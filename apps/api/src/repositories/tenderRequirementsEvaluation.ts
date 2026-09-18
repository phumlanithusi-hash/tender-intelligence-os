import type { SupabaseClient } from '@supabase/supabase-js'
import {
  extractedRequirementSchema,
  evaluationCriterionSchema,
  evaluationGateSchema,
  evaluationConflictSchema,
  requirementConflictSchema,
  extractionRunSchema,
  type ExtractedRequirementDto,
  type EvaluationCriterionDto,
  type EvaluationDto,
  type ExtractionRunDto,
} from '@tender-os/schemas'

/**
 * Read-only repositories over the Phase 9 requirement/evaluation
 * extraction tables, via the caller's own RLS-scoped Supabase client
 * (shared-catalogue read — Phase 9 §37). Writes never happen through
 * these — see lib/ai/execution/runRequirementEvaluationExtraction.ts and
 * this file's companion routes, which always use the privileged
 * service-role client (same split as repositories/tenderQualification.ts
 * vs lib/qualification/supabaseQualificationStore.ts).
 */

function toRequirement(r: Record<string, unknown>): ExtractedRequirementDto {
  const evidence = ((r.tender_requirement_evidence ?? []) as Array<Record<string, unknown>>).map((e) => ({
    id: e.id as string,
    documentId: e.document_id as string,
    documentVersionId: (e.document_version_id as string) ?? null,
    pageId: (e.page_id as string) ?? null,
    sectionId: (e.section_id as string) ?? null,
    chunkId: (e.chunk_id as string) ?? null,
    pageNumber: (e.page_number as number) ?? null,
    evidenceText: e.evidence_text as string,
  }))
  return extractedRequirementSchema.parse({
    id: r.id,
    tenderId: r.tender_id,
    parentRequirementId: r.parent_requirement_id,
    category: r.requirement_type,
    title: r.requirement_text,
    description: r.requirement_text,
    mandatoryStatus: r.mandatory_status,
    requirementStatus: r.requirement_status,
    ruleType: r.rule_type,
    sourceTruth: r.source_truth,
    disqualificationRisk: r.disqualification_risk,
    confidence: r.confidence,
    version: r.version,
    supersededBy: r.superseded_by,
    evidence,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  })
}

const REQUIREMENT_SELECT =
  'id, tender_id, parent_requirement_id, requirement_type, requirement_text, mandatory_status, requirement_status, rule_type, source_truth, disqualification_risk, confidence, version, superseded_by, created_at, updated_at, tender_requirement_evidence(*)'

export async function listExtractedRequirements(supabase: SupabaseClient, tenderId: string): Promise<ExtractedRequirementDto[]> {
  const { data, error } = await supabase.from('tender_requirements').select(REQUIREMENT_SELECT).eq('tender_id', tenderId).is('superseded_by', null)
  if (error) throw error
  return (data ?? []).map((r) => toRequirement(r as Record<string, unknown>))
}

export async function getExtractedRequirement(supabase: SupabaseClient, tenderId: string, requirementId: string): Promise<ExtractedRequirementDto | null> {
  const { data, error } = await supabase.from('tender_requirements').select(REQUIREMENT_SELECT).eq('tender_id', tenderId).eq('id', requirementId).maybeSingle()
  if (error) throw error
  if (!data) return null
  return toRequirement(data as Record<string, unknown>)
}

export async function listRequirementConflicts(supabase: SupabaseClient, tenderId: string) {
  const { data, error } = await supabase.from('tender_requirement_conflicts').select('*').eq('tender_id', tenderId)
  if (error) throw error
  return (data ?? []).map((c) =>
    requirementConflictSchema.parse({
      id: c.id,
      tenderId: c.tender_id,
      category: c.category,
      description: c.description,
      evidenceA: c.evidence_a,
      evidenceB: c.evidence_b,
      status: c.status,
      createdAt: c.created_at,
    }),
  )
}

function toCriterion(r: Record<string, unknown>): EvaluationCriterionDto {
  const evidence = ((r.tender_evaluation_criterion_evidence ?? []) as Array<Record<string, unknown>>).map((e) => ({
    id: e.id as string,
    documentId: e.document_id as string,
    documentVersionId: (e.document_version_id as string) ?? null,
    pageId: (e.page_id as string) ?? null,
    sectionId: (e.section_id as string) ?? null,
    chunkId: (e.chunk_id as string) ?? null,
    pageNumber: (e.page_number as number) ?? null,
    evidenceText: e.evidence_text as string,
  }))
  return evaluationCriterionSchema.parse({
    id: r.id,
    tenderId: r.tender_id,
    parentCriterionId: r.parent_criterion_id,
    name: r.criterion,
    description: r.description,
    criterionType: r.criterion_type,
    maximumPoints: r.maximum_points,
    weight: r.weight,
    minimumThreshold: r.minimum_score,
    scoringMethod: r.scoring_method,
    scoringBands: r.scoring_bands ?? [],
    gate: r.gate,
    thresholdType: r.threshold_type,
    formulaText: r.formula_text,
    formulaType: r.formula_type,
    formulaVariables: r.formula_variables ?? {},
    localContentMinPercent: r.local_content_min_percent,
    presentationMandatory: r.presentation_mandatory,
    presentationDate: r.presentation_date,
    presentationAttendees: r.presentation_attendees,
    sourceTruth: r.source_truth,
    status: r.status,
    version: r.version,
    supersededBy: r.superseded_by,
    evidence,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  })
}

const CRITERION_SELECT =
  'id, tender_id, parent_criterion_id, criterion, description, criterion_type, maximum_points, weight, minimum_score, scoring_method, scoring_bands, gate, threshold_type, formula_text, formula_type, formula_variables, local_content_min_percent, presentation_mandatory, presentation_date, presentation_attendees, source_truth, status, version, superseded_by, created_at, updated_at, tender_evaluation_criterion_evidence(*)'

export async function listEvaluationCriteria(supabase: SupabaseClient, tenderId: string): Promise<EvaluationCriterionDto[]> {
  const { data, error } = await supabase.from('tender_evaluation_criteria').select(CRITERION_SELECT).eq('tender_id', tenderId).is('superseded_by', null)
  if (error) throw error
  return (data ?? []).map((r) => toCriterion(r as Record<string, unknown>))
}

export async function getEvaluationCriterion(supabase: SupabaseClient, tenderId: string, criterionId: string): Promise<EvaluationCriterionDto | null> {
  const { data, error } = await supabase.from('tender_evaluation_criteria').select(CRITERION_SELECT).eq('tender_id', tenderId).eq('id', criterionId).maybeSingle()
  if (error) throw error
  if (!data) return null
  return toCriterion(data as Record<string, unknown>)
}

export async function listEvaluationGates(supabase: SupabaseClient, tenderId: string) {
  const { data, error } = await supabase.from('tender_evaluation_gates').select('*, tender_evaluation_gate_evidence(*)').eq('tender_id', tenderId)
  if (error) throw error
  return (data ?? []).map((g: Record<string, unknown>) =>
    evaluationGateSchema.parse({
      id: g.id,
      tenderId: g.tender_id,
      criterionId: g.criterion_id,
      name: g.name,
      threshold: g.threshold,
      thresholdType: g.threshold_type,
      description: g.description,
      sourceTruth: g.source_truth,
      status: g.status,
      evidence: ((g.tender_evaluation_gate_evidence ?? []) as Array<Record<string, unknown>>).map((e) => ({
        id: e.id as string,
        documentId: e.document_id as string,
        documentVersionId: (e.document_version_id as string) ?? null,
        pageId: (e.page_id as string) ?? null,
        sectionId: (e.section_id as string) ?? null,
        chunkId: (e.chunk_id as string) ?? null,
        pageNumber: (e.page_number as number) ?? null,
        evidenceText: e.evidence_text as string,
      })),
      createdAt: g.created_at,
    }),
  )
}

export async function listEvaluationConflicts(supabase: SupabaseClient, tenderId: string) {
  const { data, error } = await supabase.from('tender_evaluation_conflicts').select('*').eq('tender_id', tenderId)
  if (error) throw error
  return (data ?? []).map((c) =>
    evaluationConflictSchema.parse({
      id: c.id,
      tenderId: c.tender_id,
      criterionId: c.criterion_id,
      description: c.description,
      evidenceA: c.evidence_a,
      evidenceB: c.evidence_b,
      status: c.status,
      createdAt: c.created_at,
    }),
  )
}

export async function getEvaluation(supabase: SupabaseClient, tenderId: string): Promise<EvaluationDto> {
  const [criteria, gates, conflicts] = await Promise.all([listEvaluationCriteria(supabase, tenderId), listEvaluationGates(supabase, tenderId), listEvaluationConflicts(supabase, tenderId)])
  return { criteria, gates, conflicts }
}

export async function listExtractionRuns(supabase: SupabaseClient, tenderId: string): Promise<ExtractionRunDto[]> {
  const { data, error } = await supabase
    .from('tender_ai_runs')
    .select('*')
    .eq('tender_id', tenderId)
    .eq('agent_name', 'RequirementExtractionAgent')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r) =>
    extractionRunSchema.parse({
      id: r.id,
      tenderId: r.tender_id,
      status: r.status,
      agentName: r.agent_name,
      model: r.model,
      promptVersion: r.prompt_version,
      contextTruncated: r.context_truncated,
      evidenceCoverage: r.evidence_coverage,
      conflictCount: r.conflict_count,
      unknownCount: r.unknown_count,
      requiresReviewCount: r.requires_review_count,
      validationStatus: r.validation_status,
      validationErrors: r.validation_errors ?? [],
      error: r.error,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      createdAt: r.created_at,
    }),
  )
}
