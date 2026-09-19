/**
 * Domain allow-list for any URL this adapter ever fetches — the same
 * pattern and rationale as adapters/etenders/allowlist.ts (Phase 5
 * §31, applied identically to every scraping adapter this system
 * builds, not just the first one).
 */

/**
 * The site's own domain plus the document CDN it uses for actual file
 * downloads (`documents.easytenders.co.za`, observed directly on a
 * real tender's detail page during this adapter's build) — no other
 * host is ever fetched by this adapter.
 */
export const EASYTENDERS_ALLOWED_HOSTS: readonly string[] = [
  'easytenders.co.za',
  'www.easytenders.co.za',
  'documents.easytenders.co.za',
]

/** Same shape/rules as isAllowedDocumentUrl in adapters/etenders/allowlist.ts — https-only, exact host or subdomain match, never a substring match. */
export function isAllowedDocumentUrl(url: string, allowedHosts: readonly string[] = EASYTENDERS_ALLOWED_HOSTS): boolean {
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
