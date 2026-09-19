import type { TenderDiscovery } from '../types.js'
import { parseCapeTownDateTime } from './parsers/dates.js'
import type { CapeTownTransport, RawTenderRow } from './types.js'

/** Maps one raw row into the generic adapter contract's `TenderDiscovery` shape. */
export function toTenderDiscovery(row: RawTenderRow, listingUrl: string): TenderDiscovery | null {
  if (!row.externalId) return null // No usable identity — nothing to discover from this row.
  return {
    externalId: row.externalId,
    title: row.description ?? row.tenderNumber ?? '(no description provided by source)',
    url: listingUrl,
    tenderNumber: row.tenderNumber ?? undefined,
    organisation: row.directorate ?? undefined,
    closingDate: parseCapeTownDateTime(row.closingDateText),
    publishedDate: parseCapeTownDateTime(row.postedDateText),
    rawMetadata: { ...row },
  }
}

export async function discoverCapeTown(
  transport: CapeTownTransport,
  listingUrl: string,
): Promise<{ discovered: TenderDiscovery[]; unidentifiableRowCount: number }> {
  const rows = await transport.fetchAllTenders()
  const discovered: TenderDiscovery[] = []
  let unidentifiableRowCount = 0
  const seenExternalIds = new Set<string>()

  for (const row of rows) {
    const item = toTenderDiscovery(row, listingUrl)
    if (!item) {
      unidentifiableRowCount += 1
      continue
    }
    if (seenExternalIds.has(item.externalId)) continue // A row appeared twice across pages (pagination overlap).
    seenExternalIds.add(item.externalId)
    discovered.push(item)
  }

  return { discovered, unidentifiableRowCount }
}
