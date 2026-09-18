/**
 * Domain allow-list for any URL this adapter ever fetches (Phase 5
 * §31: "Implement a domain allow-list check as a pure, unit-tested
 * function before any document fetch logic — even discovery-only —
 * touches an externally-supplied URL"). Every URL a page hands us
 * (a detail link, a document link) is untrusted external data and
 * must be checked against this list before it is ever passed to any
 * fetch/navigation call, including inside a browser context.
 */

/** eTenders' own domain plus its documented apex — no other host is ever fetched by this adapter. */
export const ETENDERS_ALLOWED_HOSTS: readonly string[] = ['www.etenders.gov.za', 'etenders.gov.za']

/**
 * Returns true only for an absolute `https:` URL whose hostname is
 * exactly one of `allowedHosts` (or a subdomain of one) — never for a
 * relative URL (those must be resolved against the known base URL
 * first, by the caller, precisely so this function only ever judges a
 * fully-qualified origin), never for `http:`, `javascript:`, `data:`,
 * or any other scheme, and never via a substring/prefix match that a
 * crafted hostname like `www.etenders.gov.za.evil.example` could pass.
 */
export function isAllowedDocumentUrl(url: string, allowedHosts: readonly string[] = ETENDERS_ALLOWED_HOSTS): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol !== 'https:') return false

  const host = parsed.hostname.toLowerCase()
  return allowedHosts.some((allowed) => {
    const normalisedAllowed = allowed.toLowerCase()
    return host === normalisedAllowed || host.endsWith(`.${normalisedAllowed}`)
  })
}
