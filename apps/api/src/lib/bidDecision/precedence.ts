import type { BidRuleResult } from './types.js'
import type { BidRecommendation, BidDecisionPrecedenceStep } from '@tender-os/constants'

/**
 * Phase 11 §7/§28 — walk the configured precedence order; the first
 * step containing a "triggering" rule (non-PASS status with severity
 * above WARNING) decides the outcome. WARNING-severity results never
 * move the decision, only appear in the explanation. This never stops
 * evaluating rules (that already happened in rules.ts) — it only
 * decides which category is "primary" for the purpose of the headline
 * decision, while every rule result is still returned to the caller.
 */
export function decideFromPrecedence(ruleResults: BidRuleResult[], precedence: BidDecisionPrecedenceStep[]): { decision: BidRecommendation; primaryPrecedenceStep: BidDecisionPrecedenceStep } {
  for (const step of precedence) {
    if (step === 'POSITIVE_BID_RULE') {
      const passing = ruleResults.find((r) => r.precedenceStep === 'POSITIVE_BID_RULE' && r.status === 'PASS')
      if (passing) return { decision: 'BID', primaryPrecedenceStep: 'POSITIVE_BID_RULE' }
      continue
    }
    if (step === 'DEFAULT_REVIEW') {
      return { decision: 'REVIEW', primaryPrecedenceStep: 'DEFAULT_REVIEW' }
    }
    const triggering = ruleResults.filter((r) => r.precedenceStep === step && r.status !== 'PASS' && r.severity !== 'WARNING')
    if (triggering.length === 0) continue
    if (triggering.some((r) => r.severity === 'HARD_BLOCK' || r.severity === 'NO_BID')) {
      return { decision: 'NO_BID', primaryPrecedenceStep: step }
    }
    // Only REVIEW-severity results remain in this step.
    return { decision: 'REVIEW', primaryPrecedenceStep: step }
  }
  // Precedence list is validated to always include DEFAULT_REVIEW as the last
  // step (assertValidBidPolicy), so this is unreachable in practice — kept as
  // a safe, never-silent-BID/NO_BID fallback (binding constraint).
  return { decision: 'REVIEW', primaryPrecedenceStep: 'DEFAULT_REVIEW' }
}
