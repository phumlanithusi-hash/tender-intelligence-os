import type { AdapterHealthCheckResult, DocumentReference, TenderDetails, TenderDiscovery, TenderSourceAdapter } from '../types.js'
import { discoverTransnet } from './discover.js'
import { toDocumentReferences } from './documents.js'
import { checkTransnetHealth } from './health.js'
import { createPlaywrightTransport, DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG } from './transport/playwrightTransport.js'
import type { RawTransnetTender, TransnetTransport } from './types.js'

export const TRANSNET_ADAPTER_VERSION = '1.0.0'
export const TRANSNET_ADAPTER_KEY = 'transnet'

export interface TransnetAdapterOptions {
  transport?: TransnetTransport
}

/**
 * The Transnet adapter — see types.ts's module comment for the live
 * investigation this is built from. Both real JSON endpoints already
 * carry the full record (description, contact details, a single
 * attachment URL), so `discover()` is this adapter's only live fetch
 * — `fetchDetails`/`fetchDocuments` read from what that same pass
 * already saw, same "listing already has everything" pattern as the
 * City of Johannesburg and Eskom adapters.
 */
export function createTransnetAdapter(options: TransnetAdapterOptions = {}): TenderSourceAdapter {
  const transport = options.transport ?? createPlaywrightTransport()
  const baseUrl = DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG.baseUrl

  const rowByExternalId = new Map<string, RawTransnetTender>()
  const discoveryByExternalId = new Map<string, TenderDiscovery>()

  return {
    key: TRANSNET_ADAPTER_KEY,
    version: TRANSNET_ADAPTER_VERSION,

    async discover(): Promise<TenderDiscovery[]> {
      const { discovered } = await discoverTransnet(transport, baseUrl)
      rowByExternalId.clear()
      discoveryByExternalId.clear()
      for (const item of discovered) {
        discoveryByExternalId.set(item.externalId, item)
        if (item.rawMetadata) rowByExternalId.set(item.externalId, item.rawMetadata as unknown as RawTransnetTender)
      }
      return discovered
    },

    async fetchDetails(externalId: string): Promise<TenderDetails> {
      const discovery = discoveryByExternalId.get(externalId)
      const row = rowByExternalId.get(externalId)
      if (!discovery || !row) {
        throw Object.assign(
          new Error(
            `No details available for Transnet tender "${externalId}": fetchDetails can only return what the most recent discover() call already saw, and this id wasn't in it.`,
          ),
          { code: 'NO_DETAIL_SOURCE' },
        )
      }
      return {
        ...discovery,
        description: row.descriptionOfTender ?? undefined,
        documents: toDocumentReferences(row.attachment, externalId),
      }
    },

    async fetchDocuments(externalId: string): Promise<DocumentReference[]> {
      const row = rowByExternalId.get(externalId)
      if (!row) return []
      return toDocumentReferences(row.attachment, externalId)
    },

    async healthCheck(): Promise<AdapterHealthCheckResult> {
      return checkTransnetHealth(transport)
    },
  }
}
