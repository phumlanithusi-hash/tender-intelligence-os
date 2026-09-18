import type { SupabaseClient } from '@supabase/supabase-js'
import type { DecisionTimeObservation } from './types.js'

/**
 * Phase 18 — the observation-fetching boundary. Real Supabase-backed
 * (below) and a test fake (__tests__/fakeIntelligenceStore.ts) both
 * produce the same DecisionTimeObservation[] shape the pure engine in
 * this directory consumes, so the readiness/baseline/evaluation code
 * itself never touches Supabase.
 *
 * Target definition (spec §4): a record is a LABELLED observation only
 * when its Phase 17 `bid_outcomes.our_result` is VERIFIED and is
 * either WON (positive) or LOST (negative). NOT_SUBMITTED, WITHDRAWN,
 * DISQUALIFIED, UNKNOWN, and any tender-level NO_AWARD/CANCELLED are
 * never coerced into an ordinary LOST — they are excluded from the
 * label entirely (label = null), never presented as training data.
 */
export interface IntelligenceStore {
  fetchDecisionTimeObservations(agencyId: string): Promise<DecisionTimeObservation[]>
}

export function createSupabaseIntelligenceStore(supabase: SupabaseClient): IntelligenceStore {
  return {
    async fetchDecisionTimeObservations(agencyId: string): Promise<DecisionTimeObservation[]> {
      const { data: features } = await supabase
        .from('outcome_decision_time_features')
        .select(
          'id, bid_project_id, tender_category, organisation_type, province, estimated_value_band, opportunity_score_at_decision, requirement_coverage_at_decision, evidence_strength_at_decision, commercial_fit_at_decision, strategic_fit_at_decision, qualification_status_at_decision, bid_effort, captured_at, scoring_configuration_version_id, bid_policy_version_id',
        )
        .eq('agency_id', agencyId)

      const projectIds = (features ?? []).map((f) => f.bid_project_id as string)
      if (projectIds.length === 0) return []

      const { data: outcomes } = await supabase
        .from('bid_outcomes')
        .select('bid_project_id, our_result, truth_status')
        .eq('agency_id', agencyId)
        .eq('is_current', true)
        .in('bid_project_id', projectIds)

      const outcomeByProject = new Map((outcomes ?? []).map((o) => [o.bid_project_id as string, o]))

      return (features ?? []).map((f) => {
        const outcome = outcomeByProject.get(f.bid_project_id as string)
        let label: boolean | null = null
        if (outcome && outcome.truth_status === 'VERIFIED') {
          if (outcome.our_result === 'WON') label = true
          else if (outcome.our_result === 'LOST') label = false
          // DISQUALIFIED/WITHDRAWN/NOT_SUBMITTED/UNKNOWN intentionally left as null (spec §4).
        }
        return {
          bidProjectId: f.bid_project_id as string,
          decisionTimestamp: f.captured_at as string,
          label,
          tenderCategory: (f.tender_category as string | null) ?? null,
          province: (f.province as string | null) ?? null,
          estimatedValueBand: (f.estimated_value_band as string | null) ?? null,
          opportunityScoreAtDecision: (f.opportunity_score_at_decision as number | null) ?? null,
          requirementCoverageAtDecision: (f.requirement_coverage_at_decision as number | null) ?? null,
          evidenceStrengthAtDecision: (f.evidence_strength_at_decision as number | null) ?? null,
          commercialFitAtDecision: (f.commercial_fit_at_decision as number | null) ?? null,
          strategicFitAtDecision: (f.strategic_fit_at_decision as number | null) ?? null,
          qualificationStatusAtDecision: (f.qualification_status_at_decision as string | null) ?? null,
          bidEffort: (f.bid_effort as string | null) ?? null,
          scoringConfigurationVersionId: (f.scoring_configuration_version_id as string | null) ?? null,
          bidPolicyVersionId: (f.bid_policy_version_id as string | null) ?? null,
        }
      })
    },
  }
}
