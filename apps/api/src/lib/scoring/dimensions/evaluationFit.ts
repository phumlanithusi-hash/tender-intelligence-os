import type { ScoringConfiguration, ScoringInput, ScoredComponent, EvaluationCriterionInput, ScoringEvidenceRef } from '../types.js'
import type { EvaluationFitStrength } from '@tender-os/constants'

export interface ClassifiedCriterion {
  criterion: EvaluationCriterionInput
  strength: EvaluationFitStrength
  evidence: ScoringEvidenceRef[]
  verifiedCount: number
  linkedCount: number
}

/**
 * Per-criterion fit (Phase 10 §11) — STRONG/MODERATE/WEAK ONLY when an
 * explicit `tender_evaluation_criterion_agency_evidence` link exists
 * (never invented via semantic/text matching); otherwise UNKNOWN.
 */
export function classifyCriterionFit(criterion: EvaluationCriterionInput): ClassifiedCriterion {
  const links = criterion.linkedEvidence
  const verified = links.filter((l) => l.evidenceState === 'VERIFIED')
  let strength: EvaluationFitStrength
  if (links.length === 0) strength = 'UNKNOWN'
  else if (verified.length >= 2) strength = 'STRONG'
  else if (verified.length === 1) strength = 'MODERATE'
  else strength = 'WEAK'
  return { criterion, strength, evidence: links.map((l) => l.evidenceRef), verifiedCount: verified.length, linkedCount: links.length }
}

/**
 * EVALUATION_FIT dimension (Phase 10 §11/§12/§13). Weight fallback
 * (Phase 10 §12): if ANY criterion's tender-stated `weight` is null, ALL
 * criteria use equal internal weighting for this computation only —
 * labelled INTERNAL_FALLBACK in metadata, never written back to
 * tender_evaluation_criteria.
 */
export function scoreEvaluationFit(input: ScoringInput, config: ScoringConfiguration): ScoredComponent {
  const weight = config.dimensionWeights.EVALUATION_FIT
  const criteria = input.evaluationCriteria
  const drivers: ScoredComponent['drivers'] = []
  const risks: ScoredComponent['risks'] = []
  const unknowns: string[] = []

  if (criteria.length === 0) {
    return {
      dimension: 'EVALUATION_FIT',
      status: 'UNKNOWN',
      score: null,
      weight,
      explanation: 'No evaluation criteria have been extracted for this tender yet.',
      drivers,
      risks,
      unknowns: ['Evaluation criteria are unknown — extraction has not run or found none.'],
      metadata: {},
    }
  }

  const classified = criteria.map(classifyCriterionFit)
  const hasNullWeight = criteria.some((c) => c.weight === null)
  const internalWeights: number[] = hasNullWeight ? criteria.map(() => 1 / criteria.length) : normalize(criteria.map((c) => c.weight as number))

  const known = classified.map((c, i) => ({ ...c, internalWeight: internalWeights[i] ?? 0 })).filter((c) => c.strength !== 'UNKNOWN')
  const knownWeightSum = known.reduce((s, c) => s + c.internalWeight, 0)

  for (const c of classified) {
    if (c.strength === 'STRONG') {
      drivers.push({ description: `Strong evidence against "${c.criterion.criterion}" (${c.verifiedCount} verified linked agency evidence item(s)).`, evidence: c.evidence })
    } else if (c.strength === 'WEAK') {
      risks.push({ description: `Weak evidence for "${c.criterion.criterion}" — linked evidence exists but is not verified.`, evidence: c.evidence })
    } else if (c.strength === 'UNKNOWN') {
      unknowns.push(`No explicit agency-evidence link recorded for evaluation criterion "${c.criterion.criterion}" — fit is unknown.`)
    }
    if (c.criterion.gate && c.criterion.minimumScore !== null) {
      risks.push({
        description: `Evaluation threshold for "${c.criterion.criterion}" (minimum ${c.criterion.minimumScore}) cannot currently be assessed — no bidder-side score can be computed from available evidence.`,
        evidence: [{ kind: 'RULE', rule: 'THRESHOLD_UNKNOWN', description: null }],
      })
    }
  }

  if (input.evaluationGates.length > 0) {
    unknowns.push(`${input.evaluationGates.length} evaluation gate(s) recorded on this tender; threshold pass/fail is not computed by this engine — see gate details.`)
  }

  if (knownWeightSum === 0) {
    return {
      dimension: 'EVALUATION_FIT',
      status: 'UNKNOWN',
      score: null,
      weight,
      explanation: 'No evaluation criterion has an explicit agency-evidence link yet — evaluation fit is unknown.',
      drivers,
      risks,
      unknowns,
      metadata: { internalFallbackWeighting: hasNullWeight, criteriaCount: criteria.length },
    }
  }

  const numerator = known.reduce((sum, c) => sum + config.evaluationFitValueMap[c.strength as Exclude<EvaluationFitStrength, 'UNKNOWN'>] * c.internalWeight, 0)
  const score = Math.round((numerator / knownWeightSum) * 100 * 100) / 100

  return {
    dimension: 'EVALUATION_FIT',
    status: 'KNOWN',
    score,
    weight,
    explanation: `${known.length} of ${criteria.length} evaluation criteria have explicit agency-evidence links assessed. ${hasNullWeight ? 'Internal equal weighting used (INTERNAL_FALLBACK) because at least one criterion has no tender-stated weight.' : 'Tender-stated weights used.'}`,
    drivers,
    risks,
    unknowns,
    metadata: { internalFallbackWeighting: hasNullWeight, assessedCount: known.length, totalCount: criteria.length },
  }
}

function normalize(weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0)
  if (total === 0) return weights.map(() => 1 / weights.length)
  return weights.map((w) => w / total)
}
