import type { ScoringConfiguration, QualificationInput, ScoredComponent, ScoringEvidenceRef } from '../types.js'

/**
 * QUALIFICATION dimension (Phase 10 §6). Pure lookup against the
 * configured status->score map — never re-derives eligibility itself
 * (that remains Phase 8's `computeOverallStatus`, consumed as-is here).
 * No qualification run at all is UNKNOWN, not a silent 0 or 100.
 */
export function scoreQualification(input: QualificationInput, config: ScoringConfiguration): ScoredComponent {
  const weight = config.dimensionWeights.QUALIFICATION

  if (!input.overallStatus) {
    return {
      dimension: 'QUALIFICATION',
      status: 'UNKNOWN',
      score: null,
      weight,
      explanation: 'No qualification evaluation has been run for this tender yet.',
      drivers: [],
      risks: [{ description: 'Qualification has not yet been evaluated — run qualification before scoring for a complete picture.', evidence: [{ kind: 'RULE', rule: 'NO_QUALIFICATION_RUN', description: null }] }],
      unknowns: ['Qualification status is unknown — no qualification run exists.'],
      metadata: {},
    }
  }

  const score = config.qualificationStatusScoreMap[input.overallStatus]
  const mandatoryFailures = input.results.filter((r) => r.mandatory && r.status === 'FAIL')
  const drivers: ScoredComponent['drivers'] = []
  const risks: ScoredComponent['risks'] = []
  const unknowns: string[] = []

  if (input.overallStatus === 'ELIGIBLE') {
    drivers.push({ description: 'All mandatory qualification requirements currently satisfied.', evidence: [{ kind: 'RULE', rule: 'QUALIFICATION_ELIGIBLE', description: null }] })
  }
  if (mandatoryFailures.length > 0) {
    for (const f of mandatoryFailures) {
      risks.push({
        description: `Mandatory qualification requirement failed: ${f.explanation}`,
        evidence: [...f.tenderEvidence, ...f.agencyEvidence],
      })
    }
  }
  const unknownMandatory = input.results.filter((r) => r.mandatory && r.status === 'UNKNOWN')
  if (unknownMandatory.length > 0) {
    unknowns.push(`${unknownMandatory.length} mandatory qualification requirement(s) could not be resolved (UNKNOWN).`)
  }

  return {
    dimension: 'QUALIFICATION',
    status: 'KNOWN',
    score,
    weight,
    explanation: `Qualification status is ${input.overallStatus} (mapped to ${score}/100 per the current scoring configuration).`,
    drivers,
    risks,
    unknowns,
    metadata: { overallStatus: input.overallStatus, qualificationRunId: input.runId },
  }
}

export function findMandatoryQualificationFailureEvidence(input: QualificationInput): ScoringEvidenceRef[] {
  return input.results.filter((r) => r.mandatory && r.status === 'FAIL').flatMap((r) => [...r.tenderEvidence, ...r.agencyEvidence])
}
