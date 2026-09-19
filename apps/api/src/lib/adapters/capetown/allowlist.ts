/** Domain allow-list for any URL this adapter ever fetches — same pattern/rationale as every other adapter's allowlist.ts (Phase 5 §31). */
export const CAPETOWN_ALLOWED_HOSTS: readonly string[] = ['web1.capetown.gov.za', 'capetown.gov.za', 'www.capetown.gov.za']

export function isAllowedDocumentUrl(url: string, allowedHosts: readonly string[] = CAPETOWN_ALLOWED_HOSTS): boolean {
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
