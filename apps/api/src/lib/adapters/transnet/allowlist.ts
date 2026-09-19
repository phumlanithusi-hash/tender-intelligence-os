/**
 * Domain allow-list for any URL this adapter ever fetches — same
 * pattern/rationale as every other adapter's allowlist.ts (Phase 5
 * §31). Transnet's real tender system lives on a separate Azure App
 * Service subdomain (not transnet.net itself — see types.ts's module
 * comment), and each tender's single attachment is served from one of
 * two Azure Blob Storage containers (confirmed live: both a
 * "publishedetenders" and a "publishedetendersdev" container appear
 * as real attachment hosts across different tenders).
 */
export const TRANSNET_ALLOWED_HOSTS: readonly string[] = [
  'transnetetenders.azurewebsites.net',
  'publishedetenders.blob.core.windows.net',
  'publishedetendersdev.blob.core.windows.net',
]

export function isAllowedDocumentUrl(url: string, allowedHosts: readonly string[] = TRANSNET_ALLOWED_HOSTS): boolean {
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
