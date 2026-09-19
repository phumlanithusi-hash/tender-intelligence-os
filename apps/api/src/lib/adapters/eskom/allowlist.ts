/**
 * Domain allow-list for any URL this adapter ever fetches — same
 * pattern/rationale as every other adapter's allowlist.ts (Phase 5
 * §31). Eskom's tender bulletin (and its document-bundle downloads)
 * live on a dedicated subdomain, separate from the main eskom.co.za
 * corporate site.
 */
export const ESKOM_ALLOWED_HOSTS: readonly string[] = ['tenderbulletin.eskom.co.za', 'eskom.co.za', 'www.eskom.co.za']

export function isAllowedDocumentUrl(url: string, allowedHosts: readonly string[] = ESKOM_ALLOWED_HOSTS): boolean {
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
