import { describe, expect, it } from 'vitest'
import {
  assertUrlStructurallySafe,
  isPrivateOrReservedIp,
  resolveAndValidateHost,
  UnsafeUrlError,
} from '../urlSafety.js'

describe('isPrivateOrReservedIp (Phase 6 §4/§33 — SSRF)', () => {
  it('flags loopback', () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true)
    expect(isPrivateOrReservedIp('::1')).toBe(true)
  })

  it('flags RFC1918 private ranges', () => {
    expect(isPrivateOrReservedIp('10.0.0.5')).toBe(true)
    expect(isPrivateOrReservedIp('172.16.0.5')).toBe(true)
    expect(isPrivateOrReservedIp('172.31.255.255')).toBe(true)
    expect(isPrivateOrReservedIp('192.168.1.1')).toBe(true)
  })

  it('flags link-local, including the cloud metadata address', () => {
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true)
    expect(isPrivateOrReservedIp('169.254.0.1')).toBe(true)
  })

  it('flags IPv6 unique-local and link-local', () => {
    expect(isPrivateOrReservedIp('fc00::1')).toBe(true)
    expect(isPrivateOrReservedIp('fe80::1')).toBe(true)
  })

  it('allows a genuinely public address', () => {
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false)
    expect(isPrivateOrReservedIp('93.184.216.34')).toBe(false)
  })

  it('treats an unparseable value as unsafe', () => {
    expect(isPrivateOrReservedIp('not-an-ip')).toBe(true)
  })
})

describe('assertUrlStructurallySafe (Phase 6 §4)', () => {
  const options = { allowedHosts: ['example.gov.za'] }

  it('rejects non-http(s) schemes', () => {
    expect(() => assertUrlStructurallySafe('file:///etc/passwd', options)).toThrow(UnsafeUrlError)
    expect(() => assertUrlStructurallySafe('javascript:alert(1)', options)).toThrow(UnsafeUrlError)
    expect(() => assertUrlStructurallySafe('data:text/plain;base64,AAAA', options)).toThrow(UnsafeUrlError)
    expect(() => assertUrlStructurallySafe('ftp://example.gov.za/f.pdf', options)).toThrow(UnsafeUrlError)
  })

  it('rejects a malformed URL', () => {
    expect(() => assertUrlStructurallySafe('not a url', options)).toThrow(UnsafeUrlError)
  })

  it('rejects a host not on the allow-list', () => {
    expect(() => assertUrlStructurallySafe('https://evil.example/f.pdf', options)).toThrow(UnsafeUrlError)
  })

  it('rejects "localhost" outright', () => {
    expect(() => assertUrlStructurallySafe('http://localhost/f.pdf', { allowedHosts: ['localhost'] })).toThrow(
      UnsafeUrlError,
    )
  })

  it('rejects an IP-literal host that is private, even if "allowed"', () => {
    expect(() =>
      assertUrlStructurallySafe('http://127.0.0.1/f.pdf', { allowedHosts: ['127.0.0.1'] }),
    ).toThrow(UnsafeUrlError)
    expect(() =>
      assertUrlStructurallySafe('http://169.254.169.254/latest/meta-data/', { allowedHosts: ['169.254.169.254'] }),
    ).toThrow(UnsafeUrlError)
  })

  it('accepts a well-formed, allow-listed https URL', () => {
    expect(assertUrlStructurallySafe('https://example.gov.za/f.pdf', options).hostname).toBe('example.gov.za')
  })

  it('allows a subdomain of an allow-listed host', () => {
    expect(assertUrlStructurallySafe('https://docs.example.gov.za/f.pdf', options).hostname).toBe(
      'docs.example.gov.za',
    )
  })
})

describe('resolveAndValidateHost (Phase 6 §4 — DNS rebinding defence)', () => {
  it('rejects a hostname that resolves to a private address', async () => {
    const resolver = async () => [{ address: '10.1.2.3', family: 4 }]
    await expect(resolveAndValidateHost('sneaky.example', resolver)).rejects.toThrow(UnsafeUrlError)
  })

  it('rejects a hostname that resolves to the cloud metadata address', async () => {
    const resolver = async () => [{ address: '169.254.169.254', family: 4 }]
    await expect(resolveAndValidateHost('sneaky.example', resolver)).rejects.toThrow(UnsafeUrlError)
  })

  it('accepts a hostname that resolves only to public addresses', async () => {
    const resolver = async () => [{ address: '93.184.216.34', family: 4 }]
    await expect(resolveAndValidateHost('example.gov.za', resolver)).resolves.toBe('93.184.216.34')
  })

  it('rejects when DNS resolution fails outright', async () => {
    const resolver = async () => []
    await expect(resolveAndValidateHost('nowhere.example', resolver)).rejects.toThrow(UnsafeUrlError)
  })
})
