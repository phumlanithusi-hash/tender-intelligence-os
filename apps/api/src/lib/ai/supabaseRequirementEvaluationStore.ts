import type { SupabaseClient } from '@supabase/supabase-js'
import { REQUIREMENT_EXTRACTION_AGENT_NAME } from '@tender-os/constants'
import type { RequirementEvaluationStore, RunPatchWithQuality, EvidenceLinkInput } from './requirementEvaluationStore.js'
import type { RunRecord } from './store.js'

const AGENT_NAME = REQUIREMENT_EXTRACTION_AGENT_NAME

function evidenceRow(base: Record<string, unknown>, e: EvidenceLinkInput) {
  return {
    ...base,
    document_id: e.documentId,
    document_version_id: e.documentVersionId,
    page_id: e.pageId,
    section_id: e.sectionId,
    chunk_id: e.chunkId,
    page_number: e.pageNumber,
    evidence_text: e.evidenceText,
  }
}

/** Production `RequirementEvaluationStore`, service-role only (Phase 9 §30/§37) — same convention as createSupabaseQualificationAiStore. */
export function createSupabaseRequirementEvaluationStore(supabase: SupabaseClient): RequirementEvaluationStore {
  return {
    async listChunksForTender(tenderId, limit) {
      const { data: versions, error: vErr } = await supabase.from('tender_document_versions').select('id, document_id').eq('tender_id', tenderId)
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

    async findActiveExtractionRun(tenderId): Promise<RunRecord | null> {
      const { data, error } = await supabase
        .from('tender_ai_runs')
        .select('id, tender_id, agency_id, status')
        .eq('tender_id', tenderId)
        .is('agency_id', null)
        .eq('agent_name', AGENT_NAME)
        .in('status', ['QUEUED', 'RUNNING'])
        .maybeSingle()
      if (error) throw error
      return data ? { id: data.id, tenderId: data.tender_id, agencyId: data.agency_id, status: data.status } : null
    },

    async createExtractionRun(input): Promise<RunRecord> {
      const { data, error } = await supabase
        .from('tender_ai_runs')
        .insert({
          tender_id: input.tenderId,
          agency_id: null,
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

    async updateRun(runId, patch: RunPatchWithQuality) {
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
      if (patch.evidenceCoverage !== undefined) update.evidence_coverage = patch.evidenceCoverage
      if (patch.conflictCount !== undefined) update.conflict_count = patch.conflictCount
      if (patch.unknownCount !== undefined) update.unknown_count = patch.unknownCount
      if (patch.requiresReviewCount !== undefined) update.requires_review_count = patch.requiresReviewCount
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
      const { data, error } = await supabase.from('tender_ai_evidence').insert(evidenceRow({ claim_id: input.claimId }, input)).select('id').single()
      if (error) throw error
      return { id: data.id }
    },

    async listCurrentExtractedRequirements(tenderId) {
      const { data, error } = await supabase
        .from('tender_requirements')
        .select('id, requirement_type, requirement_text, version')
        .eq('tender_id', tenderId)
        .is('superseded_by', null)
        .not('ai_run_id', 'is', null)
      if (error) throw error
      return (data ?? []).map((r) => ({ id: r.id, category: r.requirement_type, title: r.requirement_text, version: r.version }))
    },

    async createRequirement(input) {
      const { data, error } = await supabase
        .from('tender_requirements')
        .insert({
          tender_id: input.tenderId,
          parent_requirement_id: input.parentRequirementId,
          requirement_type: input.category,
          requirement_text: input.title,
          mandatory: input.mandatoryStatus === 'MANDATORY',
          mandatory_status: input.mandatoryStatus,
          rule_type: input.ruleType,
          disqualification_risk: input.disqualificationRisk,
          source_truth: input.sourceTruth,
          requirement_status: input.requirementStatus,
          confidence: input.confidence,
          version: input.version,
          extraction_status: 'EXTRACTED',
          ai_run_id: input.aiRunId,
          ai_claim_id: input.aiClaimId,
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id }
    },

    async supersedeRequirement(previousId, newId, newVersion) {
      const { error } = await supabase.from('tender_requirements').update({ superseded_by: newId, superseded_at: new Date().toISOString() }).eq('id', previousId)
      if (error) throw error
      void newVersion
    },

    async linkRequirementEvidence(requirementId, links) {
      if (links.length === 0) return
      const { error } = await supabase.from('tender_requirement_evidence').insert(links.map((l) => evidenceRow({ requirement_id: requirementId }, l)))
      if (error) throw error
    },

    async setRequirementParent(requirementId, parentRequirementId) {
      const { error } = await supabase.from('tender_requirements').update({ parent_requirement_id: parentRequirementId }).eq('id', requirementId)
      if (error) throw error
    },

    async listCurrentExtractedCriteria(tenderId) {
      const { data, error } = await supabase
        .from('tender_evaluation_criteria')
        .select('id, criterion_type, criterion, version')
        .eq('tender_id', tenderId)
        .is('superseded_by', null)
        .not('ai_run_id', 'is', null)
      if (error) throw error
      return (data ?? []).map((r) => ({ id: r.id, criterionType: r.criterion_type, name: r.criterion, version: r.version }))
    },

    async createCriterion(input) {
      const { data, error } = await supabase
        .from('tender_evaluation_criteria')
        .insert({
          tender_id: input.tenderId,
          parent_criterion_id: input.parentCriterionId,
          criterion: input.name,
          description: input.description,
          criterion_type: input.criterionType,
          maximum_points: input.maximumPoints,
          weight: input.weight,
          minimum_score: input.minimumThreshold,
          scoring_method: input.scoringMethod,
          scoring_bands: input.scoringBands,
          gate: input.gate,
          threshold_type: input.thresholdType,
          formula_text: input.formulaText,
          formula_type: input.formulaType,
          formula_variables: input.formulaVariables,
          local_content_min_percent: input.localContentMinPercent,
          presentation_mandatory: input.presentationMandatory,
          presentation_date: input.presentationDate,
          presentation_attendees: input.presentationAttendees,
          source_truth: input.sourceTruth,
          status: input.status,
          confidence: input.confidence,
          version: input.version,
          ai_run_id: input.aiRunId,
          ai_claim_id: input.aiClaimId,
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id }
    },

    async supersedeCriterion(previousId, newId, newVersion) {
      const { error } = await supabase.from('tender_evaluation_criteria').update({ superseded_by: newId, superseded_at: new Date().toISOString() }).eq('id', previousId)
      if (error) throw error
      void newVersion
    },

    async linkCriterionEvidence(criterionId, links) {
      if (links.length === 0) return
      const { error } = await supabase.from('tender_evaluation_criterion_evidence').insert(links.map((l) => evidenceRow({ criterion_id: criterionId }, l)))
      if (error) throw error
    },

    async setCriterionParent(criterionId, parentCriterionId) {
      const { error } = await supabase.from('tender_evaluation_criteria').update({ parent_criterion_id: parentCriterionId }).eq('id', criterionId)
      if (error) throw error
    },

    async createGate(input) {
      const { data, error } = await supabase
        .from('tender_evaluation_gates')
        .insert({
          tender_id: input.tenderId,
          criterion_id: input.criterionId,
          name: input.name,
          threshold: input.threshold,
          threshold_type: input.thresholdType,
          description: input.description,
          source_truth: input.sourceTruth,
          status: input.status,
          ai_run_id: input.aiRunId,
          ai_claim_id: input.aiClaimId,
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id }
    },

    async linkGateEvidence(gateId, links) {
      if (links.length === 0) return
      const { error } = await supabase.from('tender_evaluation_gate_evidence').insert(links.map((l) => evidenceRow({ gate_id: gateId }, l)))
      if (error) throw error
    },

    async createRequirementConflict(input) {
      const { data, error } = await supabase
        .from('tender_requirement_conflicts')
        .insert({
          tender_id: input.tenderId,
          category: 'UNKNOWN',
          description: input.description,
          evidence_a: input.evidenceA,
          evidence_b: input.evidenceB,
          requirement_id: input.requirementId,
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id }
    },

    async createEvaluationConflict(input) {
      const { data, error } = await supabase
        .from('tender_evaluation_conflicts')
        .insert({
          tender_id: input.tenderId,
          criterion_id: input.criterionId,
          description: input.description,
          evidence_a: input.evidenceA,
          evidence_b: input.evidenceB,
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id }
    },
  }
}
