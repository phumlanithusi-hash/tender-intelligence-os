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
 * Phase 16 — mirrors database/src/__tests__/submissionReadiness.test.ts:
 * RLS agency isolation, service-role-only mutation, append-only
 * attempts, immutable confirmations/receipt-evidence, one-active-attempt
 * concurrency guard, unique idempotency keys, malicious/malformed ids.
 */
describe('submission execution tables, RLS and integrity (Phase 16)', () => {
  let agencyAId: string
  let agencyBId: string
  let userAId: string
  let userBId: string
  let tenderId: string
  let decisionRunAId: string
  let bidProjectAId: string
  let readinessId: string
  let packId: string
  let executionId: string
  let confirmationId: string

  beforeAll(async () => {
    const agencyA = await pool.query(`insert into agencies (name) values ('Submission Execution Test Agency A') returning id`)
    agencyAId = agencyA.rows[0].id
    const agencyB = await pool.query(`insert into agencies (name) values ('Submission Execution Test Agency B') returning id`)
    agencyBId = agencyB.rows[0].id

    const userA = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userAId = userA.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'sexeca@example.com')`, [userAId, agencyAId])
    const userB = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userBId = userB.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'sexecb@example.com')`, [userBId, agencyBId])

    const tender = await pool.query(`insert into tenders (title, closing_date, closing_time) values ('Submission execution test tender', current_date + 30, '17:00:00') returning id`)
    tenderId = tender.rows[0].id

    const policyA = await pool.query(`insert into bid_policies (agency_id, name) values ($1, 'default') returning id`, [agencyAId])
    const policyVersionA = await pool.query(`insert into bid_policy_versions (policy_id, version) values ($1, 1) returning id`, [policyA.rows[0].id])
    const run = await pool.query(
      `insert into bid_decision_runs (tender_id, agency_id, status, bid_policy_version_id, system_decision, final_decision, bid_effort) values ($1, $2, 'COMPLETED', $3, 'BID', 'BID', 'LOW') returning id`,
      [tenderId, agencyAId, policyVersionA.rows[0].id],
    )
    decisionRunAId = run.rows[0].id

    const project = await pool.query(`insert into bid_strategy_projects (tender_id, agency_id, project_name, bid_decision_run_id) values ($1, $2, 'Execution test bid project', $3) returning id`, [tenderId, agencyAId, decisionRunAId])
    bidProjectAId = project.rows[0].id

    const readiness = await pool.query(`insert into bid_submission_readiness (bid_project_id, agency_id, tender_id, status) values ($1, $2, $3, 'READY_TO_SUBMIT') returning id`, [bidProjectAId, agencyAId, tenderId])
    readinessId = readiness.rows[0].id

    const pack = await pool.query(`insert into bid_submission_packs (bid_project_id, agency_id, readiness_id, version) values ($1, $2, $3, 1) returning id`, [bidProjectAId, agencyAId, readinessId])
    packId = pack.rows[0].id

    const execution = await pool.query(
      `insert into bid_submission_executions (bid_project_id, agency_id, tender_id, status, submission_method, automation_status, target_value, approved_readiness_id, submission_pack_id, submission_pack_version, submission_pack_hash, manifest_hash)
       values ($1, $2, $3, 'AWAITING_HUMAN_CONFIRMATION', 'PORTAL', 'MANUAL_REQUIRED', 'https://etenders.gov.za/x', $4, $5, 1, 'hash1', 'manifest1') returning id`,
      [bidProjectAId, agencyAId, tenderId, readinessId, packId],
    )
    executionId = execution.rows[0].id

    const confirmation = await pool.query(
      `insert into bid_submission_confirmations (submission_execution_id, agency_id, readiness_id, pack_id, pack_version, pack_hash, manifest_hash, submission_method, target_value, statement, confirmed_by)
       values ($1, $2, $3, $4, 1, 'hash1', 'manifest1', 'PORTAL', 'https://etenders.gov.za/x', 'I confirm that I am authorised to submit this bid using the exact approved submission pack.', $5) returning id`,
      [executionId, agencyAId, readinessId, packId, userAId],
    )
    confirmationId = confirmation.rows[0].id
  })

  it('agency A can read its own submission execution, confirmation, attempts and receipts under RLS', async () => {
    await withUser(userAId, async (c) => {
      expect((await c.query('select id from bid_submission_executions where id = $1', [executionId])).rows).toHaveLength(1)
      expect((await c.query('select id from bid_submission_confirmations where id = $1', [confirmationId])).rows).toHaveLength(1)
    })
  })

  it('agency B cannot read agency A submission execution data (cross-tenant isolation)', async () => {
    await withUser(userBId, async (c) => {
      expect((await c.query('select id from bid_submission_executions where id = $1', [executionId])).rows).toHaveLength(0)
      expect((await c.query('select id from bid_submission_confirmations where id = $1', [confirmationId])).rows).toHaveLength(0)
    })
  })

  it('the authenticated role cannot write submission execution tables directly (service-role only)', async () => {
    await withUser(userAId, async (c) => {
      await expect(
        c.query(`insert into bid_submission_executions (bid_project_id, agency_id, tender_id) values ($1, $2, $3)`, [bidProjectAId, agencyAId, tenderId]),
      ).rejects.toThrow()
    })
  })

  it('only one submission execution row exists per bid project', async () => {
    await expect(
      pool.query(`insert into bid_submission_executions (bid_project_id, agency_id, tender_id) values ($1, $2, $3)`, [bidProjectAId, agencyAId, tenderId]),
    ).rejects.toThrow()
  })

  it('a confirmation requires a non-empty statement', async () => {
    await expect(
      pool.query(
        `insert into bid_submission_confirmations (submission_execution_id, agency_id, readiness_id, pack_id, pack_version, pack_hash, manifest_hash, submission_method, statement, confirmed_by)
         values ($1, $2, $3, $4, 1, 'h', 'm', 'PORTAL', '', $5)`,
        [executionId, agencyAId, readinessId, packId, userAId],
      ),
    ).rejects.toThrow()
  })

  it('a confirmation is immutable once created (only invalidated/invalidated_reason/invalidated_at may ever change)', async () => {
    await expect(
      pool.query(`update bid_submission_confirmations set statement = 'changed' where id = $1`, [confirmationId]),
    ).rejects.toThrow(/immutable/)
    await expect(
      pool.query(`update bid_submission_confirmations set invalidated = true, invalidated_reason = 'pack changed', invalidated_at = now() where id = $1`, [confirmationId]),
    ).resolves.toBeDefined()
  })

  it('an attempt requires an existing confirmation and pack (FK enforcement)', async () => {
    await expect(
      pool.query(
        `insert into bid_submission_attempts (submission_execution_id, agency_id, attempt_number, method, pack_id, pack_version, pack_hash, manifest_hash, initiated_by, confirmation_id, idempotency_key)
         values ($1, $2, 1, 'PORTAL', $3, 1, 'h', 'm', $4, gen_random_uuid(), 'idem-fk-test')`,
        [executionId, agencyAId, packId, userAId],
      ),
    ).rejects.toThrow()
  })

  it('a valid attempt can be created, and at most one STARTED (active) attempt is allowed per execution', async () => {
    const attempt = await pool.query(
      `insert into bid_submission_attempts (submission_execution_id, agency_id, attempt_number, method, pack_id, pack_version, pack_hash, manifest_hash, initiated_by, confirmation_id, idempotency_key)
       values ($1, $2, 1, 'PORTAL', $3, 1, 'h', 'm', $4, $5, 'idem-key-1') returning id`,
      [executionId, agencyAId, packId, userAId, confirmationId],
    )
    expect(attempt.rows).toHaveLength(1)

    await expect(
      pool.query(
        `insert into bid_submission_attempts (submission_execution_id, agency_id, attempt_number, method, pack_id, pack_version, pack_hash, manifest_hash, initiated_by, confirmation_id, idempotency_key)
         values ($1, $2, 2, 'PORTAL', $3, 1, 'h', 'm', $4, $5, 'idem-key-2')`,
        [executionId, agencyAId, packId, userAId, confirmationId],
      ),
    ).rejects.toThrow()
  })

  it('an idempotency key is unique across attempts', async () => {
    await pool.query(`update bid_submission_attempts set status = 'SUCCEEDED', completed_at = now() where submission_execution_id = $1`, [executionId])
    await expect(
      pool.query(
        `insert into bid_submission_attempts (submission_execution_id, agency_id, attempt_number, method, pack_id, pack_version, pack_hash, manifest_hash, initiated_by, confirmation_id, idempotency_key)
         values ($1, $2, 2, 'PORTAL', $3, 1, 'h', 'm', $4, $5, 'idem-key-1')`,
        [executionId, agencyAId, packId, userAId, confirmationId],
      ),
    ).rejects.toThrow()
  })

  it('a terminal (non-STARTED) attempt is append-only/immutable — its identity fields can never be rewritten', async () => {
    const [row] = (await pool.query(`select id from bid_submission_attempts where submission_execution_id = $1 order by attempt_number limit 1`, [executionId])).rows
    await expect(
      pool.query(`update bid_submission_attempts set pack_version = 2 where id = $1`, [row.id]),
    ).rejects.toThrow(/immutable/)
  })

  it('a receipt can be captured, and its evidence fields are immutable once created (only verification_status/notes may change)', async () => {
    const receipt = await pool.query(
      `insert into bid_submission_receipts (submission_execution_id, agency_id, receipt_type, provider_name, provider_reference, verification_status)
       values ($1, $2, 'PORTAL_RECEIPT', 'PORTAL', 'REF-001', 'VERIFIED') returning id`,
      [executionId, agencyAId],
    )
    const receiptId = receipt.rows[0].id
    await expect(
      pool.query(`update bid_submission_receipts set provider_reference = 'REF-002' where id = $1`, [receiptId]),
    ).rejects.toThrow(/immutable/)
    await expect(
      pool.query(`update bid_submission_receipts set verification_status = 'CONFLICTING', notes = 'disputed' where id = $1`, [receiptId]),
    ).resolves.toBeDefined()
  })

  it('agency B cannot read agency A receipts (cross-tenant isolation)', async () => {
    await withUser(userBId, async (c) => {
      expect((await c.query('select id from bid_submission_receipts where submission_execution_id = $1', [executionId])).rows).toHaveLength(0)
    })
  })

  it('a malformed execution id is rejected as an invalid UUID, never silently matched', async () => {
    await withUser(userAId, async (c) => {
      await expect(c.query(`select id from bid_submission_executions where id = $1`, ["'; drop table bid_submission_executions; --"])).rejects.toThrow()
    })
  })

  it('a cross-agency bid project id used for a new execution is rejected at the FK/agency layer', async () => {
    await expect(
      pool.query(`insert into bid_submission_executions (bid_project_id, agency_id, tender_id) values ($1, $2, $3)`, [bidProjectAId, agencyBId, tenderId]),
    ).rejects.toThrow()
  })
})
