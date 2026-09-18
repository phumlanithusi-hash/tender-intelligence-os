import type { DocumentExtractionMethod, DocumentFileKind, DocumentProcessingState } from '@tender-os/constants'

export interface DocumentIdentity {
  id: string
  tenderId: string
  sourceId: string | null
  filename: string
  fileUrl: string | null
}

export interface VersionRecord {
  id: string
  documentId: string
  version: number
  fileHash: string | null
}

export interface CreateVersionInput {
  documentId: string
  tenderId: string
  sourceId: string | null
  version: number
  previousVersionId: string | null
  originalUrl: string | null
  filename: string
  storagePath: string | null
  mimeType: string | null
  detectedFileKind: DocumentFileKind
  fileSize: number | null
  fileHash: string | null
  retrievedAt: string | null
  isOriginal: boolean
}

export interface ProcessingPatch {
  state?: DocumentProcessingState
  incrementDownloadAttempts?: boolean
  incrementExtractionAttempts?: boolean
  incrementOcrAttempts?: boolean
  lastError?: string | null
  lastErrorStage?: string | null
  downloadedAt?: string | null
  extractedAt?: string | null
  ocrCompletedAt?: string | null
  segmentedAt?: string | null
  chunkedAt?: string | null
  pageCount?: number | null
  extractionMethod?: DocumentExtractionMethod | null
  documentClassification?: string | null
  classificationConfidence?: number | null
  executionId?: string | null
}

export interface PageInput {
  pageNumber: number
  text: string
  extractionMethod: DocumentExtractionMethod
  confidence: number | null
}

export interface SectionInput {
  sectionIndex: number
  sectionNumber: string | null
  title: string | null
  pageStart: number
  pageEnd: number
  confidence: number
}

export interface ChunkInput {
  chunkIndex: number
  sectionIndex: number | null
  pageStart: number
  pageEnd: number
  text: string
  charCount: number
  tokenEstimate: number
}

/**
 * The narrow persistence surface the document pipeline (pipeline.ts)
 * needs (Phase 6 §17/§30 — same seam shape as
 * `apps/api/src/lib/ingestion/store.ts` and for the identical reason:
 * this sandbox has no PostgREST endpoint, so a genuine end-to-end
 * integration test against the real schema can only run through a
 * raw-`pg`-backed implementation of this interface — see
 * `__tests__/pgDocumentPipelineStore.ts`. Production
 * (`supabaseDocumentPipelineStore.ts`) implements the same interface
 * over the privileged Supabase client.
 */
export interface DocumentPipelineStore {
  getDocument(documentId: string): Promise<DocumentIdentity | null>
  getVersionByHash(documentId: string, fileHash: string): Promise<VersionRecord | null>
  getLatestVersion(documentId: string): Promise<VersionRecord | null>
  createVersion(input: CreateVersionInput): Promise<VersionRecord>
  setDocumentCurrentVersion(documentId: string, versionId: string, classification: string | null): Promise<void>

  getProcessingState(versionId: string): Promise<DocumentProcessingState | null>
  ensureProcessingRow(versionId: string): Promise<void>
  updateProcessing(versionId: string, patch: ProcessingPatch): Promise<void>

  replacePages(versionId: string, pages: PageInput[]): Promise<void>
  replaceSections(versionId: string, sections: SectionInput[]): Promise<void>
  replaceChunks(versionId: string, chunks: ChunkInput[]): Promise<void>

  getPages(versionId: string): Promise<PageInput[]>
}
