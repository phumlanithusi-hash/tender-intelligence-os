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
 * Phase 9 §45/§46 security + schema tests for the requirement &
 * evaluation extraction tables. Mirrors database/src/__tests__/qualification.test.ts.
 */
describe('requirement & evaluation extraction tables and RLS (Phase 9)', () => {
  let agencyAId: string
  let agencyBId: string
  let userAId: string
  let userBId: string
  let tenderId: string
  let parentRequirementId: string
  let childRequirementId: string
  let criterionId: string
  let runId: string

  beforeAll(async () => {
    const agencyA = await pool.query(`insert into agencies (name) values ('Req/Eval Test Agency A') returning id`)
    agencyAId = agencyA.rows[0].id
    const agencyB = await pool.query(`insert into agencies (name) values ('Req/Eval Test Agency B') returning id`)
    agencyBId = agencyB.rows[0].id

    const userA = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userAId = userA.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'req-a@example.com')`, [userAId, agencyAId])
    const userB = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userBId = userB.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'req-b@example.com')`, [userBId, agencyBId])

    const tender = await pool.query(`insert into tenders (title) values ('Requirement/evaluation test tender') returning id`)
    tenderId = tender.rows[0].id

    const parent = await pool.query(
      `insert into tender_requirements (tender_id, requirement_type, requirement_text, mandatory, mandatory_status, requirement_status)
       values ($1, 'FUNCTIONALITY', '3. FUNCTIONALITY', false, 'UNKNOWN', 'PROVISIONAL') returning id`,
      [tenderId],
    )
    parentRequirementId = parent.rows[0].id
    const child = await pool.query(
      `insert into tender_requirements (tender_id, parent_requirement_id, requirement_type, requirement_text, mandatory, mandatory_status, requirement_status, disqualification_risk)
       values ($1, $2, 'FUNCTIONALITY', '3.1 Company Experience', true, 'MANDATORY', 'PROVISIONAL', true) returning id`,
      [tenderId, parentRequirementId],
    )
    childRequirementId = child.rows[0].id

    const criterion = await pool.query(
      `insert into tender_evaluation_criteria (tender_id, criterion, criterion_type, maximum_points, status)
       values ($1, 'Company Experience', 'FUNCTIONALITY', 20, 'PROVISIONAL') returning id`,
      [tenderId],
    )
    criterionId = criterion.rows[0].id

    const run = await pool.query(
      `insert into tender_ai_runs (tender_id, agency_id, agent_name, model, prompt_version, status)
       values ($1, null, 'RequirementExtractionAgent', 'test-model', 'v1', 'COMPLETED') returning id`,
      [tenderId],
    )
    runId = run.rows[0].id
  })

  it('tender_requirements gained the Phase 9 hierarchy/disqualification columns with safe defaults', async () => {
    const result = await pool.query(`select parent_requirement_id, disqualification_risk from tender_requirements where id = $1`, [childRequirementId])
    expect(result.rows[0].parent_requirement_id).toBe(parentRequirementId)
    expect(result.rows[0].disqualification_risk).toBe(true)

    const parentDefaults = await pool.query(`select disqualification_risk, parent_requirement_id from tender_requirements where id = $1`, [parentRequirementId])
    expect(parentDefaults.rows[0].disqualification_risk).toBe(false)
    expect(parentDefaults.rows[0].parent_requirement_id).toBeNull()
  })

  it('requirement_type enum accepts the full Phase 9 taxonomy without duplicating a category column', async () => {
    for (const value of ['QUALIFICATION', 'FUNCTIONALITY', 'COMMERCIAL', 'PRICE', 'PREFERENCE', 'LOCAL_CONTENT', 'CONTRACTUAL', 'INFORMATIONAL']) {
      const row = await pool.query(
        `insert into tender_requirements (tender_id, requirement_type, requirement_text) values ($1, $2, 'x') returning requirement_type`,
        [tenderId, value],
      )
      expect(row.rows[0].requirement_type).toBe(value)
    }
  })

  it('tender_evaluation_criteria never defaults maximum_points/weight to an invented value', async () => {
    const untouched = await pool.query(
      `insert into tender_evaluation_criteria (tender_id, criterion) values ($1, 'Price') returning maximum_points, weight, scoring_bands, status, source_truth`,
      [tenderId],
    )
    expect(untouched.rows[0].maximum_points).toBeNull()
    expect(untouched.rows[0].weight).toBeNull()
    expect(untouched.rows[0].scoring_bands).toEqual([])
    expect(untouched.rows[0].status).toBe('PROVISIONAL')
    expect(untouched.rows[0].source_truth).toBe('UNKNOWN')
  })

  it('tender_evaluation_criteria rejects a negative maximum_points', async () => {
    await expect(
      pool.query(`insert into tender_evaluation_criteria (tender_id, criterion, maximum_points) values ($1, 'Bad', -5)`, [tenderId]),
    ).rejects.toThrow()
  })

  it('tender_evaluation_gates and tender_evaluation_conflicts are shared-catalogue readable across agencies', async () => {
    const gate = await pool.query(
      `insert into tender_evaluation_gates (tender_id, criterion_id, name, threshold, threshold_type) values ($1, $2, 'Functionality gate', 70, 'FUNCTIONALITY_GATE') returning id`,
      [tenderId, criterionId],
    )
    const conflict = await pool.query(
      `insert into tender_evaluation_conflicts (tender_id, criterion_id, description, evidence_a, evidence_b)
       values ($1, $2, 'Functionality points conflict', '{"text":"70 points","documentId":"a"}'::jsonb, '{"text":"80 points","documentId":"b"}'::jsonb) returning id`,
      [tenderId, criterionId],
    )
    await withUser(userBId, async (c: pg.PoolClient) => {
      const g = await c.query('select id from tender_evaluation_gates where id = $1', [gate.rows[0].id])
      expect(g.rows).toHaveLength(1)
      const cf = await c.query('select id, status from tender_evaluation_conflicts where id = $1', [conflict.rows[0].id])
      expect(cf.rows).toHaveLength(1)
      expect(cf.rows[0].status).toBe('OPEN')
    })
  })

  it('tender_requirement_evidence and tender_evaluation_criterion_evidence are readable but not writable by authenticated', async () => {
    const doc = await pool.query(`insert into tender_documents (tender_id, filename) values ($1, 'tor.pdf') returning id`, [tenderId])
    const evidence = await pool.query(
      `insert into tender_requirement_evidence (requirement_id, document_id, page_number, evidence_text) values ($1, $2, 4, 'Bidders must have 5 years experience') returning id`,
      [childRequirementId, doc.rows[0].id],
    )
    await withUser(userAId, async (c: pg.PoolClient) => {
      const read = await c.query('select id from tender_requirement_evidence where id = $1', [evidence.rows[0].id])
      expect(read.rows).toHaveLength(1)
      await expect(
        c.query(`insert into tender_requirement_evidence (requirement_id, document_id, evidence_text) values ($1, $2, 'x')`, [childRequirementId, doc.rows[0].id]),
      ).rejects.toThrow()
    })
  })

  it('a malicious/malformed requirement id is rejected as an invalid UUID, never silently matched', async () => {
    await withUser(userAId, async (c: pg.PoolClient) => {
      await expect(c.query(`select id from tender_requirements where id = $1`, ["'; drop table tender_requirements; --"])).rejects.toThrow()
    })
  })

  it('tender_ai_runs with agency_id null (extraction runs) are shared-readable across agencies, unlike agency-scoped classification/qualification runs', async () => {
    await withUser(userBId, async (c: pg.PoolClient) => {
      const run = await c.query('select id, agency_id from tender_ai_runs where id = $1', [runId])
      expect(run.rows).toHaveLength(1)
      expect(run.rows[0].agency_id).toBeNull()
    })
  })

  it('only one active (QUEUED/RUNNING) extraction run is allowed per tender when agency_id is null', async () => {
    await pool.query(`insert into tender_ai_runs (tender_id, agency_id, agent_name, model, prompt_version, status) values ($1, null, 'RequirementExtractionAgent', 'm', 'v1', 'RUNNING')`, [tenderId])
    await expect(
      pool.query(`insert into tender_ai_runs (tender_id, agency_id, agent_name, model, prompt_version, status) values ($1, null, 'RequirementExtractionAgent', 'm', 'v1', 'QUEUED')`, [tenderId]),
    ).rejects.toThrow()
  })

  it('tender_evaluation_criteria_reviews requires a criterion or a gate target', async () => {
    await expect(
      pool.query(`insert into tender_evaluation_criteria_reviews (tender_id, reviewer_id, decision) values ($1, $2, 'VERIFIED')`, [tenderId, userAId]),
    ).rejects.toThrow()
    const ok = await pool.query(
      `insert into tender_evaluation_criteria_reviews (criterion_id, tender_id, reviewer_id, decision, note) values ($1, $2, $3, 'VERIFIED', 'looks right') returning id`,
      [criterionId, tenderId, userAId],
    )
    expect(ok.rows[0].id).toBeTruthy()
  })
})
