/**
 * Domain allow-list for any URL this adapter ever fetches — same
 * pattern/rationale as every other adapter's allowlist.ts (Phase 5
 * §31). The City of Johannesburg serves its bid-proposal PDFs from
 * its own domain (no separate document CDN, unlike EasyTenders).
 */
export const JOBURG_ALLOWED_HOSTS: readonly string[] = ['joburg.org.za', 'www.joburg.org.za']

export function isAllowedDocumentUrl(url: string, allowedHosts: readonly string[] = JOBURG_ALLOWED_HOSTS): boolean {
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
