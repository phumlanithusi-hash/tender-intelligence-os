import type { BidRuleResult, BidDecisionInput } from './types.js'
import type { BidRecommendation } from '@tender-os/constants'

/**
 * Phase 11 §32-§34 — decision explanations are deterministically
 * templated from structured rule results, never LLM-authored.
 */
function fmtPct(n: number | null): string {
  return n === null ? 'unknown' : `${Math.round(n * 100)}%`
}

export function buildDecisionExplanation(
  decision: BidRecommendation,
  input: BidDecisionInput,
  blockers: BidRuleResult[],
  unresolvedItems: BidRuleResult[],
  positiveFactors: string[],
  humanActionsRequired: string[],
): string {
  const score = input.scoringResult.overallScore
  const completeness = fmtPct(input.scoringResult.dataCompleteness)
  const commercial = input.scoring.commercial.estimatedValue === null ? 'unknown' : `R${input.scoring.commercial.estimatedValue.toLocaleString('en-ZA')}`
  const coverage = input.scoringResult.components.find((c) => c.dimension === 'REQUIREMENT_COVERAGE')
  const evalFit = input.scoringResult.components.find((c) => c.dimension === 'EVALUATION_FIT')
  const evidence = input.scoringResult.components.find((c) => c.dimension === 'EVIDENCE_STRENGTH')

  if (decision === 'NO_BID') {
    const primary = blockers[0]
    return [
      'NO-BID',
      `The opportunity cannot currently be pursued because ${primary ? primary.explanation.toLowerCase() : 'a configured no-bid rule was triggered'}`,
      `Additional factors: Opportunity score: ${score ?? 'unknown'}, Requirement coverage: ${coverage?.score ?? 'unknown'}, Evidence strength: ${evidence?.score ?? 'unknown'}, Commercial value: ${commercial}`,
      primary ? `Primary blocker: ${primary.ruleId} — ${primary.status}` : 'Primary blocker: configured agency policy rule',
    ].join(' / ')
  }

  if (decision === 'REVIEW') {
    const reasons = [`Opportunity score: ${score ?? 'unknown'}`, `Data completeness: ${completeness}`, `Commercial value: ${commercial.toUpperCase() === commercial ? commercial : commercial}`]
    if (unresolvedItems.length > 0) reasons.push(...unresolvedItems.slice(0, 3).map((r) => r.explanation))
    return [
      'REVIEW',
      'The opportunity is potentially attractive but cannot yet receive a BID recommendation.',
      `Reasons: ${reasons.join(', ')}`,
      humanActionsRequired.length > 0 ? `Human action required: ${humanActionsRequired.join('; ')}.` : 'Human action required: resolve the unresolved items listed above.',
    ].join(' / ')
  }

  return [
    'BID',
    'The opportunity satisfies the configured agency bid policy.',
    `Opportunity score: ${score ?? 'unknown'}, Requirement coverage: ${coverage?.score ?? 'unknown'}%, Evaluation fit: ${evalFit?.score ?? 'unknown'}%, Evidence strength: ${evidence?.score ?? 'unknown'}%`,
    `No hard blockers detected. ${positiveFactors.length > 0 ? positiveFactors.join('. ') + '.' : 'Commercial information satisfies the configured policy.'}`,
  ].join(' / ')
}

export function buildPositiveFactors(ruleResults: BidRuleResult[], input: BidDecisionInput): string[] {
  const factors: string[] = []
  const passRule = (id: string, label: string) => {
    const r = ruleResults.find((r) => r.ruleId === id)
    if (r && r.status === 'PASS' && r.severity !== 'WARNING') factors.push(label)
  }
  if (input.scoring.qualification.overallStatus === 'ELIGIBLE') factors.push('Eligible — no confirmed qualification blockers')
  passRule('minimum-requirement-coverage', 'Strong requirement coverage')
  passRule('minimum-evidence-strength', 'Strong evidence')
  passRule('minimum-evaluation-fit', 'Strong evaluation fit')
  passRule('minimum-preparation-days', 'Sufficient preparation time is available')
  for (const id of ['preferred-service-alignment', 'preferred-sector-alignment', 'preferred-organisation-alignment']) {
    const r = ruleResults.find((r) => r.ruleId === id)
    if (r && r.status === 'PASS' && r.expectedValue !== null) factors.push(r.explanation)
  }
  return factors
}

export function buildHumanActions(unresolvedItems: BidRuleResult[]): string[] {
  const actions: string[] = []
  for (const r of unresolvedItems) {
    switch (r.ruleId) {
      case 'commercial-value-known':
        actions.push('Confirm commercial viability (estimated value)')
        break
      case 'compulsory-briefing-missed':
        actions.push('Confirm briefing attendance')
        break
      case 'qualification-status-review':
        actions.push('Resolve outstanding qualification review items')
        break
      case 'minimum-data-completeness':
        actions.push('Complete outstanding evidence/requirement data to raise data completeness')
        break
      case 'unresolved-evaluation-conflict':
        actions.push('Resolve the unreconciled evaluation-criteria conflict (see Evaluation tab)')
        break
      default:
        actions.push(r.explanation)
    }
  }
  return [...new Set(actions)]
}
