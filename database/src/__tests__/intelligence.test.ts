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
 * Phase 18 — predictive intelligence schema: RLS agency isolation,
 * service-role-only writes, immutability triggers (model_versions core
 * facts, model_calibrations, model_predictions), one-PRODUCTION-per-
 * registry uniqueness, FK integrity, and the probability/abstention
 * check constraints.
 */
describe('predictive intelligence tables, RLS and integrity (Phase 18)', () => {
  let agencyAId: string
  let agencyBId: string
  let userAId: string
  let userBId: string
  let tenderId: string
  let bidProjectAId: string
  let registryAId: string
  let datasetAId: string
  let versionAId: string

  beforeAll(async () => {
    const agencyA = await pool.query(`insert into agencies (name) values ('Intelligence Test Agency A') returning id`)
    agencyAId = agencyA.rows[0].id
    const agencyB = await pool.query(`insert into agencies (name) values ('Intelligence Test Agency B') returning id`)
    agencyBId = agencyB.rows[0].id

    const userA = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userAId = userA.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'intela@example.com')`, [userAId, agencyAId])
    const userB = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userBId = userB.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'intelb@example.com')`, [userBId, agencyBId])

    const tender = await pool.query(`insert into tenders (title, closing_date, closing_time) values ('Intelligence test tender', current_date - 5, '17:00:00') returning id`)
    tenderId = tender.rows[0].id

    const policyA = await pool.query(`insert into bid_policies (agency_id, name) values ($1, 'default') returning id`, [agencyAId])
    const policyVersionA = await pool.query(`insert into bid_policy_versions (policy_id, version) values ($1, 1) returning id`, [policyA.rows[0].id])
    const run = await pool.query(
      `insert into bid_decision_runs (tender_id, agency_id, status, bid_policy_version_id, system_decision, final_decision, bid_effort) values ($1, $2, 'COMPLETED', $3, 'BID', 'BID', 'LOW') returning id`,
      [tenderId, agencyAId, policyVersionA.rows[0].id],
    )

    const project = await pool.query(`insert into bid_strategy_projects (tender_id, agency_id, project_name, bid_decision_run_id) values ($1, $2, 'Intelligence test bid project', $3) returning id`, [
      tenderId,
      agencyAId,
      run.rows[0].id,
    ])
    bidProjectAId = project.rows[0].id

    const registry = await pool.query(`insert into model_registry (agency_id, name) values ($1, 'Win Likelihood Model') returning id`, [agencyAId])
    registryAId = registry.rows[0].id

    const dataset = await pool.query(
      `insert into model_datasets (agency_id, dataset_version, total_candidate_records, verified_labelled_records, positive_count, negative_count, eligibility_state)
       values ($1, 1, 3, 3, 1, 2, 'INSUFFICIENT_DATA') returning id`,
      [agencyAId],
    )
    datasetAId = dataset.rows[0].id

    const version = await pool.query(
      `insert into model_versions (model_registry_id, agency_id, version, model_type, dataset_id, status, training_sample_count, positive_sample_count, negative_sample_count)
       values ($1, $2, 1, 'LOGISTIC_REGRESSION', $3, 'EXPERIMENTAL', 0, 0, 0) returning id`,
      [registryAId, agencyAId, datasetAId],
    )
    versionAId = version.rows[0].id
  })

  it('agency A can read its own model registry/version; agency B cannot (agency isolation)', async () => {
    await withUser(userAId, async (c) => {
      expect((await c.query('select id from model_registry where id = $1', [registryAId])).rows).toHaveLength(1)
      expect((await c.query('select id from model_versions where id = $1', [versionAId])).rows).toHaveLength(1)
    })
    await withUser(userBId, async (c) => {
      expect((await c.query('select id from model_registry where id = $1', [registryAId])).rows).toHaveLength(0)
      expect((await c.query('select id from model_versions where id = $1', [versionAId])).rows).toHaveLength(0)
      expect((await c.query('select id from model_datasets where id = $1', [datasetAId])).rows).toHaveLength(0)
    })
  })

  it('the authenticated role cannot write model tables directly (service-role only)', async () => {
    await withUser(userAId, async (c) => {
      await expect(c.query(`insert into model_registry (agency_id, name) values ($1, 'Hacked Model')`, [agencyAId])).rejects.toThrow()
      await expect(c.query(`update model_versions set status = 'PRODUCTION' where id = $1`, [versionAId])).rejects.toThrow()
    })
  })

  it('a duplicate model version number within the same registry is rejected', async () => {
    await expect(
      pool.query(
        `insert into model_versions (model_registry_id, agency_id, version, model_type, dataset_id, status) values ($1, $2, 1, 'LOGISTIC_REGRESSION', $3, 'EXPERIMENTAL')`,
        [registryAId, agencyAId, datasetAId],
      ),
    ).rejects.toThrow()
  })

  it('a second model_registry with the same name for the same agency is rejected (unique per agency)', async () => {
    await expect(pool.query(`insert into model_registry (agency_id, name) values ($1, 'Win Likelihood Model')`, [agencyAId])).rejects.toThrow()
  })

  it('model_versions core training facts are immutable after insert — only status/retirement fields may change', async () => {
    await expect(pool.query(`update model_versions set training_sample_count = 999 where id = $1`, [versionAId])).rejects.toThrow()
    // Status alone may change.
    await expect(pool.query(`update model_versions set status = 'EVALUATED' where id = $1`, [versionAId])).resolves.toBeDefined()
  })

  it('RETIRED status requires retired_at and retirement_reason to be set', async () => {
    await expect(pool.query(`update model_versions set status = 'RETIRED' where id = $1`, [versionAId])).rejects.toThrow()
    await expect(
      pool.query(`update model_versions set status = 'RETIRED', retired_at = now(), retired_by = $2, retirement_reason = 'superseded' where id = $1`, [versionAId, userAId]),
    ).resolves.toBeDefined()
    // Reset back to EXPERIMENTAL isn't possible per the trigger's own
    // core-mutation guard (status IS mutable, so this itself succeeds,
    // but the model is now RETIRED for the rest of this suite —
    // subsequent tests create their own version rows where needed).
  })

  it('at most one PRODUCTION-status version per model registry at a time', async () => {
    const v2 = await pool.query(
      `insert into model_versions (model_registry_id, agency_id, version, model_type, dataset_id, status) values ($1, $2, 2, 'LOGISTIC_REGRESSION', $3, 'PRODUCTION') returning id`,
      [registryAId, agencyAId, datasetAId],
    )
    const v3 = await pool.query(
      `insert into model_versions (model_registry_id, agency_id, version, model_type, dataset_id, status) values ($1, $2, 3, 'LOGISTIC_REGRESSION', $3, 'EXPERIMENTAL') returning id`,
      [registryAId, agencyAId, datasetAId],
    )
    await expect(pool.query(`update model_versions set status = 'PRODUCTION' where id = $1`, [v3.rows[0].id])).rejects.toThrow()
    // Retire the first before promoting the second — now allowed.
    await pool.query(`update model_versions set status = 'RETIRED', retired_at = now(), retired_by = $2, retirement_reason = 'superseded' where id = $1`, [v2.rows[0].id, userAId])
    await expect(pool.query(`update model_versions set status = 'PRODUCTION' where id = $1`, [v3.rows[0].id])).resolves.toBeDefined()
  })

  it('model_calibrations rows are immutable once created', async () => {
    const calibration = await pool.query(
      `insert into model_calibrations (model_version_id, agency_id, calibration_version, method, sample_size) values ($1, $2, 1, 'NONE', 10) returning id`,
      [versionAId, agencyAId],
    )
    await expect(pool.query(`update model_calibrations set brier_score = 0.5 where id = $1`, [calibration.rows[0].id])).rejects.toThrow()
  })

  it('a duplicate calibration_version for the same model version is rejected', async () => {
    await expect(
      pool.query(`insert into model_calibrations (model_version_id, agency_id, calibration_version, method, sample_size) values ($1, $2, 1, 'NONE', 5)`, [versionAId, agencyAId]),
    ).rejects.toThrow()
  })

  it('model_predictions rows are immutable once made (spec §24)', async () => {
    const prediction = await pool.query(
      `insert into model_predictions (agency_id, bid_project_id, tender_id, model_version_id, predicted_probability, abstained)
       values ($1, $2, $3, $4, 0.65, false) returning id`,
      [agencyAId, bidProjectAId, tenderId, versionAId],
    )
    await expect(pool.query(`update model_predictions set predicted_probability = 0.99 where id = $1`, [prediction.rows[0].id])).rejects.toThrow()
  })

  it('predicted_probability must be within [0,1]', async () => {
    await expect(
      pool.query(`insert into model_predictions (agency_id, bid_project_id, tender_id, predicted_probability, abstained) values ($1, $2, $3, 1.5, false)`, [agencyAId, bidProjectAId, tenderId]),
    ).rejects.toThrow()
  })

  it('an abstained prediction may not carry a numerical probability', async () => {
    await expect(
      pool.query(`insert into model_predictions (agency_id, bid_project_id, tender_id, predicted_probability, abstained) values ($1, $2, $3, 0.5, true)`, [agencyAId, bidProjectAId, tenderId]),
    ).rejects.toThrow()
    await expect(
      pool.query(`insert into model_predictions (agency_id, bid_project_id, tender_id, predicted_probability, abstained) values ($1, $2, $3, null, true)`, [agencyAId, bidProjectAId, tenderId]),
    ).resolves.toBeDefined()
  })

  it('retiring a model does not delete its historical predictions (spec §31)', async () => {
    const prediction = await pool.query(
      `insert into model_predictions (agency_id, bid_project_id, tender_id, model_version_id, predicted_probability, abstained) values ($1, $2, $3, $4, 0.4, false) returning id`,
      [agencyAId, bidProjectAId, tenderId, versionAId],
    )
    await pool.query(`update model_versions set status = 'FAILED' where id = $1 and status = 'EXPERIMENTAL'`, [versionAId])
    const stillThere = await pool.query(`select id, model_version_id from model_predictions where id = $1`, [prediction.rows[0].id])
    expect(stillThere.rows).toHaveLength(1)
    expect(stillThere.rows[0].model_version_id).toBe(versionAId)
  })

  it('a malformed UUID is rejected rather than silently coerced', async () => {
    await expect(pool.query(`select * from model_versions where id = 'not-a-uuid'`)).rejects.toThrow()
  })

  it('a model version referencing a nonexistent dataset is rejected (FK integrity)', async () => {
    await expect(
      pool.query(
        `insert into model_versions (model_registry_id, agency_id, version, model_type, dataset_id, status) values ($1, $2, 99, 'LOGISTIC_REGRESSION', $3, 'EXPERIMENTAL')`,
        [registryAId, agencyAId, '00000000-0000-4000-8000-000000000000'],
      ),
    ).rejects.toThrow()
  })

  it('model_prediction_explanations allows at most one row per prediction', async () => {
    const prediction = await pool.query(
      `insert into model_predictions (agency_id, bid_project_id, tender_id, predicted_probability, abstained) values ($1, $2, $3, 0.3, false) returning id`,
      [agencyAId, bidProjectAId, tenderId],
    )
    await pool.query(`insert into model_prediction_explanations (prediction_id, agency_id, explanation_text) values ($1, $2, 'first')`, [prediction.rows[0].id, agencyAId])
    await expect(
      pool.query(`insert into model_prediction_explanations (prediction_id, agency_id, explanation_text) values ($1, $2, 'second')`, [prediction.rows[0].id, agencyAId]),
    ).rejects.toThrow()
  })

  it('model_promotions requires an approver (FK to users) and records the governance action', async () => {
    const promotion = await pool.query(
      `insert into model_promotions (model_version_id, agency_id, action, from_status, to_status, approved_by, rationale) values ($1, $2, 'PROMOTE', 'PRODUCTION_CANDIDATE', 'PRODUCTION', $3, 'meets all gates') returning id`,
      [versionAId, agencyAId, userAId],
    )
    expect(promotion.rows).toHaveLength(1)
    await expect(
      pool.query(`insert into model_promotions (model_version_id, agency_id, action, from_status, to_status, approved_by, rationale) values ($1, $2, 'PROMOTE', 'PRODUCTION_CANDIDATE', 'PRODUCTION', $3, 'x')`, [
        versionAId,
        agencyAId,
        '00000000-0000-4000-8000-000000000000',
      ]),
    ).rejects.toThrow()
  })
})
