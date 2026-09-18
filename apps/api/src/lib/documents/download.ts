import http from 'node:http'
import https from 'node:https'
import { Buffer } from 'node:buffer'
import {
  assertUrlSafeToFetch,
  assertUrlStructurallySafe,
  UnsafeUrlError,
  type UrlSafetyOptions,
} from '../security/urlSafety.js'
import { DOWNLOAD_TIMEOUT_MS, MAX_DOCUMENT_FILE_SIZE_BYTES, MAX_DOWNLOAD_REDIRECTS } from '@tender-os/constants'
import { logger } from '../logger.js'

export class DownloadError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'UNSAFE_URL'
      | 'TIMEOUT'
      | 'TOO_MANY_REDIRECTS'
      | 'FILE_TOO_LARGE'
      | 'HTTP_ERROR'
      | 'NETWORK_ERROR',
  ) {
    super(message)
    this.name = 'DownloadError'
  }
}

export interface DownloadResult {
  bytes: Buffer
  finalUrl: string
  statusCode: number
  contentType: string | null
  redirectCount: number
}

export interface DownloadOptions extends UrlSafetyOptions {
  maxBytes?: number
  timeoutMs?: number
  maxRedirects?: number
  /** Test seam: override DNS resolution (used by tests against a local server bound to 127.0.0.1). */
  resolver?: (hostname: string) => Promise<{ address: string; family: number }[]>
}

/**
 * Downloads a document URL under the full set of Phase 6 §4 download
 * security controls: SSRF-safe (scheme/host allow-list + resolved-IP
 * private-network rejection, applied to the initial URL AND every
 * redirect hop), bounded by timeout, byte-size cap, and redirect
 * count. Every external tender document URL is untrusted input — this
 * is the ONLY place in the pipeline that is allowed to make an
 * outbound network request for document bytes.
 *
 * Uses Node's low-level http/https modules (not fetch/undici) so the
 * TCP connection can be pinned to the exact IP address that was
 * validated as safe (via the `lookup` socket option) — closing the
 * TOCTOU gap where a second DNS lookup at connect time could resolve
 * to a different, unsafe address than the one just checked (DNS
 * rebinding).
 */
export async function downloadDocument(url: string, options: DownloadOptions): Promise<DownloadResult> {
  const maxBytes = options.maxBytes ?? MAX_DOCUMENT_FILE_SIZE_BYTES
  const timeoutMs = options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS
  const maxRedirects = options.maxRedirects ?? MAX_DOWNLOAD_REDIRECTS

  let currentUrl = url
  let redirectCount = 0

  for (;;) {
    let validated
    try {
      validated = await assertUrlSafeToFetch(currentUrl, options, options.resolver)
    } catch (error) {
      if (error instanceof UnsafeUrlError) {
        logger.warn({ url: currentUrl, reason: error.reason }, 'document download blocked: unsafe URL')
        throw new DownloadError(error.message, 'UNSAFE_URL')
      }
      throw error
    }

    const { url: parsed, resolvedAddress } = validated
    logger.info({ url: parsed.toString(), redirectCount }, 'document download: fetching')

    const response = await fetchOnce(parsed, resolvedAddress, timeoutMs)

    if (response.statusCode >= 300 && response.statusCode < 400 && response.location) {
      redirectCount += 1
      if (redirectCount > maxRedirects) {
        throw new DownloadError(`Too many redirects (> ${maxRedirects})`, 'TOO_MANY_REDIRECTS')
      }
      // Resolve a relative Location against the current URL, then the
      // NEXT loop iteration re-validates it from scratch — a redirect
      // target is exactly as untrusted as the original URL (Phase 6
      // §4: "reject unsafe redirects").
      currentUrl = new URL(response.location, parsed).toString()
      continue
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new DownloadError(`Unexpected HTTP status ${response.statusCode} for ${parsed}`, 'HTTP_ERROR')
    }

    if (response.bytes.length > maxBytes) {
      throw new DownloadError(`Downloaded file exceeds maximum size of ${maxBytes} bytes`, 'FILE_TOO_LARGE')
    }

    logger.info(
      { url: parsed.toString(), bytes: response.bytes.length, redirectCount },
      'document download: completed',
    )

    return {
      bytes: response.bytes,
      finalUrl: parsed.toString(),
      statusCode: response.statusCode,
      contentType: response.contentType,
      redirectCount,
    }
  }
}

interface RawResponse {
  statusCode: number
  location?: string
  contentType: string | null
  bytes: Buffer
}

function fetchOnce(parsed: URL, pinnedAddress: string, timeoutMs: number): Promise<RawResponse> {
  const transport = parsed.protocol === 'https:' ? https : http
  const maxBytes = MAX_DOCUMENT_FILE_SIZE_BYTES

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        headers: { host: parsed.hostname, 'user-agent': 'TenderIntelligenceOS-DocumentFetcher/1.0' },
        timeout: timeoutMs,
        // Pin the connection to the pre-validated IP address rather
        // than letting the transport re-resolve the hostname itself.
        lookup: (_hostname, opts, callback) => {
          const family = opts && typeof opts === 'object' && 'family' in opts ? (opts.family as number) : 0
          callback(null, pinnedAddress, family || (pinnedAddress.includes(':') ? 6 : 4))
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        let total = 0
        let aborted = false

        res.on('data', (chunk: Buffer) => {
          total += chunk.length
          if (total > maxBytes) {
            aborted = true
            req.destroy()
            reject(new DownloadError(`Downloaded file exceeds maximum size of ${maxBytes} bytes`, 'FILE_TOO_LARGE'))
            return
          }
          chunks.push(chunk)
        })

        res.on('end', () => {
          if (aborted) return
          resolve({
            statusCode: res.statusCode ?? 0,
            location: res.headers.location,
            contentType: res.headers['content-type'] ?? null,
            bytes: Buffer.concat(chunks),
          })
        })

        res.on('error', (err) => {
          if (!aborted) reject(new DownloadError(`Network error: ${err.message}`, 'NETWORK_ERROR'))
        })
      },
    )

    req.on('timeout', () => {
      req.destroy()
      reject(new DownloadError(`Download timed out after ${timeoutMs}ms`, 'TIMEOUT'))
    })

    req.on('error', (err) => {
      reject(new DownloadError(`Network error: ${err.message}`, 'NETWORK_ERROR'))
    })

    req.end()
  })
}

/** Re-exported for callers that only need the structural (non-DNS) check, e.g. queueing validation before a job runs. */
export { assertUrlStructurallySafe }
