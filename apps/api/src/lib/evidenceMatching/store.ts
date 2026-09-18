import type { EvidenceEmbeddingEntityType, EvidenceMatchStatus } from '@tender-os/constants'

/**
 * Port for everything the Phase 13 evidence-matching orchestration
 * layer needs (mirrors lib/bidDecision/store.ts /
 * lib/bidStrategy/supabaseBidStrategyStore.ts exactly). Real I/O
 * (Supabase reads/writes, the OpenAI embeddings call) lives entirely
 * behind this interface; rankEvidenceCandidates()/verifyEvidenceCandidate()
 * remain pure and untestable-against-a-database on purpose.
 */
export interface EvidenceMatchGenerationResult {
  evidenceNeedId: string
  candidatesCreated: number
  matchIds: string[]
}

export interface BidEvidenceMatchRecord {
  id: string
  bidProjectId: string
  agencyId: string
  evidenceNeedId: string
  candidateEntityType: EvidenceEmbeddingEntityType
  status: EvidenceMatchStatus
  semanticScore: number | null
  rankFactors: Record<string, unknown>
  rationale: string | null
  verificationResult: Record<string, unknown>
  verificationPassed: boolean | null
  decidedBy: string | null
  decidedAt: string | null
  rejectionReason: string | null
  isCurrent: boolean
  isStale: boolean
  createdAt: string
  updatedAt: string
  entityId: string
}

export interface EvidenceMatchingStore {
  generateCandidatesForProject(bidProjectId: string, agencyId: string, evidenceNeedId: string | null, actorId: string | null): Promise<EvidenceMatchGenerationResult[]>
  listMatchesForProject(bidProjectId: string, agencyId: string): Promise<BidEvidenceMatchRecord[]>
  getMatch(matchId: string): Promise<BidEvidenceMatchRecord | null>
  approveMatch(matchId: string, agencyId: string, actorId: string): Promise<BidEvidenceMatchRecord>
  rejectMatch(matchId: string, agencyId: string, actorId: string, reason: string): Promise<BidEvidenceMatchRecord>
  listClaimsForProject(bidProjectId: string, agencyId: string): Promise<unknown[]>
  computeGapsForProject(bidProjectId: string, agencyId: string): Promise<unknown[]>
  backfillEmbeddingsForAgency(agencyId: string): Promise<{ processed: number; ready: number; failed: number; skipped: number }>
}
