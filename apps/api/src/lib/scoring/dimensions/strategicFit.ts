import type { ScoringConfiguration, ScoringInput, ScoredComponent } from '../types.js'
import { matchGeography } from './geography.js'

/**
 * STRATEGIC_FIT dimension (Phase 10 §18/§20). Uses ONLY structured
 * agency profile data that already exists — never asks an LLM to invent
 * strategic desirability, and deliberately does NOT assume every
 * government tender is strategically desirable by default: the baseline
 * is neutral (50), moved only by explicit, named matches or mismatches.
 * Geography (Phase 10 §20) is folded in here as a strategic-capacity
 * signal, not a qualification/evaluation criterion.
 */
export function scoreStrategicFit(input: ScoringInput, config: ScoringConfiguration): ScoredComponent {
  const weight = config.dimensionWeights.STRATEGIC_FIT
  const s = input.strategic
  const drivers: ScoredComponent['drivers'] = []
  const risks: ScoredComponent['risks'] = []
  const unknowns: string[] = []

  if (!s.strategicProfileKnown) {
    return {
      dimension: 'STRATEGIC_FIT',
      status: 'UNKNOWN',
      score: null,
      weight,
      explanation: 'Agency has not recorded a strategic profile (target sectors / preferred organisation types) — strategic fit is unknown.',
      drivers,
      risks,
      unknowns: ['Agency strategic profile is not recorded.'],
      metadata: {},
    }
  }

  let score = 50
  const sectorMatch = s.tenderCategory !== null && s.targetSectors.includes(s.tenderCategory)
  const orgTypeMatch = s.tenderOrgType !== null && s.preferredOrgTypes.includes(s.tenderOrgType)
  const orgTypeMismatch = s.tenderOrgType !== null && s.preferredOrgTypes.length > 0 && !orgTypeMatch

  if (sectorMatch) {
    score += 25
    drivers.push({ description: `Tender category "${s.tenderCategory}" matches an agency target sector.`, evidence: [{ kind: 'RULE', rule: 'STRATEGIC_SECTOR_MATCH', description: null }] })
  } else if (s.tenderCategory === null) {
    unknowns.push('Tender category is unknown — sector alignment could not be assessed.')
  }

  if (orgTypeMatch) {
    score += 15
    drivers.push({ description: `Issuing organisation type "${s.tenderOrgType}" matches an agency preferred organisation type.`, evidence: [{ kind: 'RULE', rule: 'STRATEGIC_ORG_TYPE_MATCH', description: null }] })
  } else if (orgTypeMismatch) {
    score -= 15
    risks.push({ description: `Issuing organisation type "${s.tenderOrgType}" is not among the agency's preferred organisation types.`, evidence: [{ kind: 'RULE', rule: 'STRATEGIC_ORG_TYPE_MISMATCH', description: null }] })
  }

  const geo = matchGeography(input.geography)
  if (geo.status === 'MATCH') {
    score += 10
    drivers.push({ description: geo.explanation, evidence: [{ kind: 'RULE', rule: 'GEOGRAPHY_MATCH', description: null }] })
  } else if (geo.status === 'MISMATCH') {
    score -= 10
    risks.push({ description: geo.explanation, evidence: [{ kind: 'RULE', rule: 'GEOGRAPHY_MISMATCH', description: null }] })
  } else {
    unknowns.push(`Geographic fit is unknown: ${geo.explanation}`)
  }

  score = Math.max(0, Math.min(100, score))

  return {
    dimension: 'STRATEGIC_FIT',
    status: 'KNOWN',
    score,
    weight,
    explanation: 'Strategic fit computed from the agency\'s recorded target sectors, preferred organisation types, and geographic capability. Baseline is neutral (50) — not assumed positive just because this is a public-sector tender.',
    drivers,
    risks,
    unknowns,
    metadata: { sectorMatch, orgTypeMatch, orgTypeMismatch, geographyStatus: geo.status },
  }
}
