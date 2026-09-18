import type { SupabaseClient } from '@supabase/supabase-js'
import type { BidDecisionStore, BidPolicyRecord } from './store.js'
import type { BidDecisionInput, BidPolicyConfiguration, BidRuleResult, BidDecisionRunRecord } from './types.js'
import { createSupabaseScoringStore } from '../scoring/supabaseScoringStore.js'
import { evaluateOpportunity } from '../scoring/computeScore.js'
import { DEFAULT_BID_POLICY } from './defaultPolicy.js'

function threshold(v: unknown): { active: boolean; severity: string; value: unknown } | null {
  return v && typeof v === 'object' ? (v as { active: boolean; severity: string; value: unknown }) : null
}

function policyFromRow(version: Record<string, unknown>): BidPolicyConfiguration {
  return {
    id: version.id as string,
    policyId: version.policy_id as string,
    version: version.version as number,
    precedence: version.precedence as BidPolicyConfiguration['precedence'],
    hardGateOverrides: (version.hard_gate_overrides as Record<string, 'REVIEW'>) ?? {},
    minimumOpportunityScore: threshold(version.minimum_opportunity_score) as BidPolicyConfiguration['minimumOpportunityScore'],
    minimumDataCompleteness: threshold(version.minimum_data_completeness) as BidPolicyConfiguration['minimumDataCompleteness'],
    minimumRequirementCoverage: threshold(version.minimum_requirement_coverage) as BidPolicyConfiguration['minimumRequirementCoverage'],
    minimumEvidenceStrength: threshold(version.minimum_evidence_strength) as BidPolicyConfiguration['minimumEvidenceStrength'],
    minimumEvaluationFit: threshold(version.minimum_evaluation_fit) as BidPolicyConfiguration['minimumEvaluationFit'],
    minimumStrategicFit: threshold(version.minimum_strategic_fit) as BidPolicyConfiguration['minimumStrategicFit'],
    minimumContractValue: threshold(version.minimum_contract_value) as BidPolicyConfiguration['minimumContractValue'],
    preferredContractValue: (version.preferred_contract_value as number) ?? null,
    minimumPreparationDays: threshold(version.minimum_preparation_days) as BidPolicyConfiguration['minimumPreparationDays'],
    maximumPreparationDays: threshold(version.maximum_preparation_days) as BidPolicyConfiguration['maximumPreparationDays'],
    minimumExpectedMargin: threshold(version.minimum_expected_margin) as BidPolicyConfiguration['minimumExpectedMargin'],
    maximumBidEffort: threshold(version.maximum_bid_effort) as BidPolicyConfiguration['maximumBidEffort'],
    preferredServices: (version.preferred_services as string[]) ?? [],
    preferredSectors: (version.preferred_sectors as string[]) ?? [],
    preferredOrganisationTypes: (version.preferred_organisation_types as string[]) ?? [],
    preferredProvinces: (version.preferred_provinces as string[]) ?? [],
    excludedOrganisationTypes: threshold(version.excluded_organisation_types) as BidPolicyConfiguration['excludedOrganisationTypes'],
    excludedSectors: threshold(version.excluded_sectors) as BidPolicyConfiguration['excludedSectors'],
    unresolvedEvaluationConflict: threshold(version.unresolved_evaluation_conflict) as BidPolicyConfiguration['unresolvedEvaluationConflict'],
    unknownSeverity: (version.unknown_severity as BidPolicyConfiguration['unknownSeverity']) ?? DEFAULT_BID_POLICY.unknownSeverity,
    scoreBands: (version.score_bands as BidPolicyConfiguration['scoreBands']) ?? DEFAULT_BID_POLICY.scoreBands,
  }
}

function toRunRecord(row: Record<string, unknown>): BidDecisionRunRecord {
  return {
    id: row.id as string,
    tenderId: row.tender_id as string,
    agencyId: row.agency_id as string,
    status: row.status as BidDecisionRunRecord['status'],
    bidPolicyVersionId: row.bid_policy_version_id as string,
    scoringRunId: (row.scoring_run_id as string) ?? null,
    systemDecision: (row.system_decision as BidDecisionRunRecord['systemDecision']) ?? null,
    humanDecision: (row.human_decision as BidDecisionRunRecord['humanDecision']) ?? null,
    finalDecision: (row.final_decision as BidDecisionRunRecord['finalDecision']) ?? null,
    overrideReason: (row.override_reason as string) ?? null,
    overriddenBy: (row.overridden_by as string) ?? null,
    overriddenAt: (row.overridden_at as string) ?? null,
    bidEffort: row.bid_effort as BidDecisionRunRecord['bidEffort'],
    bidEffortExplanation: (row.bid_effort_explanation as string) ?? null,
    decisionExplanation: (row.decision_explanation as string) ?? null,
    isCurrent: Boolean(row.is_current),
    inputSnapshot: (row.input_snapshot as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
  }
}

/**
 * Production `BidDecisionStore` over the privileged service-role
 * Supabase client, mirroring `createSupabaseScoringStore` exactly. All
 * writes bypass RLS — never called with a browser-scoped client.
 *
 * KNOWN LIMITATIONS (documented in docs/BID-NO-BID-ENGINE.md, carried
 * from Phase 10 unchanged where applicable):
 *  - Briefing attendance is always UNKNOWN (no dedicated tracking table).
 *  - Agency capacity is always UNKNOWN (Phase 11 §23 — schema seam only).
 *  - Expected margin is always UNKNOWN (Phase 11 §20 — no real cost data).
 */
export function createSupabaseBidDecisionStore(supabase: SupabaseClient): BidDecisionStore {
  const scoringStore = createSupabaseScoringStore(supabase)

  async function getCurrentPolicy(agencyId: string): Promise<BidPolicyRecord> {
    const { data: policyRow, error: policyErr } = await supabase.from('bid_policies').select('id').eq('agency_id', agencyId).eq('name', 'default').maybeSingle()
    if (policyErr) throw policyErr
    if (!policyRow) return { versionId: DEFAULT_BID_POLICY.id, policy: DEFAULT_BID_POLICY }

    const { data: version, error: verErr } = await supabase.from('bid_policy_versions').select('*').eq('policy_id', policyRow.id).eq('is_current', true).maybeSingle()
    if (verErr) throw verErr
    if (!version) return { versionId: DEFAULT_BID_POLICY.id, policy: DEFAULT_BID_POLICY }

    return { versionId: version.id, policy: policyFromRow(version) }
  }

  async function fetchExtras(tenderId: string, agencyId: string) {
    const [{ data: conflicts, error: confErr }, { data: reqRows, error: reqErr }, { data: critRows, error: critErr }, { data: tender, error: tenderErr }, { data: currentScoringRun, error: scoringRunErr }] = await Promise.all([
      supabase.from('tender_evaluation_conflicts').select('id, status').eq('tender_id', tenderId),
      supabase.from('tender_requirements').select('id, mandatory, requirement_type').eq('tender_id', tenderId).is('superseded_by', null),
      supabase.from('tender_evaluation_criteria').select('id, criterion_type').eq('tender_id', tenderId).is('superseded_by', null),
      supabase.from('tenders').select('briefing_required').eq('id', tenderId).maybeSingle(),
      supabase.from('tender_scoring_runs').select('id').eq('tender_id', tenderId).eq('agency_id', agencyId).eq('is_current', true).maybeSingle(),
    ])
    for (const e of [confErr, reqErr, critErr, tenderErr, scoringRunErr]) if (e) throw e

    const requirements = reqRows ?? []
    const criteria = critRows ?? []
    const mandatoryDocumentCount = requirements.filter((r: Record<string, unknown>) => r.mandatory).length
    const mandatoryFormCount = requirements.filter((r: Record<string, unknown>) => r.mandatory && ['SUBMISSION', 'ADMINISTRATIVE'].includes(r.requirement_type as string)).length
    const presentationRequired = criteria.length === 0 ? null : criteria.some((c: Record<string, unknown>) => c.criterion_type === 'PRESENTATION')
    const unresolvedCount = (conflicts ?? []).filter((c: Record<string, unknown>) => c.status === 'OPEN').length

    return {
      evaluationConflict: { unresolvedCount },
      bidEffortInputs: {
        mandatoryDocumentCount,
        evaluationCriteriaCount: criteria.length,
        presentationRequired,
        briefingCompulsory: tender?.briefing_required ?? null,
        mandatoryFormCount,
      },
      scoringRunId: currentScoringRun?.id ?? null,
    }
  }

  async function assembleInput(tenderId: string, agencyId: string, now: string) {
    const [scoringAssembly, scoringConfig, extras] = await Promise.all([scoringStore.assembleInput(tenderId, agencyId, now), scoringStore.getCurrentConfiguration(), fetchExtras(tenderId, agencyId)])
    const scoringResult = evaluateOpportunity(scoringAssembly.input, scoringConfig.config)

    const input: BidDecisionInput = {
      tenderId,
      agencyId,
      now,
      scoring: scoringAssembly.input,
      scoringResult,
      scoringRunId: extras.scoringRunId,
      evaluationConflict: extras.evaluationConflict,
      bidEffortInputs: extras.bidEffortInputs,
      capacity: { known: false, availableTeamCapacity: null, requiredEffortEstimate: null, currentBidWorkload: null },
    }

    const snapshot = {
      scoringSnapshot: scoringAssembly.snapshot,
      scoringRunId: extras.scoringRunId,
      evaluationConflictUnresolvedCount: extras.evaluationConflict.unresolvedCount,
      bidEffortInputs: extras.bidEffortInputs,
    }

    return { input, snapshot }
  }

  async function buildSnapshot(tenderId: string, agencyId: string) {
    const { snapshot } = await assembleInput(tenderId, agencyId, new Date().toISOString())
    return snapshot
  }

  return {
    getCurrentPolicy,
    assembleInput,
    buildSnapshot,

    async findActiveRun(tenderId, agencyId) {
      const { data, error } = await supabase.from('bid_decision_runs').select('id').eq('tender_id', tenderId).eq('agency_id', agencyId).in('status', ['QUEUED', 'RUNNING']).maybeSingle()
      if (error) throw error
      return data ? { id: data.id } : null
    },

    async findCurrentRun(tenderId, agencyId) {
      const { data, error } = await supabase.from('bid_decision_runs').select('*').eq('tender_id', tenderId).eq('agency_id', agencyId).eq('is_current', true).maybeSingle()
      if (error) throw error
      return data ? toRunRecord(data) : null
    },

    async getRun(runId) {
      const { data, error } = await supabase.from('bid_decision_runs').select('*').eq('id', runId).maybeSingle()
      if (error) throw error
      return data ? toRunRecord(data) : null
    },

    async listRuns(tenderId) {
      const { data, error } = await supabase.from('bid_decision_runs').select('*').eq('tender_id', tenderId).order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map(toRunRecord)
    },

    async createRun(input) {
      const { data, error } = await supabase
        .from('bid_decision_runs')
        .insert({ tender_id: input.tenderId, agency_id: input.agencyId, bid_policy_version_id: input.bidPolicyVersionId, scoring_run_id: input.scoringRunId, status: 'QUEUED', triggered_by: input.triggeredBy })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id }
    },

    async updateRun(runId, patch) {
      const update: Record<string, unknown> = {}
      if (patch.status !== undefined) update.status = patch.status
      if (patch.systemDecision !== undefined) update.system_decision = patch.systemDecision
      if (patch.finalDecision !== undefined) update.final_decision = patch.finalDecision
      if (patch.bidEffort !== undefined) update.bid_effort = patch.bidEffort
      if (patch.bidEffortExplanation !== undefined) update.bid_effort_explanation = patch.bidEffortExplanation
      if (patch.decisionExplanation !== undefined) update.decision_explanation = patch.decisionExplanation
      if (patch.inputSnapshot !== undefined) update.input_snapshot = patch.inputSnapshot
      if (patch.error !== undefined) update.error = patch.error
      if (patch.startedAt !== undefined) update.started_at = patch.startedAt
      if (patch.completedAt !== undefined) update.completed_at = patch.completedAt
      const { error } = await supabase.from('bid_decision_runs').update(update).eq('id', runId)
      if (error) throw error
    },

    async markPreviousRunsNotCurrent(tenderId, agencyId, exceptRunId) {
      const { error } = await supabase.from('bid_decision_runs').update({ is_current: false }).eq('tender_id', tenderId).eq('agency_id', agencyId).neq('id', exceptRunId)
      if (error) throw error
    },

    async saveRuleResults(runId, results: BidRuleResult[]) {
      const rows = results.map((r) => ({ run_id: runId, rule_id: r.ruleId, precedence_step: r.precedenceStep, status: r.status, severity: r.severity, actual_value: r.actualValue as unknown, expected_value: r.expectedValue as unknown, explanation: r.explanation }))
      const { error } = await supabase.from('bid_decision_rule_results').insert(rows)
      if (error) throw error
    },

    async applyOverride(runId, input) {
      if (!input.overrideReason || input.overrideReason.trim().length === 0) {
        throw new Error('An override reason is required.')
      }
      const existing = await this.getRun(runId)
      if (!existing) throw new Error('Bid decision run not found.')

      const { data, error } = await supabase
        .from('bid_decision_runs')
        .update({ human_decision: input.humanDecision, final_decision: input.humanDecision, override_reason: input.overrideReason, overridden_by: input.overriddenBy, overridden_at: input.overriddenAt })
        .eq('id', runId)
        .select('*')
        .single()
      if (error) throw error

      await this.writeAuditEvent({
        eventType: 'BID_DECISION_OVERRIDDEN',
        agencyId: existing.agencyId,
        actorId: input.overriddenBy,
        entityId: runId,
        oldValue: { systemDecision: existing.systemDecision },
        newValue: { humanDecision: input.humanDecision, overrideReason: input.overrideReason },
      })

      return toRunRecord(data)
    },

    async writeAuditEvent(event) {
      const { error } = await supabase.from('audit_logs').insert({
        agency_id: event.agencyId,
        actor_id: event.actorId,
        actor_type: 'USER',
        action: event.eventType,
        entity_type: 'bid_decision_run',
        entity_id: event.entityId,
        old_value: event.oldValue,
        new_value: event.newValue,
      })
      if (error) throw error
    },
  }
}
