import { describe, expect, it } from 'vitest'
import { discoverEtenders, toTenderDiscovery, DEFAULT_ETENDERS_DISCOVERY_CONFIG } from '../discover.js'
import { createFixtureTransport, LISTING_FIXTURE_RUN_1 } from '../transport/fixtureTransport.js'
import type { RawListingRow } from '../types.js'

describe('toTenderDiscovery', () => {
  it('maps a well-formed row into the generic TenderDiscovery shape', () => {
    const row = LISTING_FIXTURE_RUN_1[0]!
    const result = toTenderDiscovery(row)
    expect(result).not.toBeNull()
    expect(result?.externalId).toBe('ET-100001')
    expect(result?.title).toBe(row.description)
    expect(result?.organisation).toBe(row.organisation)
    expect(result?.tenderNumber).toBe(row.tenderNumber)
    expect(result?.closingDate).toBe('2026-09-30')
  })

  it('falls back to a placeholder title, never a fabricated one, when the description is missing (malformed record)', () => {
    const malformed: RawListingRow = {
      externalId: 'ET-BAD',
      detailUrl: 'https://www.etenders.gov.za/Home/opportunity?id=999',
      category: 'X',
      description: null,
      eSubmission: null,
      advertisedText: null,
      closingDateText: null,
      organisation: null,
      tenderNumber: null,
      province: null,
      tenderType: null,
    }
    const result = toTenderDiscovery(malformed)
    expect(result?.title).toBe('(no title provided by source)')
  })

  it('derives externalId from the detail URL when the row has none directly', () => {
    const row: RawListingRow = {
      externalId: null,
      detailUrl: 'https://www.etenders.gov.za/Home/opportunity?id=42',
      category: null,
      description: 'Something',
      eSubmission: null,
      advertisedText: null,
      closingDateText: null,
      organisation: null,
      tenderNumber: null,
      province: null,
      tenderType: null,
    }
    expect(toTenderDiscovery(row)?.externalId).toBe('42')
  })

  it('returns null (unidentifiable) when there is no externalId and no parseable detail URL', () => {
    const row: RawListingRow = {
      externalId: null,
      detailUrl: null,
      category: null,
      description: 'Something',
      eSubmission: null,
      advertisedText: null,
      closingDateText: null,
      organisation: null,
      tenderNumber: null,
      province: null,
      tenderType: null,
    }
    expect(toTenderDiscovery(row)).toBeNull()
  })
})

describe('discoverEtenders (fixture transport, Phase 5 §29 — not live-website dependent)', () => {
  it('discovers every fixture row across one page', async () => {
    const transport = createFixtureTransport()
    const { discovered, unidentifiableRowCount } = await discoverEtenders(
      transport,
      { ...DEFAULT_ETENDERS_DISCOVERY_CONFIG, pageSize: 25, maxPages: 1 },
      { concurrency: 1, delayMs: 0, timeoutMs: 1000, maxRetries: 1 },
    )
    expect(discovered).toHaveLength(LISTING_FIXTURE_RUN_1.length)
    expect(unidentifiableRowCount).toBe(0)
  })

  it('paginates across multiple pages until a short page ends the pass', async () => {
    const transport = createFixtureTransport()
    const { discovered } = await discoverEtenders(
      transport,
      { ...DEFAULT_ETENDERS_DISCOVERY_CONFIG, pageSize: 4, maxPages: 10 },
      { concurrency: 1, delayMs: 0, timeoutMs: 1000, maxRetries: 1 },
    )
    expect(discovered).toHaveLength(LISTING_FIXTURE_RUN_1.length)
  })

  it('respects the maxPages ceiling — controlled discovery, no unlimited scraping (Phase 5 §5)', async () => {
    const transport = createFixtureTransport()
    const { discovered } = await discoverEtenders(
      transport,
      { ...DEFAULT_ETENDERS_DISCOVERY_CONFIG, pageSize: 1, maxPages: 3 },
      { concurrency: 1, delayMs: 0, timeoutMs: 1000, maxRetries: 1 },
    )
    expect(discovered.length).toBeLessThanOrEqual(3)
  })

  it('stops immediately on an empty first page', async () => {
    const transport = createFixtureTransport({ listingRows: [] })
    const { discovered } = await discoverEtenders(transport)
    expect(discovered).toEqual([])
  })
})
