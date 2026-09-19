import type { AdapterHealthCheckResult, DocumentReference, TenderDetails, TenderDiscovery, TenderSourceAdapter } from '../types.js'
import { discoverJoburg, JOBURG_ORGANISATION_NAME } from './discover.js'
import { toDocumentReferences } from './documents.js'
import { checkJoburgHealth } from './health.js'
import { createPlaywrightTransport, DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG } from './transport/playwrightTransport.js'
import type { JoburgTransport, RawBidProposalRow } from './types.js'

export const JOBURG_ADAPTER_VERSION = '1.0.0'
export const JOBURG_ADAPTER_KEY = 'joburg'

export interface JoburgAdapterOptions {
  transport?: JoburgTransport
}

/**
 * The City of Johannesburg adapter — see types.ts's module comment
 * for the live-site investigation this is built from. Unlike
 * eTenders/EasyTenders, there is no separate per-tender detail page:
 * the single listing table already carries the full record (reference
 * number, description, closing date, every document link), so
 * `discover()` is this adapter's ONLY live fetch — `fetchDetails` and
 * `fetchDocuments` both read from what that same call already saw,
 * exactly like the TenderBulletins adapter's `fetchDetails` (see that
 * adapter's module comment for the same "throws rather than
 * fabricates" reasoning), except this source DOES expose real public
 * document links, so `fetchDocuments` returns them rather than `[]`.
 */
export function createJoburgAdapter(options: JoburgAdapterOptions = {}): TenderSourceAdapter {
  const transport = options.transport ?? createPlaywrightTransport()
  const listingUrl = new URL(DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG.listingPath, DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG.baseUrl).toString()

  // Remembers each discovered item's full raw row (including its
  // document links) for this process's most recent discover() call,
  // keyed by externalId (the tender's own reference number) — the
  // only source fetchDetails/fetchDocuments have, since there is no
  // detail page to fetch from independently.
  const rowByExternalId = new Map<string, RawBidProposalRow>()
  const discoveryByExternalId = new Map<string, TenderDiscovery>()

  return {
    key: JOBURG_ADAPTER_KEY,
    version: JOBURG_ADAPTER_VERSION,

    async discover(): Promise<TenderDiscovery[]> {
      const { discovered } = await discoverJoburg(transport, listingUrl)
      rowByExternalId.clear()
      discoveryByExternalId.clear()
      for (const item of discovered) {
        discoveryByExternalId.set(item.externalId, item)
        if (item.rawMetadata) rowByExternalId.set(item.externalId, item.rawMetadata as unknown as RawBidProposalRow)
      }
      return discovered
    },

    async fetchDetails(externalId: string): Promise<TenderDetails> {
      const discovery = discoveryByExternalId.get(externalId)
      const row = rowByExternalId.get(externalId)
      if (!discovery || !row) {
        throw Object.assign(
          new Error(
            `No details available for City of Johannesburg tender "${externalId}": this source has no separate detail page, so fetchDetails can only return what the most recent discover() call already saw on the listing, and this id wasn't in it.`,
          ),
          { code: 'NO_DETAIL_SOURCE' },
        )
      }
      return {
        ...discovery,
        organisation: JOBURG_ORGANISATION_NAME,
        description: row.description ?? undefined,
        documents: toDocumentReferences(row.documents),
      }
    },

    async fetchDocuments(externalId: string): Promise<DocumentReference[]> {
      const row = rowByExternalId.get(externalId)
      if (!row) return []
      return toDocumentReferences(row.documents)
    },

    async healthCheck(): Promise<AdapterHealthCheckResult> {
      return checkJoburgHealth(transport)
    },
  }
}
