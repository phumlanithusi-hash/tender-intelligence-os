import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEtendersAdapter } from '../../adapters/etenders/adapter.js'
import {
  createFixtureTransport,
  LISTING_FIXTURE_RUN_1,
  LISTING_FIXTURE_RUN_2_AMENDED,
} from '../../adapters/etenders/transport/fixtureTransport.js'
import { runEtendersScan } from '../scanRunner.js'
import { createPgIngestionStore } from './pgIngestionStore.js'
import { deriveTenderStatus } from '../deriveTenderStatus.js'

/**
 * Real-database integration coverage (Phase 5 §29): discovery →
 * normalisation → canonical tender → source record → document record
 * → scan history → error history, run against the actual Postgres
 * schema (the same one `database/src/__tests__/schema.test.ts`
 * exercises) rather than a fake or mock. See pgIngestionStore.ts for
 * why this goes through raw `pg` instead of supabase-js — there is no
 * PostgREST endpoint in this sandbox to talk to.
 *
 * A fresh, uniquely-named "eTenders (Integration Test)" source row is
 * created per test run (not the seeded real eTenders row) so this
 * suite never depends on — or pollutes — `database/seeds/004_tender_sources.sql`'s
 * actual eTenders row, and can run in any order relative to other
 * suites that also touch `tender_sources`.
 */
function getTestPool(): pg.Pool {
  const connectionString =
    process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/tender_intelligence_test'
  return new pg.Pool({ connectionString })
}

const pool = getTestPool()
let sourceId: string

beforeAll(async () => {
  const { rows } = await pool.query(
    `insert into tender_sources (name, base_url, source_type, authority_level, adapter_key)
     values ('eTenders (Integration Test)', 'https://www.etenders.gov.za', 'OFFICIAL', 'PRIMARY', 'etenders')
     returning id`,
  )
  sourceId = rows[0].id as string
})

afterAll(async () => {
  // `tender_source_scans`/`tender_source_errors` cascade from
  // `tender_sources` deletion, but `tender_source_records.source_id`
  // does not (no `on delete cascade` there) — deleted explicitly,
  // before the tenders they point at, before the source row itself.
  await pool.query(`delete from tender_documents where tender_id in (select tender_id from tender_source_records where source_id = $1)`, [sourceId])
  await pool.query(`delete from tender_source_records where source_id = $1`, [sourceId])
  await pool.query(`delete from tenders where original_document_url like 'https://www.etenders.gov.za/Home/opportunity%'`)
  await pool.query(`delete from tender_sources where id = $1`, [sourceId])
  await pool.end()
})

describe('eTenders ingestion — full pipeline against a real Postgres schema (Phase 5 §29)', () => {
  it('discovers, normalises, creates canonical tenders, source records, and document records; scan status is PARTIAL for the one malformed fixture record', async () => {
    const store = createPgIngestionStore(pool)
    const adapter = createEtendersAdapter({ transport: createFixtureTransport() })

    const result = await runEtendersScan(store, adapter, {
      sourceId,
      rateLimit: { concurrency: 1, delayMs: 0, timeoutMs: 1000, maxRetries: 1 },
    })

    expect(result.recordsDiscovered).toBe(LISTING_FIXTURE_RUN_1.length)
    expect(result.recordsProcessed).toBe(LISTING_FIXTURE_RUN_1.length - 1)
    expect(result.recordsFailed).toBe(1)
    expect(result.status).toBe('PARTIAL')
    expect(result.documentsDiscovered).toBe(3)

    // Scan history (Phase 5 §13).
    const scanRow = await pool.query(`select * from tender_source_scans where id = $1`, [result.scanId])
    expect(scanRow.rows[0].status).toBe('PARTIAL')
    expect(scanRow.rows[0].records_discovered).toBe(10)
    expect(scanRow.rows[0].records_processed).toBe(9)
    expect(scanRow.rows[0].records_failed).toBe(1)

    // Structured error history (Phase 5 §14) — the malformed record must be visible, not silently dropped.
    const errorRows = await pool.query(`select * from tender_source_errors where scan_id = $1`, [result.scanId])
    expect(errorRows.rows.length).toBeGreaterThan(0)
    expect(errorRows.rows.some((r) => JSON.stringify(r.metadata).includes('ET-100004'))).toBe(true)

    // Canonical tenders (Phase 5 §10/§25; status derivation revised
    // 2026-09-20, see docs/DECISIONS.md) — status is derived purely from
    // each tender's own closing_date, never hardcoded, so this asserts
    // the invariant rather than a fixed value that would go stale the
    // moment the fixtures' hardcoded closing dates are in the past.
    const tenderRows = await pool.query(
      `select t.* from tenders t join tender_source_records tsr on tsr.tender_id = t.id where tsr.source_id = $1`,
      [sourceId],
    )
    expect(tenderRows.rows).toHaveLength(9)
    expect(tenderRows.rows.every((r) => r.status === deriveTenderStatus(r.closing_date))).toBe(true)

    // Source records preserve raw provenance (Phase 5 §6/§24).
    const sourceRecordRows = await pool.query(`select * from tender_source_records where source_id = $1`, [sourceId])
    expect(sourceRecordRows.rows).toHaveLength(9)
    for (const row of sourceRecordRows.rows) {
      expect(row.external_id).toBeTruthy()
      expect(row.source_url).toContain('etenders.gov.za')
      expect(row.content_hash).toBeTruthy()
    }

    // Document records (Phase 5 §17) — discovery-only, no download fields populated.
    const documentRows = await pool.query(
      `select d.* from tender_documents d join tender_source_records tsr on tsr.tender_id = d.tender_id where tsr.source_id = $1`,
      [sourceId],
    )
    expect(documentRows.rows).toHaveLength(3)
    expect(documentRows.rows.every((r) => r.downloaded_at === null && r.storage_path === null && r.file_hash === null)).toBe(
      true,
    )
  })

  it('idempotency (Phase 5 §12): running the exact same discovery twice creates zero duplicate canonical tenders', async () => {
    const store = createPgIngestionStore(pool)

    const before = await pool.query(`select count(*)::int as count from tenders t join tender_source_records tsr on tsr.tender_id = t.id where tsr.source_id = $1`, [sourceId])

    const adapter = createEtendersAdapter({ transport: createFixtureTransport() })
    const result = await runEtendersScan(store, adapter, {
      sourceId,
      rateLimit: { concurrency: 1, delayMs: 0, timeoutMs: 1000, maxRetries: 1 },
    })

    const after = await pool.query(`select count(*)::int as count from tenders t join tender_source_records tsr on tsr.tender_id = t.id where tsr.source_id = $1`, [sourceId])

    expect(after.rows[0].count).toBe(before.rows[0].count) // Zero new canonical tenders — every record was recognised via its existing (source_id, external_id) row.
    expect(result.recordsProcessed).toBe(9) // The same 9 records were confirmed/updated, not skipped.

    const sourceRecordCount = await pool.query(`select count(*)::int as count from tender_source_records where source_id = $1`, [sourceId])
    expect(sourceRecordCount.rows[0].count).toBe(9) // Still exactly 9 rows — the unique (source_id, external_id) constraint held.
  })

  it('amendment: a re-scan with a changed closing date updates the existing source record without creating a duplicate tender', async () => {
    const store = createPgIngestionStore(pool)
    const beforeTenderCount = await pool.query('select count(*)::int as count from tenders')

    const adapter = createEtendersAdapter({
      transport: createFixtureTransport({ listingRows: LISTING_FIXTURE_RUN_2_AMENDED }),
    })
    await runEtendersScan(store, adapter, {
      sourceId,
      rateLimit: { concurrency: 1, delayMs: 0, timeoutMs: 1000, maxRetries: 1 },
    })

    const afterTenderCount = await pool.query('select count(*)::int as count from tenders')
    expect(afterTenderCount.rows[0].count).toBe(beforeTenderCount.rows[0].count)

    const amendedRecord = await pool.query(
      `select * from tender_source_records where source_id = $1 and external_id = 'ET-100001'`,
      [sourceId],
    )
    expect(amendedRecord.rows[0].raw_closing_date).toBe('2026-10-15')
  })
})
