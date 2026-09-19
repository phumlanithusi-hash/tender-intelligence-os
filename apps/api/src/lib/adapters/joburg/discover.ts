import type { TenderDiscovery } from '../types.js'
import { parseJoburgClosingDate } from './parsers/dates.js'
import type { JoburgTransport, RawBidProposalRow } from './types.js'

/** The City of Johannesburg's own name, as recorded in the tender_sources registry — this adapter only ever discovers the City's own procurement, so the organisation is always the City itself (there is no per-row organisation field on the listing). */
export const JOBURG_ORGANISATION_NAME = 'City of Johannesburg'

/** Maps one raw listing row into the generic adapter contract's `TenderDiscovery` shape. The reference number IS the external id — the listing exposes no separate numeric id. */
export function toTenderDiscovery(row: RawBidProposalRow, listingUrl: string): TenderDiscovery | null {
  if (!row.referenceNumber) return null // No usable identity — nothing to discover from this row.
  return {
    externalId: row.referenceNumber,
    title: row.description ?? '(no description provided by source)',
    url: listingUrl,
    tenderNumber: row.referenceNumber,
    organisation: JOBURG_ORGANISATION_NAME,
    closingDate: parseJoburgClosingDate(row.closingDateText),
    rawMetadata: { ...row },
  }
}

export async function discoverJoburg(
  transport: JoburgTransport,
  listingUrl: string,
): Promise<{ discovered: TenderDiscovery[]; unidentifiableRowCount: number }> {
  const rows = await transport.fetchBidProposalsPage()
  const discovered: TenderDiscovery[] = []
  let unidentifiableRowCount = 0
  const seenReferenceNumbers = new Set<string>()

  for (const row of rows) {
    const item = toTenderDiscovery(row, listingUrl)
    if (!item) {
      unidentifiableRowCount += 1
      continue
    }
    if (seenReferenceNumbers.has(item.externalId)) continue // Same reference number appeared twice (shouldn't normally happen, but never double-count).
    seenReferenceNumbers.add(item.externalId)
    discovered.push(item)
  }

  return { discovered, unidentifiableRowCount }
}
