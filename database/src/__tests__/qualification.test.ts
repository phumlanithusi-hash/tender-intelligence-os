import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import { getTestPool, asAuthenticatedUser } from '../testHelpers.js'

const pool = getTestPool()

afterAll(async () => {
  await pool.end()
})

/** Connects, runs `fn` impersonating `userId`, and always releases the client back to the pool afterwards — omitting this leaks connections and hangs `pool.end()` in `afterAll`. */
async function withUser<T>(userId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    return await asAuthenticatedUser(client, userId, fn)
  } finally {
    client.release()
  }
}

/**
 * Phase 8 §38 security tests: agency isolation, tender isolation,
 * evidence isolation, malicious ids, and the requirement-model
 * extensions. Mirrors the Phase 7 "AI classification records are
 * isolated per agency under RLS" block in schema.test.ts exactly, one
 * layer down for the new qualification tables.
 */
describe('qualification tables and RLS (Phase 8)', () => {
  let agencyAId: string
  let agencyBId: string
  let userAId: string
  let userBId: string
  let tenderId: string
  let requirementId: string
  let runAId: string
  let resultAId: string

  beforeAll(async () => {
    const agencyA = await pool.query(`insert into agencies (name) values ('Qualification Test Agency A') returning id`)
    agencyAId = agencyA.rows[0].id
    const agencyB = await pool.query(`insert into agencies (name) values ('Qualification Test Agency B') returning id`)
    agencyBId = agencyB.rows[0].id

    const userA = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userAId = userA.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'a@example.com')`, [userAId, agencyAId])
    const userB = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userBId = userB.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'b@example.com')`, [userBId, agencyBId])

    const tender = await pool.query(`insert into tenders (title) values ('Qualification test tender') returning id`)
    tenderId = tender.rows[0].id

    const requirement = await pool.query(
      `insert into tender_requirements (tender_id, requirement_type, requirement_text, mandatory, category, mandatory_status, rule_type, requirement_status)
       values ($1, 'CSD', 'Must be CSD registered', true, 'CSD', 'MANDATORY', 'BOOLEAN', 'VERIFIED') returning id`,
      [tenderId],
    )
    requirementId = requirement.rows[0].id

    const runA = await pool.query(`insert into tender_qualification_runs (tender_id, agency_id, status, overall_status) values ($1, $2, 'COMPLETED', 'NOT_ELIGIBLE') returning id`, [tenderId, agencyAId])
    runAId = runA.rows[0].id
    const resultA = await pool.query(
      `insert into tender_qualification_results (run_id, requirement_id, tender_id, agency_id, status, mandatory, explanation)
       values ($1, $2, $3, $4, 'FAIL', true, 'test') returning id`,
      [runAId, requirementId, tenderId, agencyAId],
    )
    resultAId = resultA.rows[0].id
    await pool.query(`insert into tender_qualification_actions (run_id, result_id, requirement_id, tender_id, agency_id, description) values ($1, $2, $3, $4, $5, 'Register on CSD')`, [
      runAId,
      resultAId,
      requirementId,
      tenderId,
      agencyAId,
    ])
  })

  it('tender_requirements gained the Phase 8 columns with safe defaults', async () => {
    const result = await pool.query(`select category, mandatory_status, source_truth, requirement_status, rule_type, version from tender_requirements where id = $1`, [requirementId])
    expect(result.rows[0].category).toBe('CSD')
    expect(result.rows[0].mandatory_status).toBe('MANDATORY')
    expect(result.rows[0].requirement_status).toBe('VERIFIED')
    expect(result.rows[0].version).toBe(1)
  })

  it('agency A can read its own qualification run/result/action under RLS', async () => {
    await withUser(userAId, async (c: pg.PoolClient) => {
      const run = await c.query('select id from tender_qualification_runs where id = $1', [runAId])
      expect(run.rows).toHaveLength(1)
      const result = await c.query('select id from tender_qualification_results where id = $1', [resultAId])
      expect(result.rows).toHaveLength(1)
      const actions = await c.query('select id from tender_qualification_actions where run_id = $1', [runAId])
      expect(actions.rows).toHaveLength(1)
    })
  })

  it('agency B cannot read agency A qualification run/result/action under RLS', async () => {
    await withUser(userBId, async (c: pg.PoolClient) => {
      const run = await c.query('select id from tender_qualification_runs where id = $1', [runAId])
      expect(run.rows).toHaveLength(0)
      const result = await c.query('select id from tender_qualification_results where id = $1', [resultAId])
      expect(result.rows).toHaveLength(0)
      const actions = await c.query('select id from tender_qualification_actions where run_id = $1', [runAId])
      expect(actions.rows).toHaveLength(0)
    })
  })

  it('neither agency\'s authenticated role can write qualification tables directly (service-role only)', async () => {
    await withUser(userAId, async (c: pg.PoolClient) => {
      await expect(c.query(`insert into tender_qualification_runs (tender_id, agency_id, status) values ($1, $2, 'QUEUED')`, [tenderId, agencyAId])).rejects.toThrow()
    })
  })

  it('tender_requirements (shared catalogue) remains readable across agencies, but qualification RESULTS never leak', async () => {
    await withUser(userBId, async (c: pg.PoolClient) => {
      const req = await c.query('select id from tender_requirements where id = $1', [requirementId])
      expect(req.rows).toHaveLength(1) // shared catalogue — expected
      const result = await c.query('select id from tender_qualification_results where requirement_id = $1', [requirementId])
      expect(result.rows).toHaveLength(0) // agency-relative result — must not leak
    })
  })

  it('a malicious/malformed run id is rejected as an invalid UUID, never silently matched', async () => {
    await withUser(userAId, async (c: pg.PoolClient) => {
      await expect(c.query(`select id from tender_qualification_runs where id = $1`, ["'; drop table tender_qualification_runs; --"])).rejects.toThrow()
    })
  })

  it('agency_financial_records is agency-isolated under RLS', async () => {
    const fin = await pool.query(`insert into agency_financial_records (agency_id, period_label, annual_turnover, evidence_status) values ($1, 'FY2025', 12000000, 'VERIFIED') returning id`, [agencyAId])
    await withUser(userAId, async (c: pg.PoolClient) => {
      const own = await c.query('select id from agency_financial_records where id = $1', [fin.rows[0].id])
      expect(own.rows).toHaveLength(1)
    })
    await withUser(userBId, async (c: pg.PoolClient) => {
      const other = await c.query('select id from agency_financial_records where id = $1', [fin.rows[0].id])
      expect(other.rows).toHaveLength(0)
    })
  })

  it('tender_requirement_conflicts is shared-catalogue readable (not agency-scoped, since it describes the document set)', async () => {
    const conflict = await pool.query(
      `insert into tender_requirement_conflicts (tender_id, category, description, evidence_a, evidence_b)
       values ($1, 'TURNOVER', 'conflicting turnover figures', '{"text":"R5m"}'::jsonb, '{"text":"R10m"}'::jsonb) returning id`,
      [tenderId],
    )
    await withUser(userBId, async (c: pg.PoolClient) => {
      const result = await c.query('select id from tender_requirement_conflicts where id = $1', [conflict.rows[0].id])
      expect(result.rows).toHaveLength(1)
    })
  })
})
