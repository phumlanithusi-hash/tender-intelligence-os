import dns from 'node:dns'
import net from 'node:net'

/**
 * Shared SSRF-protection primitives for any code path in this API
 * that fetches a URL supplied (directly or indirectly) by external
 * data — tender source adapters (Phase 5) and the document download
 * stage (Phase 6 §4). Phase 5's `adapters/etenders/allowlist.ts`
 * keeps its own narrow, already-tested `isAllowedDocumentUrl` (a pure
 * domain check with no network I/O) unmodified; this module adds what
 * Phase 5 never needed — resolving a hostname and rejecting it if it
 * points at a private, loopback, link-local, or otherwise reserved
 * network, including the cloud metadata address 169.254.169.254 — so
 * the document downloader can't be tricked into fetching an internal
 * resource via a public-looking hostname that actually resolves
 * inward (DNS rebinding), or via a redirect to one.
 */

export class UnsafeUrlError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
  ) {
    super(message)
    this.name = 'UnsafeUrlError'
  }
}

/** Schemes this API will ever fetch. Everything else (file:, javascript:, data:, ftp:, ...) is rejected outright. */
export const ALLOWED_URL_SCHEMES: readonly string[] = ['http:', 'https:']

/**
 * True for an IPv4 or IPv6 literal that is loopback, private,
 * link-local (including the 169.254.169.254 cloud metadata address),
 * unique-local, or otherwise not a legitimate public destination.
 * Never trust an address only until this returns false — this is the
 * final SSRF gate, applied to every literal in a URL and to every
 * address a hostname resolves to.
 */
export function isPrivateOrReservedIp(address: string): boolean {
  const kind = net.isIP(address)
  if (kind === 4) return isPrivateIpv4(address)
  if (kind === 6) return isPrivateIpv6(address)
  return true // Not a parseable IP literal at all — never treat as safe.
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true
  const a = parts[0] ?? 0
  const b = parts[1] ?? 0
  if (a === 127) return true // loopback
  if (a === 10) return true // private
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  if (a === 169 && b === 254) return true // link-local, incl. 169.254.169.254 cloud metadata
  if (a === 0) return true // "this network"
  if (a >= 224) return true // multicast/reserved/broadcast range
  return false
}

function isPrivateIpv6(address: string): boolean {
  const normalised = address.toLowerCase()
  if (normalised === '::1' || normalised === '::') return true
  if (normalised.startsWith('fe80:')) return true // link-local
  if (normalised.startsWith('fc') || normalised.startsWith('fd')) return true // unique local (fc00::/7)
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — check the embedded IPv4.
  const mapped = normalised.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped?.[1]) return isPrivateIpv4(mapped[1])
  return false
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', '0.0.0.0'])

export interface UrlSafetyOptions {
  /** Allowed hostnames (exact or subdomain match); a URL whose host isn't in this list is rejected. */
  allowedHosts: readonly string[]
  /**
   * TEST-ONLY escape hatch: skips the private/reserved-network reject
   * so a test can point the download stage at its own
   * locally-bound HTTP server (127.0.0.1) to genuinely exercise
   * redirects/timeouts/size-limits end-to-end, per Phase 6's own
   * testing instructions ("spin up a tiny local server... localhost
   * is reachable within this sandbox for a test-owned server").
   * Production code must NEVER set this — nothing in this codebase's
   * request-handling path passes it, and its name says exactly why it
   * exists so it can't be flipped on by accident.
   */
  allowPrivateNetworksForTesting?: boolean
}

function hostAllowed(hostname: string, allowedHosts: readonly string[]): boolean {
  const host = hostname.toLowerCase()
  return allowedHosts.some((allowed) => {
    const normalised = allowed.toLowerCase()
    return host === normalised || host.endsWith(`.${normalised}`)
  })
}

/**
 * Validates a URL's scheme and hostname allow-list membership only —
 * no DNS resolution. Cheap, synchronous, safe to call on untrusted
 * input before doing anything else with it (Phase 6 §4: "validate URL
 * ... before downloading").
 */
export function assertUrlStructurallySafe(url: string, options: UrlSafetyOptions): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new UnsafeUrlError(`Malformed URL: ${url}`, 'MALFORMED_URL')
  }

  if (!ALLOWED_URL_SCHEMES.includes(parsed.protocol)) {
    throw new UnsafeUrlError(`Unsupported URL scheme: ${parsed.protocol}`, 'UNSUPPORTED_SCHEME')
  }

  const hostname = parsed.hostname.toLowerCase()
  if (!options.allowPrivateNetworksForTesting) {
    if (LOOPBACK_HOSTNAMES.has(hostname)) {
      throw new UnsafeUrlError(`Refusing to fetch loopback host: ${hostname}`, 'PRIVATE_NETWORK')
    }

    // An IP literal in the URL is checked directly, with no DNS lookup
    // needed — this also catches decimal/octal/hex IP obfuscation only
    // to the extent Node's own URL parser normalises it, which is the
    // same trust boundary the rest of the platform already relies on.
    if (net.isIP(hostname) && isPrivateOrReservedIp(hostname)) {
      throw new UnsafeUrlError(`Refusing to fetch private/reserved address: ${hostname}`, 'PRIVATE_NETWORK')
    }
  }

  if (!hostAllowed(hostname, options.allowedHosts)) {
    throw new UnsafeUrlError(`Host not on the allow-list: ${hostname}`, 'HOST_NOT_ALLOWED')
  }

  return parsed
}

/**
 * Resolves the URL's hostname and rejects it if ANY resolved address
 * is private/reserved (Phase 6 §4/§33: SSRF via DNS rebinding — a
 * hostname that passes the allow-list but resolves to an internal
 * address). Returns the first safe resolved address so the caller can
 * pin the actual TCP connection to it (defeating a second DNS lookup
 * resolving somewhere else between this check and the real connect).
 */
export async function resolveAndValidateHost(
  hostname: string,
  resolver: (hostname: string) => Promise<{ address: string; family: number }[]> = defaultResolve,
  allowPrivateNetworksForTesting = false,
): Promise<string> {
  if (net.isIP(hostname)) {
    if (!allowPrivateNetworksForTesting && isPrivateOrReservedIp(hostname)) {
      throw new UnsafeUrlError(`Refusing to fetch private/reserved address: ${hostname}`, 'PRIVATE_NETWORK')
    }
    return hostname
  }

  const addresses = await resolver(hostname)
  if (addresses.length === 0) {
    throw new UnsafeUrlError(`DNS resolution failed for host: ${hostname}`, 'DNS_RESOLUTION_FAILED')
  }
  if (!allowPrivateNetworksForTesting) {
    for (const { address } of addresses) {
      if (isPrivateOrReservedIp(address)) {
        throw new UnsafeUrlError(
          `Host ${hostname} resolves to a private/reserved address (${address})`,
          'PRIVATE_NETWORK',
        )
      }
    }
  }
  const first = addresses[0]
  if (!first) throw new UnsafeUrlError(`DNS resolution failed for host: ${hostname}`, 'DNS_RESOLUTION_FAILED')
  return first.address
}

async function defaultResolve(hostname: string): Promise<{ address: string; family: number }[]> {
  return dns.promises.lookup(hostname, { all: true })
}

/**
 * Full validation for one hop of a download (Phase 6 §4): structural
 * checks plus DNS-resolved private-network checks. Every redirect
 * target must be re-validated through this same function before it is
 * ever followed (Phase 6 §4: "validate redirect targets... reject
 * unsafe redirects").
 */
export async function assertUrlSafeToFetch(
  url: string,
  options: UrlSafetyOptions,
  resolver?: (hostname: string) => Promise<{ address: string; family: number }[]>,
): Promise<{ url: URL; resolvedAddress: string }> {
  const parsed = assertUrlStructurallySafe(url, options)
  const resolvedAddress = await resolveAndValidateHost(parsed.hostname, resolver, options.allowPrivateNetworksForTesting)
  return { url: parsed, resolvedAddress }
}
