import type { TenderDiscovery } from '../types.js'
import { normaliseListingRow } from './normalise.js'
import { DEFAULT_EASYTENDERS_RATE_LIMIT, sleep, type EasyTendersRateLimitConfig } from './rateLimit.js'
import type { EasyTendersDiscoveryParams, EasyTendersTransport, RawListingRow } from './types.js'

export interface EasyTendersDiscoveryConfig {
  /** Hard ceiling on pages fetched in a single discovery pass (same safety-net role as eTenders' maxPages). */
  maxPages: number
}

export const DEFAULT_EASYTENDERS_DISCOVERY_CONFIG: EasyTendersDiscoveryConfig = {
  maxPages: 10,
}

/** Maps one raw listing row into the generic adapter contract's `TenderDiscovery` shape — the slug IS the external id here (EasyTenders exposes no separate numeric id in its public HTML). */
export function toTenderDiscovery(row: RawListingRow): TenderDiscovery | null {
  if (!row.slug) return null // No usable identity — nothing to discover from this row.
  const normalised = normaliseListingRow(row)
  return {
    externalId: row.slug,
    title: normalised.title ?? '(no title provided by source)',
    url: row.detailUrl ?? `https://easytenders.co.za/tenders/${row.slug}`,
    closingDate: normalised.closingDate ?? undefined,
    organisation: normalised.organisation ?? undefined,
    rawMetadata: { ...row },
  }
}

export async function discoverEasyTenders(
  transport: EasyTendersTransport,
  config: EasyTendersDiscoveryConfig = DEFAULT_EASYTENDERS_DISCOVERY_CONFIG,
  rateLimit: EasyTendersRateLimitConfig = DEFAULT_EASYTENDERS_RATE_LIMIT,
): Promise<{ discovered: TenderDiscovery[]; unidentifiableRowCount: number }> {
  const discovered: TenderDiscovery[] = []
  let unidentifiableRowCount = 0
  const seenSlugs = new Set<string>()

  for (let page = 1; page <= config.maxPages; page += 1) {
    if (page > 1 && rateLimit.delayMs > 0) await sleep(rateLimit.delayMs)
    const params: EasyTendersDiscoveryParams = { page }
    const rows = await transport.fetchListingPage(params)
    if (rows.length === 0) break

    let newOnThisPage = 0
    for (const row of rows) {
      const item = toTenderDiscovery(row)
      if (!item) {
        unidentifiableRowCount += 1
        continue
      }
      if (seenSlugs.has(item.externalId)) continue // Same tender's link appeared twice on one page (e.g. title + "read more").
      seenSlugs.add(item.externalId)
      discovered.push(item)
      newOnThisPage += 1
    }
    if (newOnThisPage === 0) break // No new tenders found on this page — treat as the end of pagination.
  }

  return { discovered, unidentifiableRowCount }
}
