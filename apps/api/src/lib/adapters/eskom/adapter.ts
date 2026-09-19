import type { AdapterHealthCheckResult, DocumentReference, TenderDetails, TenderDiscovery, TenderSourceAdapter } from '../types.js'
import { discoverEskom } from './discover.js'
import { toDocumentReferences } from './documents.js'
import { checkEskomHealth } from './health.js'
import { createPlaywrightTransport, DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG } from './transport/playwrightTransport.js'
import type { EskomTransport, RawTenderCard } from './types.js'

export const ESKOM_ADAPTER_VERSION = '1.0.0'
export const ESKOM_ADAPTER_KEY = 'eskom'

export interface EskomAdapterOptions {
  transport?: EskomTransport
}

/**
 * The Eskom adapter — see types.ts's module comment for the live-site
 * investigation this is built from. Like the City of Johannesburg
 * adapter, the listing card already carries the full record
 * (reference, description, organisation, location, dates, a document
 * bundle link), so `discover()` is this adapter's only live fetch —
 * `fetchDetails`/`fetchDocuments` read from what that same pass
 * already saw, rather than visiting each tender's own `/tender/{id}`
 * detail page separately (that page exists but was never needed).
 */
export function createEskomAdapter(options: EskomAdapterOptions = {}): TenderSourceAdapter {
  const transport = options.transport ?? createPlaywrightTransport()
  const baseUrl = DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG.baseUrl

  const cardByExternalId = new Map<string, RawTenderCard>()
  const discoveryByExternalId = new Map<string, TenderDiscovery>()

  return {
    key: ESKOM_ADAPTER_KEY,
    version: ESKOM_ADAPTER_VERSION,

    async discover(): Promise<TenderDiscovery[]> {
      const { discovered } = await discoverEskom(transport, baseUrl)
      cardByExternalId.clear()
      discoveryByExternalId.clear()
      for (const item of discovered) {
        discoveryByExternalId.set(item.externalId, item)
        if (item.rawMetadata) cardByExternalId.set(item.externalId, item.rawMetadata as unknown as RawTenderCard)
      }
      return discovered
    },

    async fetchDetails(externalId: string): Promise<TenderDetails> {
      const discovery = discoveryByExternalId.get(externalId)
      const card = cardByExternalId.get(externalId)
      if (!discovery || !card) {
        throw Object.assign(
          new Error(
            `No details available for Eskom tender "${externalId}": fetchDetails can only return what the most recent discover() call already saw on the listing, and this id wasn't in it.`,
          ),
          { code: 'NO_DETAIL_SOURCE' },
        )
      }
      return {
        ...discovery,
        description: card.description ?? undefined,
        documents: toDocumentReferences(card.downloadAllDocsUrl, externalId, baseUrl),
      }
    },

    async fetchDocuments(externalId: string): Promise<DocumentReference[]> {
      const card = cardByExternalId.get(externalId)
      if (!card) return []
      return toDocumentReferences(card.downloadAllDocsUrl, externalId, baseUrl)
    },

    async healthCheck(): Promise<AdapterHealthCheckResult> {
      return checkEskomHealth(transport)
    },
  }
}
