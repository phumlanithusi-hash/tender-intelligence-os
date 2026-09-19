import type { AdapterHealthCheckResult, DocumentReference, TenderDetails, TenderDiscovery, TenderSourceAdapter } from '../types.js'
import { discoverTenderAlerts } from './discover.js'
import { checkTenderAlertsHealth } from './health.js'
import { createPlaywrightTransport, DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG } from './transport/playwrightTransport.js'
import type { TenderAlertsTransport } from './types.js'

export const TENDERALERTS_ADAPTER_VERSION = '1.0.0'
export const TENDERALERTS_ADAPTER_KEY = 'tenderalerts'

export interface TenderAlertsAdapterOptions {
  transport?: TenderAlertsTransport
}

/**
 * The TenderAlerts adapter — discovery-only by design (see types.ts's
 * module comment for the research finding behind this, same
 * reasoning as the TenderBulletins and City of Cape Town adapters).
 *
 * - `fetchDetails` returns only what the most recent `discover()`
 *   call already learned from the public listing — it does NOT
 *   attempt to fetch a fuller record, because the real detail page
 *   sits behind a subscription wall this adapter refuses to cross.
 *   If `discover()` hasn't been run in this process, or the id isn't
 *   one it found, this throws rather than silently returning an
 *   empty/fabricated record.
 * - `fetchDocuments` always returns `[]`: no public document links
 *   exist on this source (documents sit behind the same subscription
 *   wall).
 */
export function createTenderAlertsAdapter(options: TenderAlertsAdapterOptions = {}): TenderSourceAdapter {
  const transport = options.transport ?? createPlaywrightTransport()
  const baseUrl = DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG.baseUrl

  const discoveredByExternalId = new Map<string, TenderDiscovery>()

  return {
    key: TENDERALERTS_ADAPTER_KEY,
    version: TENDERALERTS_ADAPTER_VERSION,

    async discover(): Promise<TenderDiscovery[]> {
      const { discovered } = await discoverTenderAlerts(transport, baseUrl)
      discoveredByExternalId.clear()
      for (const item of discovered) discoveredByExternalId.set(item.externalId, item)
      return discovered
    },

    async fetchDetails(externalId: string): Promise<TenderDetails> {
      const discovery = discoveredByExternalId.get(externalId)
      if (!discovery) {
        throw Object.assign(
          new Error(
            `No details available for TenderAlerts tender "${externalId}": this source's detail page sits behind a subscription wall, so fetchDetails can only return what the most recent discover() call already saw on the listing, and this id wasn't in it.`,
          ),
          { code: 'NO_DETAIL_SOURCE' },
        )
      }
      return { ...discovery, documents: [] }
    },

    async fetchDocuments(_externalId: string): Promise<DocumentReference[]> {
      return [] // No public document links exist on this source (see module comment above).
    },

    async healthCheck(): Promise<AdapterHealthCheckResult> {
      return checkTenderAlertsHealth(transport)
    },
  }
}
