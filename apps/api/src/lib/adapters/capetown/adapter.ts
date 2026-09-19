import type { AdapterHealthCheckResult, DocumentReference, TenderDetails, TenderDiscovery, TenderSourceAdapter } from '../types.js'
import { discoverCapeTown } from './discover.js'
import { checkCapeTownHealth } from './health.js'
import { createPlaywrightTransport, DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG } from './transport/playwrightTransport.js'
import type { CapeTownTransport } from './types.js'

export const CAPETOWN_ADAPTER_VERSION = '1.0.0'
export const CAPETOWN_ADAPTER_KEY = 'capetown'

export interface CapeTownAdapterOptions {
  transport?: CapeTownTransport
}

/**
 * The City of Cape Town adapter — discovery-only by design, same
 * reasoning as the TenderBulletins adapter: the public listing itself
 * states that further detail requires registering and logging in, and
 * this project does not automate past a source's own login wall (see
 * that adapter's module comment). `fetchDetails` returns only what
 * the most recent `discover()` call already saw; `fetchDocuments`
 * always returns `[]` since no public document links exist here.
 */
export function createCapeTownAdapter(options: CapeTownAdapterOptions = {}): TenderSourceAdapter {
  const transport = options.transport ?? createPlaywrightTransport()
  const listingUrl = new URL(DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG.listingPath, DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG.baseUrl).toString()

  const discoveredByExternalId = new Map<string, TenderDiscovery>()

  return {
    key: CAPETOWN_ADAPTER_KEY,
    version: CAPETOWN_ADAPTER_VERSION,

    async discover(): Promise<TenderDiscovery[]> {
      const { discovered } = await discoverCapeTown(transport, listingUrl)
      discoveredByExternalId.clear()
      for (const item of discovered) discoveredByExternalId.set(item.externalId, item)
      return discovered
    },

    async fetchDetails(externalId: string): Promise<TenderDetails> {
      const discovery = discoveredByExternalId.get(externalId)
      if (!discovery) {
        throw Object.assign(
          new Error(
            `No details available for City of Cape Town tender "${externalId}": this source requires login for anything beyond the public listing, so fetchDetails can only return what the most recent discover() call already saw, and this id wasn't in it.`,
          ),
          { code: 'NO_DETAIL_SOURCE' },
        )
      }
      return { ...discovery, documents: [] }
    },

    async fetchDocuments(_externalId: string): Promise<DocumentReference[]> {
      return [] // No public document links exist on this source — they sit behind the same login wall this adapter refuses to cross.
    },

    async healthCheck(): Promise<AdapterHealthCheckResult> {
      return checkCapeTownHealth(transport)
    },
  }
}
