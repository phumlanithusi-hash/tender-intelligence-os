import type { TenderDiscovery } from '../types.js'
import { normaliseListingRow } from './normalise.js'
import { DEFAULT_ETENDERS_RATE_LIMIT, sleep, type EtendersRateLimitConfig } from './rateLimit.js'
import type { EtendersTransport, RawListingRow } from './types.js'

/** Phase 5 §5: controlled discovery scope — no unlimited historical scraping. */
export interface EtendersDiscoveryConfig {
  /** Default conservative first-run scope: current/open opportunities only, never the full historical portal. */
  statusFilter: 'OPEN' | 'ALL'
  pageSize: number
  /** Hard ceiling on pages fetched in a single discovery pass, regardless of how many the site reports — the safety net against unbounded scraping even if a future config mistake requests ALL. */
  maxPages: number
  advertisedFrom?: string
}

/**
 * Phase 5 §5's documented default: conservative, current-opportunities
 * only, capped page count. A production deployment that wants deeper
 * historical coverage must opt in explicitly (`statusFilter: 'ALL'`
 * and/or a higher `maxPages`) — this is never the default.
 */
export const DEFAULT_ETENDERS_DISCOVERY_CONFIG: EtendersDiscoveryConfig = {
  statusFilter: 'OPEN',
  pageSize: 25,
  maxPages: 10,
}

function externalIdFromRow(row: RawListingRow): string | null {
  if (row.externalId) return row.externalId
  if (!row.detailUrl) return null
  try {
    const url = new URL(row.detailUrl, 'https://www.etenders.gov.za')
    return url.searchParams.get('id')
  } catch {
    return null
  }
}

/** Maps one raw listing row into the generic adapter contract's `TenderDiscovery` shape — the ONLY place this adapter constructs that shape, so every caller sees the exact same mapping rules. */
export function toTenderDiscovery(row: RawListingRow): TenderDiscovery | null {
  const externalId = externalIdFromRow(row)
  if (!externalId) return null // Cannot even identify the record — nothing usable to discover (Phase 5 §4: nullable/unknown over fabrication; here the identity itself is unknown, so the row is unusable).

  const normalised = normaliseListingRow(row)
  return {
    externalId,
    title: normalised.title ?? '(no title provided by source)',
    url: row.detailUrl ?? `https://www.etenders.gov.za/Home/opportunities?id=${externalId}`,
    publishedDate: normalised.publishedDate ?? undefined,
    closingDate: normalised.closingDate ?? undefined,
    organisation: normalised.organisation ?? undefined,
    tenderNumber: normalised.tenderNumber ?? undefined,
    rawMetadata: { ...row },
  }
}

/**
 * Runs a controlled, paginated discovery pass (Phase 5 §5/§16): pages
 * are fetched sequentially (never in parallel), stopping at the first
 * empty page or `maxPages`, whichever comes first. A row this adapter
 * cannot even identify (see `toTenderDiscovery`) is dropped from the
 * result rather than thrown — the caller (the scan runner) is the one
 * responsible for recording that as a structured failure with a count,
 * not this pure discovery step.
 */
export async function discoverEtenders(
  transport: EtendersTransport,
  config: EtendersDiscoveryConfig = DEFAULT_ETENDERS_DISCOVERY_CONFIG,
  rateLimit: EtendersRateLimitConfig = DEFAULT_ETENDERS_RATE_LIMIT,
): Promise<{ discovered: TenderDiscovery[]; unidentifiableRowCount: number }> {
  const discovered: TenderDiscovery[] = []
  let unidentifiableRowCount = 0

  for (let page = 1; page <= config.maxPages; page += 1) {
    if (page > 1 && rateLimit.delayMs > 0) await sleep(rateLimit.delayMs) // Phase 5 §16: never fetch pages back-to-back with no delay.
    const rows = await transport.fetchListingPage({
      page,
      pageSize: config.pageSize,
      statusFilter: config.statusFilter,
      advertisedFrom: config.advertisedFrom,
    })
    if (rows.length === 0) break

    for (const row of rows) {
      const item = toTenderDiscovery(row)
      if (item) discovered.push(item)
      else unidentifiableRowCount += 1
    }

    if (rows.length < config.pageSize) break // Short page — this was the last one.
  }

  return { discovered, unidentifiableRowCount }
}
