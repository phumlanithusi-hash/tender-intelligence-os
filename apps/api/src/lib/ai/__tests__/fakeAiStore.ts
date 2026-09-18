import { randomUUID } from 'node:crypto'
import type {
  AgencyServiceOption,
  AiStore,
  ChunkForContext,
  ClassificationInput,
  CreateRunInput,
  ResolvedChunk,
  RunPatch,
  RunRecord,
  TenderForClassification,
} from '../store.js'

export interface FakeAiStoreSeed {
  tender: TenderForClassification
  services: AgencyServiceOption[]
  chunks: ChunkForContext[]
  /** chunks belonging to a DIFFERENT tender, to test cross-tender rejection. */
  foreignChunks?: ChunkForContext[]
}

export interface FakeAiStoreState {
  runs: Array<CreateRunInput & { id: string; status: string } & RunPatch>
  classifications: Array<{ id: string } & ClassificationInput>
  deliverables: Array<{ id: string; classificationId: string; text: string; truth: string; confidence: number | null }>
  requirements: Array<{ id: string; classificationId: string; kind: string; text: string; truth: string; confidence: number | null }>
  claims: Array<{ id: string; runId: string; classificationId: string | null; claimType: string; claimKey: string; claimText: string; truth: string; confidence: number | null; evidenceResolved: boolean }>
  evidence: Array<{ id: string; claimId: string; documentId: string; documentVersionId: string | null; pageId: string | null; sectionId: string | null; chunkId: string | null; pageNumber: number | null; evidenceText: string }>
  conflicts: Array<{ id: string; runId: string; classificationId: string | null; tenderId: string; field: string; dbValue: string | null; documentValue: string; claimId: string | null }>
}

/** In-memory `AiStore` fake for unit tests — no database required. */
export function createFakeAiStore(seed: FakeAiStoreSeed): { store: AiStore; state: FakeAiStoreState } {
  const state: FakeAiStoreState = {
    runs: [],
    classifications: [],
    deliverables: [],
    requirements: [],
    claims: [],
    evidence: [],
    conflicts: [],
  }

  const allChunks = [...seed.chunks, ...(seed.foreignChunks ?? [])]

  const store: AiStore = {
    async getTender(tenderId) {
      return tenderId === seed.tender.id ? seed.tender : null
    },
    async getAgencyServices() {
      return seed.services
    },
    async listChunksForTender(tenderId, limit) {
      if (tenderId !== seed.tender.id) return []
      return seed.chunks.slice(0, limit)
    },
    async resolveChunkForTender(tenderId, chunkId): Promise<ResolvedChunk | null> {
      const chunk = allChunks.find((c) => c.id === chunkId)
      if (!chunk) return null
      if (tenderId !== seed.tender.id) return null
      // Reject chunks that exist but belong to the "foreign" set —
      // simulates a chunk id valid in the DB but for another tender.
      if (seed.foreignChunks?.some((c) => c.id === chunkId)) return null
      return {
        chunkId: chunk.id,
        documentId: chunk.documentId,
        documentVersionId: chunk.documentVersionId,
        sectionId: chunk.sectionId,
        pageNumber: chunk.pageStart,
        text: chunk.text,
      }
    },
    async findActiveRun(tenderId, agencyId) {
      const active = state.runs.find((r) => r.tenderId === tenderId && r.agencyId === agencyId && ['QUEUED', 'RUNNING'].includes(r.status))
      return active ? { id: active.id, tenderId: active.tenderId, agencyId: active.agencyId, status: active.status } : null
    },
    async createRun(input: CreateRunInput): Promise<RunRecord> {
      const id = randomUUID()
      state.runs.push({ ...input, id, status: 'QUEUED' })
      return { id, tenderId: input.tenderId, agencyId: input.agencyId, status: 'QUEUED' }
    },
    async updateRun(runId, patch) {
      const run = state.runs.find((r) => r.id === runId)
      if (!run) throw new Error('run not found')
      Object.assign(run, patch)
    },
    async createClassification(input: ClassificationInput) {
      const id = randomUUID()
      state.classifications.push({ id, ...input })
      return { id }
    },
    async markPreviousClassificationsNotCurrent() {
      // no-op for single-run tests
    },
    async createDeliverable(classificationId, text, truth, confidence) {
      const id = randomUUID()
      state.deliverables.push({ id, classificationId, text, truth, confidence })
      return { id }
    },
    async createRequirement(classificationId, kind, text, truth, confidence) {
      const id = randomUUID()
      state.requirements.push({ id, classificationId, kind, text, truth, confidence })
      return { id }
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
    async createConflict(input) {
      const id = randomUUID()
      state.conflicts.push({ id, ...input })
      return { id }
    },
  }

  return { store, state }
}

export function baseTender(overrides: Partial<TenderForClassification> = {}): TenderForClassification {
  return {
    id: randomUUID(),
    title: 'Appointment of a service provider for graphic design and print services',
    organisation: 'City of Example',
    category: 'Marketing',
    description: 'The City requires a service provider for design and print.',
    closingDate: '2026-10-15',
    closingTime: '12:00',
    province: 'Gauteng',
    municipality: 'City of Example',
    estimatedValue: null,
    contractDuration: null,
    briefingRequired: false,
    briefingDate: null,
    briefingLocation: null,
    briefingUrl: null,
    ...overrides,
  }
}
