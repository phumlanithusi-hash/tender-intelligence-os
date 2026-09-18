import type { SupabaseClient } from '@supabase/supabase-js'
import {
  qualificationSchema,
  qualificationRequirementSchema,
  qualificationActionSchema,
  type QualificationDto,
  type QualificationRequirementDto,
  type QualificationActionDto,
} from '@tender-os/schemas'

/**
 * Read-only repositories over the Phase 8 qualification tables, via
 * the caller's own RLS-scoped Supabase client (agency-isolated by
 * `tender_qualification_runs_select_own_agency` etc). Writes never
 * happen through these — see lib/qualification/supabaseQualificationStore.ts,
 * which always uses the privileged service-role client (same split as
 * repositories/tenderAi.ts vs lib/ai/supabaseAiStore.ts).
 */
export async function getQualification(supabase: SupabaseClient, tenderId: string): Promise<QualificationDto> {
  const { data: run, error: runErr } = await supabase
    .from('tender_qualification_runs')
    .select('*')
    .eq('tender_id', tenderId)
    .eq('is_current', true)
    .maybeSingle()
  if (runErr) throw runErr
  if (!run) return qualificationSchema.parse({ run: null, results: [] })

  const { data: results, error: resErr } = await supabase
    .from('tender_qualification_results')
    .select('*, tender_qualification_result_tender_evidence(*), tender_qualification_result_agency_evidence(*), tender_qualification_actions(*)')
    .eq('run_id', run.id)
  if (resErr) throw resErr

  return qualificationSchema.parse({
    run: toRun(run),
    results: (results ?? []).map((r: Record<string, unknown>) => toResult(r)),
  })
}

export async function listQualificationRequirements(supabase: SupabaseClient, tenderId: string): Promise<QualificationRequirementDto[]> {
  const { data, error } = await supabase
    .from('tender_requirements')
    .select('id, tender_id, category, requirement_text, mandatory_status, source_truth, requirement_status, rule_type, rule_config, version, superseded_by, created_at, updated_at')
    .eq('tender_id', tenderId)
    .is('superseded_by', null)
  if (error) throw error
  return (data ?? []).map((r) =>
    qualificationRequirementSchema.parse({
      id: r.id,
      tenderId: r.tender_id,
      category: r.category,
      description: r.requirement_text,
      mandatoryStatus: r.mandatory_status,
      sourceTruth: r.source_truth,
      requirementStatus: r.requirement_status,
      ruleType: r.rule_type,
      ruleConfig: r.rule_config ?? {},
      version: r.version,
      supersededBy: r.superseded_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }),
  )
}

export async function getQualificationRequirement(supabase: SupabaseClient, tenderId: string, requirementId: string): Promise<QualificationRequirementDto | null> {
  const { data, error } = await supabase
    .from('tender_requirements')
    .select('id, tender_id, category, requirement_text, mandatory_status, source_truth, requirement_status, rule_type, rule_config, version, superseded_by, created_at, updated_at')
    .eq('tender_id', tenderId)
    .eq('id', requirementId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return qualificationRequirementSchema.parse({
    id: data.id,
    tenderId: data.tender_id,
    category: data.category,
    description: data.requirement_text,
    mandatoryStatus: data.mandatory_status,
    sourceTruth: data.source_truth,
    requirementStatus: data.requirement_status,
    ruleType: data.rule_type,
    ruleConfig: data.rule_config ?? {},
    version: data.version,
    supersededBy: data.superseded_by,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  })
}

export async function listQualificationActions(supabase: SupabaseClient, tenderId: string): Promise<QualificationActionDto[]> {
  const { data, error } = await supabase.from('tender_qualification_actions').select('*').eq('tender_id', tenderId).order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((a) =>
    qualificationActionSchema.parse({
      id: a.id,
      requirementId: a.requirement_id,
      description: a.description,
      priority: a.priority,
      dueDate: a.due_date,
      status: a.status,
      createdAt: a.created_at,
    }),
  )
}

function toRun(row: Record<string, unknown>) {
  return {
    id: row.id,
    tenderId: row.tender_id,
    agencyId: row.agency_id,
    status: row.status,
    overallStatus: row.overall_status,
    mandatoryBlockerCount: row.mandatory_blocker_count,
    actionRequiredCount: row.action_required_count,
    requiresReviewCount: row.requires_review_count,
    requirementCount: row.requirement_count,
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  }
}

function toResult(row: Record<string, unknown>) {
  const tenderEvidence = ((row.tender_qualification_result_tender_evidence ?? []) as Array<Record<string, unknown>>).map((e) => ({
    id: e.id,
    documentId: e.document_id,
    documentVersionId: e.document_version_id,
    pageId: e.page_id,
    sectionId: e.section_id,
    chunkId: e.chunk_id,
    pageNumber: e.page_number,
    evidenceText: e.evidence_text,
  }))
  const agencyEvidence = ((row.tender_qualification_result_agency_evidence ?? []) as Array<Record<string, unknown>>).map((e) => ({
    id: e.id,
    agencyEvidenceId: e.agency_evidence_id,
    description: e.description,
  }))
  const actions = ((row.tender_qualification_actions ?? []) as Array<Record<string, unknown>>).map((a) => ({
    id: a.id,
    requirementId: a.requirement_id,
    description: a.description,
    priority: a.priority,
    dueDate: a.due_date,
    status: a.status,
    createdAt: a.created_at,
  }))
  return {
    id: row.id,
    requirementId: row.requirement_id,
    status: row.status,
    mandatory: row.mandatory,
    mandatoryStatus: row.mandatory_status,
    explanation: row.explanation,
    evaluatedBy: row.evaluated_by,
    confidence: row.confidence,
    requiresHumanReview: row.requires_human_review,
    evaluatedAt: row.evaluated_at,
    tenderEvidence,
    agencyEvidence,
    actions,
  }
}
