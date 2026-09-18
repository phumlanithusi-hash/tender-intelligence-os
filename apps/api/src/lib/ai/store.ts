/**
 * Port over everything the AI execution/evidence layer needs to read
 * and write, following the same "interface + real Supabase impl +
 * test fake" pattern as `DocumentPipelineStore` (lib/documents/store.ts).
 * Keeping this as a narrow port — rather than agents/execution code
 * calling supabase-js directly — is what lets evidence resolution and
 * run orchestration be unit-tested without a live database.
 */

export interface TenderForClassification {
  id: string
  title: string
  organisation: string | null
  category: string | null
  description: string | null
  closingDate: string | null
  closingTime: string | null
  province: string | null
  municipality: string | null
  estimatedValue: number | null
  contractDuration: string | null
  briefingRequired: boolean
  briefingDate: string | null
  briefingLocation: string | null
  briefingUrl: string | null
}

export interface AgencyServiceOption {
  id: string
  name: string
}

export interface ChunkForContext {
  id: string
  documentId: string
  documentVersionId: string
  sectionId: string | null
  pageStart: number
  pageEnd: number
  text: string
  charCount: number
}

/** A resolved chunk, verified to belong to the tender under analysis (Phase 7 §16/§36 — cross-tender evidence must be rejected). */
export interface ResolvedChunk {
  chunkId: string
  documentId: string
  documentVersionId: string
  sectionId: string | null
  pageNumber: number | null
  text: string
}

export interface CreateRunInput {
  tenderId: string
  agencyId: string
  model: string
  promptVersion: string
  inputRefs: Record<string, unknown>
  triggeredBy: string | null
}

export interface RunPatch {
  status?: string
  rawOutput?: unknown
  validationStatus?: string | null
  validationErrors?: string[]
  contextTruncated?: boolean
  error?: string | null
  errorStage?: string | null
  retryCount?: number
  inputTokensEstimate?: number | null
  outputTokensEstimate?: number | null
  durationMs?: number | null
  startedAt?: string | null
  completedAt?: string | null
}

export interface RunRecord {
  id: string
  tenderId: string
  /** null for tender-scoped (not agency-scoped) runs — e.g. Phase 9's RequirementExtractionAgent. */
  agencyId: string | null
  status: string
}

export interface ClassificationInput {
  runId: string
  tenderId: string
  agencyId: string
  relevance: { value: string; truth: string; confidence: number | null }
  tenderType: { value: string; truth: string; confidence: number | null }
  intent: { text: string | null; truth: string; confidence: number | null }
  services: Array<{ serviceId: string; serviceName: string; confidence: number | null }>
  geography: {
    scope: string
    provinceId: string | null
    municipalityId: string | null
    truth: string
    confidence: number | null
  }
  contract: { value: Record<string, unknown>; truth: string; confidence: number | null }
  briefing: { value: Record<string, unknown>; status: string; truth: string; confidence: number | null }
  summary: { text: string | null; truth: string }
}

export interface AiStore {
  getTender(tenderId: string): Promise<TenderForClassification | null>
  getAgencyServices(agencyId: string): Promise<AgencyServiceOption[]>
  listChunksForTender(tenderId: string, limit: number): Promise<ChunkForContext[]>
  resolveChunkForTender(tenderId: string, chunkId: string): Promise<ResolvedChunk | null>

  findActiveRun(tenderId: string, agencyId: string): Promise<RunRecord | null>
  createRun(input: CreateRunInput): Promise<RunRecord>
  updateRun(runId: string, patch: RunPatch): Promise<void>

  createClassification(input: ClassificationInput): Promise<{ id: string }>
  markPreviousClassificationsNotCurrent(tenderId: string, agencyId: string, exceptId: string): Promise<void>

  createDeliverable(classificationId: string, text: string, truth: string, confidence: number | null): Promise<{ id: string }>
  createRequirement(
    classificationId: string,
    kind: string,
    text: string,
    truth: string,
    confidence: number | null,
  ): Promise<{ id: string }>

  createClaim(input: {
    runId: string
    classificationId: string | null
    claimType: string
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

  createConflict(input: {
    runId: string
    classificationId: string | null
    tenderId: string
    field: string
    dbValue: string | null
    documentValue: string
    claimId: string | null
  }): Promise<{ id: string }>
}
