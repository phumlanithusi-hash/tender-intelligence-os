import type { TenderDiscovery } from '../types.js'
import { parseEskomDateTime } from './parsers/dates.js'
import { DEFAULT_ESKOM_RATE_LIMIT, sleep, type EskomRateLimitConfig } from './rateLimit.js'
import type { EskomTransport, RawTenderCard } from './types.js'

export interface EskomDiscoveryConfig {
  /** Hard ceiling on pages fetched in a single discovery pass (same safety-net role as every other paginated adapter's maxPages). */
  maxPages: number
  pageSize: number
}

export const DEFAULT_ESKOM_DISCOVERY_CONFIG: EskomDiscoveryConfig = {
  maxPages: 25,
  pageSize: 20,
}

/** Maps one raw card into the generic adapter contract's `TenderDiscovery` shape. The numeric TENDER_ID is the external id — see types.ts for why the reference-number text alone isn't safe to use as identity. */
export function toTenderDiscovery(card: RawTenderCard, baseUrl: string): TenderDiscovery | null {
  if (!card.externalId) return null // No usable identity — nothing to discover from this card.
  return {
    externalId: card.externalId,
    title: card.referenceNumber ?? card.description ?? '(no title provided by source)',
    url: card.detailUrl ? new URL(card.detailUrl, baseUrl).toString() : new URL(`/tender/${card.externalId}`, baseUrl).toString(),
    tenderNumber: card.referenceNumber ?? undefined,
    organisation: card.organisation ?? undefined,
    closingDate: parseEskomDateTime(card.closingDateText),
    publishedDate: parseEskomDateTime(card.publishedDateText),
    rawMetadata: { ...card },
  }
}

export async function discoverEskom(
  transport: EskomTransport,
  baseUrl: string,
  config: EskomDiscoveryConfig = DEFAULT_ESKOM_DISCOVERY_CONFIG,
  rateLimit: EskomRateLimitConfig = DEFAULT_ESKOM_RATE_LIMIT,
): Promise<{ discovered: TenderDiscovery[]; unidentifiableRowCount: number }> {
  const discovered: TenderDiscovery[] = []
  let unidentifiableRowCount = 0
  const seenExternalIds = new Set<string>()

  for (let pageNumber = 1; pageNumber <= config.maxPages; pageNumber += 1) {
    if (pageNumber > 1 && rateLimit.delayMs > 0) await sleep(rateLimit.delayMs)
    const cards = await transport.fetchListingPage({ pageNumber, pageSize: config.pageSize })
    if (cards.length === 0) break

    let newOnThisPage = 0
    for (const card of cards) {
      const item = toTenderDiscovery(card, baseUrl)
      if (!item) {
        unidentifiableRowCount += 1
        continue
      }
      if (seenExternalIds.has(item.externalId)) continue // Same tender's card appeared twice across pages (pagination overlap).
      seenExternalIds.add(item.externalId)
      discovered.push(item)
      newOnThisPage += 1
    }
    if (newOnThisPage === 0) break // No new tenders found on this page — treat as the end of pagination.
  }

  return { discovered, unidentifiableRowCount }
}
