import type { SupabaseClient } from '@supabase/supabase-js'
import { dataQualityViolationSchema, type DataQualityViolationRow } from '@tender-os/schemas'
import {
  checkTendersMissingClosingDate,
  checkTendersMissingSourceUrl,
  checkDuplicateTenderNumbers,
  checkDuplicateSourceRecords,
  checkDocumentsMissingHash,
  checkMandatoryRequirementsWithoutAssessment,
  checkOutcomesWithoutProvenance,
  checkWinnersWithoutEvidence,
  checkSubmittedBidsWithoutVerifiedEvidence,
  type ViolationCandidate,
} from './rules.js'
import { buildCompletenessDashboard, type CompletenessCounts } from './completeness.js'
import type { DataQualityStore } from './store.js'

/**
 * Production `DataQualityStore` over the privileged service-role
 * Supabase client (never called with a browser-scoped client —
 * routes/dataQuality.ts enforces that, mirroring every other
 * production store in this codebase).
 */
export function createSupabaseDataQualityStore(supabase: SupabaseClient): DataQualityStore {
  async function collectCandidates(): Promise<ViolationCandidate[]> {
    const [{ data: tenders }, { data: sourceRecords }, { data: documents }, { data: requirements }, { data: outcomes }, { data: executions }] = await Promise.all([
      supabase.from('tenders').select('id, tender_number, status, closing_date'),
      supabase.from('tender_source_records').select('id, tender_id, source_id, external_id, source_url'),
      supabase.from('tender_documents').select('id, downloaded_at, file_hash'),
      supabase.from('tender_requirements').select('id, mandatory, qualification_status'),
      supabase.from('tender_outcomes').select('id, outcome_status, winner_name, provenance, source_document_id, source_evidence_ref').eq('is_current', true),
      supabase.from('bid_submission_executions').select('id, agency_id, status'),
    ])

    const tenderRows = (tenders ?? []).map((t) => ({ id: t.id as string, tenderNumber: t.tender_number as string | null, status: t.status as string, closingDate: t.closing_date as string | null }))

    const tenderIdsWithSourceUrl = new Set(
      (sourceRecords ?? []).filter((r) => r.tender_id && r.source_url).map((r) => r.tender_id as string),
    )

    const tenderNumberGroups = new Map<string, string[]>()
    for (const t of tenderRows) {
      if (!t.tenderNumber) continue
      const list = tenderNumberGroups.get(t.tenderNumber) ?? []
      list.push(t.id)
      tenderNumberGroups.set(t.tenderNumber, list)
    }

    const sourceRecordGroups = new Map<string, string[]>()
    for (const r of sourceRecords ?? []) {
      if (!r.external_id) continue
      const key = `${r.source_id}::${r.external_id}`
      const list = sourceRecordGroups.get(key) ?? []
      list.push(r.id as string)
      sourceRecordGroups.set(key, list)
    }

    // A submission execution "has a verified receipt" only if at least
    // one linked bid_submission_receipts row reached VERIFIED — never
    // inferred from the execution's own status alone (spec §16).
    const executionIds = (executions ?? []).map((e) => e.id as string)
    const { data: receipts } = executionIds.length
      ? await supabase.from('bid_submission_receipts').select('submission_execution_id, verification_status').in('submission_execution_id', executionIds)
      : { data: [] as Array<{ submission_execution_id: string; verification_status: string }> }
    const verifiedExecutionIds = new Set((receipts ?? []).filter((r) => r.verification_status === 'VERIFIED').map((r) => r.submission_execution_id as string))

    return [
      ...checkTendersMissingClosingDate(tenderRows),
      ...checkTendersMissingSourceUrl(tenderRows.map((t) => t.id), tenderIdsWithSourceUrl),
      ...checkDuplicateTenderNumbers([...tenderNumberGroups.entries()].map(([tenderNumber, ids]) => ({ tenderNumber, ids }))),
      ...checkDuplicateSourceRecords(
        [...sourceRecordGroups.entries()].map(([key, ids]) => {
          const [sourceId, externalId] = key.split('::') as [string, string]
          return { sourceId, externalId, ids }
        }),
      ),
      ...checkDocumentsMissingHash((documents ?? []).map((d) => ({ id: d.id as string, downloadedAt: d.downloaded_at as string | null, fileHash: d.file_hash as string | null }))),
      ...checkMandatoryRequirementsWithoutAssessment((requirements ?? []).map((r) => ({ id: r.id as string, mandatory: Boolean(r.mandatory), qualificationStatus: r.qualification_status as string | null }))),
      ...checkOutcomesWithoutProvenance((outcomes ?? []).map((o) => toOutcomeRow(o))),
      ...checkWinnersWithoutEvidence((outcomes ?? []).map((o) => toOutcomeRow(o))),
      ...checkSubmittedBidsWithoutVerifiedEvidence(
        (executions ?? []).map((e) => ({ id: e.id as string, agencyId: e.agency_id as string, status: e.status as string, hasVerifiedReceipt: verifiedExecutionIds.has(e.id as string) })),
      ),
    ]
  }

  function toOutcomeRow(o: Record<string, unknown>) {
    return {
      id: o.id as string,
      outcomeStatus: o.outcome_status as string,
      winnerName: o.winner_name as string | null,
      provenance: o.provenance as string,
      sourceDocumentId: o.source_document_id as string | null,
      sourceEvidenceRef: o.source_evidence_ref as string | null,
    }
  }

  async function runScan(actorId: string | null): Promise<DataQualityViolationRow[]> {
    const candidates = await collectCandidates()
    const created: DataQualityViolationRow[] = []
    for (const c of candidates) {
      // Insert only if no OPEN violation already exists for this exact
      // (rule, entity) — the partial unique index enforces this at the
      // DB level too, so a duplicate insert attempt is caught and
      // ignored rather than erroring the whole scan.
      const { data: existing } = await supabase
        .from('data_quality_violations')
        .select('id')
        .eq('rule', c.rule)
        .eq('entity_type', c.entityType)
        .eq('entity_id', c.entityId)
        .eq('status', 'OPEN')
        .maybeSingle()
      if (existing) continue
      const { data, error } = await supabase
        .from('data_quality_violations')
        .insert({ agency_id: c.agencyId, rule: c.rule, severity: c.severity, entity_type: c.entityType, entity_id: c.entityId, details: c.details })
        .select('*')
        .maybeSingle()
      if (error) {
        if ((error as { code?: string }).code === '23505') continue // raced with a concurrent scan — not a new violation
        throw error
      }
      if (data) {
        created.push(dataQualityViolationSchema.parse(data))
        await supabase.from('audit_logs').insert({ agency_id: c.agencyId, actor_id: actorId, actor_type: actorId ? 'USER' : 'SYSTEM', action: 'DATA_QUALITY_VIOLATION_DETECTED', entity_type: 'data_quality_violations', entity_id: data.id, new_value: data })
      }
    }
    await supabase.from('audit_logs').insert({ agency_id: null, actor_id: actorId, actor_type: actorId ? 'USER' : 'SYSTEM', action: 'DATA_QUALITY_SCAN_RUN', entity_type: 'data_quality_scan', entity_id: null, new_value: { candidatesFound: candidates.length, newViolations: created.length } })
    return created
  }

  async function listViolations(filter: { status?: string; severity?: string; agencyId?: string | null }): Promise<DataQualityViolationRow[]> {
    let query = supabase.from('data_quality_violations').select('*').order('detected_at', { ascending: false })
    if (filter.status) query = query.eq('status', filter.status)
    if (filter.severity) query = query.eq('severity', filter.severity)
    if (filter.agencyId !== undefined) query = filter.agencyId === null ? query.is('agency_id', null) : query.eq('agency_id', filter.agencyId)
    const { data, error } = await query
    if (error) throw error
    return (data ?? []).map((d) => dataQualityViolationSchema.parse(d))
  }

  async function resolveViolation(id: string, input: { status: 'RESOLVED' | 'DISMISSED'; resolution: string; resolvedBy: string }): Promise<DataQualityViolationRow> {
    const { data, error } = await supabase
      .from('data_quality_violations')
      .update({ status: input.status, resolution: input.resolution, resolved_by: input.resolvedBy, resolved_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single()
    if (error) throw error
    const row = dataQualityViolationSchema.parse(data)
    await supabase.from('audit_logs').insert({
      agency_id: row.agency_id,
      actor_id: input.resolvedBy,
      actor_type: 'USER',
      action: input.status === 'RESOLVED' ? 'DATA_QUALITY_VIOLATION_RESOLVED' : 'DATA_QUALITY_VIOLATION_DISMISSED',
      entity_type: 'data_quality_violations',
      entity_id: id,
      new_value: row,
    })
    return row
  }

  async function getCompletenessDashboard(agencyId: string) {
    const [{ data: tenders }, { count: tenderCount }, { data: documents }, { data: requirements }, { data: criteria }, { data: outcomes }, { count: openConflicts }, { data: embeddings }, { data: executions }] = await Promise.all([
      supabase.from('tenders').select('id, status, closing_date'),
      supabase.from('tenders').select('id', { count: 'exact', head: true }),
      supabase.from('tender_documents').select('id, extraction_status'),
      supabase.from('tender_requirements').select('id, mandatory, qualification_status'),
      supabase.from('tender_evaluation_criteria').select('id, weight'),
      supabase.from('tender_outcomes').select('id, truth_status').eq('is_current', true),
      supabase.from('outcome_conflicts').select('id', { count: 'exact', head: true }).eq('status', 'OPEN'),
      supabase.from('agency_evidence_embeddings').select('id, status').eq('agency_id', agencyId),
      supabase.from('bid_submission_executions').select('id, status').eq('agency_id', agencyId),
    ])

    const domains: Record<string, CompletenessCounts> = {
      TENDER: countTenders(tenders ?? []),
      DOCUMENT: countDocuments(documents ?? []),
      REQUIREMENT: countRequirements(requirements ?? []),
      EVALUATION: countEvaluationCriteria(criteria ?? []),
      OUTCOME: countOutcomes(outcomes ?? [], openConflicts ?? 0),
      EVIDENCE: countEvidence(embeddings ?? []),
      SUBMISSION: countSubmissions(executions ?? []),
    }
    void tenderCount
    return buildCompletenessDashboard(domains)
  }

  function countTenders(rows: Array<{ status: string; closing_date: string | null }>): CompletenessCounts {
    const total = rows.length
    const missing = rows.filter((r) => !r.closing_date).length
    const unverified = rows.filter((r) => r.status === 'DISCOVERED' || r.status === 'VERIFYING').length
    return { total, known: total - missing - unverified, unverified, unknown: 0, missing, conflicting: 0 }
  }

  function countDocuments(rows: Array<{ extraction_status: string }>): CompletenessCounts {
    const total = rows.length
    const known = rows.filter((r) => r.extraction_status === 'EXTRACTED').length
    const missing = rows.filter((r) => r.extraction_status === 'FAILED' || r.extraction_status === 'NEEDS_REVIEW').length
    const unverified = rows.filter((r) => r.extraction_status === 'PENDING').length
    return { total, known, unverified, unknown: 0, missing, conflicting: 0 }
  }

  function countRequirements(rows: Array<{ mandatory: boolean; qualification_status: string | null }>): CompletenessCounts {
    const mandatory = rows.filter((r) => r.mandatory)
    const total = mandatory.length
    const unknown = mandatory.filter((r) => !r.qualification_status || r.qualification_status === 'UNKNOWN').length
    return { total, known: total - unknown, unverified: 0, unknown, missing: 0, conflicting: 0 }
  }

  function countEvaluationCriteria(rows: Array<{ weight: number | null }>): CompletenessCounts {
    const total = rows.length
    const unknown = rows.filter((r) => r.weight === null).length
    return { total, known: total - unknown, unverified: 0, unknown, missing: 0, conflicting: 0 }
  }

  function countOutcomes(rows: Array<{ truth_status: string }>, openConflicts: number): CompletenessCounts {
    const total = rows.length
    const known = rows.filter((r) => r.truth_status === 'VERIFIED').length
    const unverified = rows.filter((r) => r.truth_status === 'UNVERIFIED' || r.truth_status === 'INFERRED').length
    const unknown = rows.filter((r) => r.truth_status === 'UNKNOWN').length
    return { total, known, unverified, unknown, missing: 0, conflicting: openConflicts }
  }

  function countEvidence(rows: Array<{ status: string }>): CompletenessCounts {
    const total = rows.length
    const known = rows.filter((r) => r.status === 'READY').length
    const unverified = rows.filter((r) => r.status === 'STALE').length
    const missing = rows.filter((r) => r.status === 'FAILED').length
    const unknown = rows.filter((r) => r.status === 'NOT_EMBEDDED' || r.status === 'QUEUED' || r.status === 'PROCESSING').length
    return { total, known, unverified, unknown, missing, conflicting: 0 }
  }

  function countSubmissions(rows: Array<{ status: string }>): CompletenessCounts {
    const total = rows.length
    const known = rows.filter((r) => r.status === 'SUBMITTED').length
    const missing = rows.filter((r) => r.status === 'NOT_READY').length
    const unverified = rows.filter((r) => r.status === 'SUBMISSION_REPORTED' || r.status === 'REQUIRES_MANUAL_ACTION').length
    return { total, known, unverified, unknown: total - known - missing - unverified, missing, conflicting: 0 }
  }

  return { runScan, listViolations, resolveViolation, getCompletenessDashboard }
}
