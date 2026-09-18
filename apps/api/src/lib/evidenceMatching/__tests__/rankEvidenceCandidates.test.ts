import { describe, expect, it } from 'vitest'
import { EVIDENCE_MAX_CANDIDATES_PER_NEED, EVIDENCE_MIN_SIMILARITY_THRESHOLD, EVIDENCE_RANKING_WEIGHTS, EVIDENCE_RECENCY_HALF_LIFE_DAYS } from '@tender-os/constants'
import { rankEvidenceCandidates } from '../rankEvidenceCandidates.js'
import type { CandidateEmbeddingResult, EvidenceNeedForRanking, RankingConfig } from '../types.js'

const NOW = '2026-09-11T00:00:00.000Z'

const config: RankingConfig = {
  nowIso: NOW,
  weights: EVIDENCE_RANKING_WEIGHTS,
  minSimilarityThreshold: EVIDENCE_MIN_SIMILARITY_THRESHOLD,
  maxCandidates: EVIDENCE_MAX_CANDIDATES_PER_NEED,
  recencyHalfLifeDays: EVIDENCE_RECENCY_HALF_LIFE_DAYS,
}

const need: EvidenceNeedForRanking = { id: 'need-1', description: 'Proof of graphic design case studies', severity: 'HIGH', minimumCount: 1, allowedEntityTypes: null }

function candidate(overrides: Partial<CandidateEmbeddingResult> = {}): CandidateEmbeddingResult {
  return {
    embeddingId: 'emb-1',
    entityType: 'AGENCY_CASE_STUDY',
    entityId: 'entity-1',
    agencyId: 'agency-1',
    similarity: 0.5,
    embeddingStatus: 'READY',
    embeddedAt: NOW,
    contentHash: 'hash',
    priorApprovalCount: 0,
    priorRejectionCount: 0,
    ...overrides,
  }
}

describe('rankEvidenceCandidates (Phase 13 §B — pure retrieval ranking)', () => {
  it('is pure: identical inputs always produce identical output (repeat-run determinism)', () => {
    const candidates = [candidate({ entityId: 'a', similarity: 0.6 }), candidate({ entityId: 'b', similarity: 0.4 })]
    const run1 = rankEvidenceCandidates(need, candidates, config)
    const run2 = rankEvidenceCandidates(need, candidates, config)
    expect(run1).toEqual(run2)
  })

  it('filters out candidates below the minimum similarity threshold', () => {
    const candidates = [candidate({ entityId: 'below', similarity: 0.01 }), candidate({ entityId: 'above', similarity: 0.5 })]
    const ranked = rankEvidenceCandidates(need, candidates, config)
    expect(ranked.map((r) => r.entityId)).toEqual(['above'])
  })

  it('ranks a higher-similarity candidate above a lower one, all else equal', () => {
    const candidates = [candidate({ entityId: 'low', similarity: 0.3 }), candidate({ entityId: 'high', similarity: 0.9 })]
    const ranked = rankEvidenceCandidates(need, candidates, config)
    expect(ranked[0]!.entityId).toBe('high')
  })

  it('a type mismatch (when the need restricts entity types) lowers the score relative to a type match', () => {
    const restrictedNeed: EvidenceNeedForRanking = { ...need, allowedEntityTypes: ['AGENCY_CERTIFICATE'] }
    const candidates = [candidate({ entityId: 'mismatch', entityType: 'AGENCY_CASE_STUDY', similarity: 0.7 }), candidate({ entityId: 'match', entityType: 'AGENCY_CERTIFICATE', similarity: 0.7 })]
    const ranked = rankEvidenceCandidates(restrictedNeed, candidates, config)
    const mismatch = ranked.find((r) => r.entityId === 'mismatch')!
    const match = ranked.find((r) => r.entityId === 'match')!
    expect(match.score).toBeGreaterThan(mismatch.score)
    expect(mismatch.factors.typeMatch).toBe(0)
    expect(match.factors.typeMatch).toBe(1)
  })

  it('a null allowedEntityTypes on the need means every type is eligible (factor = 1)', () => {
    const ranked = rankEvidenceCandidates(need, [candidate({ entityType: 'AGENCY_REFERENCE' })], config)
    expect(ranked[0]!.factors.typeMatch).toBe(1)
  })

  it('a more recently embedded candidate scores higher on recency than a stale-old one', () => {
    const recent = candidate({ entityId: 'recent', embeddedAt: NOW, similarity: 0.5 })
    const old = candidate({ entityId: 'old', embeddedAt: '2020-01-01T00:00:00.000Z', similarity: 0.5 })
    const ranked = rankEvidenceCandidates(need, [recent, old], config)
    const recentFactor = ranked.find((r) => r.entityId === 'recent')!.factors.recency
    const oldFactor = ranked.find((r) => r.entityId === 'old')!.factors.recency
    expect(recentFactor).toBeGreaterThan(oldFactor)
  })

  it('a null embeddedAt scores zero recency, never a fabricated freshness', () => {
    const ranked = rankEvidenceCandidates(need, [candidate({ embeddedAt: null })], config)
    expect(ranked[0]!.factors.recency).toBe(0)
  })

  it('no prior approval/rejection history is treated as neutral (0.5), never penalised as if rejected', () => {
    const ranked = rankEvidenceCandidates(need, [candidate({ priorApprovalCount: 0, priorRejectionCount: 0 })], config)
    expect(ranked[0]!.factors.priorApprovalHistory).toBe(0.5)
  })

  it('a strong prior-approval history scores higher than a strong prior-rejection history', () => {
    const approved = candidate({ entityId: 'approved-before', priorApprovalCount: 5, priorRejectionCount: 0, similarity: 0.5 })
    const rejected = candidate({ entityId: 'rejected-before', priorApprovalCount: 0, priorRejectionCount: 5, similarity: 0.5 })
    const ranked = rankEvidenceCandidates(need, [approved, rejected], config)
    const approvedFactor = ranked.find((r) => r.entityId === 'approved-before')!.factors.priorApprovalHistory
    const rejectedFactor = ranked.find((r) => r.entityId === 'rejected-before')!.factors.priorApprovalHistory
    expect(approvedFactor).toBeGreaterThan(rejectedFactor)
  })

  it('deterministically tie-breaks equal scores by similarity, then by entityId', () => {
    const a = candidate({ entityId: 'zzz', similarity: 0.5, embeddedAt: null, priorApprovalCount: 0, priorRejectionCount: 0 })
    const b = candidate({ entityId: 'aaa', similarity: 0.5, embeddedAt: null, priorApprovalCount: 0, priorRejectionCount: 0 })
    const ranked = rankEvidenceCandidates(need, [a, b], config)
    expect(ranked.map((r) => r.entityId)).toEqual(['aaa', 'zzz'])
  })

  it('truncates to maxCandidates', () => {
    const many = Array.from({ length: 10 }, (_, i) => candidate({ entityId: `c${i}`, similarity: 0.5 + i / 100 }))
    const ranked = rankEvidenceCandidates(need, many, { ...config, maxCandidates: 3 })
    expect(ranked).toHaveLength(3)
  })

  it('never returns a score outside [0,1] for well-formed inputs', () => {
    const ranked = rankEvidenceCandidates(need, [candidate({ similarity: 1, priorApprovalCount: 10, priorRejectionCount: 0 })], config)
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(0)
    expect(ranked[0]!.score).toBeLessThanOrEqual(1)
  })

  it('produces a human-readable rationale referencing the real inputs, never an opaque score alone', () => {
    const ranked = rankEvidenceCandidates(need, [candidate({ similarity: 0.73 })], config)
    expect(ranked[0]!.rationale).toContain('73.0%')
  })
})
