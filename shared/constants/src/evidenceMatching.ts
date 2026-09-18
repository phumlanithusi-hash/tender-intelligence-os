/**
 * Phase 13 — Evidence Matching & Portfolio Intelligence. Mirrors
 * bidStrategy.ts/bidDecision.ts exactly. Roles reuse the existing RBAC
 * roles unchanged (Phase 13 §D): ADMIN/BID_MANAGER may approve or
 * reject a candidate match; RESEARCHER may view and trigger candidate
 * generation ("suggest") but never decide.
 */
export const EVIDENCE_MATCH_VIEW_ROLES = ['ADMIN', 'BID_MANAGER', 'RESEARCHER'] as const
export const EVIDENCE_MATCH_GENERATE_ROLES = ['ADMIN', 'BID_MANAGER', 'RESEARCHER'] as const
export const EVIDENCE_MATCH_DECIDE_ROLES = ['ADMIN', 'BID_MANAGER'] as const

export const EVIDENCE_EMBEDDING_STATUS = ['NOT_EMBEDDED', 'QUEUED', 'PROCESSING', 'READY', 'STALE', 'FAILED'] as const
export type EvidenceEmbeddingStatus = (typeof EVIDENCE_EMBEDDING_STATUS)[number]

export const EVIDENCE_EMBEDDING_ENTITY_TYPE = ['AGENCY_DOCUMENT', 'AGENCY_CERTIFICATE', 'AGENCY_CASE_STUDY', 'AGENCY_REFERENCE', 'AGENCY_FINANCIAL_RECORD'] as const
export type EvidenceEmbeddingEntityType = (typeof EVIDENCE_EMBEDDING_ENTITY_TYPE)[number]

/**
 * Phase 13 §C (binding constraint): AI/semantic scoring can only ever
 * produce a status up to and including VERIFIED. APPROVED/REJECTED are
 * exclusively human-actioned; SUPERSEDED marks a decided or re-run row
 * that a fresher evaluation has displaced.
 */
export const EVIDENCE_MATCH_STATUS = ['CANDIDATE', 'REQUIRES_VERIFICATION', 'VERIFIED', 'APPROVED', 'REJECTED', 'SUPERSEDED'] as const
export type EvidenceMatchStatus = (typeof EVIDENCE_MATCH_STATUS)[number]

/** Statuses a system (embedding job + ranking + verification) may ever write. A human decision is the only path to the remainder. */
export const EVIDENCE_MATCH_SYSTEM_STATUSES: EvidenceMatchStatus[] = ['CANDIDATE', 'REQUIRES_VERIFICATION', 'VERIFIED']
export const EVIDENCE_MATCH_HUMAN_DECISION_STATUSES: EvidenceMatchStatus[] = ['APPROVED', 'REJECTED']

/** Phase 13 §B — retrieval/ranking weighting, documented and testable (rankEvidenceCandidates.ts). Sums to 1 by construction; see docs/EVIDENCE-MATCHING.md §2 for rationale. */
export const EVIDENCE_RANKING_WEIGHTS = {
  semanticSimilarity: 0.45,
  evidenceTypeMatch: 0.2,
  recency: 0.15,
  priorApprovalHistory: 0.2,
} as const

/** Minimum cosine similarity for a candidate to be retrieved at all (Phase 13 §B) — kept as a single documented constant, mirroring Phase 12's BID_MILESTONE_AT_RISK_WINDOW_DAYS discipline. */
export const EVIDENCE_MIN_SIMILARITY_THRESHOLD = 0.15

/** How many ranked candidates a single generation run returns per evidence need (Phase 13 §B). */
export const EVIDENCE_MAX_CANDIDATES_PER_NEED = 5

/** A READY embedding older than this is treated as a recency-penalised (not automatically STALE) signal in ranking (Phase 13 §B "recency" factor). */
export const EVIDENCE_RECENCY_HALF_LIFE_DAYS = 365
