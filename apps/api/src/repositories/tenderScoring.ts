import type { SupabaseClient } from '@supabase/supabase-js'
import {
  opportunityScoreSchema,
  opportunityScoreComponentSchema,
  opportunityScoreDriverSchema,
  opportunityScoreGateSchema,
  scoringConfigurationSchema,
  type OpportunityScoreDto,
  type OpportunityScoringRunDto,
  type ScoringConfigurationDto,
} from '@tender-os/schemas'
import { createSupabaseScoringStore } from '../lib/scoring/supabaseScoringStore.js'
import { isSnapshotStale } from '../lib/scoring/staleness.js'
import { logger } from '../lib/logger.js'

/**
 * Read-only repositories over the Phase 10 scoring tables, via the
 * caller's own RLS-scoped client — same split as
 * repositories/tenderQualification.ts vs
 * lib/qualification/supabaseQualificationStore.ts. Writes (scoring runs)
 * always go through lib/scoring/runScoring.ts with the privileged
 * service-role client.
 */
export async function getOpportunityScore(supabase: SupabaseClient, tenderId: string, agencyId: string): Promise<OpportunityScoreDto> {
  const { data: run, error: runErr } = await supabase.from('tender_scoring_runs').select('*').eq('tender_id', tenderId).eq('is_current', true).maybeSingle()
  if (runErr) throw runErr
  if (!run) return opportunityScoreSchema.parse({ run: null, components: [], drivers: [], risks: [], gates: [], unknowns: [] })

  const [{ data: components, error: compErr }, { data: drivers, error: drvErr }, { data: risks, error: riskErr }, { data: gates, error: gateErr }] = await Promise.all([
    supabase.from('tender_score_components').select('*').eq('run_id', run.id),
    supabase.from('tender_score_drivers').select('*').eq('run_id', run.id),
    supabase.from('tender_score_risks').select('*').eq('run_id', run.id),
    supabase.from('tender_score_gates').select('*').eq('run_id', run.id),
  ])
  if (compErr) throw compErr
  if (drvErr) throw drvErr
  if (riskErr) throw riskErr
  if (gateErr) throw gateErr

  let isStale = false
  try {
    const store = createSupabaseScoringStore(supabase)
    const currentSnapshot = await store.buildSnapshot(tenderId, agencyId)
    isStale = isSnapshotStale(run.input_snapshot ?? {}, currentSnapshot)
  } catch (err) {
    logger.warn({ err, tenderId }, 'could not compute score staleness — reporting as not stale')
  }

  const runDto: OpportunityScoringRunDto = {
    id: run.id,
    tenderId: run.tender_id,
    agencyId: run.agency_id,
    status: run.status,
    scoringConfigurationVersionId: run.scoring_configuration_version_id,
    overallScore: run.overall_score,
    dataCompleteness: run.data_completeness,
    decisionSignal: run.decision_signal,
    deadlineStatus: run.deadline_status,
    timezoneUnknown: run.timezone_unknown,
    isCurrent: run.is_current,
    isStale,
    inputSnapshot: run.input_snapshot ?? {},
    error: run.error,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    createdAt: run.created_at,
  }

  return opportunityScoreSchema.parse({
    run: runDto,
    components: (components ?? []).map((c) => opportunityScoreComponentSchema.parse({ id: c.id, dimension: c.dimension, status: c.status, score: c.score, weight: c.weight, explanation: c.explanation, metadata: c.metadata ?? {} })),
    drivers: (drivers ?? []).map((d) => opportunityScoreDriverSchema.parse({ id: d.id, dimension: d.dimension, description: d.description, evidence: d.evidence ?? [] })),
    risks: (risks ?? []).map((r) => opportunityScoreDriverSchema.parse({ id: r.id, dimension: r.dimension, description: r.description, evidence: r.evidence ?? [] })),
    gates: (gates ?? []).map((g) => opportunityScoreGateSchema.parse({ id: g.id, gateType: g.gate_type, status: g.status, description: g.description, evidence: g.evidence ?? [] })),
    unknowns: [],
  })
}

export async function listScoreComponents(supabase: SupabaseClient, tenderId: string) {
  const { data: run } = await supabase.from('tender_scoring_runs').select('id').eq('tender_id', tenderId).eq('is_current', true).maybeSingle()
  if (!run) return []
  const { data, error } = await supabase.from('tender_score_components').select('*').eq('run_id', run.id)
  if (error) throw error
  return (data ?? []).map((c) => opportunityScoreComponentSchema.parse({ id: c.id, dimension: c.dimension, status: c.status, score: c.score, weight: c.weight, explanation: c.explanation, metadata: c.metadata ?? {} }))
}

export async function listScoreDrivers(supabase: SupabaseClient, tenderId: string) {
  const { data: run } = await supabase.from('tender_scoring_runs').select('id').eq('tender_id', tenderId).eq('is_current', true).maybeSingle()
  if (!run) return []
  const { data, error } = await supabase.from('tender_score_drivers').select('*').eq('run_id', run.id)
  if (error) throw error
  return (data ?? []).map((d) => opportunityScoreDriverSchema.parse({ id: d.id, dimension: d.dimension, description: d.description, evidence: d.evidence ?? [] }))
}

export async function listScoreRisks(supabase: SupabaseClient, tenderId: string) {
  const { data: run } = await supabase.from('tender_scoring_runs').select('id').eq('tender_id', tenderId).eq('is_current', true).maybeSingle()
  if (!run) return []
  const { data, error } = await supabase.from('tender_score_risks').select('*').eq('run_id', run.id)
  if (error) throw error
  return (data ?? []).map((r) => opportunityScoreDriverSchema.parse({ id: r.id, dimension: r.dimension, description: r.description, evidence: r.evidence ?? [] }))
}

export async function listScoreGates(supabase: SupabaseClient, tenderId: string) {
  const { data: run } = await supabase.from('tender_scoring_runs').select('id').eq('tender_id', tenderId).eq('is_current', true).maybeSingle()
  if (!run) return []
  const { data, error } = await supabase.from('tender_score_gates').select('*').eq('run_id', run.id)
  if (error) throw error
  return (data ?? []).map((g) => opportunityScoreGateSchema.parse({ id: g.id, gateType: g.gate_type, status: g.status, description: g.description, evidence: g.evidence ?? [] }))
}

export async function listScoringRuns(supabase: SupabaseClient, tenderId: string): Promise<OpportunityScoringRunDto[]> {
  const { data, error } = await supabase.from('tender_scoring_runs').select('*').eq('tender_id', tenderId).order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((run) => ({
    id: run.id,
    tenderId: run.tender_id,
    agencyId: run.agency_id,
    status: run.status,
    scoringConfigurationVersionId: run.scoring_configuration_version_id,
    overallScore: run.overall_score,
    dataCompleteness: run.data_completeness,
    decisionSignal: run.decision_signal,
    deadlineStatus: run.deadline_status,
    timezoneUnknown: run.timezone_unknown,
    isCurrent: run.is_current,
    isStale: !run.is_current ? false : false,
    inputSnapshot: run.input_snapshot ?? {},
    error: run.error,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    createdAt: run.created_at,
  }))
}

export async function listScoringConfigurations(supabase: SupabaseClient): Promise<ScoringConfigurationDto[]> {
  const { data: configs, error } = await supabase.from('scoring_configurations').select('*')
  if (error) throw error
  const out: ScoringConfigurationDto[] = []
  for (const cfg of configs ?? []) {
    const { data: version, error: verErr } = await supabase.from('scoring_configuration_versions').select('*').eq('configuration_id', cfg.id).eq('is_current', true).maybeSingle()
    if (verErr) throw verErr
    out.push(
      scoringConfigurationSchema.parse({
        id: cfg.id,
        name: cfg.name,
        description: cfg.description,
        isActive: cfg.is_active,
        currentVersion: version
          ? {
              id: version.id,
              configurationId: version.configuration_id,
              version: version.version,
              dimensionWeights: version.dimension_weights,
              qualificationStatusScoreMap: version.qualification_status_score_map,
              requirementCoverageValueMap: version.requirement_coverage_value_map,
              evaluationFitValueMap: version.evaluation_fit_value_map,
              evidenceStateValueMap: version.evidence_state_value_map,
              decisionBands: version.decision_bands,
              dataCompletenessInsufficientThreshold: version.data_completeness_insufficient_threshold,
              criticalDimensions: version.critical_dimensions,
              isCurrent: version.is_current,
              createdAt: version.created_at,
            }
          : null,
      }),
    )
  }
  return out
}
