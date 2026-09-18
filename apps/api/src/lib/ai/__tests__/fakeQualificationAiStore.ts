import { randomUUID } from 'node:crypto'
import type { ChunkForContext, ResolvedChunk, RunPatch, RunRecord } from '../store.js'
import type { QualificationAiStore } from '../qualificationAiStore.js'

export interface FakeQualificationAiStoreSeed {
  tenderId: string
  chunks: ChunkForContext[]
  foreignChunks?: ChunkForContext[]
}

export interface FakeQualificationAiStoreState {
  runs: Array<{ id: string; tenderId: string; agencyId: string; status: string } & RunPatch>
  claims: Array<{ id: string; runId: string; claimType: string; claimKey: string; claimText: string; truth: string; confidence: number | null; evidenceResolved: boolean }>
  evidence: Array<{ id: string; claimId: string; documentId: string; documentVersionId: string | null; pageId: string | null; sectionId: string | null; chunkId: string | null; pageNumber: number | null; evidenceText: string }>
  interpretations: Array<{ id: string; runId: string; claimId: string | null; requirementText: string; category: string; ruleType: string | null; mandatoryStatus: string; interpretation: string; truth: string; confidence: number | null }>
}

export function createFakeQualificationAiStore(seed: FakeQualificationAiStoreSeed): { store: QualificationAiStore; state: FakeQualificationAiStoreState } {
  const state: FakeQualificationAiStoreState = { runs: [], claims: [], evidence: [], interpretations: [] }
  const allChunks = [...seed.chunks, ...(seed.foreignChunks ?? [])]

  const store: QualificationAiStore = {
    async listChunksForTender(tenderId, limit) {
      if (tenderId !== seed.tenderId) return []
      return seed.chunks.slice(0, limit)
    },
    async resolveChunkForTender(tenderId, chunkId): Promise<ResolvedChunk | null> {
      const chunk = allChunks.find((c) => c.id === chunkId)
      if (!chunk) return null
      if (tenderId !== seed.tenderId) return null
      if (seed.foreignChunks?.some((c) => c.id === chunkId)) return null
      return { chunkId: chunk.id, documentId: chunk.documentId, documentVersionId: chunk.documentVersionId, sectionId: chunk.sectionId, pageNumber: chunk.pageStart, text: chunk.text }
    },
    async findActiveInterpretationRun(tenderId, agencyId) {
      const active = state.runs.find((r) => r.tenderId === tenderId && r.agencyId === agencyId && ['QUEUED', 'RUNNING'].includes(r.status))
      return active ? { id: active.id, tenderId: active.tenderId, agencyId: active.agencyId, status: active.status } : null
    },
    async createInterpretationRun(input): Promise<RunRecord> {
      const id = randomUUID()
      state.runs.push({ id, tenderId: input.tenderId, agencyId: input.agencyId, status: 'QUEUED' })
      return { id, tenderId: input.tenderId, agencyId: input.agencyId, status: 'QUEUED' }
    },
    async updateRun(runId, patch) {
      const run = state.runs.find((r) => r.id === runId)
      if (!run) throw new Error('run not found')
      Object.assign(run, patch)
    },
    async createClaim(input) {
      const id = randomUUID()
      state.claims.push({ id, ...input })
      return { id }
    },
    async createEvidence(input) {
      const id = randomUUID()
      state.evidence.push({ id, ...input })
      return { id }
    },
    async createInterpretation(input) {
      const id = randomUUID()
      state.interpretations.push({ id, ...input })
      return { id }
    },
  }

  return { store, state }
}
