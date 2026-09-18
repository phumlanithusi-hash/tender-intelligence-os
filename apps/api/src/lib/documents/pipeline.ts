import type { DocumentFileKind } from '@tender-os/constants'
import { OCR_MIN_CHARS_PER_PAGE } from '@tender-os/constants'
import { downloadDocument, DownloadError, type DownloadOptions } from './download.js'
import { sha256Hex } from './hashing.js'
import { detectFileType } from './fileType.js'
import { sanitiseFilename, buildStoragePath } from './filename.js'
import { getExtractor, isSupportedForExtraction } from './extractors/registry.js'
import type { ExtractedPage } from './extractors/types.js'
import { detectSections } from './sectionDetection.js'
import { chunkDocument } from './chunking.js'
import { classifyDocument } from './classification.js'
import { runOcr } from './ocr/ocrPipeline.js'
import type { OcrEngine } from './ocr/types.js'
import type { DocumentStorage } from './storage.js'
import type { DocumentPipelineStore } from './store.js'
import { logger } from '../logger.js'

export interface PipelineDeps {
  store: DocumentPipelineStore
  storage: DocumentStorage
  ocrEngine: OcrEngine
  allowedHosts: readonly string[]
  downloadOptions?: Partial<DownloadOptions>
}

export interface ProcessDocumentInput {
  documentId: string
  /** URL to fetch. Falls back to the document's own `fileUrl` if omitted. */
  sourceUrl?: string
  executionId?: string | null
  /** Test/offline seam: use these bytes directly instead of performing a network download (Phase 6's binding constraint: no live network to real tender sources in this sandbox). */
  bytesOverride?: Buffer
}

export interface PipelineResult {
  success: boolean
  documentId: string
  versionId: string | null
  state: string
  pageCount: number
  reused: boolean
  warnings: string[]
  error?: string
}

/**
 * Runs the full DOWNLOAD -> VALIDATE -> HASH -> STORE -> EXTRACT ->
 * OCR -> SEGMENT -> SECTION DETECT -> CHUNK pipeline for one document
 * (Phase 6 §1/§18). Composable, idempotent stage functions rather
 * than one monolithic procedure — see docs/DOCUMENT-INGESTION.md
 * "Queue seam" for how a future BullMQ worker calls this same
 * function per job (Phase 6 §17) instead of this ever running
 * synchronously inside an HTTP handler in production (the
 * download/reprocess ROUTES in this phase call it directly only
 * because no queue exists yet — the seam is what a worker will use
 * unchanged).
 */
export async function processDocument(deps: PipelineDeps, input: ProcessDocumentInput): Promise<PipelineResult> {
  const { store, storage, ocrEngine, allowedHosts } = deps
  const log = logger.child({ documentId: input.documentId, executionId: input.executionId ?? null })

  const document = await store.getDocument(input.documentId)
  if (!document) {
    return { success: false, documentId: input.documentId, versionId: null, state: 'FAILED', pageCount: 0, reused: false, warnings: [], error: 'Document not found' }
  }

  const url = input.sourceUrl ?? document.fileUrl
  log.info({ url }, 'document processing: started')

  // --- DOWNLOAD -------------------------------------------------
  let bytes: Buffer
  if (input.bytesOverride) {
    bytes = input.bytesOverride
  } else {
    if (!url) {
      return { success: false, documentId: document.id, versionId: null, state: 'DOWNLOAD_FAILED', pageCount: 0, reused: false, warnings: [], error: 'No source URL available for this document' }
    }
    try {
      const result = await downloadDocument(url, { allowedHosts, ...deps.downloadOptions })
      bytes = result.bytes
      log.info({ bytes: bytes.length, redirects: result.redirectCount }, 'document processing: download complete')
    } catch (error) {
      const message = error instanceof DownloadError ? error.message : String(error)
      log.error({ error: message }, 'document processing: download failed')
      return { success: false, documentId: document.id, versionId: null, state: 'DOWNLOAD_FAILED', pageCount: 0, reused: false, warnings: [], error: message }
    }
  }

  // --- HASH + DETECT TYPE (VALIDATE) -----------------------------
  const fileHash = sha256Hex(bytes)
  const detected = await detectFileType(bytes, document.filename)
  log.info({ fileHash, kind: detected.kind, mimeType: detected.mimeType }, 'document processing: validated')

  // --- DEDUPLICATION (Phase 6 §6) ---------------------------------
  const existing = await store.getVersionByHash(document.id, fileHash)
  let versionId: string
  let reused = false

  if (existing) {
    versionId = existing.id
    reused = true
    log.info({ versionId }, 'document processing: identical content already stored — reusing version, not storing again')
  } else {
    const latest = await store.getLatestVersion(document.id)
    const nextVersion = (latest?.version ?? 0) + 1
    const filename = sanitiseFilename(document.filename)
    const storagePath = buildStoragePath(document.tenderId, document.id, nextVersion, filename)

    await storage.upload(storagePath, bytes, detected.mimeType)

    const created = await store.createVersion({
      documentId: document.id,
      tenderId: document.tenderId,
      sourceId: document.sourceId,
      version: nextVersion,
      previousVersionId: latest?.id ?? null,
      originalUrl: url ?? null,
      filename,
      storagePath,
      mimeType: detected.mimeType,
      detectedFileKind: detected.kind,
      fileSize: bytes.length,
      fileHash,
      retrievedAt: new Date().toISOString(),
      isOriginal: nextVersion === 1,
    })
    versionId = created.id
    await store.ensureProcessingRow(versionId)
    await store.updateProcessing(versionId, {
      state: 'DOWNLOADED',
      downloadedAt: new Date().toISOString(),
      incrementDownloadAttempts: true,
      executionId: input.executionId ?? null,
    })
    log.info({ versionId, version: nextVersion }, 'document processing: stored new version')
  }

  await store.ensureProcessingRow(versionId)

  if (!isSupportedForExtraction(detected.kind)) {
    await store.updateProcessing(versionId, {
      state: 'REQUIRES_REVIEW',
      lastError: `Unsupported document format for extraction: ${detected.kind}`,
      lastErrorStage: 'VALIDATE',
    })
    log.warn({ versionId, kind: detected.kind }, 'document processing: unsupported format, marked REQUIRES_REVIEW')
    return { success: false, documentId: document.id, versionId, state: 'REQUIRES_REVIEW', pageCount: 0, reused, warnings: ['Unsupported document format'] }
  }

  await store.updateProcessing(versionId, { state: 'VALID' })

  // --- EXTRACT -----------------------------------------------------
  await store.updateProcessing(versionId, { state: 'EXTRACTING', incrementExtractionAttempts: true })
  const extractor = getExtractor(detected.kind)!
  let pages: ExtractedPage[]
  let ocrRequired: boolean
  let warnings: string[]

  try {
    const result = await extractor.extract(bytes)
    pages = result.pages
    ocrRequired = result.ocrRequired
    warnings = result.warnings
    log.info({ versionId, pageCount: pages.length, ocrRequired }, 'document processing: extraction complete')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // A thrown extractor error for a format that should be parseable
    // (PDF/DOCX/XLSX) means the file itself is malformed (Phase 6
    // §19: "INVALID (malformed PDF)") — never silently produced as an
    // empty successful result.
    await store.updateProcessing(versionId, { state: 'INVALID', lastError: message, lastErrorStage: 'EXTRACT' })
    log.error({ versionId, error: message }, 'document processing: extraction failed — file treated as INVALID')
    return { success: false, documentId: document.id, versionId, state: 'INVALID', pageCount: 0, reused, warnings: [], error: message }
  }

  await store.updateProcessing(versionId, {
    state: 'EXTRACTED',
    extractedAt: new Date().toISOString(),
    extractionMethod: pages[0]?.extractionMethod ?? null,
  })

  // --- OCR (Phase 6 §10/§11) ---------------------------------------
  let ocrFullyFailed = false
  if (ocrRequired) {
    await store.updateProcessing(versionId, { state: 'OCR_REQUIRED' })
    const pageNumbers = pages.filter((p) => p.text.trim().length < OCR_MIN_CHARS_PER_PAGE).map((p) => p.pageNumber)
    const isAvailable = await ocrEngine.isAvailable()

    if (!isAvailable) {
      await store.updateProcessing(versionId, {
        state: 'OCR_FAILED',
        lastError: `OCR engine "${ocrEngine.name}" is not available in this environment.`,
        lastErrorStage: 'OCR',
        incrementOcrAttempts: true,
      })
      log.warn({ versionId }, 'document processing: OCR required but no engine available — OCR_FAILED, no text fabricated')
      ocrFullyFailed = true
    } else {
      await store.updateProcessing(versionId, { state: 'OCR_QUEUED' })
      await store.updateProcessing(versionId, { state: 'OCR_PROCESSING' })
      const ocrResult = await runOcr(ocrEngine, bytes, pageNumbers, detected.kind === 'PDF')
      const ocrPageByNumber = new Map(ocrResult.pages.map((p) => [p.pageNumber, p]))
      pages = pages.map((p) => ocrPageByNumber.get(p.pageNumber) ?? p)

      await store.updateProcessing(versionId, { incrementOcrAttempts: true })
      if (ocrResult.failedPages.length === pageNumbers.length && pageNumbers.length > 0) {
        ocrFullyFailed = true
        await store.updateProcessing(versionId, {
          state: 'OCR_FAILED',
          lastError: `OCR failed for all ${pageNumbers.length} page(s) requiring it.`,
          lastErrorStage: 'OCR',
        })
        log.error({ versionId, pageNumbers }, 'document processing: OCR failed for every page requiring it')
      } else {
        await store.updateProcessing(versionId, { state: 'OCR_COMPLETE', ocrCompletedAt: new Date().toISOString() })
        if (ocrResult.failedPages.length > 0) {
          warnings.push(`OCR failed for pages: ${ocrResult.failedPages.join(', ')}`)
        }
        log.info({ versionId, ocrPages: ocrResult.pages.length, failedPages: ocrResult.failedPages }, 'document processing: OCR complete')
      }
    }
  }

  // --- PAGE SEGMENTATION (Phase 6 §12) ------------------------------
  await store.replacePages(
    versionId,
    pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text, extractionMethod: p.extractionMethod, confidence: p.confidence })),
  )
  await store.updateProcessing(versionId, { state: 'SEGMENTED', segmentedAt: new Date().toISOString(), pageCount: pages.length })
  log.info({ versionId, pageCount: pages.length }, 'document processing: page segmentation complete')

  // --- SECTION DETECTION (Phase 6 §13) ------------------------------
  const sections = detectSections(pages)
  await store.replaceSections(versionId, sections)
  log.info({ versionId, sectionCount: sections.length }, 'document processing: section detection complete')

  // --- CHUNKING (Phase 6 §14) --------------------------------------
  const chunks = chunkDocument(pages, sections)
  await store.replaceChunks(
    versionId,
    chunks.map((c) => ({
      chunkIndex: c.chunkIndex,
      sectionIndex: c.sectionIndex,
      pageStart: c.pageStart,
      pageEnd: c.pageEnd,
      text: c.text,
      charCount: c.charCount,
      tokenEstimate: c.tokenEstimate,
    })),
  )
  await store.updateProcessing(versionId, { state: 'CHUNKED', chunkedAt: new Date().toISOString() })
  log.info({ versionId, chunkCount: chunks.length }, 'document processing: chunking complete')

  // --- CLASSIFICATION (Phase 6 §23) ---------------------------------
  const classification = classifyDocument(document.filename, pages)
  await store.updateProcessing(versionId, {
    documentClassification: classification.classification,
    classificationConfidence: classification.confidence,
  })
  await store.setDocumentCurrentVersion(document.id, versionId, classification.classification)

  const finalState = ocrFullyFailed ? 'REQUIRES_REVIEW' : 'READY_FOR_ANALYSIS'
  await store.updateProcessing(versionId, { state: finalState })
  log.info({ versionId, finalState }, 'document processing: finished')

  return {
    success: !ocrFullyFailed,
    documentId: document.id,
    versionId,
    state: finalState,
    pageCount: pages.length,
    reused,
    warnings,
  }
}

/** Re-processes an already-stored version's bytes (Phase 6 §20) — retries extraction/OCR/segmentation/chunking without re-downloading or creating a duplicate version, and without duplicating pages/chunks (replace* is upsert-by-delete-then-insert, keyed on the same version id). */
export async function reprocessDocumentVersion(
  deps: PipelineDeps,
  input: { documentId: string; versionId: string; storagePath: string; filename: string; detectedFileKind: DocumentFileKind; executionId?: string | null },
): Promise<PipelineResult> {
  const bytes = await deps.storage.download(input.storagePath)
  return processDocument(deps, {
    documentId: input.documentId,
    bytesOverride: bytes,
    executionId: input.executionId,
  })
}
