import type { QualificationOverallStatus } from '@tender-os/constants'
import type { RuleResult } from './types.js'

/**
 * Overall qualification status calculation (Phase 8 §24/§25). This is
 * the single most safety-critical function in the phase — a mandatory
 * FAIL must never be hidden by any aggregate, and UNKNOWN/REQUIRES_ACTION
 * must never collapse into FAIL or PASS respectively.
 *
 * EXACT PRECEDENCE (documented here and in
 * docs/QUALIFICATION-ENGINE.md — the spec deliberately leaves edge
 * cases to be resolved and documented, this is that resolution):
 *
 *   1. NOT_ELIGIBLE   — at least one VERIFIED-mandatory requirement's
 *                        result is FAIL. Always wins, checked first.
 *   2. REQUIRES_REVIEW — no mandatory FAIL, but at least one MANDATORY
 *                        or CONDITIONALLY_MANDATORY requirement's
 *                        result is UNKNOWN, OR any requirement (of any
 *                        mandatory status) is flagged
 *                        `requiresHumanReview`.
 *   3. ACTION_REQUIRED — no mandatory FAIL, no requires-review
 *                        condition, but at least one MANDATORY or
 *                        CONDITIONALLY_MANDATORY requirement's result
 *                        is REQUIRES_ACTION.
 *   4. UNKNOWN        — no mandatory FAIL/REQUIRES_ACTION/UNKNOWN
 *                        condition above applied, but there is
 *                        insufficient agency information overall —
 *                        i.e. at least one requirement of ANY
 *                        mandatory status is UNKNOWN (a PREFERENTIAL/
 *                        INFORMATIONAL/UNKNOWN-mandatory-status
 *                        requirement being UNKNOWN does not block
 *                        ELIGIBLE by itself, but if it is the only
 *                        unresolved thing in an otherwise-empty result
 *                        set, this rung still applies rather than
 *                        silently saying ELIGIBLE).
 *   5. ELIGIBLE       — all VERIFIED-mandatory requirements PASS and
 *                        no unresolved mandatory ambiguity remains.
 *                        "ELIGIBLE" means "no identified mandatory
 *                        blocker found based on available evidence",
 *                        NOT a guarantee — see UI wording.
 *
 * An optional/PREFERENTIAL requirement's FAIL never causes
 * NOT_ELIGIBLE (Phase 8 §37 test 5/6) — it simply never reaches rung 1
 * because rung 1 only inspects requirements whose mandatoryStatus is
 * MANDATORY or CONDITIONALLY_MANDATORY.
 */
export function computeOverallStatus(results: RuleResult[]): QualificationOverallStatus {
  const isHardMandatory = (r: RuleResult) => r.mandatory

  if (results.some((r) => isHardMandatory(r) && r.status === 'FAIL')) {
    return 'NOT_ELIGIBLE'
  }

  const anyRequiresReview =
    results.some((r) => isHardMandatory(r) && r.status === 'UNKNOWN') || results.some((r) => r.requiresHumanReview)
  if (anyRequiresReview) {
    return 'REQUIRES_REVIEW'
  }

  if (results.some((r) => isHardMandatory(r) && r.status === 'REQUIRES_ACTION')) {
    return 'ACTION_REQUIRED'
  }

  if (results.some((r) => r.status === 'UNKNOWN')) {
    return 'UNKNOWN'
  }

  return 'ELIGIBLE'
}

/** Convenience aggregate counts for a run summary (Phase 8 §34 UI: "2 MANDATORY BLOCKERS" etc). */
export function summarizeResults(results: RuleResult[]) {
  return {
    mandatoryBlockerCount: results.filter((r) => r.mandatory && r.status === 'FAIL').length,
    actionRequiredCount: results.filter((r) => r.status === 'REQUIRES_ACTION').length,
    requiresReviewCount: results.filter((r) => r.requiresHumanReview).length,
    requirementCount: results.length,
  }
}
