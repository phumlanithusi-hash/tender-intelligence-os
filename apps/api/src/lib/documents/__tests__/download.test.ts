import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { downloadDocument, DownloadError } from '../download.js'

/**
 * Exercises the real download stage end-to-end against a
 * test-owned local HTTP server (Phase 6's own testing instructions:
 * "spin up a tiny local server... to exercise real download/SSRF/
 * timeout/redirect logic without needing internet access"). No live
 * external network call is made anywhere in this suite.
 */
describe('downloadDocument (Phase 6 §4)', () => {
  let server: http.Server
  let baseUrl: string

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url ?? ''
      if (url === '/file.pdf') {
        res.writeHead(200, { 'content-type': 'application/pdf' })
        res.end(Buffer.from('%PDF-1.4 fake content'))
        return
      }
      if (url === '/redirect-once') {
        res.writeHead(302, { location: '/file.pdf' })
        res.end()
        return
      }
      if (url.startsWith('/redirect-loop')) {
        const n = Number(url.split('/').pop())
        res.writeHead(302, { location: `/redirect-loop/${n + 1}` })
        res.end()
        return
      }
      if (url === '/big-file') {
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        res.end(Buffer.alloc(2000, 'x'))
        return
      }
      if (url === '/slow') {
        setTimeout(() => {
          res.writeHead(200)
          res.end('too late')
        }, 2000)
        return
      }
      if (url === '/redirect-to-private') {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' })
        res.end()
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterAll(() => {
    server.close()
  })

  // Every genuine-mechanics test targets our own loopback server, so
  // the SSRF private-network check must be explicitly (and only here)
  // relaxed via the documented test-only flag.
  const testOptions = { allowedHosts: ['127.0.0.1'], allowPrivateNetworksForTesting: true }

  it('downloads a small file successfully', async () => {
    const result = await downloadDocument(`${baseUrl}/file.pdf`, testOptions)
    expect(result.bytes.toString()).toContain('%PDF-1.4')
    expect(result.statusCode).toBe(200)
    expect(result.redirectCount).toBe(0)
  })

  it('follows a redirect and revalidates the target before following it', async () => {
    const result = await downloadDocument(`${baseUrl}/redirect-once`, testOptions)
    expect(result.bytes.toString()).toContain('%PDF-1.4')
    expect(result.redirectCount).toBe(1)
  })

  it('rejects a redirect to a private/reserved address, even mid-chain', async () => {
    await expect(downloadDocument(`${baseUrl}/redirect-to-private`, testOptions)).rejects.toThrow(DownloadError)
  })

  it('rejects too many redirects', async () => {
    await expect(
      downloadDocument(`${baseUrl}/redirect-loop/0`, { ...testOptions, maxRedirects: 2 }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REDIRECTS' })
  })

  it('rejects a file exceeding the configured maximum size', async () => {
    await expect(
      downloadDocument(`${baseUrl}/big-file`, { ...testOptions, maxBytes: 500 }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
  })

  it('times out a slow response', async () => {
    await expect(
      downloadDocument(`${baseUrl}/slow`, { ...testOptions, timeoutMs: 200 }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('rejects a host not on the allow-list', async () => {
    await expect(
      downloadDocument(`${baseUrl}/file.pdf`, { allowedHosts: ['some-other-host.example'], allowPrivateNetworksForTesting: true }),
    ).rejects.toMatchObject({ code: 'UNSAFE_URL' })
  })

  it('rejects a genuine SSRF attempt against localhost/127.0.0.1 with the real (non-test) safety check', async () => {
    await expect(downloadDocument(`${baseUrl}/file.pdf`, { allowedHosts: ['127.0.0.1'] })).rejects.toMatchObject({
      code: 'UNSAFE_URL',
    })
  })

  it('rejects a non-HTTP(S) scheme', async () => {
    await expect(downloadDocument('file:///etc/passwd', testOptions)).rejects.toMatchObject({ code: 'UNSAFE_URL' })
  })

  it('rejects a 404 as an HTTP error rather than returning an empty success', async () => {
    await expect(downloadDocument(`${baseUrl}/does-not-exist`, testOptions)).rejects.toMatchObject({
      code: 'HTTP_ERROR',
    })
  })
})
