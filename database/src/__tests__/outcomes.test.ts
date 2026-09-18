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
 * Phase 17 — awards/outcomes/win-loss/learning-foundation schema:
 * RLS agency isolation, service-role-only mutation, one-current-per-
 * tender/project uniqueness, at-most-one-primary-loss-reason,
 * verified-requires-verifier constraints, immutable decision-time
 * feature snapshots (spec §44/§80), and the decision-time/outcome
 * feature split (spec §79 leakage boundary — enforced structurally by
 * these being two separate tables).
 */
describe('outcome/award/learning tables, RLS and integrity (Phase 17)', () => {
  let agencyAId: string
  let agencyBId: string
  let userAId: string
  let userBId: string
  let tenderId: string
  let decisionRunAId: string
  let bidProjectAId: string
  let tenderOutcomeId: string
  let bidOutcomeId: string

  beforeAll(async () => {
    const agencyA = await pool.query(`insert into agencies (name) values ('Outcomes Test Agency A') returning id`)
    agencyAId = agencyA.rows[0].id
    const agencyB = await pool.query(`insert into agencies (name) values ('Outcomes Test Agency B') returning id`)
    agencyBId = agencyB.rows[0].id

    const userA = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userAId = userA.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'outcomea@example.com')`, [userAId, agencyAId])
    const userB = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userBId = userB.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'outcomeb@example.com')`, [userBId, agencyBId])

    const tender = await pool.query(`insert into tenders (title, closing_date, closing_time) values ('Outcomes test tender', current_date - 5, '17:00:00') returning id`)
    tenderId = tender.rows[0].id

    const policyA = await pool.query(`insert into bid_policies (agency_id, name) values ($1, 'default') returning id`, [agencyAId])
    const policyVersionA = await pool.query(`insert into bid_policy_versions (policy_id, version) values ($1, 1) returning id`, [policyA.rows[0].id])
    const run = await pool.query(
      `insert into bid_decision_runs (tender_id, agency_id, status, bid_policy_version_id, system_decision, final_decision, bid_effort) values ($1, $2, 'COMPLETED', $3, 'BID', 'BID', 'LOW') returning id`,
      [tenderId, agencyAId, policyVersionA.rows[0].id],
    )
    decisionRunAId = run.rows[0].id

    const project = await pool.query(`insert into bid_strategy_projects (tender_id, agency_id, project_name, bid_decision_run_id) values ($1, $2, 'Outcomes test bid project', $3) returning id`, [tenderId, agencyAId, decisionRunAId])
    bidProjectAId = project.rows[0].id

    const outcome = await pool.query(
      `insert into tender_outcomes (tender_id, outcome_status, winner_name, award_value, truth_status, provenance)
       values ($1, 'AWARDED', 'Competitor Co', 100000, 'UNVERIFIED', 'HUMAN_REPORTED') returning id`,
      [tenderId],
    )
    tenderOutcomeId = outcome.rows[0].id

    const bidOutcome = await pool.query(
      `insert into bid_outcomes (bid_project_id, agency_id, tender_id, tender_outcome_id, our_result, submission_status_snapshot, reconciliation_basis, truth_status, provenance)
       values ($1, $2, $3, $4, 'LOST', 'VERIFIED_SUBMITTED', 'AWARDED + VERIFIED_SUBMITTED + winner != us', 'INFERRED', 'SYSTEM_CALCULATED') returning id`,
      [bidProjectAId, agencyAId, tenderId, tenderOutcomeId],
    )
    bidOutcomeId = bidOutcome.rows[0].id
  })

  it('agency A can read its own bid outcome; the tender outcome (shared fact) is visible to any authenticated user', async () => {
    await withUser(userAId, async (c) => {
      expect((await c.query('select id from bid_outcomes where id = $1', [bidOutcomeId])).rows).toHaveLength(1)
      expect((await c.query('select id from tender_outcomes where id = $1', [tenderOutcomeId])).rows).toHaveLength(1)
    })
  })

  it('agency B cannot read agency A bid outcome (cross-tenant isolation), but can read the shared tender outcome', async () => {
    await withUser(userBId, async (c) => {
      expect((await c.query('select id from bid_outcomes where id = $1', [bidOutcomeId])).rows).toHaveLength(0)
      expect((await c.query('select id from tender_outcomes where id = $1', [tenderOutcomeId])).rows).toHaveLength(1)
    })
  })

  it('the authenticated role cannot write outcome tables directly (service-role only)', async () => {
    await withUser(userAId, async (c) => {
      await expect(
        c.query(`insert into bid_outcomes (bid_project_id, agency_id, tender_id) values ($1, $2, $3)`, [bidProjectAId, agencyAId, tenderId]),
      ).rejects.toThrow()
      await expect(
        c.query(`update tender_outcomes set winner_name = 'Hacked' where id = $1`, [tenderOutcomeId]),
      ).rejects.toThrow()
    })
  })

  it('only one current tender outcome per tender, and one current bid outcome per bid project', async () => {
    await expect(
      pool.query(`insert into tender_outcomes (tender_id, outcome_status) values ($1, 'AWARDED')`, [tenderId]),
    ).rejects.toThrow()
    await expect(
      pool.query(`insert into bid_outcomes (bid_project_id, agency_id, tender_id, our_result) values ($1, $2, $3, 'LOST')`, [bidProjectAId, agencyAId, tenderId]),
    ).rejects.toThrow()
  })

  it('a superseding outcome version can be recorded once the old one is marked not-current (append-only correction, spec §59)', async () => {
    await pool.query(`update tender_outcomes set is_current = false where id = $1`, [tenderOutcomeId])
    const corrected = await pool.query(
      `insert into tender_outcomes (tender_id, outcome_status, winner_name, award_value, truth_status, provenance, supersedes_id, version, verified_by, verified_at)
       values ($1, 'AWARDED', 'Corrected Winner Ltd', 95000, 'VERIFIED', 'OFFICIAL_SOURCE', $2, 2, $3, now()) returning id`,
      [tenderId, tenderOutcomeId, userAId],
    )
    expect(corrected.rows).toHaveLength(1)
    // the original row still exists, unmodified in substance — auditable history.
    const original = await pool.query(`select winner_name, is_current from tender_outcomes where id = $1`, [tenderOutcomeId])
    expect(original.rows[0].winner_name).toBe('Competitor Co')
    expect(original.rows[0].is_current).toBe(false)
  })

  it('truth_status VERIFIED requires a verified_by/verified_at pair', async () => {
    await expect(
      pool.query(`insert into tender_outcomes (tender_id, outcome_status, truth_status, is_current) values ($1, 'AWARDED', 'VERIFIED', false)`, [tenderId]),
    ).rejects.toThrow()
    await expect(
      pool.query(
        `insert into tender_outcomes (tender_id, outcome_status, truth_status, verified_by, verified_at, is_current) values ($1, 'AWARDED', 'VERIFIED', $2, now(), false)`,
        [tenderId, userAId],
      ),
    ).resolves.toBeDefined()
  })

  it('at most one loss reason per bid outcome may be marked primary', async () => {
    await pool.query(
      `insert into loss_reasons (bid_outcome_id, agency_id, category, is_primary, provenance) values ($1, $2, 'PRICE', true, 'HUMAN_REPORTED')`,
      [bidOutcomeId, agencyAId],
    )
    await expect(
      pool.query(
        `insert into loss_reasons (bid_outcome_id, agency_id, category, is_primary, provenance) values ($1, $2, 'EVALUATION_SCORE', true, 'HUMAN_REPORTED')`,
        [bidOutcomeId, agencyAId],
      ),
    ).rejects.toThrow()
    // a non-primary secondary reason is fine
    await expect(
      pool.query(
        `insert into loss_reasons (bid_outcome_id, agency_id, category, is_primary, provenance) values ($1, $2, 'CAPACITY', false, 'HUMAN_REPORTED')`,
        [bidOutcomeId, agencyAId],
      ),
    ).resolves.toBeDefined()
  })

  it('an outcome conflict can be recorded and only resolved with a resolver (spec §17)', async () => {
    const conflict = await pool.query(
      `insert into outcome_conflicts (tender_outcome_id, field_name, existing_value, conflicting_value, existing_source, conflicting_source)
       values ($1, 'winner_name', 'Competitor Co', 'Other Co', 'source-a', 'source-b') returning id`,
      [tenderOutcomeId],
    )
    const conflictId = conflict.rows[0].id
    await expect(
      pool.query(`update outcome_conflicts set status = 'RESOLVED' where id = $1`, [conflictId]),
    ).rejects.toThrow()
    await expect(
      pool.query(`update outcome_conflicts set status = 'RESOLVED', resolved_by = $2, resolved_at = now() where id = $1`, [conflictId, userAId]),
    ).resolves.toBeDefined()
  })

  it('a decision-time feature snapshot is immutable once captured (spec §44/§80)', async () => {
    const snapshot = await pool.query(
      `insert into outcome_decision_time_features (bid_project_id, agency_id, tender_id, tender_category, opportunity_score_at_decision, bid_decision)
       values ($1, $2, $3, 'IT Services', 72, 'BID') returning id`,
      [bidProjectAId, agencyAId, tenderId],
    )
    const id = snapshot.rows[0].id
    await expect(
      pool.query(`update outcome_decision_time_features set opportunity_score_at_decision = 90 where id = $1`, [id]),
    ).rejects.toThrow(/immutable/)
  })

  it('only one decision-time feature row and one outcome-feature row exist per bid project', async () => {
    await expect(
      pool.query(
        `insert into outcome_decision_time_features (bid_project_id, agency_id, tender_id) values ($1, $2, $3)`,
        [bidProjectAId, agencyAId, tenderId],
      ),
    ).rejects.toThrow()
    await pool.query(
      `insert into outcome_result_features (bid_project_id, agency_id, tender_id, bid_outcome_id, our_result, award_value) values ($1, $2, $3, $4, 'LOST', 100000)`,
      [bidProjectAId, agencyAId, tenderId, bidOutcomeId],
    )
    await expect(
      pool.query(
        `insert into outcome_result_features (bid_project_id, agency_id, tender_id) values ($1, $2, $3)`,
        [bidProjectAId, agencyAId, tenderId],
      ),
    ).rejects.toThrow()
  })

  it('competitor extension columns exist and default data_quality to UNKNOWN', async () => {
    const competitor = await pool.query(`insert into competitors (name) values ('New Competitor Ltd') returning id, data_quality`)
    expect(competitor.rows[0].data_quality).toBe('UNKNOWN')
  })

  it('a malformed tender outcome id is rejected as an invalid UUID, never silently matched', async () => {
    await withUser(userAId, async (c) => {
      await expect(c.query(`select id from tender_outcomes where id = $1`, ['not-a-uuid'])).rejects.toThrow()
    })
  })
})
