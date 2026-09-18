import type { SupabaseClient } from '@supabase/supabase-js'
import { bidDecisionResponseSchema, bidDecisionRunSchema, bidDecisionRuleResultSchema, type BidDecisionResponseDto, type BidDecisionRunDto } from '@tender-os/schemas'
import { createSupabaseBidDecisionStore } from '../lib/bidDecision/supabaseBidDecisionStore.js'
import { isSnapshotStale } from '../lib/bidDecision/staleness.js'
import { logger } from '../lib/logger.js'

/**
 * Read-only repository over the Phase 11 bid-decision tables, via the
 * caller's own RLS-scoped client — same split as
 * repositories/tenderScoring.ts vs
 * lib/bidDecision/supabaseBidDecisionStore.ts. Writes (evaluate,
 * override) always go through lib/bidDecision/runBidDecision.ts /
 * the store's applyOverride with the privileged service-role client.
 */
export async function getBidDecision(supabase: SupabaseClient, tenderId: string, agencyId: string): Promise<BidDecisionResponseDto> {
  const { data: run, error: runErr } = await supabase.from('bid_decision_runs').select('*').eq('tender_id', tenderId).eq('is_current', true).maybeSingle()
  if (runErr) throw runErr
  if (!run) return bidDecisionResponseSchema.parse({ run: null, ruleResults: [], blockers: [], warnings: [], unresolvedItems: [], positiveFactors: [], humanActionsRequired: [] })

  const { data: ruleRows, error: ruleErr } = await supabase.from('bid_decision_rule_results').select('*').eq('run_id', run.id)
  if (ruleErr) throw ruleErr

  let isStale = false
  try {
    const store = createSupabaseBidDecisionStore(supabase)
    const currentSnapshot = await store.buildSnapshot(tenderId, agencyId)
    isStale = isSnapshotStale(run.input_snapshot ?? {}, currentSnapshot)
  } catch (err) {
    logger.warn({ err, tenderId }, 'could not compute bid-decision staleness — reporting as not stale')
  }

  const runDto: BidDecisionRunDto = bidDecisionRunSchema.parse({
    id: run.id,
    tenderId: run.tender_id,
    agencyId: run.agency_id,
    status: run.status,
    bidPolicyVersionId: run.bid_policy_version_id,
    scoringRunId: run.scoring_run_id,
    systemDecision: run.system_decision,
    humanDecision: run.human_decision,
    finalDecision: run.final_decision,
    overrideReason: run.override_reason,
    overriddenBy: run.overridden_by,
    overriddenAt: run.overridden_at,
    bidEffort: run.bid_effort,
    bidEffortExplanation: run.bid_effort_explanation,
    decisionExplanation: run.decision_explanation,
    isCurrent: run.is_current,
    isStale,
    inputSnapshot: run.input_snapshot ?? {},
    error: run.error,
    createdAt: run.created_at,
  })

  const ruleResults = (ruleRows ?? []).map((r) =>
    bidDecisionRuleResultSchema.parse({ id: r.id, ruleId: r.rule_id, precedenceStep: r.precedence_step, status: r.status, severity: r.severity, actualValue: r.actual_value, expectedValue: r.expected_value, explanation: r.explanation }),
  )

  const blockers = ruleResults.filter((r) => r.status === 'FAIL' && (r.severity === 'HARD_BLOCK' || r.severity === 'NO_BID'))
  const warnings = ruleResults.filter((r) => r.status !== 'PASS' && r.severity === 'WARNING')
  const unresolvedItems = ruleResults.filter((r) => r.status !== 'PASS' && r.severity === 'REVIEW')

  return bidDecisionResponseSchema.parse({
    run: runDto,
    ruleResults,
    blockers,
    warnings,
    unresolvedItems,
    positiveFactors: [], // recomputed on demand from ruleResults on the client; the authoritative copy lives in decisionExplanation
    humanActionsRequired: [],
  })
}

export async function listBidDecisionRules(supabase: SupabaseClient, tenderId: string) {
  const { data: run } = await supabase.from('bid_decision_runs').select('id').eq('tender_id', tenderId).eq('is_current', true).maybeSingle()
  if (!run) return []
  const { data, error } = await supabase.from('bid_decision_rule_results').select('*').eq('run_id', run.id)
  if (error) throw error
  return (data ?? []).map((r) => bidDecisionRuleResultSchema.parse({ id: r.id, ruleId: r.rule_id, precedenceStep: r.precedence_step, status: r.status, severity: r.severity, actualValue: r.actual_value, expectedValue: r.expected_value, explanation: r.explanation }))
}

export async function listBidDecisionHistory(supabase: SupabaseClient, tenderId: string): Promise<BidDecisionRunDto[]> {
  const { data, error } = await supabase.from('bid_decision_runs').select('*').eq('tender_id', tenderId).order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((run) =>
    bidDecisionRunSchema.parse({
      id: run.id,
      tenderId: run.tender_id,
      agencyId: run.agency_id,
      status: run.status,
      bidPolicyVersionId: run.bid_policy_version_id,
      scoringRunId: run.scoring_run_id,
      systemDecision: run.system_decision,
      humanDecision: run.human_decision,
      finalDecision: run.final_decision,
      overrideReason: run.override_reason,
      overriddenBy: run.overridden_by,
      overriddenAt: run.overridden_at,
      bidEffort: run.bid_effort,
      bidEffortExplanation: run.bid_effort_explanation,
      decisionExplanation: run.decision_explanation,
      isCurrent: run.is_current,
      isStale: false,
      inputSnapshot: run.input_snapshot ?? {},
      error: run.error,
      createdAt: run.created_at,
    }),
  )
}
