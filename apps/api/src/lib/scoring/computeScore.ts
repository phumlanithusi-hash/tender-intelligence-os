import type { ScoringInput, ScoringConfiguration, OpportunityScoreResult } from './types.js'
import { scoreQualification } from './dimensions/qualification.js'
import { scoreRequirementCoverage } from './dimensions/requirementCoverage.js'
import { scoreEvaluationFit } from './dimensions/evaluationFit.js'
import { scoreEvidenceStrength } from './dimensions/evidenceStrength.js'
import { scoreCommercialFit } from './dimensions/commercialFit.js'
import { scoreStrategicFit } from './dimensions/strategicFit.js'
import { computeGates } from './gates.js'
import { computeDataCompleteness, computeOverallScore, computeDecisionSignal } from './decisionSignal.js'

/**
 * The single pure entrypoint of the Phase 10 scoring engine (Phase 10
 * §3/§4: deterministic, explainable, repeatable, auditable). Given the
 * identical `ScoringInput` + `ScoringConfiguration`, this function
 * ALWAYS returns an identical `OpportunityScoreResult` — no I/O, no
 * clock reads beyond `input.now`, no randomness, no AI call of any kind.
 * `runScoring.ts` is the only caller that talks to a database; this
 * function is fully unit-testable without one.
 */
export function evaluateOpportunity(input: ScoringInput, config: ScoringConfiguration): OpportunityScoreResult {
  const components = [
    scoreQualification(input.qualification, config),
    scoreRequirementCoverage(input, config),
    scoreEvaluationFit(input, config),
    scoreEvidenceStrength(input, config),
    scoreCommercialFit(input, config),
    scoreStrategicFit(input, config),
  ]

  const { gates, deadlineStatus, timezoneUnknown } = computeGates(input)
  const { dataCompleteness } = computeDataCompleteness(components)
  const overallScore = computeOverallScore(components)
  const decisionSignal = computeDecisionSignal(overallScore, dataCompleteness, components, gates, config)

  const drivers: OpportunityScoreResult['drivers'] = components.flatMap((c) => c.drivers.map((d) => ({ dimension: c.dimension, description: d.description, evidence: d.evidence })))
  const risks: OpportunityScoreResult['risks'] = components.flatMap((c) => c.risks.map((r) => ({ dimension: c.dimension, description: r.description, evidence: r.evidence })))
  const unknowns = [...new Set(components.flatMap((c) => c.unknowns))]

  for (const g of gates) {
    if (g.status === 'TRIGGERED') {
      risks.push({ dimension: null, description: `HARD GATE — ${g.gateType}: ${g.description}`, evidence: g.evidence })
    } else if (g.status === 'UNKNOWN') {
      unknowns.push(`Gate ${g.gateType} could not be evaluated: ${g.description}`)
    }
  }

  return {
    overallScore,
    dataCompleteness: Math.round(dataCompleteness * 10000) / 10000,
    decisionSignal,
    deadlineStatus,
    timezoneUnknown,
    components,
    gates,
    drivers,
    risks,
    unknowns,
  }
}
