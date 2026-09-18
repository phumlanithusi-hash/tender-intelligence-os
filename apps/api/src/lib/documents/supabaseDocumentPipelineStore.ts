import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ChunkInput,
  CreateVersionInput,
  DocumentIdentity,
  DocumentPipelineStore,
  PageInput,
  ProcessingPatch,
  SectionInput,
  VersionRecord,
} from './store.js'
import type { DocumentProcessingState } from '@tender-os/constants'

/** Production `DocumentPipelineStore` over the privileged service-role Supabase client (Phase 6 §17). */
export function createSupabaseDocumentPipelineStore(supabase: SupabaseClient): DocumentPipelineStore {
  return {
    async getDocument(documentId) {
      const { data, error } = await supabase
        .from('tender_documents')
        .select('id, tender_id, source_id, filename, file_url')
        .eq('id', documentId)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      return {
        id: data.id,
        tenderId: data.tender_id,
        sourceId: data.source_id,
        filename: data.filename,
        fileUrl: data.file_url,
      } satisfies DocumentIdentity
    },

    async getVersionByHash(documentId, fileHash) {
      const { data, error } = await supabase
        .from('tender_document_versions')
        .select('id, document_id, version, file_hash')
        .eq('document_id', documentId)
        .eq('file_hash', fileHash)
        .maybeSingle()
      if (error) throw error
      return data ? toVersionRecord(data) : null
    },

    async getLatestVersion(documentId) {
      const { data, error } = await supabase
        .from('tender_document_versions')
        .select('id, document_id, version, file_hash')
        .eq('document_id', documentId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data ? toVersionRecord(data) : null
    },

    async createVersion(input: CreateVersionInput) {
      const { data, error } = await supabase
        .from('tender_document_versions')
        .insert({
          document_id: input.documentId,
          tender_id: input.tenderId,
          source_id: input.sourceId,
          version: input.version,
          previous_version_id: input.previousVersionId,
          original_url: input.originalUrl,
          filename: input.filename,
          storage_path: input.storagePath,
          mime_type: input.mimeType,
          detected_file_kind: input.detectedFileKind,
          file_size: input.fileSize,
          file_hash: input.fileHash,
          retrieved_at: input.retrievedAt,
          is_original: input.isOriginal,
        })
        .select('id, document_id, version, file_hash')
        .single()
      if (error) throw error
      return toVersionRecord(data)
    },

    async setDocumentCurrentVersion(documentId, versionId, classification) {
      const { error } = await supabase
        .from('tender_documents')
        .update({ current_version_id: versionId, classification })
        .eq('id', documentId)
      if (error) throw error
    },

    async getProcessingState(versionId) {
      const { data, error } = await supabase
        .from('tender_document_processing')
        .select('state')
        .eq('document_version_id', versionId)
        .maybeSingle()
      if (error) throw error
      return (data?.state as DocumentProcessingState | undefined) ?? null
    },

    async ensureProcessingRow(versionId) {
      const { error } = await supabase
        .from('tender_document_processing')
        .upsert({ document_version_id: versionId }, { onConflict: 'document_version_id', ignoreDuplicates: true })
      if (error) throw error
    },

    async updateProcessing(versionId, patch: ProcessingPatch) {
      const update: Record<string, unknown> = {}
      if (patch.state !== undefined) update.state = patch.state
      if (patch.lastError !== undefined) update.last_error = patch.lastError
      if (patch.lastErrorStage !== undefined) update.last_error_stage = patch.lastErrorStage
      if (patch.downloadedAt !== undefined) update.downloaded_at = patch.downloadedAt
      if (patch.extractedAt !== undefined) update.extracted_at = patch.extractedAt
      if (patch.ocrCompletedAt !== undefined) update.ocr_completed_at = patch.ocrCompletedAt
      if (patch.segmentedAt !== undefined) update.segmented_at = patch.segmentedAt
      if (patch.chunkedAt !== undefined) update.chunked_at = patch.chunkedAt
      if (patch.pageCount !== undefined) update.page_count = patch.pageCount
      if (patch.extractionMethod !== undefined) update.extraction_method = patch.extractionMethod
      if (patch.documentClassification !== undefined) update.document_classification = patch.documentClassification
      if (patch.classificationConfidence !== undefined) update.classification_confidence = patch.classificationConfidence
      if (patch.executionId !== undefined) update.execution_id = patch.executionId

      if (patch.incrementDownloadAttempts || patch.incrementExtractionAttempts || patch.incrementOcrAttempts) {
        const { data: current, error: readError } = await supabase
          .from('tender_document_processing')
          .select('download_attempts, extraction_attempts, ocr_attempts')
          .eq('document_version_id', versionId)
          .single()
        if (readError) throw readError
        if (patch.incrementDownloadAttempts) update.download_attempts = (current.download_attempts ?? 0) + 1
        if (patch.incrementExtractionAttempts) update.extraction_attempts = (current.extraction_attempts ?? 0) + 1
        if (patch.incrementOcrAttempts) update.ocr_attempts = (current.ocr_attempts ?? 0) + 1
      }

      const { error } = await supabase.from('tender_document_processing').update(update).eq('document_version_id', versionId)
      if (error) throw error
    },

    async replacePages(versionId, pages: PageInput[]) {
      const { error: deleteError } = await supabase.from('tender_document_pages').delete().eq('document_version_id', versionId)
      if (deleteError) throw deleteError
      if (pages.length === 0) return
      const { error } = await supabase.from('tender_document_pages').insert(
        pages.map((p) => ({
          document_version_id: versionId,
          page_number: p.pageNumber,
          text: p.text,
          extraction_method: p.extractionMethod,
          extraction_confidence: p.confidence,
          char_count: p.text.length,
        })),
      )
      if (error) throw error
    },

    async replaceSections(versionId, sections: SectionInput[]) {
      const { error: deleteError } = await supabase
        .from('tender_document_sections')
        .delete()
        .eq('document_version_id', versionId)
      if (deleteError) throw deleteError
      if (sections.length === 0) return
      const { error } = await supabase.from('tender_document_sections').insert(
        sections.map((s) => ({
          document_version_id: versionId,
          section_index: s.sectionIndex,
          section_number: s.sectionNumber,
          title: s.title,
          page_start: s.pageStart,
          page_end: s.pageEnd,
          confidence: s.confidence,
        })),
      )
      if (error) throw error
    },

    async replaceChunks(versionId, chunks: ChunkInput[]) {
      const { error: deleteError } = await supabase.from('tender_document_chunks').delete().eq('document_version_id', versionId)
      if (deleteError) throw deleteError
      if (chunks.length === 0) return

      // section_index -> section_id lookup, so chunks can carry a
      // real FK (Phase 6 §15's "no floating text with no source").
      const { data: sectionRows, error: sectionError } = await supabase
        .from('tender_document_sections')
        .select('id, section_index')
        .eq('document_version_id', versionId)
      if (sectionError) throw sectionError
      const sectionIdByIndex = new Map((sectionRows ?? []).map((r) => [r.section_index as number, r.id as string]))

      const insertRows = chunks.map((c) => ({
        document_version_id: versionId,
        section_id: c.sectionIndex !== null ? (sectionIdByIndex.get(c.sectionIndex) ?? null) : null,
        chunk_index: c.chunkIndex,
        page_start: c.pageStart,
        page_end: c.pageEnd,
        text: c.text,
        char_count: c.charCount,
        token_estimate: c.tokenEstimate,
        previous_chunk_id: null as string | null,
      }))

      const { data: inserted, error } = await supabase.from('tender_document_chunks').insert(insertRows).select('id, chunk_index')
      if (error) throw error

      // Second pass: wire up previous_chunk_id now that ids exist.
      const idByIndex = new Map((inserted ?? []).map((r) => [r.chunk_index as number, r.id as string]))
      for (const chunk of chunks) {
        if (chunk.chunkIndex === 0) continue
        const id = idByIndex.get(chunk.chunkIndex)
        const previousId = idByIndex.get(chunk.chunkIndex - 1)
        if (!id || !previousId) continue
        const { error: linkError } = await supabase
          .from('tender_document_chunks')
          .update({ previous_chunk_id: previousId })
          .eq('id', id)
        if (linkError) throw linkError
      }
    },

    async getPages(versionId) {
      const { data, error } = await supabase
        .from('tender_document_pages')
        .select('page_number, text, extraction_method, extraction_confidence')
        .eq('document_version_id', versionId)
        .order('page_number', { ascending: true })
      if (error) throw error
      return (data ?? []).map((r) => ({
        pageNumber: r.page_number,
        text: r.text,
        extractionMethod: r.extraction_method,
        confidence: r.extraction_confidence,
      }))
    },
  }
}

function toVersionRecord(row: { id: string; document_id: string; version: number; file_hash: string | null }): VersionRecord {
  return { id: row.id, documentId: row.document_id, version: row.version, fileHash: row.file_hash }
}
