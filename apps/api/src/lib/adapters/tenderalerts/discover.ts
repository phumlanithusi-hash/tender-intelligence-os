import type { TenderDiscovery } from '../types.js'
import { parseTenderAlertsDateTime } from './parsers/dates.js'
import { DEFAULT_TENDERALERTS_RATE_LIMIT, sleep, type TenderAlertsRateLimitConfig } from './rateLimit.js'
import type { RawListingRow, TenderAlertsTransport } from './types.js'

export interface TenderAlertsDiscoveryConfig {
  /** Hard ceiling on pages fetched in a single discovery pass (same safety-net role as every other paginated adapter's maxPages). The live site showed ~68 pages at the time this was investigated; set with headroom above that. */
  maxPages: number
}

export const DEFAULT_TENDERALERTS_DISCOVERY_CONFIG: TenderAlertsDiscoveryConfig = {
  maxPages: 120,
}

/** Maps one raw listing row into the generic adapter contract's `TenderDiscovery` shape. */
export function toTenderDiscovery(row: RawListingRow, baseUrl: string): TenderDiscovery | null {
  if (!row.externalId) return null // No usable identity — nothing to discover from this row.
  return {
    externalId: row.externalId,
    title: row.title ?? row.tenderNumber ?? '(no title provided by source)',
    url: row.detailHref ? new URL(row.detailHref, baseUrl).toString() : new URL('/tenders/all', baseUrl).toString(),
    tenderNumber: row.tenderNumber ?? undefined,
    organisation: undefined, // Not exposed on the public listing (see types.ts) — never guessed.
    closingDate: parseTenderAlertsDateTime(row.closingDateText),
    rawMetadata: { ...row },
  }
}

export async function discoverTenderAlerts(
  transport: TenderAlertsTransport,
  baseUrl: string,
  config: TenderAlertsDiscoveryConfig = DEFAULT_TENDERALERTS_DISCOVERY_CONFIG,
  rateLimit: TenderAlertsRateLimitConfig = DEFAULT_TENDERALERTS_RATE_LIMIT,
): Promise<{ discovered: TenderDiscovery[]; unidentifiableRowCount: number }> {
  const discovered: TenderDiscovery[] = []
  let unidentifiableRowCount = 0
  const seenExternalIds = new Set<string>()

  for (let page = 1; page <= config.maxPages; page += 1) {
    if (page > 1 && rateLimit.delayMs > 0) await sleep(rateLimit.delayMs)
    const rows = await transport.fetchListingPage({ page })
    if (rows.length === 0) break

    let newOnThisPage = 0
    for (const row of rows) {
      const item = toTenderDiscovery(row, baseUrl)
      if (!item) {
        unidentifiableRowCount += 1
        continue
      }
      if (seenExternalIds.has(item.externalId)) continue // Same tender appeared twice across pages (pagination overlap).
      seenExternalIds.add(item.externalId)
      discovered.push(item)
      newOnThisPage += 1
    }
    if (newOnThisPage === 0) break // No new tenders found on this page — treat as the end of pagination.
  }

  return { discovered, unidentifiableRowCount }
}
