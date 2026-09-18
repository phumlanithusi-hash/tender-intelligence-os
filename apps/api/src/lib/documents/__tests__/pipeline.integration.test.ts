import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { processDocument, reprocessDocumentVersion, type PipelineDeps } from '../pipeline.js'
import { createPgDocumentPipelineStore } from './pgDocumentPipelineStore.js'
import { createFakeStorage } from './fakeStorage.js'
import { TesseractOcrEngine } from '../ocr/tesseractEngine.js'
import type { OcrEngine } from '../ocr/types.js'

const fixturesDir = path.resolve(__dirname, '../../../../../../tests/fixtures/documents')
const fixture = (name: string) => readFileSync(path.join(fixturesDir, name))

function getTestPool(): pg.Pool {
  const connectionString =
    process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/tender_intelligence_test'
  return new pg.Pool({ connectionString })
}

/**
 * A fake OCR engine used only to test the "OCR engine unavailable"
 * failure path deterministically, regardless of whether this
 * particular sandbox happens to have `tesseract` installed (Phase 6
 * §11: "do not fabricate OCR text" when no engine is available).
 */
class UnavailableOcrEngine implements OcrEngine {
  readonly name = 'unavailable-test-engine'
  async isAvailable() {
    return false
  }
  async recognizeImage(): Promise<never> {
    throw new Error('should never be called when unavailable')
  }
}

describe('document processing pipeline — real Postgres schema (Phase 6 §30)', () => {
  const pool = getTestPool()
  let server: http.Server
  let baseUrl: string
  let tenderId: string

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const name = (req.url ?? '').replace(/^\//, '')
      try {
        const bytes = fixture(decodeURIComponent(name))
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        res.end(bytes)
      } catch {
        res.writeHead(404)
        res.end()
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    const { rows } = await pool.query(
      `insert into tenders (title) values ('Phase 6 pipeline test tender (synthetic)') returning id`,
    )
    tenderId = rows[0].id
  })

  afterAll(async () => {
    server.close()
    await pool.query(`delete from tenders where id = $1`, [tenderId])
    await pool.end()
  })

  async function createDocument(filename: string): Promise<string> {
    const { rows } = await pool.query(
      `insert into tender_documents (tender_id, filename, file_url) values ($1, $2, $3) returning id`,
      [tenderId, filename, `${baseUrl}/${encodeURIComponent(filename)}`],
    )
    return rows[0].id
  }

  function makeDeps(ocrEngine: OcrEngine = new TesseractOcrEngine()): PipelineDeps {
    return {
      store: createPgDocumentPipelineStore(pool),
      storage: createFakeStorage(),
      ocrEngine,
      allowedHosts: ['127.0.0.1'],
      downloadOptions: { allowPrivateNetworksForTesting: true },
    }
  }

  it('processes a normal text PDF end-to-end to READY_FOR_ANALYSIS with full provenance', async () => {
    const documentId = await createDocument('normal-text.pdf')
    const deps = makeDeps()
    const result = await processDocument(deps, { documentId })

    expect(result.state).toBe('READY_FOR_ANALYSIS')
    expect(result.reused).toBe(false)
    expect(result.pageCount).toBe(1)

    const { rows: versionRows } = await pool.query('select * from tender_document_versions where document_id = $1', [documentId])
    expect(versionRows).toHaveLength(1)
    expect(versionRows[0].file_hash).toHaveLength(64)
    expect(versionRows[0].version).toBe(1)
    expect(versionRows[0].is_original).toBe(true)

    const { rows: processingRows } = await pool.query(
      'select * from tender_document_processing where document_version_id = $1',
      [result.versionId],
    )
    expect(processingRows).toHaveLength(1)
    expect(processingRows[0].state).toBe('READY_FOR_ANALYSIS')
    expect(processingRows[0].page_count).toBe(1)
    expect(processingRows[0].download_attempts).toBe(1)

    const { rows: pageRows } = await pool.query(
      'select * from tender_document_pages where document_version_id = $1 order by page_number',
      [result.versionId],
    )
    expect(pageRows).toHaveLength(1)
    expect(pageRows[0].page_number).toBe(1)
    expect(pageRows[0].text).toContain('INTRODUCTION')
    expect(pageRows[0].extraction_method).toBe('NATIVE_TEXT')

    const { rows: sectionRows } = await pool.query(
      'select * from tender_document_sections where document_version_id = $1',
      [result.versionId],
    )
    expect(sectionRows.length).toBeGreaterThan(0)

    const { rows: chunkRows } = await pool.query(
      'select * from tender_document_chunks where document_version_id = $1 order by chunk_index',
      [result.versionId],
    )
    expect(chunkRows.length).toBeGreaterThan(0)
    expect(chunkRows[0].page_start).toBe(1)
    // Provenance chain (Phase 6 §15): every chunk resolves to a section on this version.
    expect(chunkRows[0].section_id).not.toBeNull()

    const { rows: docRows } = await pool.query('select * from tender_documents where id = $1', [documentId])
    expect(docRows[0].current_version_id).toBe(result.versionId)
  })

  it('detects multiple sections and produces page-attributed, section-scoped chunks for a multi-page tender', async () => {
    const documentId = await createDocument('multi-page-tender.pdf')
    const result = await processDocument(makeDeps(), { documentId })
    expect(result.state).toBe('READY_FOR_ANALYSIS')
    expect(result.pageCount).toBe(5)

    const { rows: sectionRows } = await pool.query(
      'select * from tender_document_sections where document_version_id = $1 order by section_index',
      [result.versionId],
    )
    expect(sectionRows.length).toBeGreaterThanOrEqual(3)
    expect(sectionRows.some((r) => r.section_number === '1')).toBe(true)
    expect(sectionRows.some((r) => r.section_number === 'Annexure A')).toBe(true)
  })

  it('extracts a DOCX document', async () => {
    const documentId = await createDocument('terms-of-reference.docx')
    const result = await processDocument(makeDeps(), { documentId })
    expect(result.state).toBe('READY_FOR_ANALYSIS')
    const { rows } = await pool.query('select * from tender_document_pages where document_version_id = $1', [result.versionId])
    expect(rows[0].text).toContain('TERMS OF REFERENCE')
  })

  it('extracts an XLSX pricing schedule preserving structured rows', async () => {
    const documentId = await createDocument('pricing-schedule.xlsx')
    const result = await processDocument(makeDeps(), { documentId })
    expect(result.state).toBe('READY_FOR_ANALYSIS')
    const { rows } = await pool.query('select * from tender_document_pages where document_version_id = $1', [result.versionId])
    expect(rows[0].extraction_method).toBe('STRUCTURED')
    expect(rows[0].text).toContain('Synthetic widget')
  })

  it('marks a malformed PDF as INVALID rather than a fake successful extraction', async () => {
    const documentId = await createDocument('malformed.pdf')
    const result = await processDocument(makeDeps(), { documentId })
    expect(result.state).toBe('INVALID')
    expect(result.success).toBe(false)

    const { rows } = await pool.query('select * from tender_document_processing where document_version_id = $1', [result.versionId])
    expect(rows[0].state).toBe('INVALID')
    expect(rows[0].last_error).toBeTruthy()
  })

  it('marks an unsupported format as REQUIRES_REVIEW, never silently discarded', async () => {
    const documentId = await createDocument('unsupported.bin')
    // No fixture named unsupported.bin exists — serve raw unknown bytes via override instead.
    const result = await processDocument(makeDeps(), { documentId, bytesOverride: Buffer.from([0x00, 0x01, 0x02, 0xff, 0x10, 0x20]) })
    expect(result.state).toBe('REQUIRES_REVIEW')
    const { rows } = await pool.query('select * from tender_documents where id = $1', [documentId])
    expect(rows[0]).toBeTruthy() // The document record itself never disappears (Phase 6 §18).
  })

  it('is idempotent: processing the same document twice never duplicates versions, pages, sections, or chunks', async () => {
    const documentId = await createDocument('normal-text.pdf')
    const deps = makeDeps()
    const first = await processDocument(deps, { documentId })
    const second = await processDocument(deps, { documentId })

    expect(second.reused).toBe(true)
    expect(second.versionId).toBe(first.versionId)

    const { rows: versionRows } = await pool.query('select count(*)::int as count from tender_document_versions where document_id = $1', [documentId])
    expect(versionRows[0].count).toBe(1)

    const { rows: pageRows } = await pool.query('select count(*)::int as count from tender_document_pages where document_version_id = $1', [first.versionId])
    expect(pageRows[0].count).toBe(1)
  })

  it('creates a new version for a revised document while the original remains available (Phase 6 §7)', async () => {
    const documentId = await createDocument('normal-text.pdf')
    const deps = makeDeps()
    const original = await processDocument(deps, { documentId })

    const revisedBytes = fixture('normal-text-revised.pdf')
    const revised = await processDocument(deps, { documentId, bytesOverride: revisedBytes })

    expect(revised.versionId).not.toBe(original.versionId)

    const { rows: versions } = await pool.query(
      'select version, is_original, previous_version_id from tender_document_versions where document_id = $1 order by version',
      [documentId],
    )
    expect(versions).toHaveLength(2)
    expect(versions[0].version).toBe(1)
    expect(versions[0].is_original).toBe(true)
    expect(versions[1].version).toBe(2)
    expect(versions[1].previous_version_id).toBeTruthy()

    // The original version's pages are still queryable — never erased.
    const { rows: originalPages } = await pool.query('select * from tender_document_pages where document_version_id = $1', [original.versionId])
    expect(originalPages.length).toBeGreaterThan(0)
  })

  it('reprocesses a stored version, rebuilding chunks without duplicating rows', async () => {
    const documentId = await createDocument('multi-page-tender.pdf')
    const deps = makeDeps()
    const result = await processDocument(deps, { documentId })

    const { rows: versionRows } = await pool.query('select storage_path, filename, detected_file_kind from tender_document_versions where id = $1', [result.versionId])

    const reprocessed = await reprocessDocumentVersion(deps, {
      documentId,
      versionId: result.versionId!,
      storagePath: versionRows[0].storage_path,
      filename: versionRows[0].filename,
      detectedFileKind: versionRows[0].detected_file_kind,
    })

    expect(reprocessed.versionId).toBe(result.versionId)
    expect(reprocessed.state).toBe('READY_FOR_ANALYSIS')

    const { rows: chunkRows } = await pool.query('select count(*)::int as count from tender_document_chunks where document_version_id = $1', [result.versionId])
    const { rows: originalChunks } = await pool.query('select count(*)::int as count from tender_document_chunks where document_version_id = $1', [result.versionId])
    expect(chunkRows[0].count).toBe(originalChunks[0].count)
    expect(chunkRows[0].count).toBeGreaterThan(0)
  })

  it('detects a scanned (image-only) PDF, marks OCR_REQUIRED, and either recovers text via real OCR or fails explicitly without fabricating text', async () => {
    const documentId = await createDocument('scanned-page.pdf')
    const result = await processDocument(makeDeps(), { documentId })

    const { rows: processingRows } = await pool.query('select * from tender_document_processing where document_version_id = $1', [result.versionId])
    const state = processingRows[0].state as string
    expect(['READY_FOR_ANALYSIS', 'REQUIRES_REVIEW']).toContain(state)

    const { rows: pageRows } = await pool.query('select * from tender_document_pages where document_version_id = $1', [result.versionId])
    if (state === 'READY_FOR_ANALYSIS') {
      // Real OCR ran and recovered at least some text — never fabricated.
      expect(pageRows[0].extraction_method).toBe('OCR')
      expect(pageRows[0].extraction_confidence).not.toBeNull()
    } else {
      // OCR genuinely failed (or was unavailable) — explicit failure state, no invented text.
      expect(processingRows[0].last_error).toBeTruthy()
    }
  }, 30_000)

  it('never fabricates OCR text when the OCR engine is unavailable — moves to OCR_FAILED / REQUIRES_REVIEW with a clear reason', async () => {
    const documentId = await createDocument('scanned-page.pdf')
    const result = await processDocument(makeDeps(new UnavailableOcrEngine()), { documentId })

    expect(result.state).toBe('REQUIRES_REVIEW')
    const { rows: processingRows } = await pool.query('select * from tender_document_processing where document_version_id = $1', [result.versionId])
    expect(processingRows[0].last_error).toMatch(/not available/i)

    const { rows: pageRows } = await pool.query('select * from tender_document_pages where document_version_id = $1', [result.versionId])
    expect(pageRows[0].text).toBe('') // Never fabricated.
  })
})
