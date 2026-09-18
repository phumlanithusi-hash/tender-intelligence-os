import type { ChunkForContext, ResolvedChunk, RunPatch, RunRecord } from './store.js'

/**
 * Port for everything the QualificationInterpretationAgent's execution
 * layer needs (Phase 8 §26/§27) — a sibling to `AiStore`, not a
 * modification of it (the classification store/routes are untouched
 * per the binding constraint carried forward from Phase 7). Reuses the
 * SAME underlying `tender_ai_runs`/`tender_ai_claims`/`tender_ai_evidence`
 * tables (agent_name = 'QualificationInterpretationAgent'), so the
 * idempotency guard here is scoped to that agent specifically —
 * running a classification and a qualification-interpretation pass on
 * the same tender concurrently is allowed; running two qualification
 * interpretation passes concurrently is not.
 */
export interface QualificationAiStore {
  listChunksForTender(tenderId: string, limit: number): Promise<ChunkForContext[]>
  resolveChunkForTender(tenderId: string, chunkId: string): Promise<ResolvedChunk | null>

  findActiveInterpretationRun(tenderId: string, agencyId: string): Promise<RunRecord | null>
  createInterpretationRun(input: { tenderId: string; agencyId: string; model: string; promptVersion: string; inputRefs: Record<string, unknown>; triggeredBy: string | null }): Promise<RunRecord>
  updateRun(runId: string, patch: RunPatch): Promise<void>

  createClaim(input: {
    runId: string
    claimType: 'QUALIFICATION_INTERPRETATION'
    claimKey: string
    claimText: string
    truth: string
    confidence: number | null
    evidenceResolved: boolean
  }): Promise<{ id: string }>

  createEvidence(input: {
    claimId: string
    documentId: string
    documentVersionId: string | null
    pageId: string | null
    sectionId: string | null
    chunkId: string | null
    pageNumber: number | null
    evidenceText: string
  }): Promise<{ id: string }>

  createInterpretation(input: {
    runId: string
    claimId: string | null
    requirementText: string
    category: string
    ruleType: string | null
    mandatoryStatus: string
    interpretation: string
    truth: string
    confidence: number | null
  }): Promise<{ id: string }>
}
