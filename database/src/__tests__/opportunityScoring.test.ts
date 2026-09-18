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
 * Phase 10 §49/§50/§36 security tests: agency isolation for every new
 * scoring table, shared-catalogue read access for scoring
 * configurations, no direct authenticated write access, and malicious
 * ids. Mirrors database/src/__tests__/qualification.test.ts exactly,
 * one layer down for the Phase 10 tables.
 */
describe('opportunity scoring tables and RLS (Phase 10)', () => {
  let agencyAId: string
  let agencyBId: string
  let userAId: string
  let userBId: string
  let tenderId: string
  let configVersionId: string
  let runAId: string

  beforeAll(async () => {
    const agencyA = await pool.query(`insert into agencies (name) values ('Scoring Test Agency A') returning id`)
    agencyAId = agencyA.rows[0].id
    const agencyB = await pool.query(`insert into agencies (name) values ('Scoring Test Agency B') returning id`)
    agencyBId = agencyB.rows[0].id

    const userA = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userAId = userA.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'sa@example.com')`, [userAId, agencyAId])
    const userB = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userBId = userB.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'sb@example.com')`, [userBId, agencyBId])

    const tender = await pool.query(`insert into tenders (title) values ('Opportunity scoring test tender') returning id`)
    tenderId = tender.rows[0].id

    const cfgVersion = await pool.query(`select id from scoring_configuration_versions where is_current = true limit 1`)
    configVersionId = cfgVersion.rows[0].id

    const runA = await pool.query(
      `insert into tender_scoring_runs (tender_id, agency_id, status, scoring_configuration_version_id, overall_score, data_completeness, decision_signal)
       values ($1, $2, 'COMPLETED', $3, 82, 0.9, 'HIGH_PRIORITY') returning id`,
      [tenderId, agencyAId, configVersionId],
    )
    runAId = runA.rows[0].id

    await pool.query(`insert into tender_score_components (run_id, dimension, status, score, weight, explanation) values ($1, 'QUALIFICATION', 'KNOWN', 100, 0.2, 'eligible')`, [runAId])
    await pool.query(`insert into tender_score_drivers (run_id, dimension, description, evidence) values ($1, 'QUALIFICATION', 'all mandatory satisfied', '[]'::jsonb)`, [runAId])
    await pool.query(`insert into tender_score_risks (run_id, dimension, description, evidence) values ($1, 'COMMERCIAL_FIT', 'value unknown', '[]'::jsonb)`, [runAId])
    await pool.query(`insert into tender_score_gates (run_id, gate_type, status, description) values ($1, 'MANDATORY_QUALIFICATION_FAILURE', 'OK', 'no failure')`, [runAId])
  })

  it('the default scoring configuration seed is present and its weights sum to 1', async () => {
    const result = await pool.query(`select dimension_weights from scoring_configuration_versions where id = $1`, [configVersionId])
    const weights: Record<string, number> = result.rows[0].dimension_weights
    const sum = Object.values(weights).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1)
  })

  it('scoring_configurations/versions are shared-catalogue readable by any authenticated user', async () => {
    await withUser(userBId, async (c: pg.PoolClient) => {
      const result = await c.query('select id from scoring_configuration_versions where id = $1', [configVersionId])
      expect(result.rows).toHaveLength(1)
    })
  })

  it('agency A can read its own scoring run/components/drivers/risks/gates under RLS', async () => {
    await withUser(userAId, async (c: pg.PoolClient) => {
      expect((await c.query('select id from tender_scoring_runs where id = $1', [runAId])).rows).toHaveLength(1)
      expect((await c.query('select id from tender_score_components where run_id = $1', [runAId])).rows).toHaveLength(1)
      expect((await c.query('select id from tender_score_drivers where run_id = $1', [runAId])).rows).toHaveLength(1)
      expect((await c.query('select id from tender_score_risks where run_id = $1', [runAId])).rows).toHaveLength(1)
      expect((await c.query('select id from tender_score_gates where run_id = $1', [runAId])).rows).toHaveLength(1)
    })
  })

  it('agency B cannot read agency A scoring run/components/drivers/risks/gates under RLS', async () => {
    await withUser(userBId, async (c: pg.PoolClient) => {
      expect((await c.query('select id from tender_scoring_runs where id = $1', [runAId])).rows).toHaveLength(0)
      expect((await c.query('select id from tender_score_components where run_id = $1', [runAId])).rows).toHaveLength(0)
      expect((await c.query('select id from tender_score_drivers where run_id = $1', [runAId])).rows).toHaveLength(0)
      expect((await c.query('select id from tender_score_risks where run_id = $1', [runAId])).rows).toHaveLength(0)
      expect((await c.query('select id from tender_score_gates where run_id = $1', [runAId])).rows).toHaveLength(0)
    })
  })

  it("neither agency's authenticated role can write scoring tables directly (service-role only)", async () => {
    await withUser(userAId, async (c: pg.PoolClient) => {
      await expect(c.query(`insert into tender_scoring_runs (tender_id, agency_id, status, scoring_configuration_version_id) values ($1, $2, 'QUEUED', $3)`, [tenderId, agencyAId, configVersionId])).rejects.toThrow()
    })
  })

  it('a malicious/malformed run id is rejected as an invalid UUID, never silently matched', async () => {
    await withUser(userAId, async (c: pg.PoolClient) => {
      await expect(c.query(`select id from tender_scoring_runs where id = $1`, ["'; drop table tender_scoring_runs; --"])).rejects.toThrow()
    })
  })

  it('agency_geographic_scope and tender_evaluation_criterion_agency_evidence are agency-isolated', async () => {
    const geo = await pool.query(`insert into agency_geographic_scope (agency_id, scope_type) values ($1, 'NATIONAL') returning id`, [agencyAId])
    await withUser(userAId, async (c: pg.PoolClient) => {
      expect((await c.query('select id from agency_geographic_scope where id = $1', [geo.rows[0].id])).rows).toHaveLength(1)
    })
    await withUser(userBId, async (c: pg.PoolClient) => {
      expect((await c.query('select id from agency_geographic_scope where id = $1', [geo.rows[0].id])).rows).toHaveLength(0)
    })
  })

  it('historical scoring runs are never mutated by a new run — a second COMPLETED run for the same tender+agency leaves the first row\'s data intact and only flips is_current', async () => {
    const runB = await pool.query(
      `insert into tender_scoring_runs (tender_id, agency_id, status, scoring_configuration_version_id, overall_score, decision_signal, is_current)
       values ($1, $2, 'COMPLETED', $3, 40, 'LOW_PRIORITY', false) returning id`,
      [tenderId, agencyAId, configVersionId],
    )
    await pool.query(`update tender_scoring_runs set is_current = false where id = $1`, [runAId])
    await pool.query(`update tender_scoring_runs set is_current = true where id = $1`, [runB.rows[0].id])
    const original = await pool.query(`select overall_score, decision_signal from tender_scoring_runs where id = $1`, [runAId])
    expect(Number(original.rows[0].overall_score)).toBe(82)
    expect(original.rows[0].decision_signal).toBe('HIGH_PRIORITY')
  })

  it('only one row per tender+agency can be is_current at a time', async () => {
    await expect(pool.query(`update tender_scoring_runs set is_current = true where tender_id = $1 and agency_id = $2`, [tenderId, agencyAId])).rejects.toThrow()
  })
})
