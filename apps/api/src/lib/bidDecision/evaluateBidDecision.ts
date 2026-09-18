import type { BidDecisionInput, BidDecisionResult, BidPolicyConfiguration } from './types.js'
import { computeBidEffort } from './bidEffort.js'
import { evaluateAllRules } from './rules.js'
import { decideFromPrecedence } from './precedence.js'
import { buildDecisionExplanation, buildPositiveFactors, buildHumanActions } from './explanations.js'

/**
 * Phase 11 §29 — `evaluateBidDecision(input, policy): BidDecisionResult`.
 * Pure, deterministic, no I/O. Same input + same policy always produces
 * the same output (verified by tests/repeat-run.test.ts).
 */
export function evaluateBidDecision(input: BidDecisionInput, policy: BidPolicyConfiguration): BidDecisionResult {
  const effort = computeBidEffort(input.bidEffortInputs)
  const ruleResults = evaluateAllRules(input, policy, effort.level)
  const { decision, primaryPrecedenceStep } = decideFromPrecedence(ruleResults, policy.precedence)

  const triggeredRules = ruleResults.filter((r) => r.status !== 'PASS')
  const blockers = ruleResults.filter((r) => r.status === 'FAIL' && (r.severity === 'HARD_BLOCK' || r.severity === 'NO_BID'))
  const warnings = ruleResults.filter((r) => r.status !== 'PASS' && r.severity === 'WARNING')
  const unresolvedItems = ruleResults.filter((r) => r.status !== 'PASS' && r.severity === 'REVIEW')
  const positiveFactors = buildPositiveFactors(ruleResults, input)
  const humanActionsRequired = decision === 'REVIEW' ? buildHumanActions(unresolvedItems) : []
  const decisionExplanation = buildDecisionExplanation(decision, input, blockers, unresolvedItems, positiveFactors, humanActionsRequired)

  return {
    decision,
    primaryPrecedenceStep,
    ruleResults,
    triggeredRules,
    blockers,
    warnings,
    unresolvedItems,
    positiveFactors,
    humanActionsRequired,
    decisionExplanation,
    bidEffort: effort.level,
    bidEffortExplanation: effort.explanation,
    policyVersion: policy.version,
    policyId: policy.policyId,
  }
}
