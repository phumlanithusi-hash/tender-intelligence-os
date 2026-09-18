import type { SupabaseClient } from '@supabase/supabase-js'
import type { QualificationAiStore } from './qualificationAiStore.js'
import type { RunPatch, RunRecord } from './store.js'

const AGENT_NAME = 'QualificationInterpretationAgent'

/** Production `QualificationAiStore`, service-role only — same convention as `createSupabaseAiStore` (Phase 7). */
export function createSupabaseQualificationAiStore(supabase: SupabaseClient): QualificationAiStore {
  return {
    async listChunksForTender(tenderId, limit) {
      const { data: versions, error: vErr } = await supabase
        .from('tender_document_versions')
        .select('id, document_id')
        .eq('tender_id', tenderId)
      if (vErr) throw vErr
      const versionIds = (versions ?? []).map((v) => v.id)
      if (versionIds.length === 0) return []
      const versionToDoc = new Map((versions ?? []).map((v) => [v.id, v.document_id]))

      const { data, error } = await supabase
        .from('tender_document_chunks')
        .select('id, document_version_id, section_id, page_start, page_end, text, char_count, chunk_index')
        .in('document_version_id', versionIds)
        .order('document_version_id', { ascending: true })
        .order('chunk_index', { ascending: true })
        .limit(limit)
      if (error) throw error
      return (data ?? []).map((c) => ({
        id: c.id,
        documentId: versionToDoc.get(c.document_version_id) ?? '',
        documentVersionId: c.document_version_id,
        sectionId: c.section_id,
        pageStart: c.page_start,
        pageEnd: c.page_end,
        text: c.text,
        charCount: c.char_count,
      }))
    },

    async resolveChunkForTender(tenderId, chunkId) {
      const { data, error } = await supabase
        .from('tender_document_chunks')
        .select('id, document_version_id, section_id, page_start, text, tender_document_versions!inner(id, document_id, tender_id)')
        .eq('id', chunkId)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const version = data.tender_document_versions as unknown as { id: string; document_id: string; tender_id: string }
      if (!version || version.tender_id !== tenderId) return null
      return {
        chunkId: data.id,
        documentId: version.document_id,
        documentVersionId: version.id,
        sectionId: data.section_id,
        pageNumber: data.page_start,
        text: (data as unknown as { text: string }).text,
      }
    },

    async findActiveInterpretationRun(tenderId, agencyId): Promise<RunRecord | null> {
      const { data, error } = await supabase
        .from('tender_ai_runs')
        .select('id, tender_id, agency_id, status')
        .eq('tender_id', tenderId)
        .eq('agency_id', agencyId)
        .eq('agent_name', AGENT_NAME)
        .in('status', ['QUEUED', 'RUNNING'])
        .maybeSingle()
      if (error) throw error
      return data ? { id: data.id, tenderId: data.tender_id, agencyId: data.agency_id, status: data.status } : null
    },

    async createInterpretationRun(input): Promise<RunRecord> {
      const { data, error } = await supabase
        .from('tender_ai_runs')
        .insert({
          tender_id: input.tenderId,
          agency_id: input.agencyId,
          status: 'QUEUED',
          agent_name: AGENT_NAME,
          model: input.model,
          prompt_version: input.promptVersion,
          input_refs: input.inputRefs,
          triggered_by: input.triggeredBy,
        })
        .select('id, tender_id, agency_id, status')
        .single()
      if (error) throw error
      return { id: data.id, tenderId: data.tender_id, agencyId: data.agency_id, status: data.status }
    },

    async updateRun(runId, patch: RunPatch) {
      const update: Record<string, unknown> = {}
      if (patch.status !== undefined) update.status = patch.status
      if (patch.rawOutput !== undefined) update.raw_output = patch.rawOutput
      if (patch.validationStatus !== undefined) update.validation_status = patch.validationStatus
      if (patch.validationErrors !== undefined) update.validation_errors = patch.validationErrors
      if (patch.contextTruncated !== undefined) update.context_truncated = patch.contextTruncated
      if (patch.error !== undefined) update.error = patch.error
      if (patch.errorStage !== undefined) update.error_stage = patch.errorStage
      if (patch.retryCount !== undefined) update.retry_count = patch.retryCount
      if (patch.inputTokensEstimate !== undefined) update.input_tokens_estimate = patch.inputTokensEstimate
      if (patch.outputTokensEstimate !== undefined) update.output_tokens_estimate = patch.outputTokensEstimate
      if (patch.durationMs !== undefined) update.duration_ms = patch.durationMs
      if (patch.startedAt !== undefined) update.started_at = patch.startedAt
      if (patch.completedAt !== undefined) update.completed_at = patch.completedAt
      const { error } = await supabase.from('tender_ai_runs').update(update).eq('id', runId)
      if (error) throw error
    },

    async createClaim(input) {
      const { data, error } = await supabase
        .from('tender_ai_claims')
        .insert({
          run_id: input.runId,
          classification_id: null,
          claim_type: input.claimType,
          claim_key: input.claimKey,
          claim_text: input.claimText,
          truth: input.truth,
          confidence: input.confidence,
          evidence_resolved: input.evidenceResolved,
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id }
    },

    async createEvidence(input) {
      const { data, error } = await supabase
        .from('tender_ai_evidence')
        .insert({
          claim_id: input.claimId,
          document_id: input.documentId,
          document_version_id: input.documentVersionId,
          page_id: input.pageId,
          section_id: input.sectionId,
          chunk_id: input.chunkId,
          page_number: input.pageNumber,
          evidence_text: input.evidenceText,
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id }
    },

    async createInterpretation(input) {
      const { data, error } = await supabase
        .from('tender_qualification_ai_interpretations')
        .insert({
          run_id: input.runId,
          claim_id: input.claimId,
          requirement_text: input.requirementText,
          category: input.category,
          rule_type: input.ruleType,
          mandatory_status: input.mandatoryStatus,
          interpretation: input.interpretation,
          truth: input.truth,
          confidence: input.confidence,
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id }
    },
  }
}
