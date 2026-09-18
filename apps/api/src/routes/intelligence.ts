import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { INTELLIGENCE_APPROVE_ROLES, INTELLIGENCE_MANAGE_ROLES, MIN_SEGMENT_SAMPLE_SIZE } from '@tender-os/constants'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../lib/requireRole.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { createSupabaseIntelligenceStore } from '../lib/intelligence/store.js'
import { computeDatasetReadiness } from '../lib/intelligence/readiness.js'
import { computePrevalenceBaseline, computeOpportunityScoreBaseline } from '../lib/intelligence/baselines.js'
import { chronologicalSplit, verifyNoFutureLeakage } from '../lib/intelligence/temporalValidation.js'
import { evaluatePredictions } from '../lib/intelligence/evaluation.js'
import { buildCalibrationResult } from '../lib/intelligence/calibration.js'
import { extractModelFeatures, trainLogisticRegression, predictWithLogisticModel, featureContributions } from '../lib/intelligence/model.js'
import { evaluatePromotion, evaluateRetirement } from '../lib/intelligence/governance.js'
import { evaluateAbstention } from '../lib/intelligence/abstention.js'
import { detectDistributionShift } from '../lib/intelligence/distributionShift.js'
import { buildPredictionExplanation, buildAbstentionExplanation } from '../lib/intelligence/explanations.js'
import { buildOpportunityScoreCalibration } from '../lib/intelligence/scoreCalibration.js'
import { buildSegmentedPerformance } from '../lib/intelligence/segments.js'
import type { ModelStatus } from '@tender-os/constants'
import type { LogisticModel } from '../lib/intelligence/types.js'

const idParams = z.object({ id: z.string().uuid() })

/**
 * Phase 18 §28 — predictive-intelligence API. Route paths checked
 * against every existing routes/*.ts file: none of the `/intelligence/*`
 * paths below collide with any route already registered in app.ts
 * (mirrors the check documented in routes/outcomes.ts and
 * routes/submissionExecution.ts).
 *
 * Every write is role-gated (spec §28): INTELLIGENCE_MANAGE_ROLES for
 * dataset/training/evaluation/calibration/candidate actions,
 * INTELLIGENCE_APPROVE_ROLES (ADMIN only) for PRODUCTION promotion and
 * retirement (spec §30 "human model approval" bar).
 */
export async function intelligenceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  function admin(reply: FastifyReply) {
    const client = getSupabaseAdmin()
    if (!client) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return null
    }
    return client
  }

  function agencyOf(request: FastifyRequest, reply: FastifyReply): string | null {
    const agencyId = request.user?.agencyId
    if (!agencyId) {
      reply.code(422).send({ error: { code: 'NO_AGENCY', message: 'Your account is not associated with an agency.' } })
      return null
    }
    return agencyId
  }

  async function writeAudit(supabase: ReturnType<typeof getSupabaseAdmin>, agencyId: string, action: string, modelVersionId: string | null, actorId: string | null, detail: unknown) {
    if (!supabase) return
    await supabase.from('model_audit_events').insert({ agency_id: agencyId, model_version_id: modelVersionId, event_type: action, actor_id: actorId, detail: detail ?? {} })
    await supabase.from('audit_logs').insert({ agency_id: agencyId, actor_id: actorId, actor_type: 'USER', action, entity_type: 'model_version', entity_id: modelVersionId })
  }

  // -----------------------------------------------------------------
  // GET /api/intelligence/readiness — live-computed readiness (never
  // persisted implicitly; use POST /datasets to snapshot it).
  // -----------------------------------------------------------------
  app.get('/api/intelligence/readiness', async (request, reply) => {
    const supabase = admin(reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return
    const store = createSupabaseIntelligenceStore(supabase)
    const observations = await store.fetchDecisionTimeObservations(agencyId)
    const readiness = computeDatasetReadiness({ observations, duplicateRecordCount: 0, now: new Date().toISOString() })
    reply.send({ data: readiness })
  })

  // -----------------------------------------------------------------
  // POST /api/intelligence/datasets — snapshot the current readiness
  // state as an immutable versioned dataset row (spec §3/§8/§9/§33).
  // -----------------------------------------------------------------
  const createDatasetBody = z.object({ isTestFixture: z.boolean().default(false) })
  app.post('/api/intelligence/datasets', async (request, reply) => {
    if (!requireRole(request, reply, INTELLIGENCE_MANAGE_ROLES)) return
    const supabase = admin(reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return
    const body = createDatasetBody.parse(request.body ?? {})

    const store = createSupabaseIntelligenceStore(supabase)
    const observations = await store.fetchDecisionTimeObservations(agencyId)
    const readiness = computeDatasetReadiness({ observations, duplicateRecordCount: 0, now: new Date().toISOString() })

    const { data: existingVersions } = await supabase.from('model_datasets').select('dataset_version').eq('agency_id', agencyId).order('dataset_version', { ascending: false }).limit(1)
    const nextVersion = ((existingVersions?.[0]?.dataset_version as number | undefined) ?? 0) + 1

    const { data: created, error } = await supabase
      .from('model_datasets')
      .insert({
        agency_id: agencyId,
        dataset_version: nextVersion,
        total_candidate_records: readiness.totalCandidateRecords,
        verified_labelled_records: readiness.verifiedLabelledRecords,
        positive_count: readiness.positiveCount,
        negative_count: readiness.negativeCount,
        class_balance: readiness.classBalance,
        feature_completeness: readiness.featureCompleteness,
        temporal_coverage_start: readiness.temporalCoverageStart,
        temporal_coverage_end: readiness.temporalCoverageEnd,
        duplicate_rate: readiness.duplicateRate,
        leakage_check_passed: readiness.leakageCheckPassed,
        leakage_findings: readiness.leakageFindings,
        eligibility_state: readiness.eligibilityState,
        eligibility_reasons: readiness.eligibilityReasons,
        is_test_fixture: body.isTestFixture,
        generated_by: request.user?.id ?? null,
      })
      .select('*')
      .single()
    if (error || !created) {
      reply.code(500).send({ error: { code: 'DATASET_CREATE_FAILED', message: error?.message ?? 'Failed to create dataset snapshot.' } })
      return
    }
    await writeAudit(supabase, agencyId, 'MODEL_DATASET_GENERATED', null, request.user?.id ?? null, { datasetId: created.id, eligibilityState: readiness.eligibilityState })
    reply.code(201).send({ data: created })
  })

  app.get('/api/intelligence/datasets', async (request, reply) => {
    const supabase = admin(reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return
    const { data } = await supabase.from('model_datasets').select('*').eq('agency_id', agencyId).order('dataset_version', { ascending: false })
    reply.send({ data: data ?? [] })
  })

  // -----------------------------------------------------------------
  // Model registry
  // -----------------------------------------------------------------
  const createModelBody = z.object({ name: z.string().min(1), description: z.string().nullable().optional() })
  app.post('/api/intelligence/models', async (request, reply) => {
    if (!requireRole(request, reply, INTELLIGENCE_MANAGE_ROLES)) return
    const supabase = admin(reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return
    const body = createModelBody.parse(request.body)
    const { data: created, error } = await supabase
      .from('model_registry')
      .insert({ agency_id: agencyId, name: body.name, description: body.description ?? null, created_by: request.user?.id ?? null })
      .select('*')
      .single()
    if (error || !created) {
      reply.code(409).send({ error: { code: 'MODEL_CREATE_FAILED', message: error?.message ?? 'A model with this name may already exist.' } })
      return
    }
    reply.code(201).send({ data: created })
  })

  app.get('/api/intelligence/models', async (request, reply) => {
    const supabase = admin(reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return
    const { data } = await supabase.from('model_registry').select('*').eq('agency_id', agencyId).order('created_at', { ascending: false })
    reply.send({ data: data ?? [] })
  })

  app.get('/api/intelligence/models/:id', async (request, reply) => {
    const supabase = admin(reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return
    const params = idParams.parse(request.params)
    const { data: registry } = await supabase.from('model_registry').select('*').eq('id', params.id).eq('agency_id', agencyId).maybeSingle()
    if (!registry) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Model not found.' } })
      return
    }
    const { data: versions } = await supabase.from('model_versions').select('*').eq('model_registry_id', params.id).order('version', { ascending: false })
    reply.send({ data: registry, versions: versions ?? [] })
  })

  // -----------------------------------------------------------------
  // POST /api/intelligence/models/:id/versions — create + immediately
  // attempt a training run (spec §7/§8/§9/§33: baselines always run;
  // the model itself trains only when the dataset is READY_FOR_TRAINING
  // or better — no BullMQ is wired in this system, so this runs
  // synchronously in-process like every other Phase 5-17 seam).
  // -----------------------------------------------------------------
  const createVersionBody = z.object({ datasetId: z.string().uuid(), isTestFixture: z.boolean().default(false) })
  app.post('/api/intelligence/models/:id/versions', async (request, reply) => {
    if (!requireRole(request, reply, INTELLIGENCE_MANAGE_ROLES)) return
    const supabase = admin(reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return
    const params = idParams.parse(request.params)
    const body = createVersionBody.parse(request.body)

    const { data: registry } = await supabase.from('model_registry').select('id').eq('id', params.id).eq('agency_id', agencyId).maybeSingle()
    if (!registry) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Model not found.' } })
      return
    }
    const { data: dataset } = await supabase.from('model_datasets').select('*').eq('id', body.datasetId).eq('agency_id', agencyId).maybeSingle()
    if (!dataset) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Dataset not found.' } })
      return
    }

    const { data: existingVersions } = await supabase.from('model_versions').select('version').eq('model_registry_id', params.id).order('version', { ascending: false }).limit(1)
    const nextVersion = ((existingVersions?.[0]?.version as number | undefined) ?? 0) + 1

    const { data: created, error } = await supabase
      .from('model_versions')
      .insert({
        model_registry_id: params.id,
        agency_id: agencyId,
        version: nextVersion,
        model_type: 'LOGISTIC_REGRESSION',
        dataset_id: dataset.id,
        status: 'EXPERIMENTAL',
        is_test_fixture: body.isTestFixture,
        created_by: request.user?.id ?? null,
      })
      .select('*')
      .single()
    if (error || !created) {
      reply.code(500).send({ error: { code: 'VERSION_CREATE_FAILED', message: error?.message ?? 'Failed to create model version.' } })
      return
    }
    await writeAudit(supabase, agencyId, 'MODEL_VERSION_CREATED', created.id as string, request.user?.id ?? null, { version: nextVersion, datasetEligibility: dataset.eligibility_state })
    reply.code(201).send({ data: created })
  })

  app.get('/api/intelligence/versions/:id', async (request, reply) => {
    const supabase = admin(reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return
    const params = idParams.parse(request.params)
    const { data: version } = await supabase.from('model_versions').select('*').eq('id', params.id).eq('agency_id', agencyId).maybeSingle()
    if (!version) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Model version not found.' } })
      return
    }
    const [{ data: evaluations }, { data: calibrations }, { data: card }, { data: promotions }, { data: trainingRuns }] = await Promise.all([
      supabase.from('model_evaluations').select('*').eq('model_version_id', params.id).order('evaluated_at', { ascending: false }),
      supabase.from('model_calibrations').select('*').eq('model_version_id', params.id).order('calibration_version', { ascending: false }),
      supabase.from('model_cards').select('*').eq('model_version_id', params.id).maybeSingle(),
      supabase.from('model_promotions').select('*').eq('model_version_id', params.id).order('approved_at', { ascending: false }),
      supabase.from('model_training_runs').select('*').eq('model_version_id', params.id).order('started_at', { ascending: false }),
    ])
    reply.send({ data: version, evaluations: evaluations ?? [], calibrations: calibrations ?? [], card: card ?? null, promotions: promotions ?? [], trainingRuns: trainingRuns ?? [] })
  })

  // -----------------------------------------------------------------
  // POST /api/intelligence/versions/:id/train — runs baselines (always)
  // and, only if the dataset is READY_FOR_TRAINING (or better), trains
  // the logistic-regression Baseline C via a chronological
  // train/validation/test split (spec §7/§9).
  // -----------------------------------------------------------------
  app.post('/api/intelligence/versions/:id/train', async (request, reply) => {
    if (!requireRole(request, reply, INTELLIGENCE_MANAGE_ROLES)) return
    const supabase = admin(reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return
    const params = idParams.parse(request.params)
    const { data: version } = await supabase.from('model_versions').select('*').eq('id', params.id).eq('agency_id', agencyId).maybeSingle()
    if (!version) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Model version not found.' } })
      return
    }
    const { data: dataset } = await supabase.from('model_datasets').select('*').eq('id', version.dataset_id).maybeSingle()
    if (!dataset) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Dataset not found for this version.' } })
      return
    }

    const store = createSupabaseIntelligenceStore(supabase)
    const allObservations = await store.fetchDecisionTimeObservations(agencyId)
    const labelled = allObservations.filter((o) => o.label !== null)

    const { data: run } = await supabase
      .from('model_training_runs')
      .insert({ model_version_id: params.id, agency_id: agencyId, dataset_id: dataset.id as string, status: 'RUNNING', is_test_fixture: version.is_test_fixture })
      .select('*')
      .single()

    // Baselines always computed and recorded — descriptive regardless
    // of eligibility (spec §7 "before ML, implement deterministic
    // baselines").
    const prevalence = computePrevalenceBaseline(labelled)
    const opportunityScore = computeOpportunityScoreBaseline(labelled)
    await supabase.from('model_evaluations').insert([
      {
        model_version_id: params.id,
        agency_id: agencyId,
        evaluation_type: 'BASELINE_PREVALENCE',
        sample_size: prevalence.sampleSize,
        auc: prevalence.auc,
        is_test_fixture: version.is_test_fixture,
      },
      {
        model_version_id: params.id,
        agency_id: agencyId,
        evaluation_type: 'BASELINE_OPPORTUNITY_SCORE',
        sample_size: opportunityScore.sampleSize,
        auc: opportunityScore.auc,
        is_test_fixture: version.is_test_fixture,
      },
    ])

    const eligibilityState = dataset.eligibility_state as string
    if (eligibilityState !== 'READY_FOR_TRAINING' && eligibilityState !== 'READY_FOR_EVALUATION' && eligibilityState !== 'PRODUCTION_ELIGIBLE') {
      await supabase.from('model_training_runs').update({ status: 'SKIPPED_INSUFFICIENT_DATA', completed_at: new Date().toISOString(), notes: `Dataset eligibility state is ${eligibilityState} — no model was trained (spec §3/§8/§39).` }).eq('id', run!.id as string)
      await supabase.from('model_versions').update({ status: 'FAILED' }).eq('id', params.id)
      await writeAudit(supabase, agencyId, 'MODEL_TRAINING_RUN_SKIPPED', params.id, request.user?.id ?? null, { eligibilityState })
      reply.send({
        data: { status: 'SKIPPED_INSUFFICIENT_DATA', eligibilityState, message: 'NOT ENOUGH VERIFIED DATA to train a model — baselines were computed and recorded, but no model was trained. This is a successful, honest system state (spec §39).' },
        baselines: { prevalence, opportunityScore },
      })
      return
    }

    const split = chronologicalSplit(labelled)
    const leakageCheck = verifyNoFutureLeakage(split)
    if (!leakageCheck.valid) {
      await supabase.from('model_training_runs').update({ status: 'FAILED', completed_at: new Date().toISOString(), notes: leakageCheck.reason }).eq('id', run!.id as string)
      await supabase.from('model_versions').update({ status: 'FAILED' }).eq('id', params.id)
      reply.code(500).send({ error: { code: 'TEMPORAL_LEAKAGE', message: leakageCheck.reason } })
      return
    }

    const trainFeatures = split.train.map(extractModelFeatures)
    const trainLabels = split.train.map((o) => o.label as boolean)
    const model: LogisticModel = trainLogisticRegression(trainFeatures, trainLabels)

    const testFeatures = split.test.map(extractModelFeatures)
    const testPredictions = testFeatures.map((f) => predictWithLogisticModel(model, f))
    const testLabels = split.test.map((o) => o.label as boolean)
    const evaluation = evaluatePredictions(testPredictions, testLabels)

    await supabase
      .from('model_versions')
      .update({
        status: 'EVALUATED',
        training_period_start: split.trainPeriod.start,
        training_period_end: split.trainPeriod.end,
        validation_period_start: split.validationPeriod.start,
        validation_period_end: split.validationPeriod.end,
        test_period_start: split.testPeriod.start,
        test_period_end: split.testPeriod.end,
        training_sample_count: split.train.length,
        positive_sample_count: trainLabels.filter(Boolean).length,
        negative_sample_count: trainLabels.filter((l) => !l).length,
        hyperparameters: { epochs: 500, learningRate: 0.1, l2: 0.01, fittedModel: model },
      })
      .eq('id', params.id)

    await supabase.from('model_evaluations').insert({
      model_version_id: params.id,
      agency_id: agencyId,
      evaluation_type: 'MODEL',
      sample_size: evaluation.sampleSize,
      auc: evaluation.auc,
      pr_auc: evaluation.prAuc,
      precision_score: evaluation.precision,
      recall_score: evaluation.recall,
      f1_score: evaluation.f1,
      brier_score: evaluation.brierScore,
      log_loss_score: evaluation.logLoss,
      confusion_matrix: evaluation.confusionMatrix,
      validation_period_start: split.testPeriod.start,
      validation_period_end: split.testPeriod.end,
      is_test_fixture: version.is_test_fixture,
    })

    await supabase.from('model_training_runs').update({ status: 'COMPLETED', completed_at: new Date().toISOString() }).eq('id', run!.id as string)
    await writeAudit(supabase, agencyId, 'MODEL_EVALUATED', params.id, request.user?.id ?? null, { auc: evaluation.auc, sampleSize: evaluation.sampleSize })

    reply.send({ data: { status: 'COMPLETED', evaluation }, baselines: { prevalence, opportunityScore } })
  })

  // -----------------------------------------------------------------
  // POST /api/intelligence/versions/:id/calibrate (spec §11).
  // -----------------------------------------------------------------
  app.post('/api/intelligence/versions/:id/calibrate', async (request, reply) => {
    if (!requireRole(request, reply, INTELLIGENCE_MANAGE_ROLES)) return
    const supabase = admin(reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return
    const params = idParams.parse(request.params)
    const { data: version } = await supabase.from('model_versions').select('*').eq('id', params.id).eq('agency_id', agencyId).maybeSingle()
    if (!version || version.status !== 'EVALUATED') {
      reply.code(422).send({ error: { code: 'NOT_EVALUATED', message: 'A model version must be EVALUATED (spec §19 status order) before it can be calibrated.' } })
      return
    }
    const fittedModel = (version.hyperparameters as { fittedModel?: LogisticModel } | null)?.fittedModel
    if (!fittedModel) {
      reply.code(422).send({ error: { code: 'NO_TRAINED_MODEL', message: 'No trained model exists for this version — insufficient data prevented training.' } })
      return
    }
    const store = createSupabaseIntelligenceStore(supabase)
    const allObservations = await store.fetchDecisionTimeObservations(agencyId)
    const labelled = allObservations.filter((o) => o.label !== null)
    const split = chronologicalSplit(labelled)
    const testPredictions = split.test.map((o) => predictWithLogisticModel(fittedModel, extractModelFeatures(o)))
    const testLabels = split.test.map((o) => o.label as boolean)
    const calibration = buildCalibrationResult(testPredictions, testLabels)

    const { data: existing } = await supabase.from('model_calibrations').select('calibration_version').eq('model_version_id', params.id).order('calibration_version', { ascending: false }).limit(1)
    const nextCalibrationVersion = ((existing?.[0]?.calibration_version as number | undefined) ?? 0) + 1

    const { data: created } = await supabase
      .from('model_calibrations')
      .insert({
        model_version_id: params.id,
        agency_id: agencyId,
        calibration_version: nextCalibrationVersion,
        method: 'NONE',
        buckets: calibration.buckets,
        brier_score: calibration.brierScore,
        calibration_error: calibration.meanCalibrationError,
        sample_size: calibration.sampleSize,
        training_period_start: split.trainPeriod.start,
        training_period_end: split.trainPeriod.end,
        validation_period_start: split.testPeriod.start,
        validation_period_end: split.testPeriod.end,
        is_test_fixture: version.is_test_fixture,
      })
      .select('*')
      .single()

    await supabase.from('model_versions').update({ status: 'CALIBRATED' }).eq('id', params.id)
    await writeAudit(supabase, agencyId, 'MODEL_CALIBRATED', params.id, request.user?.id ?? null, { calibrationError: calibration.meanCalibrationError })
    reply.send({ data: created })
  })

  // -----------------------------------------------------------------
  // POST /api/intelligence/versions/:id/candidate — CALIBRATED →
  // PRODUCTION_CANDIDATE, requires a model card (spec §23).
  // -----------------------------------------------------------------
  app.post('/api/intelligence/versions/:id/candidate', async (request, reply) => {
    if (!requireRole(request, reply, INTELLIGENCE_MANAGE_ROLES)) return
    const supabase = admin(reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return
    const params = idParams.parse(request.params)
    const { data: version } = await supabase.from('model_versions').select('*').eq('id', params.id).eq('agency_id', agencyId).maybeSingle()
    if (!version || version.status !== 'CALIBRATED') {
      reply.code(422).send({ error: { code: 'NOT_CALIBRATED', message: 'A model version must be CALIBRATED before becoming a production candidate (spec §19).' } })
      return
    }
    const [{ data: evaluations }, { data: calibrations }] = await Promise.all([
      supabase.from('model_evaluations').select('*').eq('model_version_id', params.id),
      supabase.from('model_calibrations').select('*').eq('model_version_id', params.id).order('calibration_version', { ascending: false }).limit(1),
    ])
    const modelEval = (evaluations ?? []).find((e) => e.evaluation_type === 'MODEL')
    const baselinePrevalence = (evaluations ?? []).find((e) => e.evaluation_type === 'BASELINE_PREVALENCE')
    const baselineScore = (evaluations ?? []).find((e) => e.evaluation_type === 'BASELINE_OPPORTUNITY_SCORE')
    const cardContent = {
      intendedUse: 'Decision support only: an indicative predicted win-likelihood for a bid, shown alongside its reliability and sample size. Never an automatic Bid/No-Bid decision.',
      prohibitedUse: 'Must never be used to automatically submit/withdraw a tender, change pricing, change scoring weights, change bid/no-bid thresholds, or change qualification rules (spec §21/§44).',
      targetDefinition: 'VERIFIED_BID_OUTCOME_WON_LOST — WON is positive, a verified LOST is negative; NOT_SUBMITTED/WITHDRAWN/DISQUALIFIED/UNKNOWN/NO_AWARD/CANCELLED are excluded from the label entirely (spec §4).',
      trainingSampleSize: version.training_sample_count,
      classBalance: { positive: version.positive_sample_count, negative: version.negative_sample_count },
      validationMethodology: 'Chronological (temporal) train/validation/test split — never a purely random split (spec §9).',
      featureDefinitions: ['opportunityScoreAtDecision', 'requirementCoverageAtDecision', 'evidenceStrengthAtDecision', 'commercialFitAtDecision', 'strategicFitAtDecision'],
      leakageControls: 'Features sourced only from immutable Phase 17 outcome_decision_time_features snapshots; award value/winner/loss reason/winning score structurally excluded.',
      performance: { modelAuc: modelEval?.auc ?? null, baselinePrevalenceAuc: baselinePrevalence?.auc ?? null, baselineOpportunityScoreAuc: baselineScore?.auc ?? null },
      calibration: calibrations?.[0] ?? null,
      knownWeakSegments: 'Not yet segment-tested at production candidacy time — see the Model Performance by Segment view before approval.',
      abstentionConditions: 'See docs/PREDICTIVE-INTELLIGENCE.md §11 — insufficient verified outcomes, insufficient segment sample, missing critical features, distribution shift, calibration insufficient, model not production-eligible.',
      version: version.version,
      approvalStatus: 'PENDING',
    }
    const { data: card, error } = await supabase
      .from('model_cards')
      .upsert({ model_version_id: params.id, agency_id: agencyId, content: cardContent, approval_status: 'PENDING', created_by: request.user?.id ?? null }, { onConflict: 'model_version_id' })
      .select('*')
      .single()
    if (error) {
      reply.code(500).send({ error: { code: 'MODEL_CARD_FAILED', message: error.message } })
      return
    }
    await supabase.from('model_versions').update({ status: 'PRODUCTION_CANDIDATE' }).eq('id', params.id)
    await writeAudit(supabase, agencyId, 'MODEL_READY_FOR_REVIEW', params.id, request.user?.id ?? null, {})
    reply.send({ data: card })
  })

  // -----------------------------------------------------------------
  // POST /api/intelligence/versions/:id/approve — PRODUCTION_CANDIDATE
  // → PRODUCTION. Human approval mandatory (spec §30).
  // -----------------------------------------------------------------
  const approveBody = z.object({ rationale: z.string().min(1) })
  app.post('/api/intelligence/versions/:id/approve', async (request, reply) => {
    if (!requireRole(request, reply, INTELLIGENCE_APPROVE_ROLES)) return
    const supabase = admin(reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return
    const params = idParams.parse(request.params)
    const body = approveBody.parse(request.body)
    const { data: version } = await supabase.from('model_versions').select('*').eq('id', params.id).eq('agency_id', agencyId).maybeSingle()
    if (!version) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Model version not found.' } })
      return
    }
    const { data: dataset } = await supabase.from('model_datasets').select('eligibility_state').eq('id', version.dataset_id).maybeSingle()
    const { data: evaluations } = await supabase.from('model_evaluations').select('*').eq('model_version_id', params.id)
    const modelEval = (evaluations ?? []).find((e) => e.evaluation_type === 'MODEL')
    const baselineAucs = (evaluations ?? []).filter((e) => e.evaluation_type !== 'MODEL').map((e) => e.auc as number | null).filter((a): a is number => a !== null)
    const bestBaselineAuc = baselineAucs.length > 0 ? Math.max(...baselineAucs) : null
    const { data: calibrations } = await supabase.from('model_calibrations').select('*').eq('model_version_id', params.id).order('calibration_version', { ascending: false }).limit(1)
    const { data: card } = await supabase.from('model_cards').select('id').eq('model_version_id', params.id).maybeSingle()

    const decision = evaluatePromotion({
      currentStatus: version.status as ModelStatus,
      targetStatus: 'PRODUCTION',
      eligibilityState: (dataset?.eligibility_state as never) ?? 'INSUFFICIENT_DATA',
      latestEvaluation: modelEval
        ? { sampleSize: modelEval.sample_size as number, auc: modelEval.auc as number | null, prAuc: modelEval.pr_auc as number | null, precision: modelEval.precision_score as number | null, recall: modelEval.recall_score as number | null, f1: modelEval.f1_score as number | null, brierScore: modelEval.brier_score as number | null, logLoss: modelEval.log_loss_score as number | null, confusionMatrix: modelEval.confusion_matrix as never }
        : null,
      bestBaselineAuc,
      latestCalibrationError: (calibrations?.[0]?.calibration_error as number | null) ?? null,
      hasModelCard: !!card,
      approverRole: request.user?.role ?? null,
    })
    if (!decision.allowed) {
      reply.code(422).send({ error: { code: 'PROMOTION_NOT_ALLOWED', message: decision.reason } })
      return
    }

    await supabase.from('model_versions').update({ status: 'PRODUCTION' }).eq('id', params.id)
    await supabase.from('model_promotions').insert({ model_version_id: params.id, agency_id: agencyId, action: 'PROMOTE', from_status: version.status, to_status: 'PRODUCTION', approved_by: request.user!.id, rationale: body.rationale, sample_size_at_approval: modelEval?.sample_size ?? null })
    await writeAudit(supabase, agencyId, 'MODEL_PROMOTED', params.id, request.user?.id ?? null, { rationale: body.rationale })
    reply.send({ data: { status: 'PRODUCTION' } })
  })

  // -----------------------------------------------------------------
  // POST /api/intelligence/versions/:id/reject
  // -----------------------------------------------------------------
  const rejectBody = z.object({ rationale: z.string().min(1) })
  app.post('/api/intelligence/versions/:id/reject', async (request, reply) => {
    if (!requireRole(request, reply, INTELLIGENCE_APPROVE_ROLES)) return
    const supabase = admin(reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return
    const params = idParams.parse(request.params)
    const body = rejectBody.parse(request.body)
    const { data: version } = await supabase.from('model_versions').select('*').eq('id', params.id).eq('agency_id', agencyId).maybeSingle()
    if (!version) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Model version not found.' } })
      return
    }
    await supabase.from('model_versions').update({ status: 'FAILED' }).eq('id', params.id)
    await supabase.from('model_promotions').insert({ model_version_id: params.id, agency_id: agencyId, action: 'REJECT', from_status: version.status, to_status: 'FAILED', approved_by: request.user!.id, rationale: body.rationale })
    await writeAudit(supabase, agencyId, 'MODEL_REJECTED', params.id, request.user?.id ?? null, { rationale: body.rationale })
    reply.send({ data: { status: 'FAILED' } })
  })

  // -----------------------------------------------------------------
  // POST /api/intelligence/versions/:id/retire (spec §31 — never
  // deletes historical predictions).
  // -----------------------------------------------------------------
  const retireBody = z.object({ rationale: z.string().min(1) })
  app.post('/api/intelligence/versions/:id/retire', async (request, reply) => {
    if (!requireRole(request, reply, INTELLIGENCE_APPROVE_ROLES)) return
    const supabase = admin(reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return
    const params = idParams.parse(request.params)
    const body = retireBody.parse(request.body)
    const { data: version } = await supabase.from('model_versions').select('*').eq('id', params.id).eq('agency_id', agencyId).maybeSingle()
    if (!version) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Model version not found.' } })
      return
    }
    const decision = evaluateRetirement(version.status as ModelStatus, request.user?.role ?? null)
    if (!decision.allowed) {
      reply.code(422).send({ error: { code: 'RETIREMENT_NOT_ALLOWED', message: decision.reason } })
      return
    }
    await supabase.from('model_versions').update({ status: 'RETIRED', retired_at: new Date().toISOString(), retired_by: request.user!.id, retirement_reason: body.rationale }).eq('id', params.id)
    await supabase.from('model_promotions').insert({ model_version_id: params.id, agency_id: agencyId, action: 'RETIRE', from_status: 'PRODUCTION', to_status: 'RETIRED', approved_by: request.user!.id, rationale: body.rationale })
    await writeAudit(supabase, agencyId, 'MODEL_RETIRED', params.id, request.user?.id ?? null, { rationale: body.rationale })
    reply.send({ data: { status: 'RETIRED' } })
  })

  // -----------------------------------------------------------------
  // POST /api/intelligence/predictions — generate (or abstain from) a
  // prediction for one bid project (spec §12/§13/§14/§22/§24).
  // -----------------------------------------------------------------
  const predictBody = z.object({ bidProjectId: z.string().uuid(), modelRegistryId: z.string().uuid(), isTestFixture: z.boolean().default(false) })
  app.post('/api/intelligence/predictions', async (request, reply) => {
    const supabase = admin(reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return
    const body = predictBody.parse(request.body)

    const { data: project } = await supabase.from('bid_strategy_projects').select('id, tender_id, agency_id').eq('id', body.bidProjectId).maybeSingle()
    if (!project || project.agency_id !== agencyId) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bid project not found.' } })
      return
    }
    const { data: feature } = await supabase.from('outcome_decision_time_features').select('*').eq('bid_project_id', body.bidProjectId).eq('agency_id', agencyId).maybeSingle()
    const { data: productionVersion } = await supabase
      .from('model_versions')
      .select('*')
      .eq('model_registry_id', body.modelRegistryId)
      .eq('agency_id', agencyId)
      .eq('status', 'PRODUCTION')
      .maybeSingle()
    const { data: dataset } = productionVersion ? await supabase.from('model_datasets').select('*').eq('id', productionVersion.dataset_id).maybeSingle() : { data: null }
    const { data: calibration } = productionVersion
      ? await supabase.from('model_calibrations').select('*').eq('model_version_id', productionVersion.id).order('calibration_version', { ascending: false }).limit(1).maybeSingle()
      : { data: null }

    const hasCriticalFeatures = !!feature && feature.opportunity_score_at_decision !== null && feature.requirement_coverage_at_decision !== null
    const store = createSupabaseIntelligenceStore(supabase)
    const allObservations = productionVersion ? await store.fetchDecisionTimeObservations(agencyId) : []
    const labelled = allObservations.filter((o) => o.label !== null)
    const trainingCategories = new Set(labelled.map((o) => o.tenderCategory).filter((c): c is string => !!c))
    const trainingProvinces = new Set(labelled.map((o) => o.province).filter((p): p is string => !!p))
    const trainingValueBands = new Set(labelled.map((o) => o.estimatedValueBand).filter((b): b is string => !!b))
    const distributionShift = feature
      ? detectDistributionShift({
          trainingCategories,
          trainingProvinces,
          trainingValueBands,
          candidateCategory: (feature.tender_category as string | null) ?? null,
          candidateProvince: (feature.province as string | null) ?? null,
          candidateValueBand: (feature.estimated_value_band as string | null) ?? null,
          trainingSampleSize: labelled.length,
        })
      : null
    const segmentSampleSize = feature ? labelled.filter((o) => o.tenderCategory === feature.tender_category).length : null

    const abstentionCheck = evaluateAbstention({
      eligibilityState: (dataset?.eligibility_state as never) ?? 'INSUFFICIENT_DATA',
      modelStatus: (productionVersion?.status as ModelStatus | undefined) ?? null,
      segmentSampleSize,
      hasCriticalFeatures,
      distributionShift,
      calibrationError: (calibration?.calibration_error as number | null) ?? null,
    })

    if (abstentionCheck.shouldAbstain) {
      const { data: prediction } = await supabase
        .from('model_predictions')
        .insert({
          agency_id: agencyId,
          bid_project_id: body.bidProjectId,
          tender_id: project.tender_id as string,
          model_version_id: productionVersion?.id ?? null,
          decision_time_feature_id: feature?.id ?? null,
          abstained: true,
          feature_snapshot: feature ?? {},
          model_version_label: productionVersion ? `v${productionVersion.version as number}` : null,
          is_test_fixture: body.isTestFixture,
        })
        .select('*')
        .single()
      await supabase.from('model_abstentions').insert({ prediction_id: prediction!.id as string, agency_id: agencyId, reason: abstentionCheck.reason, detail: abstentionCheck.detail })
      const explanationText = buildAbstentionExplanation(abstentionCheck.reason!, abstentionCheck.detail)
      await supabase.from('model_prediction_explanations').insert({ prediction_id: prediction!.id as string, agency_id: agencyId, explanation_text: explanationText, model_version_label: prediction!.model_version_label })
      await writeAudit(supabase, agencyId, 'PREDICTION_ABSTAINED', productionVersion?.id ?? null, request.user?.id ?? null, { reason: abstentionCheck.reason })
      reply.send({ data: prediction, abstained: true, reason: abstentionCheck.reason, explanation: explanationText })
      return
    }

    const fittedModel = (productionVersion!.hyperparameters as { fittedModel?: LogisticModel }).fittedModel!
    const featureVector = extractModelFeatures({
      bidProjectId: body.bidProjectId,
      decisionTimestamp: (feature!.captured_at as string) ?? new Date().toISOString(),
      label: null,
      tenderCategory: (feature!.tender_category as string | null) ?? null,
      province: (feature!.province as string | null) ?? null,
      estimatedValueBand: (feature!.estimated_value_band as string | null) ?? null,
      opportunityScoreAtDecision: (feature!.opportunity_score_at_decision as number | null) ?? null,
      requirementCoverageAtDecision: (feature!.requirement_coverage_at_decision as number | null) ?? null,
      evidenceStrengthAtDecision: (feature!.evidence_strength_at_decision as number | null) ?? null,
      commercialFitAtDecision: (feature!.commercial_fit_at_decision as number | null) ?? null,
      strategicFitAtDecision: (feature!.strategic_fit_at_decision as number | null) ?? null,
      qualificationStatusAtDecision: null,
      bidEffort: null,
      scoringConfigurationVersionId: null,
      bidPolicyVersionId: null,
    })
    const predictedProbability = predictWithLogisticModel(fittedModel, featureVector)
    const contributions = featureContributions(fittedModel, featureVector)
    const positiveFeatures = contributions.filter((c) => c.contribution > 0)
    const negativeFeatures = contributions.filter((c) => c.contribution < 0)
    const missingFeatures = ['opportunityScoreAtDecision', 'requirementCoverageAtDecision', 'evidenceStrengthAtDecision', 'commercialFitAtDecision', 'strategicFitAtDecision'].filter(
      (key) => (feature as unknown as Record<string, unknown>)[key.replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`)] === null,
    )

    const { data: prediction } = await supabase
      .from('model_predictions')
      .insert({
        agency_id: agencyId,
        bid_project_id: body.bidProjectId,
        tender_id: project.tender_id as string,
        model_version_id: productionVersion!.id,
        calibration_id: calibration?.id ?? null,
        decision_time_feature_id: feature!.id as string,
        predicted_probability: predictedProbability,
        abstained: false,
        feature_snapshot: feature,
        data_completeness: hasCriticalFeatures ? 1 : 0.5,
        model_version_label: `v${productionVersion!.version as number}`,
        is_test_fixture: body.isTestFixture,
      })
      .select('*')
      .single()

    const explanationText = buildPredictionExplanation(predictedProbability, labelled.length, positiveFeatures, negativeFeatures, missingFeatures, `v${productionVersion!.version as number}`)
    const { data: explanation } = await supabase
      .from('model_prediction_explanations')
      .insert({
        prediction_id: prediction!.id as string,
        agency_id: agencyId,
        top_positive_features: positiveFeatures.slice(0, 3),
        top_negative_features: negativeFeatures.slice(0, 3),
        missing_features: missingFeatures,
        explanation_text: explanationText,
        model_version_label: `v${productionVersion!.version as number}`,
      })
      .select('*')
      .single()

    await writeAudit(supabase, agencyId, 'PREDICTION_MADE', productionVersion!.id as string, request.user?.id ?? null, { predictedProbability })
    reply.send({ data: prediction, abstained: false, explanation })
  })

  app.get('/api/intelligence/predictions/:bidProjectId', async (request, reply) => {
    const supabase = admin(reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return
    const params = z.object({ bidProjectId: z.string().uuid() }).parse(request.params)
    const { data: predictions } = await supabase.from('model_predictions').select('*').eq('bid_project_id', params.bidProjectId).eq('agency_id', agencyId).order('prediction_timestamp', { ascending: false })
    const predictionIds = (predictions ?? []).map((p) => p.id as string)
    const { data: explanations } = predictionIds.length ? await supabase.from('model_prediction_explanations').select('*').in('prediction_id', predictionIds) : { data: [] }
    reply.send({ data: predictions ?? [], explanations: explanations ?? [] })
  })

  // -----------------------------------------------------------------
  // GET /api/intelligence/score-calibration (spec §15).
  // -----------------------------------------------------------------
  app.get('/api/intelligence/score-calibration', async (request, reply) => {
    const supabase = admin(reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return
    const store = createSupabaseIntelligenceStore(supabase)
    const observations = await store.fetchDecisionTimeObservations(agencyId)
    const rows = observations
      .filter((o) => o.opportunityScoreAtDecision !== null)
      .map((o) => ({ opportunityScore: o.opportunityScoreAtDecision as number, won: o.label === true, outcomeVerified: o.label !== null }))
    reply.send({ data: buildOpportunityScoreCalibration(rows) })
  })

  // -----------------------------------------------------------------
  // GET /api/intelligence/segments/:category (spec §17) — segmented
  // performance by tender category (the most immediately useful
  // segment dimension given the current data volume).
  // -----------------------------------------------------------------
  app.get('/api/intelligence/segments', async (request, reply) => {
    const supabase = admin(reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return
    const store = createSupabaseIntelligenceStore(supabase)
    const observations = await store.fetchDecisionTimeObservations(agencyId)
    const rows = observations.map((o) => ({ segmentKey: o.tenderCategory ?? 'Uncategorised', won: o.label }))
    reply.send({ data: buildSegmentedPerformance(rows), minSegmentSampleSize: MIN_SEGMENT_SAMPLE_SIZE })
  })
}
