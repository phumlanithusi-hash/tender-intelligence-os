import type { ScoringConfiguration, ScoringInput, ScoredComponent } from '../types.js'

/**
 * COMMERCIAL_FIT dimension (Phase 10 §17) — deliberately conservative.
 * Never estimates a tender's value from similar tenders; an unknown
 * tender value or unknown agency minimum-project-value both leave the
 * dimension UNKNOWN rather than fabricating a number.
 */
export function scoreCommercialFit(input: ScoringInput, config: ScoringConfiguration): ScoredComponent {
  const weight = config.dimensionWeights.COMMERCIAL_FIT
  const { estimatedValue, contractDuration, agencyMinProjectValue } = input.commercial
  const drivers: ScoredComponent['drivers'] = []
  const risks: ScoredComponent['risks'] = []
  const unknowns: string[] = []

  if (estimatedValue === null) {
    return {
      dimension: 'COMMERCIAL_FIT',
      status: 'UNKNOWN',
      score: null,
      weight,
      explanation: 'Estimated tender value is unknown — commercial fit cannot be assessed. Never estimated from similar tenders.',
      drivers,
      risks: [{ description: 'Commercial value unavailable for this tender.', evidence: [{ kind: 'RULE', rule: 'COMMERCIAL_VALUE_UNKNOWN', description: null }] }],
      unknowns: ['Estimated tender value is unknown.'],
      metadata: { contractDuration },
    }
  }

  if (agencyMinProjectValue === null) {
    return {
      dimension: 'COMMERCIAL_FIT',
      status: 'UNKNOWN',
      score: null,
      weight,
      explanation: `Estimated tender value (${estimatedValue}) is known, but the agency has not recorded a minimum project value to assess it against.`,
      drivers,
      risks,
      unknowns: ['Agency minimum project value is not configured.'],
      metadata: { estimatedValue, contractDuration },
    }
  }

  const meetsMinimum = estimatedValue >= agencyMinProjectValue
  if (meetsMinimum) {
    drivers.push({ description: `Estimated tender value (${estimatedValue}) meets the agency's minimum project value (${agencyMinProjectValue}).`, evidence: [{ kind: 'RULE', rule: 'MEETS_MIN_PROJECT_VALUE', description: null }] })
  } else {
    risks.push({ description: `Estimated tender value (${estimatedValue}) is below the agency's minimum project value (${agencyMinProjectValue}).`, evidence: [{ kind: 'RULE', rule: 'BELOW_MIN_PROJECT_VALUE', description: null }] })
  }

  return {
    dimension: 'COMMERCIAL_FIT',
    status: 'KNOWN',
    score: meetsMinimum ? 100 : 30,
    weight,
    explanation: meetsMinimum ? 'Estimated value meets the agency minimum project value threshold.' : 'Estimated value is below the agency minimum project value threshold.',
    drivers,
    risks,
    unknowns,
    metadata: { estimatedValue, agencyMinProjectValue, contractDuration },
  }
}
