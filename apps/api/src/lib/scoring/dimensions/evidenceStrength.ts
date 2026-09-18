import type { ScoringConfiguration, ScoringInput, ScoredComponent } from '../types.js'
import type { EvidenceStrengthState } from '@tender-os/constants'

/**
 * EVIDENCE_STRENGTH dimension (Phase 10 §14/§15/§16). Equal-weighted
 * average over every agency evidence record the engine was given —
 * AI confidence is never consulted (only deterministic
 * VERIFIED/UNVERIFIED/UNKNOWN/MISSING/EXPIRED states from Phase 8's own
 * evidence tables). Recency (§16) is surfaced only as a qualitative
 * note when an explicit tender-stated recency requirement exists in the
 * evaluation criteria set; no expiry period is ever invented globally.
 */
export function scoreEvidenceStrength(input: ScoringInput, config: ScoringConfiguration): ScoredComponent {
  const weight = config.dimensionWeights.EVIDENCE_STRENGTH
  const records = input.agencyEvidence
  const drivers: ScoredComponent['drivers'] = []
  const risks: ScoredComponent['risks'] = []
  const unknowns: string[] = []

  if (records.length === 0) {
    return {
      dimension: 'EVIDENCE_STRENGTH',
      status: 'UNKNOWN',
      score: null,
      weight,
      explanation: 'No agency evidence records are available to assess.',
      drivers,
      risks,
      unknowns: ['No agency evidence has been recorded for this agency.'],
      metadata: {},
    }
  }

  const counts: Record<EvidenceStrengthState, number> = { VERIFIED: 0, UNVERIFIED: 0, UNKNOWN: 0, MISSING: 0, EXPIRED: 0 }
  for (const r of records) counts[r.state]++

  const numerator = records.reduce((sum, r) => sum + config.evidenceStateValueMap[r.state], 0)
  const score = Math.round((numerator / records.length) * 100 * 100) / 100

  if (counts.VERIFIED > 0) {
    drivers.push({
      description: `${counts.VERIFIED} verified agency evidence record(s) (case studies, certificates, references, or documents).`,
      evidence: records.filter((r) => r.state === 'VERIFIED').map((r) => r.evidenceRef),
    })
  }
  if (counts.EXPIRED > 0) risks.push({ description: `${counts.EXPIRED} agency evidence record(s) have expired.`, evidence: records.filter((r) => r.state === 'EXPIRED').map((r) => r.evidenceRef) })
  if (counts.MISSING > 0) risks.push({ description: `${counts.MISSING} expected agency evidence record(s) are missing.`, evidence: records.filter((r) => r.state === 'MISSING').map((r) => r.evidenceRef) })
  if (counts.UNKNOWN > 0) unknowns.push(`${counts.UNKNOWN} agency evidence record(s) have unknown verification status.`)

  return {
    dimension: 'EVIDENCE_STRENGTH',
    status: 'KNOWN',
    score,
    weight,
    explanation: `${counts.VERIFIED} verified, ${counts.UNVERIFIED} unverified, ${counts.UNKNOWN} unknown, ${counts.MISSING} missing, ${counts.EXPIRED} expired, out of ${records.length} evidence records (equal-weighted).`,
    drivers,
    risks,
    unknowns,
    metadata: { counts },
  }
}
