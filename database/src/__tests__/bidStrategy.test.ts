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
 * Phase 12 §38/§26 — mirrors database/src/__tests__/bidDecision.test.ts:
 * RLS agency isolation, service-role-only mutation, and the
 * DB-enforced approved-strategy immutability constraint.
 */
describe('bid strategy tables and RLS (Phase 12)', () => {
  let agencyAId: string
  let agencyBId: string
  let userAId: string
  let userBId: string
  let tenderId: string
  let policyVersionAId: string
  let decisionRunAId: string
  let bidProjectAId: string
  let strategyAId: string

  beforeAll(async () => {
    const agencyA = await pool.query(`insert into agencies (name) values ('Bid Strategy Test Agency A') returning id`)
    agencyAId = agencyA.rows[0].id
    const agencyB = await pool.query(`insert into agencies (name) values ('Bid Strategy Test Agency B') returning id`)
    agencyBId = agencyB.rows[0].id

    const userA = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userAId = userA.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'bsa@example.com')`, [userAId, agencyAId])
    const userB = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userBId = userB.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'bsb@example.com')`, [userBId, agencyBId])

    const tender = await pool.query(`insert into tenders (title) values ('Bid strategy test tender') returning id`)
    tenderId = tender.rows[0].id

    const policyA = await pool.query(`insert into bid_policies (agency_id, name) values ($1, 'default') returning id`, [agencyAId])
    const policyVersionA = await pool.query(`insert into bid_policy_versions (policy_id, version) values ($1, 1) returning id`, [policyA.rows[0].id])
    policyVersionAId = policyVersionA.rows[0].id

    const run = await pool.query(
      `insert into bid_decision_runs (tender_id, agency_id, status, bid_policy_version_id, system_decision, final_decision, bid_effort)
       values ($1, $2, 'COMPLETED', $3, 'BID', 'BID', 'LOW') returning id`,
      [tenderId, agencyAId, policyVersionAId],
    )
    decisionRunAId = run.rows[0].id

    const project = await pool.query(
      `insert into bid_strategy_projects (tender_id, agency_id, project_name, bid_decision_run_id) values ($1, $2, 'Test bid project', $3) returning id`,
      [tenderId, agencyAId, decisionRunAId],
    )
    bidProjectAId = project.rows[0].id

    const strategy = await pool.query(`insert into bid_strategies (bid_project_id, agency_id, version, objective) values ($1, $2, 1, 'Win this tender') returning id`, [bidProjectAId, agencyAId])
    strategyAId = strategy.rows[0].id
  })

  it('a Bid Project cannot exist without a Bid Decision run (not-null FK)', async () => {
    await expect(pool.query(`insert into bid_strategy_projects (tender_id, agency_id, project_name, bid_decision_run_id) values ($1, $2, 'x', null)`, [tenderId, agencyAId])).rejects.toThrow()
  })

  it('agency A can read its own bid project and strategy under RLS', async () => {
    await withUser(userAId, async (c) => {
      expect((await c.query('select id from bid_strategy_projects where id = $1', [bidProjectAId])).rows).toHaveLength(1)
      expect((await c.query('select id from bid_strategies where id = $1', [strategyAId])).rows).toHaveLength(1)
    })
  })

  it('agency B cannot read agency A bid project or strategy (agency isolation)', async () => {
    await withUser(userBId, async (c) => {
      expect((await c.query('select id from bid_strategy_projects where id = $1', [bidProjectAId])).rows).toHaveLength(0)
      expect((await c.query('select id from bid_strategies where id = $1', [strategyAId])).rows).toHaveLength(0)
    })
  })

  it('the authenticated role cannot write bid strategy tables directly (service-role only)', async () => {
    await withUser(userAId, async (c) => {
      await expect(c.query(`insert into bid_strategy_projects (tender_id, agency_id, project_name, bid_decision_run_id) values ($1, $2, 'x', $3)`, [tenderId, agencyAId, decisionRunAId])).rejects.toThrow()
    })
  })

  it('a differentiator cannot be marked SUPPORTED with zero supporting evidence (DB-level check)', async () => {
    await expect(
      pool.query(`insert into bid_differentiators (bid_project_id, strategy_id, title, evidence_status, supporting_evidence_count) values ($1, $2, 'x', 'SUPPORTED', 0)`, [bidProjectAId, strategyAId]),
    ).rejects.toThrow()
  })

  it('a differentiator CAN be marked SUPPORTED once it has at least one supporting evidence record', async () => {
    const result = await pool.query(`insert into bid_differentiators (bid_project_id, strategy_id, title, evidence_status, supporting_evidence_count) values ($1, $2, 'x', 'SUPPORTED', 1) returning id`, [bidProjectAId, strategyAId])
    expect(result.rows).toHaveLength(1)
  })

  it('a bid question cannot carry an answer with no answer_source (never an invented answer)', async () => {
    await expect(pool.query(`insert into bid_questions (bid_project_id, question, answer) values ($1, 'q?', 'a.')`, [bidProjectAId])).rejects.toThrow()
  })

  it('a win theme not sourced from HUMAN_DEFINED must carry a source_id (traceability, never invented)', async () => {
    await expect(pool.query(`insert into bid_win_themes (bid_project_id, strategy_id, title, source_type, source_id) values ($1, $2, 'x', 'EVALUATION_CRITERION', null)`, [bidProjectAId, strategyAId])).rejects.toThrow()
  })

  it('an APPROVED strategy version is immutable at the DB level — updating its content is rejected', async () => {
    await pool.query(`update bid_strategies set status = 'APPROVED', approved_by = $2, approved_at = now() where id = $1`, [strategyAId, userAId])
    await expect(pool.query(`update bid_strategies set objective = 'changed' where id = $1`, [strategyAId])).rejects.toThrow(/immutable/)
  })

  it('superseding an approved strategy (creating v2, marking v1 SUPERSEDED and not current) is allowed', async () => {
    // is_current must move off v1 before v2 can take the unique "current" slot.
    const result = await pool.query(`update bid_strategies set status = 'SUPERSEDED', is_current = false where id = $1 returning status, is_current`, [strategyAId])
    expect(result.rows[0].status).toBe('SUPERSEDED')
    expect(result.rows[0].is_current).toBe(false)

    const v2 = await pool.query(`insert into bid_strategies (bid_project_id, agency_id, version, objective, supersedes_strategy_id) values ($1, $2, 2, 'v2 objective', $3) returning id`, [bidProjectAId, agencyAId, strategyAId])
    expect(v2.rows).toHaveLength(1)
  })

  it('only one bid_strategies row per project can be is_current at a time (unique partial index)', async () => {
    await expect(pool.query(`update bid_strategies set is_current = true where version = 1 and bid_project_id = $1`, [bidProjectAId])).rejects.toThrow()
  })

  it('only one active (non-cancelled/closed) Bid Project can exist per tender+agency', async () => {
    await expect(
      pool.query(`insert into bid_strategy_projects (tender_id, agency_id, project_name, bid_decision_run_id) values ($1, $2, 'dup', $3)`, [tenderId, agencyAId, decisionRunAId]),
    ).rejects.toThrow()
  })

  it('a malformed project id is rejected as an invalid UUID, never silently matched', async () => {
    await withUser(userAId, async (c) => {
      await expect(c.query(`select id from bid_strategy_projects where id = $1`, ["'; drop table bid_strategy_projects; --"])).rejects.toThrow()
    })
  })
})
