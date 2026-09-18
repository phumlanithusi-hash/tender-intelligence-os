import { randomUUID } from 'node:crypto'
import type { ChunkForContext, ResolvedChunk } from '../store.js'
import type { RequirementEvaluationStore, RunPatchWithQuality, EvidenceLinkInput } from '../requirementEvaluationStore.js'

export interface FakeRequirementEvaluationStoreSeed {
  tenderId: string
  chunks: ChunkForContext[]
  foreignChunks?: ChunkForContext[]
  /** Pre-existing extracted requirements/criteria, to exercise versioning/supersede. */
  previousRequirements?: Array<{ id: string; category: string; title: string; version: number }>
  previousCriteria?: Array<{ id: string; criterionType: string; name: string; version: number }>
}

export interface FakeRequirementEvaluationStoreState {
  runs: Array<{ id: string; tenderId: string; agencyId: string | null; status: string } & RunPatchWithQuality>
  claims: Array<{ id: string; runId: string; claimType: string; claimKey: string; claimText: string; truth: string; confidence: number | null; evidenceResolved: boolean }>
  evidence: Array<{ id: string; claimId: string } & EvidenceLinkInput>
  requirements: Array<{ id: string; parentRequirementId: string | null; supersededBy: string | null } & Record<string, unknown>>
  requirementEvidence: Array<{ requirementId: string } & EvidenceLinkInput>
  criteria: Array<{ id: string; parentCriterionId: string | null; supersededBy: string | null } & Record<string, unknown>>
  criterionEvidence: Array<{ criterionId: string } & EvidenceLinkInput>
  gates: Array<{ id: string } & Record<string, unknown>>
  gateEvidence: Array<{ gateId: string } & EvidenceLinkInput>
  requirementConflicts: Array<Record<string, unknown>>
  evaluationConflicts: Array<Record<string, unknown>>
}

export function createFakeRequirementEvaluationStore(seed: FakeRequirementEvaluationStoreSeed): { store: RequirementEvaluationStore; state: FakeRequirementEvaluationStoreState } {
  const state: FakeRequirementEvaluationStoreState = {
    runs: [],
    claims: [],
    evidence: [],
    requirements: [],
    requirementEvidence: [],
    criteria: [],
    criterionEvidence: [],
    gates: [],
    gateEvidence: [],
    requirementConflicts: [],
    evaluationConflicts: [],
  }
  const allChunks = [...seed.chunks, ...(seed.foreignChunks ?? [])]

  const store: RequirementEvaluationStore = {
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
    async findActiveExtractionRun(tenderId) {
      const active = state.runs.find((r) => r.tenderId === tenderId && ['QUEUED', 'RUNNING'].includes(r.status))
      return active ? { id: active.id, tenderId: active.tenderId, agencyId: active.agencyId, status: active.status } : null
    },
    async createExtractionRun(input) {
      const id = randomUUID()
      state.runs.push({ id, tenderId: input.tenderId, agencyId: null, status: 'QUEUED' })
      return { id, tenderId: input.tenderId, agencyId: null, status: 'QUEUED' }
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
    async listCurrentExtractedRequirements() {
      return seed.previousRequirements ?? []
    },
    async createRequirement(input) {
      const id = randomUUID()
      state.requirements.push({ ...input, id, supersededBy: null })
      return { id }
    },
    async supersedeRequirement(previousId) {
      const existing = state.requirements.find((r) => r.id === previousId)
      if (existing) existing.supersededBy = 'external' // previous rows live in seed, not state — this exercises the call happened
    },
    async linkRequirementEvidence(requirementId, links) {
      for (const l of links) state.requirementEvidence.push({ requirementId, ...l })
    },
    async setRequirementParent(requirementId, parentRequirementId) {
      const r = state.requirements.find((x) => x.id === requirementId)
      if (r) r.parentRequirementId = parentRequirementId
    },
    async listCurrentExtractedCriteria() {
      return seed.previousCriteria ?? []
    },
    async createCriterion(input) {
      const id = randomUUID()
      state.criteria.push({ ...input, id, supersededBy: null })
      return { id }
    },
    async supersedeCriterion(previousId) {
      const existing = state.criteria.find((c) => c.id === previousId)
      if (existing) existing.supersededBy = 'external'
    },
    async linkCriterionEvidence(criterionId, links) {
      for (const l of links) state.criterionEvidence.push({ criterionId, ...l })
    },
    async setCriterionParent(criterionId, parentCriterionId) {
      const c = state.criteria.find((x) => x.id === criterionId)
      if (c) c.parentCriterionId = parentCriterionId
    },
    async createGate(input) {
      const id = randomUUID()
      state.gates.push({ id, ...input })
      return { id }
    },
    async linkGateEvidence(gateId, links) {
      for (const l of links) state.gateEvidence.push({ gateId, ...l })
    },
    async createRequirementConflict(input) {
      const id = randomUUID()
      state.requirementConflicts.push({ id, ...input })
      return { id }
    },
    async createEvaluationConflict(input) {
      const id = randomUUID()
      state.evaluationConflicts.push({ id, ...input })
      return { id }
    },
  }

  return { store, state }
}
