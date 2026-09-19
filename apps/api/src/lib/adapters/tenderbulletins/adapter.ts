import type { AdapterHealthCheckResult, DocumentReference, TenderDetails, TenderDiscovery, TenderSourceAdapter } from '../types.js'
import { discoverTenderBulletins } from './discover.js'
import { checkTenderBulletinsHealth } from './health.js'
import { createPlaywrightTransport } from './transport/playwrightTransport.js'
import type { TenderBulletinsTransport } from './types.js'

/**
 * The TenderBulletins adapter — discovery-only by design (see
 * types.ts's module comment for the research finding behind this).
 * `fetchDetails` and `fetchDocuments` are honest, limited
 * implementations rather than faked-out full ones:
 *
 * - `fetchDetails` returns only what the most recent `discover()` call
 *   already learned from the public listing (title, organisation,
 *   closing date) — it does NOT attempt to fetch a fuller record,
 *   because no public per-tender detail page exists on this source.
 *   If `discover()` hasn't been run in this process, or the id isn't
 *   one it found, this throws rather than silently returning an
 *   empty/fabricated record — callers should not mistake "unknown" for
 *   "no further detail exists".
 * - `fetchDocuments` always returns `[]`: this source exposes no
 *   public document links at all (documents sit behind the same
 *   `/login` wall this adapter refuses to cross).
 */
export const TENDERBULLETINS_ADAPTER_VERSION = '1.0.0'
export const TENDERBULLETINS_ADAPTER_KEY = 'tenderbulletins'

export interface TenderBulletinsAdapterOptions {
  transport?: TenderBulletinsTransport
}

export function createTenderBulletinsAdapter(options: TenderBulletinsAdapterOptions = {}): TenderSourceAdapter {
  const transport = options.transport ?? createPlaywrightTransport()

  // Remembers each discovered item's full TenderDiscovery for this
  // process's most recent discover() call, keyed by externalId — the
  // only source `fetchDetails` has, since there is no detail page to
  // fetch from independently.
  const discoveredByExternalId = new Map<string, TenderDiscovery>()

  return {
    key: TENDERBULLETINS_ADAPTER_KEY,
    version: TENDERBULLETINS_ADAPTER_VERSION,

    async discover(): Promise<TenderDiscovery[]> {
      const { discovered } = await discoverTenderBulletins(transport)
      discoveredByExternalId.clear()
      for (const item of discovered) discoveredByExternalId.set(item.externalId, item)
      return discovered
    },

    async fetchDetails(externalId: string): Promise<TenderDetails> {
      const discovery = discoveredByExternalId.get(externalId)
      if (!discovery) {
        throw Object.assign(
          new Error(
            `No details available for TenderBulletins tender "${externalId}": this source has no public detail page, so fetchDetails can only return what the most recent discover() call already saw on the listing, and this id wasn't in it.`,
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
      return checkTenderBulletinsHealth(transport)
    },
  }
}
