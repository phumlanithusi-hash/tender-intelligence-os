import type { CandidateEmbeddingResult, EvidenceNeedForRanking, RankedCandidate, RankingConfig } from './types.js'

/**
 * Phase 13 §B — PURE retrieval-RESULT ranking. Takes an evidence need
 * plus a set of already-fetched candidate embeddings/metadata (the
 * store's job — see supabaseEvidenceMatchingStore.ts's
 * `match_agency_evidence_embeddings` RPC call) and returns a
 * deterministic, explainable, ranked list. Never performs the vector
 * query itself, never touches Supabase/OpenAI/the network, and never
 * decides a match's final status — the highest-ranked candidate is
 * still, at most, a CANDIDATE until verifyEvidenceCandidate() and a
 * human act on it.
 *
 * Deterministic tie-breaking: score desc, then similarity desc, then
 * entityId asc — the same two runs over the same inputs always
 * produce the same ordering (verified by repeat-run tests).
 */
export function rankEvidenceCandidates(evidenceNeed: EvidenceNeedForRanking, candidates: CandidateEmbeddingResult[], config: RankingConfig): RankedCandidate[] {
  const ranked: RankedCandidate[] = []

  for (const candidate of candidates) {
    if (candidate.similarity < config.minSimilarityThreshold) continue

    const typeMatch = computeTypeMatch(evidenceNeed, candidate)
    const recency = computeRecency(candidate.embeddedAt, config.nowIso, config.recencyHalfLifeDays)
    const priorApprovalHistory = computePriorApprovalHistory(candidate)

    const factors = {
      semanticSimilarity: candidate.similarity,
      typeMatch,
      recency,
      priorApprovalHistory,
    }

    const score = config.weights.semanticSimilarity * factors.semanticSimilarity + config.weights.evidenceTypeMatch * factors.typeMatch + config.weights.recency * factors.recency + config.weights.priorApprovalHistory * factors.priorApprovalHistory

    ranked.push({
      embeddingId: candidate.embeddingId,
      entityType: candidate.entityType,
      entityId: candidate.entityId,
      score: round(score),
      factors: { semanticSimilarity: round(factors.semanticSimilarity), typeMatch: round(factors.typeMatch), recency: round(factors.recency), priorApprovalHistory: round(factors.priorApprovalHistory) },
      rationale: buildRationale(candidate, factors),
    })
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.factors.semanticSimilarity !== a.factors.semanticSimilarity) return b.factors.semanticSimilarity - a.factors.semanticSimilarity
    return a.entityId.localeCompare(b.entityId)
  })

  return ranked.slice(0, Math.max(0, config.maxCandidates))
}

function computeTypeMatch(need: EvidenceNeedForRanking, candidate: CandidateEmbeddingResult): number {
  if (!need.allowedEntityTypes || need.allowedEntityTypes.length === 0) return 1
  return need.allowedEntityTypes.includes(candidate.entityType) ? 1 : 0
}

function computeRecency(embeddedAtIso: string | null, nowIso: string, halfLifeDays: number): number {
  if (!embeddedAtIso) return 0
  const embeddedAt = new Date(embeddedAtIso).getTime()
  const now = new Date(nowIso).getTime()
  if (Number.isNaN(embeddedAt) || Number.isNaN(now) || halfLifeDays <= 0) return 0
  const ageDays = Math.max(0, (now - embeddedAt) / (1000 * 60 * 60 * 24))
  return Math.pow(0.5, ageDays / halfLifeDays)
}

/**
 * A real historical signal only — never fabricated. No approval or
 * rejection history at all is treated as neutral (0.5), never
 * penalised as if it had been rejected before.
 */
function computePriorApprovalHistory(candidate: CandidateEmbeddingResult): number {
  const { priorApprovalCount: a, priorRejectionCount: r } = candidate
  if (a === 0 && r === 0) return 0.5
  return a / (a + r)
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000
}

function buildRationale(candidate: CandidateEmbeddingResult, factors: { semanticSimilarity: number; typeMatch: number; recency: number; priorApprovalHistory: number }): string {
  const parts = [`semantic similarity ${(factors.semanticSimilarity * 100).toFixed(1)}%`]
  parts.push(factors.typeMatch === 1 ? 'evidence type matches the need' : 'evidence type does not match the need’s allowed types')
  parts.push(`recency factor ${(factors.recency * 100).toFixed(0)}%`)
  if (candidate.priorApprovalCount > 0 || candidate.priorRejectionCount > 0) {
    parts.push(`prior history: ${candidate.priorApprovalCount} approval(s), ${candidate.priorRejectionCount} rejection(s)`)
  } else {
    parts.push('no prior approval/rejection history')
  }
  return parts.join('; ')
}
