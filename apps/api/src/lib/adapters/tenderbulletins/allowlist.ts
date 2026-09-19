export const TENDERBULLETINS_ALLOWED_HOSTS: readonly string[] = ['tenderbulletin.co.za', 'www.tenderbulletin.co.za']

export function isAllowedDocumentUrl(url: string, allowedHosts: readonly string[] = TENDERBULLETINS_ALLOWED_HOSTS): boolean {
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
