import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AgencyServiceOption,
  AiStore,
  ClassificationInput,
  CreateRunInput,
  ResolvedChunk,
  RunPatch,
  RunRecord,
} from './store.js'

/** Production `AiStore` over the privileged service-role Supabase client — same convention as `createSupabaseDocumentPipelineStore` (Phase 6). All writes go through this client; classification data is never written via a browser-scoped RLS client. */
export function createSupabaseAiStore(supabase: SupabaseClient): AiStore {
  return {
    async getTender(tenderId) {
      const { data, error } = await supabase
        .from('tenders')
        .select(
          'id, title, organisation, category, description, closing_date, closing_time, province, municipality, estimated_value, contract_duration, briefing_required, briefing_date, briefing_location, briefing_url',
        )
        .eq('id', tenderId)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      return {
        id: data.id,
        title: data.title,
        organisation: data.organisation,
        category: data.category,
        description: data.description,
        closingDate: data.closing_date,
        closingTime: data.closing_time,
        province: data.province,
        municipality: data.municipality,
        estimatedValue: data.estimated_value,
        contractDuration: data.contract_duration,
        briefingRequired: data.briefing_required,
        briefingDate: data.briefing_date,
        briefingLocation: data.briefing_location,
        briefingUrl: data.briefing_url,
      }
    },

    async getAgencyServices(agencyId) {
      const { data, error } = await supabase
        .from('agency_services')
        .select('service_id, services(id, name)')
        .eq('agency_id', agencyId)
        .eq('active', true)
      if (error) throw error
      type ServiceJoinRow = { service_id: string; services: { id: string; name: string } | { id: string; name: string }[] | null }
      const rows = (data ?? []) as unknown as ServiceJoinRow[]
      const result: AgencyServiceOption[] = []
      for (const r of rows) {
        const svc = Array.isArray(r.services) ? r.services[0] : r.services
        if (svc) result.push({ id: svc.id, name: svc.name })
      }
      return result
    },

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

    async resolveChunkForTender(tenderId, chunkId): Promise<ResolvedChunk | null> {
      const { data, error } = await supabase
        .from('tender_document_chunks')
        .select('id, document_version_id, section_id, page_start, text, tender_document_versions!inner(id, document_id, tender_id)')
        .eq('id', chunkId)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const version = data.tender_document_versions as unknown as { id: string; document_id: string; tender_id: string }
      // Hard cross-tender check (Phase 7 §16/§36) — a chunk that
      // exists but belongs to a different tender's document is
      // rejected exactly like one that doesn't exist at all.
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

    async findActiveRun(tenderId, agencyId): Promise<RunRecord | null> {
      const { data, error } = await supabase
        .from('tender_ai_runs')
        .select('id, tender_id, agency_id, status')
        .eq('tender_id', tenderId)
        .eq('agency_id', agencyId)
        .in('status', ['QUEUED', 'RUNNING'])
        .maybeSingle()
      if (error) throw error
      return data ? { id: data.id, tenderId: data.tender_id, agencyId: data.agency_id, status: data.status } : null
    },

    async createRun(input: CreateRunInput): Promise<RunRecord> {
      const { data, error } = await supabase
        .from('tender_ai_runs')
        .insert({
          tender_id: input.tenderId,
          agency_id: input.agencyId,
          status: 'QUEUED',
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

    async createClassification(input: ClassificationInput) {
      const { data, error } = await supabase
        .from('tender_ai_classifications')
        .insert({
          run_id: input.runId,
          tender_id: input.tenderId,
          agency_id: input.agencyId,
          is_current: true,
          relevance: input.relevance.value,
          relevance_truth: input.relevance.truth,
          relevance_confidence: input.relevance.confidence,
          tender_type: input.tenderType.value,
          tender_type_truth: input.tenderType.truth,
          tender_type_confidence: input.tenderType.confidence,
          intent_text: input.intent.text,
          intent_truth: input.intent.truth,
          intent_confidence: input.intent.confidence,
          services: input.services,
          geographic_scope: input.geography.scope,
          geography_province_id: input.geography.provinceId,
          geography_municipality_id: input.geography.municipalityId,
          geography_truth: input.geography.truth,
          geography_confidence: input.geography.confidence,
          contract: input.contract.value,
          contract_truth: input.contract.truth,
          contract_confidence: input.contract.confidence,
          briefing: input.briefing.value,
          briefing_status: input.briefing.status,
          briefing_truth: input.briefing.truth,
          briefing_confidence: input.briefing.confidence,
          summary: input.summary.text,
          summary_truth: input.summary.truth,
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id }
    },

    async markPreviousClassificationsNotCurrent(tenderId, agencyId, exceptId) {
      const { error } = await supabase
        .from('tender_ai_classifications')
        .update({ is_current: false })
        .eq('tender_id', tenderId)
        .eq('agency_id', agencyId)
        .neq('id', exceptId)
      if (error) throw error
    },

    async createDeliverable(classificationId, text, truth, confidence) {
      const { data, error } = await supabase
        .from('tender_ai_deliverables')
        .insert({ classification_id: classificationId, text, truth, confidence })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id }
    },

    async createRequirement(classificationId, kind, text, truth, confidence) {
      const { data, error } = await supabase
        .from('tender_ai_requirements')
        .insert({ classification_id: classificationId, kind, text, truth, confidence })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id }
    },

    async createClaim(input) {
      const { data, error } = await supabase
        .from('tender_ai_claims')
        .insert({
          run_id: input.runId,
          classification_id: input.classificationId,
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

    async createConflict(input) {
      const { data, error } = await supabase
        .from('tender_ai_conflicts')
        .insert({
          run_id: input.runId,
          classification_id: input.classificationId,
          tender_id: input.tenderId,
          field: input.field,
          db_value: input.dbValue,
          document_value: input.documentValue,
          claim_id: input.claimId,
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id }
    },
  }
}
