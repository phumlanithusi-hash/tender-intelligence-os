import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import { getTestPool, asAuthenticatedUser } from '../testHelpers.js'

const pool = getTestPool()

afterAll(async () => {
  await pool.end()
})

async function withUser<T>(userId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    return await asAuthenticatedUser(client, userId, fn)
  } finally {
    client.release()
  }
}

/**
 * Phase 20 — Enterprise Hardening, Continuous Surveillance & System
 * Convergence: the `tender_addenda` extension (content_hash,
 * impact_assessment, detected_via, nullable document_id), the new
 * `audit_trail_events` (append-only, ADMIN-only) and
 * `industry_benchmarks_daily` (anonymized, k-anonymity floor) tables.
 */
describe('Phase 20 surveillance/benchmarks/audit tables, RLS and integrity', () => {
  let agencyAId: string
  let agencyBId: string
  let adminAId: string
  let adminBId: string
  let tenderId: string
  let documentId: string

  beforeAll(async () => {
    const agencyA = await pool.query(`insert into agencies (name) values ('Phase20 Test Agency A') returning id`)
    agencyAId = agencyA.rows[0].id
    const agencyB = await pool.query(`insert into agencies (name) values ('Phase20 Test Agency B') returning id`)
    agencyBId = agencyB.rows[0].id

    const userA = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    adminAId = userA.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'p20a@example.com')`, [adminAId, agencyAId])
    const userB = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    adminBId = userB.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'p20b@example.com')`, [adminBId, agencyBId])

    const tender = await pool.query(`insert into tenders (title, category, province) values ('Phase 20 test tender', 'Media & Design', 'Gauteng') returning id`)
    tenderId = tender.rows[0].id

    const doc = await pool.query(`insert into tender_documents (tender_id, filename, document_type, is_addendum) values ($1, 'addendum-1.pdf', 'ADDENDUM', true) returning id`, [tenderId])
    documentId = doc.rows[0].id
  })

  describe('tender_addenda extension (spec §4A/§5)', () => {
    it('accepts a DOCUMENT-path addendum with a document_id (the original Phase 2 §9 path, untouched)', async () => {
      const row = await pool.query(
        `insert into tender_addenda (tender_id, document_id, addendum_number, deadline_changed, detected_via) values ($1, $2, 101, true, 'DOCUMENT') returning id, document_id, detected_via`,
        [tenderId, documentId],
      )
      expect(row.rows[0].detected_via).toBe('DOCUMENT')
      expect(row.rows[0].document_id).toBe(documentId)
    })

    it('rejects a DOCUMENT-path addendum with no document_id (CHECK constraint)', async () => {
      await expect(
        pool.query(`insert into tender_addenda (tender_id, document_id, addendum_number, detected_via) values ($1, null, 102, 'DOCUMENT')`, [tenderId]),
      ).rejects.toThrow()
    })

    it('accepts a DIFF_ENGINE-path addendum with NO document_id — the genuinely new Phase 20 case', async () => {
      const row = await pool.query(
        `insert into tender_addenda (tender_id, document_id, addendum_number, deadline_changed, content_hash, impact_assessment, detected_via)
         values ($1, null, 103, true, 'abc123', '{"affectedAreas":["SUBMISSION_TIMELINE"]}'::jsonb, 'DIFF_ENGINE') returning id, document_id, detected_via, content_hash`,
        [tenderId],
      )
      expect(row.rows[0].document_id).toBeNull()
      expect(row.rows[0].detected_via).toBe('DIFF_ENGINE')
      expect(row.rows[0].content_hash).toBe('abc123')
    })

    it('rejects an invalid detected_via value', async () => {
      await expect(
        pool.query(`insert into tender_addenda (tender_id, document_id, addendum_number, detected_via) values ($1, $2, 104, 'SOMETHING_ELSE')`, [tenderId, documentId]),
      ).rejects.toThrow()
    })

    it('defaults detected_via to DOCUMENT and impact_assessment to {} for pre-Phase-20-shaped inserts', async () => {
      const row = await pool.query(`insert into tender_addenda (tender_id, document_id, addendum_number) values ($1, $2, 105) returning detected_via, impact_assessment`, [tenderId, documentId])
      expect(row.rows[0].detected_via).toBe('DOCUMENT')
      expect(row.rows[0].impact_assessment).toEqual({})
    })
  })

  describe('audit_trail_events (spec §4D)', () => {
    let eventId: string
    let correlationId: string

    beforeAll(async () => {
      correlationId = tenderId
      const event = await pool.query(
        `insert into audit_trail_events (correlation_id, agency_id, stage, entity_type, entity_id, actor_type, summary)
         values ($1, $2, 'STRATEGY_GENERATION', 'bid_strategy_projects', gen_random_uuid(), 'USER', 'test event') returning id`,
        [correlationId, agencyAId],
      )
      eventId = event.rows[0].id
      // A shared/system-wide event (agency_id null) — visible to any ADMIN.
      await pool.query(
        `insert into audit_trail_events (correlation_id, stage, entity_type, entity_id, actor_type, summary) values ($1, 'SOURCE_SCAN', 'tenders', $2, 'SYSTEM', 'source scan event')`,
        [correlationId, tenderId],
      )
    })

    it('rejects an invalid stage value', async () => {
      await expect(
        pool.query(`insert into audit_trail_events (correlation_id, stage, entity_type, actor_type, summary) values (gen_random_uuid(), 'NOT_A_STAGE', 'tenders', 'SYSTEM', 'x')`),
      ).rejects.toThrow()
    })

    it('agency A ADMIN can read its own event plus the shared (agency-null) event', async () => {
      await withUser(adminAId, async (c) => {
        expect((await c.query('select id from audit_trail_events where id = $1', [eventId])).rows).toHaveLength(1)
        const shared = await c.query(`select id from audit_trail_events where correlation_id = $1 and agency_id is null`, [correlationId])
        expect(shared.rows.length).toBeGreaterThan(0)
      })
    })

    it('agency B ADMIN cannot read agency A-scoped event but CAN read the shared one', async () => {
      await withUser(adminBId, async (c) => {
        expect((await c.query('select id from audit_trail_events where id = $1', [eventId])).rows).toHaveLength(0)
        const shared = await c.query(`select id from audit_trail_events where correlation_id = $1 and agency_id is null`, [correlationId])
        expect(shared.rows.length).toBeGreaterThan(0)
      })
    })

    it('the authenticated role cannot write audit trail events directly (service-role only)', async () => {
      await withUser(adminAId, async (c) => {
        await expect(
          c.query(`insert into audit_trail_events (correlation_id, agency_id, stage, entity_type, actor_type, summary) values (gen_random_uuid(), $1, 'SUBMISSION', 'tenders', 'USER', 'x')`, [agencyAId]),
        ).rejects.toThrow()
      })
    })

    it('is fully immutable — any update is rejected, even by the service role', async () => {
      await expect(pool.query(`update audit_trail_events set summary = 'edited' where id = $1`, [eventId])).rejects.toThrow()
    })

    it('is append-only — delete is rejected, even by the service role', async () => {
      await expect(pool.query(`delete from audit_trail_events where id = $1`, [eventId])).rejects.toThrow()
    })
  })

  describe('industry_benchmarks_daily (spec §4C k-anonymity)', () => {
    let sufficientRowId: string

    beforeAll(async () => {
      const row = await pool.query(
        `insert into industry_benchmarks_daily (metric_date, category, region, metric_type, sample_size, p25, p50, p75, mean, stddev)
         values (current_date, 'Media & Design', 'Gauteng', 'CYCLE_DAYS', 5, 10, 20, 30, 20, 5) returning id`,
      )
      sufficientRowId = row.rows[0].id
    })

    it('rejects a row below the k-anonymity floor that still carries real statistics', async () => {
      await expect(
        pool.query(
          `insert into industry_benchmarks_daily (metric_date, category, region, metric_type, sample_size, p50) values (current_date, 'X', 'Y', 'VOLUME', 3, 10)`,
        ),
      ).rejects.toThrow()
    })

    it('accepts a below-floor row when every statistic is null (the honest "insufficient data" marker)', async () => {
      const row = await pool.query(
        `insert into industry_benchmarks_daily (metric_date, category, region, metric_type, sample_size) values (current_date, 'Niche Category', 'Northern Cape', 'VOLUME', 2) returning sample_size, p50`,
      )
      expect(row.rows[0].sample_size).toBe(2)
      expect(row.rows[0].p50).toBeNull()
    })

    it('rejects an invalid metric_type', async () => {
      await expect(
        pool.query(`insert into industry_benchmarks_daily (metric_date, metric_type, sample_size) values (current_date, 'NOT_A_METRIC', 10)`),
      ).rejects.toThrow()
    })

    it('rejects a duplicate (metric_date, category, region, metric_type) row', async () => {
      await expect(
        pool.query(
          `insert into industry_benchmarks_daily (metric_date, category, region, metric_type, sample_size) values (current_date, 'Media & Design', 'Gauteng', 'CYCLE_DAYS', 6)`,
        ),
      ).rejects.toThrow()
    })

    it('is fully anonymized: any authenticated user (any agency) can read it — no per-agency scoping applies', async () => {
      await withUser(adminBId, async (c) => {
        expect((await c.query('select id from industry_benchmarks_daily where id = $1', [sufficientRowId])).rows).toHaveLength(1)
      })
    })

    it('the authenticated role cannot write benchmark rows directly (service-role only)', async () => {
      await withUser(adminAId, async (c) => {
        await expect(
          c.query(`insert into industry_benchmarks_daily (metric_date, category, region, metric_type, sample_size) values (current_date, 'Z', 'W', 'VOLUME', 10)`),
        ).rejects.toThrow()
      })
    })
  })
})
