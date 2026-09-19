import type { AdapterHealthCheckResult, DocumentReference, TenderDetails, TenderDiscovery, TenderSourceAdapter } from '../types.js'
import { discoverEasyTenders, DEFAULT_EASYTENDERS_DISCOVERY_CONFIG, type EasyTendersDiscoveryConfig } from './discover.js'
import { fetchEasyTendersDetails } from './details.js'
import { fetchEasyTendersDocuments } from './documents.js'
import { checkEasyTendersHealth } from './health.js'
import { DEFAULT_EASYTENDERS_RATE_LIMIT, type EasyTendersRateLimitConfig } from './rateLimit.js'
import { createPlaywrightTransport } from './transport/playwrightTransport.js'
import type { EasyTendersTransport } from './types.js'

export const EASYTENDERS_ADAPTER_VERSION = '1.0.0'
export const EASYTENDERS_ADAPTER_KEY = 'easytenders'

export interface EasyTendersAdapterOptions {
  transport?: EasyTendersTransport
  discoveryConfig?: EasyTendersDiscoveryConfig
  rateLimit?: EasyTendersRateLimitConfig
}

export function createEasyTendersAdapter(options: EasyTendersAdapterOptions = {}): TenderSourceAdapter {
  const transport = options.transport ?? createPlaywrightTransport()
  const discoveryConfig = options.discoveryConfig ?? DEFAULT_EASYTENDERS_DISCOVERY_CONFIG
  const rateLimit = options.rateLimit ?? DEFAULT_EASYTENDERS_RATE_LIMIT

  // Same in-memory, never-persisted convenience as the eTenders
  // adapter: remembers each discovered slug's real detail URL for
  // this process's most recent discover() call.
  const urlBySlug = new Map<string, string>()

  return {
    key: EASYTENDERS_ADAPTER_KEY,
    version: EASYTENDERS_ADAPTER_VERSION,

    async discover(): Promise<TenderDiscovery[]> {
      const { discovered } = await discoverEasyTenders(transport, discoveryConfig, rateLimit)
      urlBySlug.clear()
      for (const item of discovered) urlBySlug.set(item.externalId, item.url)
      return discovered
    },

    async fetchDetails(externalId: string): Promise<TenderDetails> {
      const url = urlBySlug.get(externalId) ?? `https://easytenders.co.za/tenders/${externalId}`
      return fetchEasyTendersDetails(transport, externalId, url)
    },

    async fetchDocuments(externalId: string): Promise<DocumentReference[]> {
      const url = urlBySlug.get(externalId) ?? `https://easytenders.co.za/tenders/${externalId}`
      return fetchEasyTendersDocuments(transport, externalId, url)
    },

    async healthCheck(): Promise<AdapterHealthCheckResult> {
      return checkEasyTendersHealth(transport)
    },
  }
}
