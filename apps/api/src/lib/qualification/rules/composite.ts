import type { RuleResult, QualificationAction } from '../types.js'

/**
 * COMPOSITE rule (Phase 8 §10) — combines several already-evaluated
 * sub-results (e.g. "JV requirement" = lead-partner rule AND
 * min-partner-contribution rule) using the same precedence as the
 * overall qualification status calculation (status.ts), scoped to
 * just this requirement's own sub-checks:
 *   any sub-result FAIL -> FAIL
 *   else any REQUIRES_ACTION -> REQUIRES_ACTION
 *   else any UNKNOWN -> UNKNOWN
 *   else PASS
 * This mirrors the mandatory-failure precedence (§24) at requirement
 * granularity rather than duplicating separate logic.
 */
export function evaluateCompositeRule(mandatory: boolean, subResults: RuleResult[]): RuleResult {
  const agencyEvidence = subResults.flatMap((r) => r.agencyEvidence)
  const tenderEvidence = subResults.flatMap((r) => r.tenderEvidence)
  const actions: QualificationAction[] = subResults.flatMap((r) => r.actions)
  const requiresHumanReview = subResults.some((r) => r.requiresHumanReview)
  const explanations = subResults.map((r) => r.explanation).join(' ')

  const base = { mandatory, agencyEvidence, tenderEvidence, evaluatedBy: 'DETERMINISTIC_RULE' as const, confidence: null, requiresHumanReview, actions }

  if (subResults.length === 0) {
    return { ...base, status: 'UNKNOWN', explanation: 'Composite requirement has no sub-checks configured.' }
  }
  if (subResults.some((r) => r.status === 'FAIL')) {
    return { ...base, status: 'FAIL', explanation: explanations }
  }
  if (subResults.some((r) => r.status === 'REQUIRES_ACTION')) {
    return { ...base, status: 'REQUIRES_ACTION', explanation: explanations }
  }
  if (subResults.some((r) => r.status === 'UNKNOWN')) {
    return { ...base, status: 'UNKNOWN', explanation: explanations }
  }
  return { ...base, status: 'PASS', explanation: explanations }
}
