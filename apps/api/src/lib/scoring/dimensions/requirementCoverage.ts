import type { ScoringConfiguration, ScoringInput, ScoredComponent, RequirementInput, ScoringEvidenceRef } from '../types.js'
import type { RequirementCoverageStatus } from '@tender-os/constants'
import { computeServiceAlignment } from './serviceAlignment.js'

export interface ClassifiedRequirement {
  requirement: RequirementInput
  coverageStatus: RequirementCoverageStatus
  explanation: string
  evidence: ScoringEvidenceRef[]
}

/**
 * Classifies one Phase 9 requirement's coverage (Phase 10 §7) by
 * reusing the ALREADY-COMPUTED Phase 8 qualification result for that
 * exact requirement row (tender_requirements is the shared table both
 * phases extend) — this phase never re-evaluates a requirement against
 * agency evidence itself. An INFORMATIONAL requirement carries no
 * compliance obligation and is always NOT_APPLICABLE regardless of any
 * underlying check. Absence of any Phase 8 result for a
 * non-informational requirement is UNKNOWN, never FAILED.
 */
export function classifyRequirementCoverage(
  requirement: RequirementInput,
  qualificationResult: ScoringInput['qualification']['results'][number] | undefined,
): ClassifiedRequirement {
  if (requirement.mandatoryStatus === 'INFORMATIONAL') {
    return { requirement, coverageStatus: 'NOT_APPLICABLE', explanation: 'Informational requirement — no compliance obligation.', evidence: [] }
  }
  if (!qualificationResult) {
    return { requirement, coverageStatus: 'UNKNOWN', explanation: 'No qualification check has been run against this requirement yet.', evidence: [] }
  }
  const evidence = [...qualificationResult.tenderEvidence, ...qualificationResult.agencyEvidence]
  const map: Record<string, RequirementCoverageStatus> = { PASS: 'SUPPORTED', FAIL: 'FAILED', UNKNOWN: 'UNKNOWN', REQUIRES_ACTION: 'ACTION_REQUIRED' }
  return { requirement, coverageStatus: map[qualificationResult.status] ?? 'UNKNOWN', explanation: qualificationResult.explanation, evidence }
}

/**
 * REQUIREMENT_COVERAGE dimension (Phase 10 §7/§8). Formula (documented,
 * exact, per §8): coverage = weighted_supported_value / weighted_applicable_value,
 * where NOT_APPLICABLE requirements are excluded from BOTH numerator and
 * denominator, and every applicable requirement is weighted EQUALLY —
 * Phase 9's `tender_requirements` carries no per-requirement weight
 * column, so equal weighting is the documented fallback (never invented
 * per-requirement importance).
 */
export function scoreRequirementCoverage(input: ScoringInput, config: ScoringConfiguration): ScoredComponent {
  const weight = config.dimensionWeights.REQUIREMENT_COVERAGE
  const resultsByRequirement = new Map(input.qualification.results.map((r) => [r.requirementId, r]))
  const classified = input.requirements.map((r) => classifyRequirementCoverage(r, resultsByRequirement.get(r.id)))
  const applicable = classified.filter((c) => c.coverageStatus !== 'NOT_APPLICABLE')

  const counts: Record<RequirementCoverageStatus, number> = { SUPPORTED: 0, PARTIALLY_SUPPORTED: 0, UNKNOWN: 0, ACTION_REQUIRED: 0, FAILED: 0, NOT_APPLICABLE: classified.length - applicable.length }
  for (const c of applicable) counts[c.coverageStatus]++

  const serviceAlignment = computeServiceAlignment(input.serviceAlignment)
  const risks: ScoredComponent['risks'] = []
  const drivers: ScoredComponent['drivers'] = []
  const unknowns: string[] = []

  if (applicable.length === 0) {
    if (input.requirements.length === 0) unknowns.push('No requirements have been extracted for this tender yet.')
    return {
      dimension: 'REQUIREMENT_COVERAGE',
      status: 'UNKNOWN',
      score: null,
      weight,
      explanation: 'No applicable requirements to assess coverage against.',
      drivers,
      risks,
      unknowns,
      metadata: { counts },
    }
  }

  const numerator = applicable.reduce((sum, c) => sum + (config.requirementCoverageValueMap[c.coverageStatus] ?? 0), 0)
  const coverage = numerator / applicable.length
  const score = Math.round(coverage * 100 * 100) / 100

  const mandatoryFailed = applicable.filter((c) => c.coverageStatus === 'FAILED' && (c.requirement.mandatoryStatus === 'MANDATORY' || c.requirement.mandatoryStatus === 'CONDITIONALLY_MANDATORY'))
  for (const f of mandatoryFailed) {
    risks.push({ description: `Mandatory requirement failed: ${f.requirement.description}`, evidence: f.evidence })
  }
  if (counts.SUPPORTED > 0) {
    drivers.push({ description: `${counts.SUPPORTED} of ${applicable.length} applicable requirements are SUPPORTED by evidence.`, evidence: [{ kind: 'RULE', rule: 'REQUIREMENT_COVERAGE_FORMULA', description: null }] })
  }
  if (counts.UNKNOWN > 0) unknowns.push(`${counts.UNKNOWN} requirement(s) have unknown coverage — not treated as failures.`)
  if (counts.ACTION_REQUIRED > 0) risks.push({ description: `${counts.ACTION_REQUIRED} requirement(s) require action before they can be confirmed.`, evidence: [] })
  if (serviceAlignment.status === 'KNOWN' && serviceAlignment.missingServiceIds.length > 0) {
    risks.push({ description: `Service gap: ${serviceAlignment.explanation}`, evidence: serviceAlignment.evidence })
  } else if (serviceAlignment.status === 'UNKNOWN') {
    unknowns.push('Service alignment is unknown — tender services have not been classified.')
  }

  return {
    dimension: 'REQUIREMENT_COVERAGE',
    status: 'KNOWN',
    score,
    weight,
    explanation: `${counts.SUPPORTED} supported, ${counts.PARTIALLY_SUPPORTED} partial, ${counts.UNKNOWN} unknown, ${counts.ACTION_REQUIRED} action required, ${counts.FAILED} failed, ${counts.NOT_APPLICABLE} not applicable, out of ${classified.length} requirements. Coverage = ${(coverage * 100).toFixed(1)}% (equal-weighted, Phase 9 carries no per-requirement weight).`,
    drivers,
    risks,
    unknowns,
    metadata: { counts, serviceAlignment },
  }
}

export function findMandatoryRequirementFailureEvidence(input: ScoringInput): { evidence: ScoringEvidenceRef[]; descriptions: string[] } {
  const resultsByRequirement = new Map(input.qualification.results.map((r) => [r.requirementId, r]))
  const classified = input.requirements.map((r) => classifyRequirementCoverage(r, resultsByRequirement.get(r.id)))
  const failures = classified.filter((c) => c.coverageStatus === 'FAILED' && (c.requirement.mandatoryStatus === 'MANDATORY' || c.requirement.mandatoryStatus === 'CONDITIONALLY_MANDATORY'))
  return { evidence: failures.flatMap((f) => f.evidence), descriptions: failures.map((f) => f.requirement.description) }
}
