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
 * Phase 15 — mirrors database/src/__tests__/proposalGeneration.test.ts:
 * RLS agency isolation, service-role-only mutation, DB-enforced
 * immutability of historical readiness snapshots and submission packs,
 * required-reason CHECKs, one-current-per-project uniqueness.
 */
describe('submission readiness tables, RLS and integrity (Phase 15)', () => {
  let agencyAId: string
  let agencyBId: string
  let userAId: string
  let userBId: string
  let tenderId: string
  let decisionRunAId: string
  let bidProjectAId: string
  let pricingId: string
  let readinessId: string
  let packId: string

  beforeAll(async () => {
    const agencyA = await pool.query(`insert into agencies (name) values ('Submission Test Agency A') returning id`)
    agencyAId = agencyA.rows[0].id
    const agencyB = await pool.query(`insert into agencies (name) values ('Submission Test Agency B') returning id`)
    agencyBId = agencyB.rows[0].id

    const userA = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userAId = userA.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'suba@example.com')`, [userAId, agencyAId])
    const userB = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userBId = userB.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'subb@example.com')`, [userBId, agencyBId])

    const tender = await pool.query(`insert into tenders (title) values ('Submission readiness test tender') returning id`)
    tenderId = tender.rows[0].id

    const policyA = await pool.query(`insert into bid_policies (agency_id, name) values ($1, 'default') returning id`, [agencyAId])
    const policyVersionA = await pool.query(`insert into bid_policy_versions (policy_id, version) values ($1, 1) returning id`, [policyA.rows[0].id])
    const run = await pool.query(
      `insert into bid_decision_runs (tender_id, agency_id, status, bid_policy_version_id, system_decision, final_decision, bid_effort) values ($1, $2, 'COMPLETED', $3, 'BID', 'BID', 'LOW') returning id`,
      [tenderId, agencyAId, policyVersionA.rows[0].id],
    )
    decisionRunAId = run.rows[0].id

    const project = await pool.query(`insert into bid_strategy_projects (tender_id, agency_id, project_name, bid_decision_run_id) values ($1, $2, 'Test bid project', $3) returning id`, [tenderId, agencyAId, decisionRunAId])
    bidProjectAId = project.rows[0].id

    const pricing = await pool.query(`insert into bid_pricing (bid_project_id, agency_id, currency) values ($1, $2, 'ZAR') returning id`, [bidProjectAId, agencyAId])
    pricingId = pricing.rows[0].id

    const readiness = await pool.query(
      `insert into bid_submission_readiness (bid_project_id, agency_id, tender_id, status, pricing_id) values ($1, $2, $3, 'BLOCKED', $4) returning id`,
      [bidProjectAId, agencyAId, tenderId, pricingId],
    )
    readinessId = readiness.rows[0].id

    const pack = await pool.query(
      `insert into bid_submission_packs (bid_project_id, agency_id, readiness_id, version, pricing_id) values ($1, $2, $3, 1, $4) returning id`,
      [bidProjectAId, agencyAId, readinessId, pricingId],
    )
    packId = pack.rows[0].id
  })

  it('agency A can read its own pricing, readiness and pack under RLS', async () => {
    await withUser(userAId, async (c) => {
      expect((await c.query('select id from bid_pricing where id = $1', [pricingId])).rows).toHaveLength(1)
      expect((await c.query('select id from bid_submission_readiness where id = $1', [readinessId])).rows).toHaveLength(1)
      expect((await c.query('select id from bid_submission_packs where id = $1', [packId])).rows).toHaveLength(1)
    })
  })

  it('agency B cannot read agency A submission readiness data (cross-tenant isolation)', async () => {
    await withUser(userBId, async (c) => {
      expect((await c.query('select id from bid_pricing where id = $1', [pricingId])).rows).toHaveLength(0)
      expect((await c.query('select id from bid_submission_readiness where id = $1', [readinessId])).rows).toHaveLength(0)
      expect((await c.query('select id from bid_submission_packs where id = $1', [packId])).rows).toHaveLength(0)
    })
  })

  it('the authenticated role cannot write submission readiness tables directly (service-role only)', async () => {
    await withUser(userAId, async (c) => {
      await expect(
        c.query(`insert into bid_submission_readiness (bid_project_id, agency_id, tender_id) values ($1, $2, $3)`, [bidProjectAId, agencyAId, tenderId]),
      ).rejects.toThrow()
    })
  })

  it('only one CURRENT readiness snapshot per bid project is allowed', async () => {
    await pool.query(`update bid_submission_readiness set is_current = true where id = $1`, [readinessId])
    await expect(
      pool.query(`insert into bid_submission_readiness (bid_project_id, agency_id, tender_id, is_current) values ($1, $2, $3, true)`, [bidProjectAId, agencyAId, tenderId]),
    ).rejects.toThrow()
  })

  it('a historical (non-current) readiness snapshot is immutable', async () => {
    const historical = await pool.query(
      `insert into bid_submission_readiness (bid_project_id, agency_id, tender_id, status, is_current) values ($1, $2, $3, 'READY_TO_SUBMIT', false) returning id`,
      [bidProjectAId, agencyAId, tenderId],
    )
    await expect(
      pool.query(`update bid_submission_readiness set status = 'BLOCKED' where id = $1`, [historical.rows[0].id]),
    ).rejects.toThrow(/immutable/)
  })

  it('only one CURRENT pack per bid project is allowed', async () => {
    await expect(
      pool.query(`insert into bid_submission_packs (bid_project_id, agency_id, readiness_id, version, pricing_id) values ($1, $2, $3, 2, $4)`, [bidProjectAId, agencyAId, readinessId, pricingId]),
    ).rejects.toThrow()
  })

  it('a submission pack cannot have its manifest mutated after creation (immutable, versioned instead)', async () => {
    await expect(
      pool.query(`update bid_submission_packs set manifest = '{"changed":true}'::jsonb where id = $1`, [packId]),
    ).rejects.toThrow(/immutable/)
  })

  it('a new pack version can be created and superseding the old is explicit, never implicit', async () => {
    await pool.query(`update bid_submission_packs set status = 'SUPERSEDED' where id = $1`, [packId])
    const v2 = await pool.query(
      `insert into bid_submission_packs (bid_project_id, agency_id, readiness_id, version, pricing_id) values ($1, $2, $3, 2, $4) returning id`,
      [bidProjectAId, agencyAId, readinessId, pricingId],
    )
    expect(v2.rows).toHaveLength(1)
    const old = await pool.query(`select status from bid_submission_packs where id = $1`, [packId])
    expect(old.rows[0].status).toBe('SUPERSEDED')
  })

  it('a pricing item requires non-negative quantity and unit price', async () => {
    await expect(
      pool.query(`insert into bid_pricing_items (pricing_id, agency_id, line_number, description, quantity, unit_price, line_total) values ($1, $2, 1, 'Line 1', -1, 100, -100)`, [pricingId, agencyAId]),
    ).rejects.toThrow()
  })

  it('a valid pricing item is accepted', async () => {
    const item = await pool.query(
      `insert into bid_pricing_items (pricing_id, agency_id, line_number, description, quantity, unit_price, line_total) values ($1, $2, 1, 'Project management', 1, 50000, 50000) returning id`,
      [pricingId, agencyAId],
    )
    expect(item.rows).toHaveLength(1)
  })

  it('a final approval requires a non-empty reason', async () => {
    await expect(
      pool.query(`insert into bid_submission_approvals (bid_project_id, agency_id, readiness_id, pack_id, approval_reason, approved_by) values ($1, $2, $3, $4, '', $5)`, [bidProjectAId, agencyAId, readinessId, packId, userAId]),
    ).rejects.toThrow()
  })

  it('a valid final approval is accepted and only one ACTIVE (APPROVED) approval per project is allowed', async () => {
    const v2 = await pool.query(`select id from bid_submission_packs where bid_project_id = $1 and version = 2`, [bidProjectAId])
    const approval = await pool.query(
      `insert into bid_submission_approvals (bid_project_id, agency_id, readiness_id, pack_id, approval_reason, approved_by) values ($1, $2, $3, $4, 'Reviewed and confirmed ready by BID_MANAGER.', $5) returning id`,
      [bidProjectAId, agencyAId, readinessId, v2.rows[0].id, userAId],
    )
    expect(approval.rows).toHaveLength(1)
    await expect(
      pool.query(`insert into bid_submission_approvals (bid_project_id, agency_id, readiness_id, pack_id, approval_reason, approved_by) values ($1, $2, $3, $4, 'Second approval attempt.', $5)`, [bidProjectAId, agencyAId, readinessId, v2.rows[0].id, userAId]),
    ).rejects.toThrow()
  })

  it('revoking an approval requires an actor and timestamp (CHECK constraint)', async () => {
    const v2 = await pool.query(`select id from bid_submission_packs where bid_project_id = $1 and version = 2`, [bidProjectAId])
    const [approvalRow] = (await pool.query(`select id from bid_submission_approvals where pack_id = $1`, [v2.rows[0].id])).rows
    await expect(
      pool.query(`update bid_submission_approvals set status = 'REVOKED' where id = $1`, [approvalRow.id]),
    ).rejects.toThrow()
    await expect(
      pool.query(`update bid_submission_approvals set status = 'REVOKED', revoked_by = $2, revoked_at = now(), revoked_reason = 'Package changed materially.' where id = $1`, [approvalRow.id, userAId]),
    ).resolves.toBeDefined()
  })

  it('a malformed pricing id is rejected as an invalid UUID, never silently matched', async () => {
    await withUser(userAId, async (c) => {
      await expect(c.query(`select id from bid_pricing where id = $1`, ["'; drop table bid_pricing; --"])).rejects.toThrow()
    })
  })
})
