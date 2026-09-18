import { createRequire } from 'node:module'
import type { EtendersDiscoveryParams, EtendersTransport, RawDetailPage, RawListingRow } from '../types.js'

const require = createRequire(import.meta.url)

/**
 * Fixture-backed transport (Phase 5's live-access finding —
 * docs/SCRAPING-ARCHITECTURE.md §12): replays captured/constructed
 * data resembling the real eTenders listing/detail structure instead
 * of touching the network. Used by every unit/integration/E2E test
 * (Phase 5 §29: "NOT live-website-dependent") and by the documented
 * dev fixture-import path — never registered as the production
 * adapter's default transport.
 */
export interface FixtureTransportData {
  listingRows: RawListingRow[]
  details: Record<string, RawDetailPage>
}

export const LISTING_FIXTURE_RUN_1 = require('../fixtures/listing-run1.json') as RawListingRow[]
export const LISTING_FIXTURE_RUN_2_AMENDED = require('../fixtures/listing-run2-amended.json') as RawListingRow[]
export const DETAILS_FIXTURE = require('../fixtures/details.json') as Record<string, RawDetailPage>

export function createFixtureTransport(data: Partial<FixtureTransportData> = {}): EtendersTransport {
  const listingRows = data.listingRows ?? LISTING_FIXTURE_RUN_1
  const details = data.details ?? DETAILS_FIXTURE

  return {
    async fetchListingPage(params: EtendersDiscoveryParams): Promise<RawListingRow[]> {
      const start = (params.page - 1) * params.pageSize
      return listingRows.slice(start, start + params.pageSize)
    },
    async fetchDetailPage(detailUrl: string, externalId: string): Promise<RawDetailPage> {
      const found = details[externalId]
      if (found) return found
      // A discovered row with no captured detail fixture still
      // returns a minimal, honest detail page (nulls, not a thrown
      // error) — most discovered records will not have a detail
      // fixture, and that must not look like a fetch failure.
      return {
        externalId,
        detailUrl,
        title: null,
        description: null,
        organisation: null,
        tenderNumber: null,
        advertisedText: null,
        closingDateText: null,
        closingTimeText: null,
        province: null,
        briefingText: null,
        documents: [],
      }
    },
    async checkReachable(): Promise<{ reachable: boolean; message: string }> {
      return { reachable: true, message: 'Fixture transport is always reachable (not a live check).' }
    },
  }
}
