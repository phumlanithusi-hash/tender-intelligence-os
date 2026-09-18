import type { EvidenceEmbeddingEntityType, EvidenceEmbeddingStatus, EvidenceMatchStatus } from '@tender-os/constants'

/**
 * Phase 13 — the pure-function contract, mirroring
 * lib/bidStrategy/types.ts and lib/bidDecision/types.ts exactly.
 * Nothing in rankEvidenceCandidates.ts, verifyEvidenceCandidate.ts,
 * gaps.ts, contentHash.ts or staleness.ts performs I/O of any kind (no
 * Supabase, no OpenAI, no network) — only supabaseEvidenceMatchingStore.ts
 * and embedAgencyEvidence.ts (an explicit I/O seam, not a pure
 * function) touch the database or the OpenAI API.
 */

// ---------------------------------------------------------------
// Retrieval & ranking (Phase 13 §B).
// ---------------------------------------------------------------

export interface EvidenceNeedForRanking {
  id: string
  description: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  minimumCount: number
  /** Optional hint restricting which embedded entity types are structurally eligible for this need. Null/empty means "any type". Never AI-inferred — only ever set from deterministic Phase 12 data (e.g. a requirement category), when set at all. */
  allowedEntityTypes: EvidenceEmbeddingEntityType[] | null
}

/**
 * One pre-fetched candidate embedding + its metadata, exactly as the
 * store's vector query + entity lookups produced it. rankEvidenceCandidates
 * never performs the vector query itself — retrieval (I/O, cosine
 * similarity via pgvector) and ranking (pure, deterministic weighting)
 * are cleanly separated (Phase 13 §B binding constraint).
 */
export interface CandidateEmbeddingResult {
  embeddingId: string
  entityType: EvidenceEmbeddingEntityType
  entityId: string
  agencyId: string
  /** Cosine similarity in [0,1], as already computed by the store's `match_agency_evidence_embeddings` query (`1 - cosine_distance`). */
  similarity: number
  embeddingStatus: EvidenceEmbeddingStatus
  embeddedAt: string | null
  contentHash: string | null
  /** Number of times this exact entity has previously been APPROVED (across any bid project for this agency) — a real historical signal, never fabricated. */
  priorApprovalCount: number
  /** Number of times this exact entity has previously been REJECTED. */
  priorRejectionCount: number
}

export interface RankingConfig {
  nowIso: string
  weights: {
    semanticSimilarity: number
    evidenceTypeMatch: number
    recency: number
    priorApprovalHistory: number
  }
  minSimilarityThreshold: number
  maxCandidates: number
  recencyHalfLifeDays: number
}

export interface RankedCandidateFactors {
  semanticSimilarity: number
  typeMatch: number
  recency: number
  priorApprovalHistory: number
}

export interface RankedCandidate {
  embeddingId: string
  entityType: EvidenceEmbeddingEntityType
  entityId: string
  score: number
  factors: RankedCandidateFactors
  rationale: string
}

// ---------------------------------------------------------------
// Deterministic verification (Phase 13 §C).
// ---------------------------------------------------------------

export interface VerificationCandidateInput {
  entityType: EvidenceEmbeddingEntityType
  entityId: string
  candidateAgencyId: string
  /** The Phase 2/8 `evidence_status` of the underlying agency evidence row (VERIFIED/INFERRED/UNVERIFIED/UNKNOWN) — consumed, never recalculated. */
  evidenceStatus: 'VERIFIED' | 'INFERRED' | 'UNVERIFIED' | 'UNKNOWN'
  /** Null when the evidence type has no expiry concept (e.g. a case study). */
  expiryDate: string | null
  /** False when the underlying source document/certificate has been superseded/deactivated (Phase 2/6 lifecycle) — a structural disqualifier independent of semantic similarity. */
  sourceActive: boolean
  embeddingStatus: EvidenceEmbeddingStatus
}

export interface VerificationEvidenceNeedInput {
  id: string
  requiredAgencyId: string
  allowedEntityTypes: EvidenceEmbeddingEntityType[] | null
}

export interface VerificationRules {
  nowIso: string
}

export interface VerificationCheck {
  code: string
  passed: boolean
  message: string
}

/**
 * AI/semantic scoring can never itself decide, verify, or approve
 * (binding architectural constraint carried through every phase).
 * `resultingStatus` therefore caps out at 'VERIFIED' — this function
 * itself never returns 'APPROVED'/'REJECTED', those are exclusively
 * human-actioned end states applied by the store layer after a real
 * human decision.
 */
export interface VerificationResult {
  passed: boolean
  checks: VerificationCheck[]
  resultingStatus: Extract<EvidenceMatchStatus, 'CANDIDATE' | 'REQUIRES_VERIFICATION' | 'VERIFIED'>
}

// ---------------------------------------------------------------
// Evidence gap feedback loop (Phase 13 §E).
// ---------------------------------------------------------------

export interface EvidenceNeedGapInput {
  id: string
  minimumCount: number
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  currentStatus: 'OPEN' | 'PARTIALLY_SATISFIED' | 'SATISFIED' | 'BLOCKED' | 'WAIVED'
}

export interface EvidenceGapComputationInput {
  need: EvidenceNeedGapInput
  approvedClaimCount: number
  hasOnlyRejectedOrNoCandidates: boolean
}

export interface EvidenceGapResult {
  evidenceNeedId: string
  /** The status Phase 12's `bid_evidence_needs.status` should be updated to — this phase annotates that existing column, it never forks a parallel model (Phase 13 §E binding constraint). */
  recommendedStatus: 'OPEN' | 'PARTIALLY_SATISFIED' | 'SATISFIED' | 'BLOCKED' | 'WAIVED'
  isGap: boolean
  reason: string
}
