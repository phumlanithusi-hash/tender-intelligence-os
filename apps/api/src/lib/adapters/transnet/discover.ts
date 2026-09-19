import type { TenderDiscovery } from '../types.js'
import { parseTransnetDateTime } from './parsers/dates.js'
import type { RawTransnetTender, TransnetTransport } from './types.js'

/** Maps one raw JSON row into the generic adapter contract's `TenderDiscovery` shape. `rowKey` is the source's own stable numeric id — used as `externalId` rather than `tenderNumber`, which is free text and not guaranteed unique across the two endpoints. */
export function toTenderDiscovery(row: RawTransnetTender, baseUrl: string): TenderDiscovery | null {
  if (!row.rowKey) return null // No usable identity — nothing to discover from this row.
  return {
    externalId: row.rowKey,
    title: row.nameOfTender ?? row.tenderNumber ?? '(no title provided by source)',
    url: new URL(`/Home/TenderDetails?Id=${encodeURIComponent(row.rowKey)}`, baseUrl).toString(),
    tenderNumber: row.tenderNumber ?? undefined,
    organisation: row.nameOfInstitution ?? undefined,
    closingDate: parseTransnetDateTime(row.closingDate),
    publishedDate: parseTransnetDateTime(row.publishedDate),
    rawMetadata: { ...row },
  }
}

export async function discoverTransnet(
  transport: TransnetTransport,
  baseUrl: string,
): Promise<{ discovered: TenderDiscovery[]; unidentifiableRowCount: number }> {
  const discovered: TenderDiscovery[] = []
  let unidentifiableRowCount = 0
  const seenExternalIds = new Set<string>()

  const rows = await transport.fetchAllTenders()
  for (const row of rows) {
    const item = toTenderDiscovery(row, baseUrl)
    if (!item) {
      unidentifiableRowCount += 1
      continue
    }
    if (seenExternalIds.has(item.externalId)) continue // Same tender appeared on both endpoints, or twice on one.
    seenExternalIds.add(item.externalId)
    discovered.push(item)
  }

  return { discovered, unidentifiableRowCount }
}
