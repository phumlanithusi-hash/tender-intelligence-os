import type { TenderDiscovery } from '../types.js'
import { normaliseListingRow } from './normalise.js'
import type { RawListingRow, TenderBulletinsTransport } from './types.js'

/**
 * Discovery-only, single-pass — there is no confirmed pagination
 * mechanism for the public `/search` listing (see types.ts's
 * documented gap), so this fetches the one page the transport can
 * reach and stops. No maxPages/rateLimit config exists yet because
 * there is nothing to page through or throttle between calls.
 */

/** Maps one raw listing row into the generic adapter contract's `TenderDiscovery` shape. There is no real per-tender URL on this source (see types.ts) — `url` honestly points at the shared `/search` listing page rather than a fabricated per-tender link. */
export function toTenderDiscovery(row: RawListingRow): TenderDiscovery | null {
  if (!row.tenderId) return null // No usable identity — nothing to discover from this row.
  const normalised = normaliseListingRow(row)
  return {
    externalId: row.tenderId,
    title: normalised.title ?? '(no title provided by source)',
    url: 'https://www.tenderbulletin.co.za/search',
    closingDate: normalised.closingDate ?? undefined,
    organisation: normalised.organisation ?? undefined,
    rawMetadata: { ...row },
  }
}

export async function discoverTenderBulletins(
  transport: TenderBulletinsTransport,
): Promise<{ discovered: TenderDiscovery[]; unidentifiableRowCount: number }> {
  const discovered: TenderDiscovery[] = []
  let unidentifiableRowCount = 0
  const seenIds = new Set<string>()

  const rows = await transport.fetchListingPage()
  for (const row of rows) {
    const item = toTenderDiscovery(row)
    if (!item) {
      unidentifiableRowCount += 1
      continue
    }
    if (seenIds.has(item.externalId)) continue // Same tender appeared twice on the page.
    seenIds.add(item.externalId)
    discovered.push(item)
  }

  return { discovered, unidentifiableRowCount }
}
