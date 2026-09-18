import { describe, expect, it } from 'vitest'
import { createEtendersAdapter } from '../../adapters/etenders/adapter.js'
import { createFixtureTransport, LISTING_FIXTURE_RUN_1, LISTING_FIXTURE_RUN_2_AMENDED } from '../../adapters/etenders/transport/fixtureTransport.js'
import { runEtendersScan } from '../scanRunner.js'
import { createFakeIngestionStore } from './fakeIngestionStore.js'

const SOURCE_ID = '00000000-0000-4000-8000-000000000001'
const NO_DELAY = { concurrency: 1, delayMs: 0, timeoutMs: 1000, maxRetries: 1 }

describe('runEtendersScan (Phase 5 §10-§19) — in-memory store', () => {
  it('creates a canonical tender + source record per discoverable fixture record, and marks the scan PARTIAL for the one malformed record', async () => {
    const adapter = createEtendersAdapter({ transport: createFixtureTransport() })
    const { store, scans, tenders, sourceRecords } = createFakeIngestionStore()

    const result = await runEtendersScan(store, adapter, { sourceId: SOURCE_ID, rateLimit: NO_DELAY })

    expect(result.recordsDiscovered).toBe(LISTING_FIXTURE_RUN_1.length)
    expect(result.recordsProcessed).toBe(LISTING_FIXTURE_RUN_1.length - 1) // ET-100004 has no description (Phase 5 §14).
    expect(result.recordsFailed).toBe(1)
    expect(result.status).toBe('PARTIAL')
    expect(tenders.size).toBe(LISTING_FIXTURE_RUN_1.length - 1)
    expect(sourceRecords.size).toBe(LISTING_FIXTURE_RUN_1.length - 1)

    const finalScan = scans.get(result.scanId)
    expect(finalScan?.status).toBe('PARTIAL')
    expect(finalScan?.completed_at).not.toBeNull()
  })

  it('records a structured error for the malformed record rather than silently dropping it', async () => {
    const adapter = createEtendersAdapter({ transport: createFixtureTransport() })
    const { store, errorLog } = createFakeIngestionStore()

    await runEtendersScan(store, adapter, { sourceId: SOURCE_ID, rateLimit: NO_DELAY })

    expect(errorLog.length).toBeGreaterThan(0)
    expect(errorLog.some((e) => (e.metadata as { externalId?: string })?.externalId === 'ET-100004')).toBe(true)
  })

  it('idempotency: running twice with identical data creates zero duplicate canonical tenders (Phase 5 §12)', async () => {
    const { store, tenders, sourceRecords } = createFakeIngestionStore()

    const adapterA = createEtendersAdapter({ transport: createFixtureTransport() })
    const runA = await runEtendersScan(store, adapterA, { sourceId: SOURCE_ID, rateLimit: NO_DELAY })
    const tenderCountAfterRunA = tenders.size
    const sourceRecordCountAfterRunA = sourceRecords.size

    const adapterB = createEtendersAdapter({ transport: createFixtureTransport() })
    const runB = await runEtendersScan(store, adapterB, { sourceId: SOURCE_ID, rateLimit: NO_DELAY })

    expect(tenders.size).toBe(tenderCountAfterRunA) // Zero new canonical tenders on the second identical run.
    expect(sourceRecords.size).toBe(sourceRecordCountAfterRunA) // Zero new source records either — every one was recognised and updated in place.
    expect(runB.recordsProcessed).toBe(runA.recordsProcessed)
    expect(runB.recordsDiscovered).toBe(runA.recordsDiscovered)
  })

  it('amendment: a changed field on a re-scanned record updates the existing source record and fills a previously-unknown canonical field, without creating a duplicate tender', async () => {
    const { store, tenders, sourceRecords } = createFakeIngestionStore()

    const adapterInitial = createEtendersAdapter({ transport: createFixtureTransport() })
    await runEtendersScan(store, adapterInitial, { sourceId: SOURCE_ID, rateLimit: NO_DELAY })
    const tenderCountAfterFirstRun = tenders.size

    const adapterAmended = createEtendersAdapter({
      transport: createFixtureTransport({ listingRows: LISTING_FIXTURE_RUN_2_AMENDED }),
    })
    await runEtendersScan(store, adapterAmended, { sourceId: SOURCE_ID, rateLimit: NO_DELAY })

    expect(tenders.size).toBe(tenderCountAfterFirstRun) // No duplicate tender created for the amended record.
    const amendedRecord = [...sourceRecords.values()].find((r) => r.external_id === 'ET-100001')
    expect(amendedRecord?.raw_closing_date).toBe('2026-10-15') // The amended closing date was written to the source record.
  })

  it('Phase 20 §4A — a re-scan with a changed closing date creates a DIFF_ENGINE tender_addenda row, never for the unchanged first scan', async () => {
    const { store, addenda } = createFakeIngestionStore()

    const adapterInitial = createEtendersAdapter({ transport: createFixtureTransport() })
    await runEtendersScan(store, adapterInitial, { sourceId: SOURCE_ID, rateLimit: NO_DELAY })
    expect(addenda).toHaveLength(0) // First scan ever seen: nothing to diff against yet.

    const adapterAmended = createEtendersAdapter({
      transport: createFixtureTransport({ listingRows: LISTING_FIXTURE_RUN_2_AMENDED }),
    })
    await runEtendersScan(store, adapterAmended, { sourceId: SOURCE_ID, rateLimit: NO_DELAY })

    expect(addenda).toHaveLength(1)
    const created = addenda[0]!
    expect(created.detected_via).toBe('DIFF_ENGINE')
    expect(created.document_id).toBeNull()
    expect(created.deadline_changed).toBe(true)
    expect(created.addendum_number).toBe(1)
  })

  it('Phase 20 §4A — running the identical amended scan twice never creates a second addendum for the same, already-recorded change', async () => {
    const { store, addenda } = createFakeIngestionStore()

    await runEtendersScan(store, createEtendersAdapter({ transport: createFixtureTransport() }), { sourceId: SOURCE_ID, rateLimit: NO_DELAY })
    await runEtendersScan(store, createEtendersAdapter({ transport: createFixtureTransport({ listingRows: LISTING_FIXTURE_RUN_2_AMENDED }) }), {
      sourceId: SOURCE_ID,
      rateLimit: NO_DELAY,
    })
    expect(addenda).toHaveLength(1)

    // A third scan with the SAME (already-amended) data: content hash
    // matches what was just stored, so `changed` is false and no new
    // addendum is created.
    await runEtendersScan(store, createEtendersAdapter({ transport: createFixtureTransport({ listingRows: LISTING_FIXTURE_RUN_2_AMENDED }) }), {
      sourceId: SOURCE_ID,
      rateLimit: NO_DELAY,
    })
    expect(addenda).toHaveLength(1)
  })

  it('a scan with zero discovered records is a clean SUCCESS, never PARTIAL/FAILED', async () => {
    const adapter = createEtendersAdapter({ transport: createFixtureTransport({ listingRows: [] }) })
    const { store } = createFakeIngestionStore()

    const result = await runEtendersScan(store, adapter, { sourceId: SOURCE_ID, rateLimit: NO_DELAY })
    expect(result).toMatchObject({ status: 'SUCCESS', recordsDiscovered: 0, recordsProcessed: 0, recordsFailed: 0 })
  })

  it('discovers documents for records with captured detail fixtures', async () => {
    const adapter = createEtendersAdapter({ transport: createFixtureTransport() })
    const { store } = createFakeIngestionStore()

    const result = await runEtendersScan(store, adapter, { sourceId: SOURCE_ID, rateLimit: NO_DELAY })
    // ET-100001 (2 docs) + ET-100002 (1 doc) from the details fixture; every other record has no captured detail fixture.
    expect(result.documentsDiscovered).toBe(3)
  })

  it('FAILS the whole scan (not PARTIAL) when discovery itself throws before any record exists', async () => {
    const { store } = createFakeIngestionStore()
    const brokenAdapter = createEtendersAdapter({
      transport: {
        ...createFixtureTransport(),
        fetchListingPage: async () => {
          throw Object.assign(new Error('simulated network outage'), { code: 'ECONNRESET' })
        },
      },
    })

    const result = await runEtendersScan(store, brokenAdapter, { sourceId: SOURCE_ID, rateLimit: NO_DELAY })
    expect(result.status).toBe('FAILED')
    expect(result.recordsDiscovered).toBe(0)
  })
})
