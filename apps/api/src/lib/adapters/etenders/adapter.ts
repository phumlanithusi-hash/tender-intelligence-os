import type { AdapterHealthCheckResult, DocumentReference, TenderDetails, TenderDiscovery, TenderSourceAdapter } from '../types.js'
import { discoverEtenders, DEFAULT_ETENDERS_DISCOVERY_CONFIG, type EtendersDiscoveryConfig } from './discover.js'
import { fetchEtendersDetails } from './details.js'
import { fetchEtendersDocuments } from './documents.js'
import { checkEtendersHealth } from './health.js'
import { DEFAULT_ETENDERS_RATE_LIMIT, type EtendersRateLimitConfig } from './rateLimit.js'
import { createPlaywrightTransport } from './transport/playwrightTransport.js'
import type { EtendersTransport } from './types.js'

/**
 * The eTenders adapter (Phase 5 §3): the ONLY module outside the
 * `etenders/` directory that anything else touches. `discover()`
 * returns the last discovery pass's identified rows so that
 * `fetchDetails`/`fetchDocuments` (which take only an `externalId`,
 * per the shared `TenderSourceAdapter` contract) can resolve the
 * matching `url` without a second listing fetch — the contract does
 * not pass a URL to those two methods, so the adapter must remember
 * it itself between calls within one scan.
 */
export const ETENDERS_ADAPTER_VERSION = '1.0.0'
export const ETENDERS_ADAPTER_KEY = 'etenders'

export interface EtendersAdapterOptions {
  transport?: EtendersTransport
  discoveryConfig?: EtendersDiscoveryConfig
  rateLimit?: EtendersRateLimitConfig
}

export function createEtendersAdapter(options: EtendersAdapterOptions = {}): TenderSourceAdapter {
  const transport = options.transport ?? createPlaywrightTransport()
  const discoveryConfig = options.discoveryConfig ?? DEFAULT_ETENDERS_DISCOVERY_CONFIG
  const rateLimit = options.rateLimit ?? DEFAULT_ETENDERS_RATE_LIMIT

  // Remembers each discovered item's detail URL for this process's
  // most recent discover() call, keyed by externalId — an in-memory
  // convenience only, never persisted, and always safe to be stale
  // or missing (fetchDetails/fetchDocuments fall back to eTenders'
  // canonical opportunity URL shape when a discover() hasn't been run
  // in this process yet).
  const urlByExternalId = new Map<string, string>()

  return {
    key: ETENDERS_ADAPTER_KEY,
    version: ETENDERS_ADAPTER_VERSION,

    async discover(): Promise<TenderDiscovery[]> {
      const { discovered } = await discoverEtenders(transport, discoveryConfig, rateLimit)
      urlByExternalId.clear()
      for (const item of discovered) urlByExternalId.set(item.externalId, item.url)
      return discovered
    },

    async fetchDetails(externalId: string): Promise<TenderDetails> {
      const url = urlByExternalId.get(externalId) ?? `https://www.etenders.gov.za/Home/opportunities?id=${externalId}`
      return fetchEtendersDetails(transport, externalId, url)
    },

    async fetchDocuments(externalId: string): Promise<DocumentReference[]> {
      const url = urlByExternalId.get(externalId) ?? `https://www.etenders.gov.za/Home/opportunities?id=${externalId}`
      return fetchEtendersDocuments(transport, externalId, url)
    },

    async healthCheck(): Promise<AdapterHealthCheckResult> {
      return checkEtendersHealth(transport)
    },
  }
}
