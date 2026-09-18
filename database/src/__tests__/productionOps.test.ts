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
 * Phase 19 — mirrors database/src/__tests__/submissionReadiness.test.ts:
 * RLS agency isolation, service-role-only mutation, DB-enforced
 * immutability, uniqueness and required-reason CHECK constraints for
 * the two new tables (bid_addendum_acknowledgements,
 * data_quality_violations).
 */
describe('Phase 19 production operations tables, RLS and integrity', () => {
  let agencyAId: string
  let agencyBId: string
  let userAId: string
  let userBId: string
  let tenderId: string
  let documentId: string
  let addendumId: string
  let decisionRunAId: string
  let bidProjectAId: string
  let ackId: string
  let violationOpenId: string
  let sharedViolationId: string

  beforeAll(async () => {
    const agencyA = await pool.query(`insert into agencies (name) values ('Ops Test Agency A') returning id`)
    agencyAId = agencyA.rows[0].id
    const agencyB = await pool.query(`insert into agencies (name) values ('Ops Test Agency B') returning id`)
    agencyBId = agencyB.rows[0].id

    const userA = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userAId = userA.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'opsa@example.com')`, [userAId, agencyAId])
    const userB = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userBId = userB.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'opsb@example.com')`, [userBId, agencyBId])

    const tender = await pool.query(`insert into tenders (title) values ('Phase 19 ops test tender') returning id`)
    tenderId = tender.rows[0].id

    const doc = await pool.query(`insert into tender_documents (tender_id, filename, document_type, is_addendum) values ($1, 'addendum-1.pdf', 'ADDENDUM', true) returning id`, [tenderId])
    documentId = doc.rows[0].id

    const addendum = await pool.query(
      `insert into tender_addenda (tender_id, document_id, addendum_number, deadline_changed) values ($1, $2, 1, true) returning id`,
      [tenderId, documentId],
    )
    addendumId = addendum.rows[0].id

    const policyA = await pool.query(`insert into bid_policies (agency_id, name) values ($1, 'default') returning id`, [agencyAId])
    const policyVersionA = await pool.query(`insert into bid_policy_versions (policy_id, version) values ($1, 1) returning id`, [policyA.rows[0].id])
    const run = await pool.query(
      `insert into bid_decision_runs (tender_id, agency_id, status, bid_policy_version_id, system_decision, final_decision, bid_effort) values ($1, $2, 'COMPLETED', $3, 'BID', 'BID', 'LOW') returning id`,
      [tenderId, agencyAId, policyVersionA.rows[0].id],
    )
    decisionRunAId = run.rows[0].id

    const project = await pool.query(`insert into bid_strategy_projects (tender_id, agency_id, project_name, bid_decision_run_id) values ($1, $2, 'Ops test bid project', $3) returning id`, [tenderId, agencyAId, decisionRunAId])
    bidProjectAId = project.rows[0].id

    const ack = await pool.query(
      `insert into bid_addendum_acknowledgements (agency_id, bid_project_id, addendum_id, acknowledged_by, reconciled) values ($1, $2, $3, $4, false) returning id`,
      [agencyAId, bidProjectAId, addendumId, userAId],
    )
    ackId = ack.rows[0].id

    const violation = await pool.query(
      `insert into data_quality_violations (agency_id, rule, severity, entity_type, entity_id) values ($1, 'BID_SUBMITTED_WITHOUT_VERIFIED_EVIDENCE', 'CRITICAL', 'bid_submission_executions', $2) returning id`,
      [agencyAId, bidProjectAId],
    )
    violationOpenId = violation.rows[0].id

    const shared = await pool.query(
      `insert into data_quality_violations (agency_id, rule, severity, entity_type, entity_id) values (null, 'TENDER_MISSING_CLOSING_DATE', 'HIGH', 'tenders', $1) returning id`,
      [tenderId],
    )
    sharedViolationId = shared.rows[0].id
  })

  describe('bid_addendum_acknowledgements', () => {
    it('agency A can read its own acknowledgement under RLS', async () => {
      await withUser(userAId, async (c) => {
        expect((await c.query('select id from bid_addendum_acknowledgements where id = $1', [ackId])).rows).toHaveLength(1)
      })
    })

    it('agency B cannot read agency A acknowledgement (cross-tenant isolation)', async () => {
      await withUser(userBId, async (c) => {
        expect((await c.query('select id from bid_addendum_acknowledgements where id = $1', [ackId])).rows).toHaveLength(0)
      })
    })

    it('the authenticated role cannot write acknowledgements directly (service-role only)', async () => {
      await withUser(userAId, async (c) => {
        await expect(
          c.query(`insert into bid_addendum_acknowledgements (agency_id, bid_project_id, addendum_id, acknowledged_by) values ($1, $2, $3, $4)`, [agencyAId, bidProjectAId, addendumId, userAId]),
        ).rejects.toThrow()
      })
    })

    it('rejects a second acknowledgement for the same bid project + addendum (unique constraint)', async () => {
      await expect(
        pool.query(`insert into bid_addendum_acknowledgements (agency_id, bid_project_id, addendum_id, acknowledged_by) values ($1, $2, $3, $4)`, [agencyAId, bidProjectAId, addendumId, userAId]),
      ).rejects.toThrow()
    })

    it('is fully immutable — any update is rejected', async () => {
      await expect(pool.query(`update bid_addendum_acknowledgements set reconciled = true where id = $1`, [ackId])).rejects.toThrow()
    })
  })

  describe('data_quality_violations', () => {
    it('agency A can read its own violation plus the shared (agency_id null) violation under RLS', async () => {
      await withUser(userAId, async (c) => {
        expect((await c.query('select id from data_quality_violations where id = $1', [violationOpenId])).rows).toHaveLength(1)
        expect((await c.query('select id from data_quality_violations where id = $1', [sharedViolationId])).rows).toHaveLength(1)
      })
    })

    it('agency B cannot read agency A-scoped violation but CAN read the shared one', async () => {
      await withUser(userBId, async (c) => {
        expect((await c.query('select id from data_quality_violations where id = $1', [violationOpenId])).rows).toHaveLength(0)
        expect((await c.query('select id from data_quality_violations where id = $1', [sharedViolationId])).rows).toHaveLength(1)
      })
    })

    it('the authenticated role cannot write violations directly (service-role only)', async () => {
      await withUser(userAId, async (c) => {
        await expect(
          c.query(`insert into data_quality_violations (agency_id, rule, severity, entity_type, entity_id) values ($1, 'TENDER_MISSING_CLOSING_DATE', 'HIGH', 'tenders', $2)`, [agencyAId, tenderId]),
        ).rejects.toThrow()
      })
    })

    it('rejects a second OPEN violation for the same rule + entity (partial unique index)', async () => {
      await expect(
        pool.query(`insert into data_quality_violations (agency_id, rule, severity, entity_type, entity_id) values ($1, 'BID_SUBMITTED_WITHOUT_VERIFIED_EVIDENCE', 'CRITICAL', 'bid_submission_executions', $2)`, [agencyAId, bidProjectAId]),
      ).rejects.toThrow()
    })

    it('requires resolution/resolved_by/resolved_at when marking RESOLVED (CHECK constraint)', async () => {
      await expect(pool.query(`update data_quality_violations set status = 'RESOLVED' where id = $1`, [violationOpenId])).rejects.toThrow()
      await pool.query(`update data_quality_violations set status = 'RESOLVED', resolution = 'fixed', resolved_by = $2, resolved_at = now() where id = $1`, [violationOpenId, userAId])
      const row = await pool.query(`select status from data_quality_violations where id = $1`, [violationOpenId])
      expect(row.rows[0].status).toBe('RESOLVED')
    })

    it('rejects mutating the detected-fact fields (rule/entity/detected_at) even by service role', async () => {
      await expect(pool.query(`update data_quality_violations set rule = 'OUTCOME_WITHOUT_PROVENANCE' where id = $1`, [sharedViolationId])).rejects.toThrow()
    })
  })
})
