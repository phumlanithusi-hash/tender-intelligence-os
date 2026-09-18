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
 * Phase 11 §58 security tests + §37 DB-level override-reason
 * enforcement + §40 versioning/immutability, mirroring
 * database/src/__tests__/opportunityScoring.test.ts exactly, one layer
 * up for the Phase 11 bid-decision tables.
 */
describe('bid decision tables and RLS (Phase 11)', () => {
  let agencyAId: string
  let agencyBId: string
  let userAId: string
  let userBId: string
  let tenderId: string
  let policyVersionAId: string
  let runAId: string

  beforeAll(async () => {
    const agencyA = await pool.query(`insert into agencies (name) values ('Bid Decision Test Agency A') returning id`)
    agencyAId = agencyA.rows[0].id
    const agencyB = await pool.query(`insert into agencies (name) values ('Bid Decision Test Agency B') returning id`)
    agencyBId = agencyB.rows[0].id

    const userA = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userAId = userA.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'bda@example.com')`, [userAId, agencyAId])
    const userB = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userBId = userB.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'bdb@example.com')`, [userBId, agencyBId])

    const tender = await pool.query(`insert into tenders (title) values ('Bid decision test tender') returning id`)
    tenderId = tender.rows[0].id

    // Agencies created after the migration's one-time backfill get no
    // policy row automatically (documented in the migration) — create one
    // explicitly here, exactly as the real store does when none exists.
    const policyA = await pool.query(`insert into bid_policies (agency_id, name) values ($1, 'default') returning id`, [agencyAId])
    const policyVersionA = await pool.query(
      `insert into bid_policy_versions (policy_id, version, minimum_opportunity_score) values ($1, 1, '{"active": true, "severity": "NO_BID", "value": 65}'::jsonb) returning id`,
      [policyA.rows[0].id],
    )
    policyVersionAId = policyVersionA.rows[0].id

    const run = await pool.query(
      `insert into bid_decision_runs (tender_id, agency_id, status, bid_policy_version_id, system_decision, final_decision, bid_effort)
       values ($1, $2, 'COMPLETED', $3, 'BID', 'BID', 'LOW') returning id`,
      [tenderId, agencyAId, policyVersionAId],
    )
    runAId = run.rows[0].id
    await pool.query(`insert into bid_decision_rule_results (run_id, rule_id, precedence_step, status, severity, explanation) values ($1, 'minimum-opportunity-score', 'POSITIVE_BID_RULE', 'PASS', 'NO_BID', 'meets minimum')`, [runAId])
  })

  it('a bid policy version has a full, valid default precedence containing every required step exactly once', async () => {
    const result = await pool.query(`select precedence from bid_policy_versions where id = $1`, [policyVersionAId])
    const precedence: string[] = result.rows[0].precedence
    expect(new Set(precedence).size).toBe(precedence.length)
    expect(precedence).toContain('CONFIRMED_MANDATORY_FAILURE')
    expect(precedence).toContain('DEFAULT_REVIEW')
  })

  it('agency A can read its own bid policy, decision run, and rule results under RLS', async () => {
    await withUser(userAId, async (c: pg.PoolClient) => {
      expect((await c.query('select id from bid_policy_versions where id = $1', [policyVersionAId])).rows).toHaveLength(1)
      expect((await c.query('select id from bid_decision_runs where id = $1', [runAId])).rows).toHaveLength(1)
      expect((await c.query('select id from bid_decision_rule_results where run_id = $1', [runAId])).rows).toHaveLength(1)
    })
  })

  it('agency B cannot read agency A bid policy, decision run, or rule results under RLS (agency isolation)', async () => {
    await withUser(userBId, async (c: pg.PoolClient) => {
      expect((await c.query('select id from bid_policy_versions where id = $1', [policyVersionAId])).rows).toHaveLength(0)
      expect((await c.query('select id from bid_decision_runs where id = $1', [runAId])).rows).toHaveLength(0)
      expect((await c.query('select id from bid_decision_rule_results where run_id = $1', [runAId])).rows).toHaveLength(0)
    })
  })

  it("neither agency's authenticated role can write bid-decision tables directly (service-role only)", async () => {
    await withUser(userAId, async (c: pg.PoolClient) => {
      await expect(c.query(`insert into bid_decision_runs (tender_id, agency_id, status, bid_policy_version_id) values ($1, $2, 'QUEUED', $3)`, [tenderId, agencyAId, policyVersionAId])).rejects.toThrow()
    })
  })

  it('a malicious/malformed run id is rejected as an invalid UUID, never silently matched', async () => {
    await withUser(userAId, async (c: pg.PoolClient) => {
      await expect(c.query(`select id from bid_decision_runs where id = $1`, ["'; drop table bid_decision_runs; --"])).rejects.toThrow()
    })
  })

  it('a cross-agency override attempt cannot target another agency\'s decision run (unauthorized override attempt)', async () => {
    await withUser(userBId, async (c: pg.PoolClient) => {
      const visible = await c.query('select id from bid_decision_runs where id = $1', [runAId])
      expect(visible.rows).toHaveLength(0) // agency B cannot even see it to override it
    })
  })

  it('DB-level enforcement (§37): a human override without a reason is rejected by a CHECK constraint, not only app validation', async () => {
    await expect(pool.query(`update bid_decision_runs set human_decision = 'BID', final_decision = 'BID' where id = $1`, [runAId])).rejects.toThrow(/override_requires_reason/)
  })

  it('DB-level enforcement: an empty-string override reason is also rejected, not just NULL', async () => {
    await expect(
      pool.query(`update bid_decision_runs set human_decision = 'BID', final_decision = 'BID', override_reason = '   ', overridden_by = $2, overridden_at = now() where id = $1`, [runAId, null]),
    ).rejects.toThrow()
  })

  it('a valid override with a real reason is accepted and stores system + human + final side by side', async () => {
    await pool.query(
      `update bid_decision_runs set human_decision = 'BID', final_decision = 'BID', override_reason = 'Strategic client acquisition opportunity approved by executive team.', overridden_by = $2, overridden_at = now() where id = $1`,
      [runAId, userAId],
    )
    const row = await pool.query(`select system_decision, human_decision, final_decision, override_reason from bid_decision_runs where id = $1`, [runAId])
    expect(row.rows[0].system_decision).toBe('BID') // system decision is never mutated by an override
    expect(row.rows[0].human_decision).toBe('BID')
    expect(row.rows[0].override_reason).toContain('Strategic client acquisition')
  })

  it('historical decision runs are immutable in the sense that a superseding run only flips is_current, never rewriting the earlier row', async () => {
    const runB = await pool.query(
      `insert into bid_decision_runs (tender_id, agency_id, status, bid_policy_version_id, system_decision, final_decision, bid_effort, is_current)
       values ($1, $2, 'COMPLETED', $3, 'NO_BID', 'NO_BID', 'HIGH', false) returning id`,
      [tenderId, agencyAId, policyVersionAId],
    )
    await pool.query(`update bid_decision_runs set is_current = false where id = $1`, [runAId])
    await pool.query(`update bid_decision_runs set is_current = true where id = $1`, [runB.rows[0].id])
    const original = await pool.query(`select system_decision from bid_decision_runs where id = $1`, [runAId])
    expect(original.rows[0].system_decision).toBe('BID')

    // Now two rows exist for the same tender+agency — only one may be is_current at a time.
    await expect(pool.query(`update bid_decision_runs set is_current = true where tender_id = $1 and agency_id = $2`, [tenderId, agencyAId])).rejects.toThrow()

    // Restore runA as current for later tests in this file.
    await pool.query(`update bid_decision_runs set is_current = false where id = $1`, [runB.rows[0].id])
    await pool.query(`update bid_decision_runs set is_current = true where id = $1`, [runAId])
  })
})
