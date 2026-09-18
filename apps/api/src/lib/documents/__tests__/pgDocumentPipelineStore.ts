import type pg from 'pg'
import type {
  ChunkInput,
  CreateVersionInput,
  DocumentPipelineStore,
  PageInput,
  ProcessingPatch,
  SectionInput,
} from '../store.js'

/**
 * Test-only `DocumentPipelineStore` backed directly by a real
 * Postgres connection (raw `pg`) — same reasoning as
 * `apps/api/src/lib/ingestion/__tests__/pgIngestionStore.ts`: this
 * sandbox has no PostgREST endpoint, so this is what makes a genuine
 * end-to-end integration test against the real schema possible
 * (Phase 6 §30).
 */
export function createPgDocumentPipelineStore(pool: pg.Pool): DocumentPipelineStore {
  return {
    async getDocument(documentId) {
      const { rows } = await pool.query(
        `select id, tender_id, source_id, filename, file_url from tender_documents where id = $1`,
        [documentId],
      )
      if (rows.length === 0) return null
      const r = rows[0]
      return { id: r.id, tenderId: r.tender_id, sourceId: r.source_id, filename: r.filename, fileUrl: r.file_url }
    },

    async getVersionByHash(documentId, fileHash) {
      const { rows } = await pool.query(
        `select id, document_id, version, file_hash from tender_document_versions where document_id = $1 and file_hash = $2`,
        [documentId, fileHash],
      )
      if (rows.length === 0) return null
      return { id: rows[0].id, documentId: rows[0].document_id, version: rows[0].version, fileHash: rows[0].file_hash }
    },

    async getLatestVersion(documentId) {
      const { rows } = await pool.query(
        `select id, document_id, version, file_hash from tender_document_versions where document_id = $1 order by version desc limit 1`,
        [documentId],
      )
      if (rows.length === 0) return null
      return { id: rows[0].id, documentId: rows[0].document_id, version: rows[0].version, fileHash: rows[0].file_hash }
    },

    async createVersion(input: CreateVersionInput) {
      const { rows } = await pool.query(
        `insert into tender_document_versions
           (document_id, tender_id, source_id, version, previous_version_id, original_url, filename,
            storage_path, mime_type, detected_file_kind, file_size, file_hash, retrieved_at, is_original)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         returning id, document_id, version, file_hash`,
        [
          input.documentId,
          input.tenderId,
          input.sourceId,
          input.version,
          input.previousVersionId,
          input.originalUrl,
          input.filename,
          input.storagePath,
          input.mimeType,
          input.detectedFileKind,
          input.fileSize,
          input.fileHash,
          input.retrievedAt,
          input.isOriginal,
        ],
      )
      return { id: rows[0].id, documentId: rows[0].document_id, version: rows[0].version, fileHash: rows[0].file_hash }
    },

    async setDocumentCurrentVersion(documentId, versionId, classification) {
      await pool.query(`update tender_documents set current_version_id = $2, classification = $3 where id = $1`, [
        documentId,
        versionId,
        classification,
      ])
    },

    async getProcessingState(versionId) {
      const { rows } = await pool.query(`select state from tender_document_processing where document_version_id = $1`, [versionId])
      return rows.length > 0 ? rows[0].state : null
    },

    async ensureProcessingRow(versionId) {
      await pool.query(
        `insert into tender_document_processing (document_version_id) values ($1)
         on conflict (document_version_id) do nothing`,
        [versionId],
      )
    },

    async updateProcessing(versionId, patch: ProcessingPatch) {
      if (patch.incrementDownloadAttempts) {
        await pool.query(
          `update tender_document_processing set download_attempts = download_attempts + 1 where document_version_id = $1`,
          [versionId],
        )
      }
      if (patch.incrementExtractionAttempts) {
        await pool.query(
          `update tender_document_processing set extraction_attempts = extraction_attempts + 1 where document_version_id = $1`,
          [versionId],
        )
      }
      if (patch.incrementOcrAttempts) {
        await pool.query(
          `update tender_document_processing set ocr_attempts = ocr_attempts + 1 where document_version_id = $1`,
          [versionId],
        )
      }

      const fields: string[] = []
      const values: unknown[] = [versionId]
      const setField = (col: string, value: unknown) => {
        values.push(value)
        fields.push(`${col} = $${values.length}`)
      }

      if (patch.state !== undefined) setField('state', patch.state)
      if (patch.lastError !== undefined) setField('last_error', patch.lastError)
      if (patch.lastErrorStage !== undefined) setField('last_error_stage', patch.lastErrorStage)
      if (patch.downloadedAt !== undefined) setField('downloaded_at', patch.downloadedAt)
      if (patch.extractedAt !== undefined) setField('extracted_at', patch.extractedAt)
      if (patch.ocrCompletedAt !== undefined) setField('ocr_completed_at', patch.ocrCompletedAt)
      if (patch.segmentedAt !== undefined) setField('segmented_at', patch.segmentedAt)
      if (patch.chunkedAt !== undefined) setField('chunked_at', patch.chunkedAt)
      if (patch.pageCount !== undefined) setField('page_count', patch.pageCount)
      if (patch.extractionMethod !== undefined) setField('extraction_method', patch.extractionMethod)
      if (patch.documentClassification !== undefined) setField('document_classification', patch.documentClassification)
      if (patch.classificationConfidence !== undefined) setField('classification_confidence', patch.classificationConfidence)
      if (patch.executionId !== undefined) setField('execution_id', patch.executionId)

      if (fields.length > 0) {
        await pool.query(`update tender_document_processing set ${fields.join(', ')} where document_version_id = $1`, values)
      }
    },

    async replacePages(versionId, pages: PageInput[]) {
      await pool.query(`delete from tender_document_pages where document_version_id = $1`, [versionId])
      for (const p of pages) {
        await pool.query(
          `insert into tender_document_pages (document_version_id, page_number, text, extraction_method, extraction_confidence, char_count)
           values ($1,$2,$3,$4,$5,$6)`,
          [versionId, p.pageNumber, p.text, p.extractionMethod, p.confidence, p.text.length],
        )
      }
    },

    async replaceSections(versionId, sections: SectionInput[]) {
      await pool.query(`delete from tender_document_sections where document_version_id = $1`, [versionId])
      for (const s of sections) {
        await pool.query(
          `insert into tender_document_sections (document_version_id, section_index, section_number, title, page_start, page_end, confidence)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [versionId, s.sectionIndex, s.sectionNumber, s.title, s.pageStart, s.pageEnd, s.confidence],
        )
      }
    },

    async replaceChunks(versionId, chunks: ChunkInput[]) {
      await pool.query(`delete from tender_document_chunks where document_version_id = $1`, [versionId])
      const { rows: sectionRows } = await pool.query<{ id: string; section_index: number }>(
        `select id, section_index from tender_document_sections where document_version_id = $1`,
        [versionId],
      )
      const sectionIdByIndex = new Map<number, string>(sectionRows.map((r) => [r.section_index, r.id]))

      let previousId: string | null = null
      for (const c of chunks) {
        const sectionId = c.sectionIndex !== null ? (sectionIdByIndex.get(c.sectionIndex) ?? null) : null
        const insertResult: pg.QueryResult<{ id: string }> = await pool.query(
          `insert into tender_document_chunks
             (document_version_id, section_id, chunk_index, page_start, page_end, text, char_count, token_estimate, previous_chunk_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
          [versionId, sectionId, c.chunkIndex, c.pageStart, c.pageEnd, c.text, c.charCount, c.tokenEstimate, previousId],
        )
        previousId = insertResult.rows[0]?.id ?? null
      }
    },

    async getPages(versionId) {
      const { rows } = await pool.query(
        `select page_number, text, extraction_method, extraction_confidence from tender_document_pages where document_version_id = $1 order by page_number`,
        [versionId],
      )
      return rows.map((r) => ({
        pageNumber: r.page_number,
        text: r.text,
        extractionMethod: r.extraction_method,
        confidence: r.extraction_confidence,
      }))
    },
  }
}
