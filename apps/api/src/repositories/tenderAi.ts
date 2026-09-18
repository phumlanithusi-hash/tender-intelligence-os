import type { SupabaseClient } from '@supabase/supabase-js'
import { aiClassificationSchema, aiRunSchema, type AiClassification, type AiRun } from '@tender-os/schemas'

/**
 * Read-only repositories over the Phase 7 AI tables, via the caller's
 * own RLS-scoped Supabase client (agency-isolated by
 * `tender_ai_runs_select_own_agency` etc — Phase 7 §20/§36). Writes
 * never happen through these — see lib/ai/supabaseAiStore.ts, which
 * always uses the privileged service-role client.
 */

export async function listAiRuns(supabase: SupabaseClient, tenderId: string): Promise<AiRun[]> {
  const { data, error } = await supabase
    .from('tender_ai_runs')
    .select('*')
    .eq('tender_id', tenderId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row) => toAiRun(row))
}

export async function getCurrentClassification(supabase: SupabaseClient, tenderId: string): Promise<AiClassification | null> {
  const { data, error } = await supabase
    .from('tender_ai_classifications')
    .select('*')
    .eq('tender_id', tenderId)
    .eq('is_current', true)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return hydrateClassification(supabase, data)
}

async function hydrateClassification(supabase: SupabaseClient, row: Record<string, unknown>): Promise<AiClassification> {
  const classificationId = row.id as string

  const [{ data: deliverables }, { data: requirements }, { data: claims }, { data: conflicts }] = await Promise.all([
    supabase.from('tender_ai_deliverables').select('*').eq('classification_id', classificationId),
    supabase.from('tender_ai_requirements').select('*').eq('classification_id', classificationId),
    supabase.from('tender_ai_claims').select('*, tender_ai_evidence(*)').eq('classification_id', classificationId),
    supabase.from('tender_ai_conflicts').select('*').eq('classification_id', classificationId),
  ])

  const claimsByKey = new Map<string, { evidence: unknown[] }>()
  const claimList = ((claims ?? []) as Array<Record<string, unknown>>).map((c) => {
    const evidence = ((c.tender_ai_evidence ?? []) as Array<Record<string, unknown>>).map((e) => ({
      id: e.id,
      documentId: e.document_id,
      documentVersionId: e.document_version_id,
      pageId: e.page_id,
      pageNumber: e.page_number,
      sectionId: e.section_id,
      chunkId: e.chunk_id,
      evidenceText: e.evidence_text,
    }))
    claimsByKey.set(c.claim_key as string, { evidence })
    return {
      id: c.id,
      claimType: c.claim_type,
      claimKey: c.claim_key,
      claimText: c.claim_text,
      truth: c.truth,
      confidence: c.confidence,
      evidenceResolved: c.evidence_resolved,
      evidence,
    }
  })

  const contract = (row.contract as Record<string, unknown>) ?? {}
  const briefing = (row.briefing as Record<string, unknown>) ?? {}

  return aiClassificationSchema.parse({
    id: row.id,
    runId: row.run_id,
    tenderId: row.tender_id,
    agencyId: row.agency_id,
    isCurrent: row.is_current,
    createdAt: row.created_at,
    relevance: row.relevance,
    relevanceTruth: row.relevance_truth,
    relevanceConfidence: row.relevance_confidence,
    tenderType: row.tender_type,
    tenderTypeTruth: row.tender_type_truth,
    tenderTypeConfidence: row.tender_type_confidence,
    intentText: row.intent_text,
    intentTruth: row.intent_truth,
    intentConfidence: row.intent_confidence,
    services: row.services ?? [],
    deliverables: ((deliverables ?? []) as Array<Record<string, unknown>>).map((d) => ({
      id: d.id,
      text: d.text,
      truth: d.truth,
      confidence: d.confidence,
      evidence: claimsByKey.get(`deliverable:${d.id}`)?.evidence ?? [],
    })),
    geographicScope: row.geographic_scope,
    geographyProvinceId: row.geography_province_id,
    geographyMunicipalityId: row.geography_municipality_id,
    geographyTruth: row.geography_truth,
    geographyConfidence: row.geography_confidence,
    contract: {
      durationText: contract.durationText ?? null,
      estimatedValue: contract.estimatedValue ?? null,
      procurementMethod: contract.procurementMethod ?? null,
      isFrameworkOrPanel: contract.isFrameworkOrPanel ?? null,
      numberOfSuppliers: contract.numberOfSuppliers ?? null,
      appointmentPeriod: contract.appointmentPeriod ?? null,
    },
    contractTruth: row.contract_truth,
    contractConfidence: row.contract_confidence,
    briefing: {
      status: briefing.status ?? row.briefing_status ?? 'UNKNOWN',
      date: briefing.date ?? null,
      time: briefing.time ?? null,
      location: briefing.location ?? null,
      url: briefing.url ?? null,
      isOnline: briefing.isOnline ?? null,
      registrationRequired: briefing.registrationRequired ?? null,
    },
    briefingTruth: row.briefing_truth,
    briefingConfidence: row.briefing_confidence,
    apparentRequirements: ((requirements ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id,
      kind: r.kind,
      text: r.text,
      truth: r.truth,
      confidence: r.confidence,
      evidence: claimsByKey.get(`apparentRequirement:${r.id}`)?.evidence ?? [],
    })),
    conflicts: ((conflicts ?? []) as Array<Record<string, unknown>>).map((c) => ({
      id: c.id,
      field: c.field,
      dbValue: c.db_value,
      documentValue: c.document_value,
      resolved: c.resolved,
      claimId: c.claim_id,
    })),
    summary: row.summary,
    summaryTruth: row.summary_truth,
    claims: claimList,
  })
}

function toAiRun(row: Record<string, unknown>): AiRun {
  return aiRunSchema.parse({
    id: row.id,
    tenderId: row.tender_id,
    agencyId: row.agency_id,
    status: row.status,
    agentName: row.agent_name,
    model: row.model,
    promptVersion: row.prompt_version,
    validationStatus: row.validation_status,
    validationErrors: row.validation_errors ?? [],
    contextTruncated: row.context_truncated,
    error: row.error,
    errorStage: row.error_stage,
    retryCount: row.retry_count,
    inputTokensEstimate: row.input_tokens_estimate,
    outputTokensEstimate: row.output_tokens_estimate,
    durationMs: row.duration_ms,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  })
}
