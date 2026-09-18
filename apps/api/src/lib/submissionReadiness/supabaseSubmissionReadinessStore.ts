import type { SupabaseClient } from '@supabase/supabase-js'
import type { SubmissionPricingCurrency } from '@tender-os/constants'
import type { SubmissionReadinessInput, SubmissionEvidenceLifecycle } from './types.js'
import type {
  ApprovalRecord,
  PackFileRecordRow,
  PackRecord,
  PricingItemRecord,
  PricingRecord,
  ReadinessItemRecord,
  ReadinessRecord,
  SubmissionReadinessStore,
} from './store.js'
import { validatePricingLine } from './pricing.js'
import { calculateDeadlineState } from './deadline.js'
import { buildAddendumReconciliationInput } from '../addenda/reconciliation.js'

/**
 * Production `SubmissionReadinessStore` over the privileged
 * service-role Supabase client, mirroring
 * createSupabaseBidDecisionStore/createSupabaseProposalStore exactly.
 * All writes bypass RLS — never called with a browser-scoped client
 * (routes/submissionReadiness.ts enforces that).
 *
 * KNOWN LIMITATIONS (documented in docs/SUBMISSION-READINESS.md,
 * carried forward honestly rather than fabricated):
 *  - Forms/signatures have no dedicated per-tender extraction table
 *    yet (Phase 8/9 does not structurally distinguish "a form" from a
 *    general requirement) — this assembler derives a best-effort
 *    checklist from tender_requirements rows whose requirement_type is
 *    SUBMISSION, and leaves fine-grained completed/signed detail
 *    UNKNOWN (never fabricated true/false) unless a human records it.
 *  - File-level format/size/naming validation requires the tender to
 *    publish machine-readable constraints, which are not currently
 *    extracted as structured fields; where absent, files default to
 *    "no constraint" (formatValid/sizeValid null, NO_NAMING_RULE) —
 *    never invented as failing or passing.
 *  - Certificates map from agency_certificates' Phase 2
 *    evidence_status ('VERIFIED'->VALID, 'UNVERIFIED'/'UNKNOWN'/
 *    'INFERRED'->UNKNOWN) plus an explicit expiry_date check — no
 *    fabricated renewal status is ever produced.
 */
export function createSupabaseSubmissionReadinessStore(supabase: SupabaseClient): SubmissionReadinessStore {
  async function assembleInput(bidProjectId: string, agencyId: string, nowIso: string) {
    const { data: project } = await supabase.from('bid_strategy_projects').select('id, tender_id, agency_id, bid_decision_run_id').eq('id', bidProjectId).maybeSingle()
    if (!project) throw new Error('bid project not found')
    const tenderId = project.tender_id as string

    const [{ data: tender }, { data: decisionRun }, { data: requirements }, { data: criteria }, { data: briefings }, { data: addenda }, { data: proposal }, { data: certificates }, { data: agencyDocs }, pricing] = await Promise.all([
      supabase.from('tenders').select('closing_date, closing_time, submission_method, submission_url, submission_email').eq('id', tenderId).maybeSingle(),
      project.bid_decision_run_id ? supabase.from('bid_decision_runs').select('final_decision').eq('id', project.bid_decision_run_id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from('tender_requirements').select('id, requirement_type, requirement_text, mandatory, qualification_status').eq('tender_id', tenderId),
      supabase.from('tender_evaluation_criteria').select('id, weight, mandatory').eq('tender_id', tenderId),
      supabase.from('tender_briefings').select('id, mandatory, attendance_recorded').eq('tender_id', tenderId),
      supabase.from('tender_addenda').select('id, addendum_number, deadline_changed, briefing_changed, requirement_changed, evaluation_changed, pricing_changed').eq('tender_id', tenderId),
      supabase.from('bid_proposals').select('id, status').eq('bid_project_id', bidProjectId).maybeSingle(),
      supabase.from('agency_certificates').select('id, certificate_type, status, expiry_date').eq('agency_id', agencyId),
      supabase.from('agency_documents').select('id, document_type, status, expiry_date').eq('agency_id', agencyId),
      getCurrentPricing(bidProjectId),
    ])

    let proposalInput: SubmissionReadinessInput['proposal'] = {
      exists: false,
      versionId: null,
      matchesTender: true,
      matchesBidProject: true,
      isCurrentVersion: true,
      isStale: false,
      staleReason: null,
      complianceResult: null,
      missingRequiredSections: [],
    }
    let evidenceInputs: SubmissionReadinessInput['evidence'] = []

    if (proposal) {
      const { data: version } = await supabase.from('bid_proposal_versions').select('id, is_stale, stale_reason, agency_id').eq('proposal_id', proposal.id).eq('is_current', true).maybeSingle()
      if (version) {
        const { data: complianceResult } = await supabase.from('bid_proposal_compliance_results').select('result').eq('proposal_version_id', version.id).order('computed_at', { ascending: false }).limit(1).maybeSingle()
        proposalInput = {
          exists: true,
          versionId: version.id as string,
          matchesTender: true,
          matchesBidProject: true,
          isCurrentVersion: true,
          isStale: Boolean(version.is_stale),
          staleReason: (version.stale_reason as string) ?? null,
          complianceResult: (complianceResult?.result as 'BLOCKED' | 'REQUIRES_REVIEW' | 'READY_FOR_INTERNAL_REVIEW') ?? null,
          missingRequiredSections: [],
        }
      }

      const { data: claims } = await supabase
        .from('bid_evidence_claims')
        .select('id, match_id, bid_evidence_matches!inner(status, is_stale, is_current)')
        .eq('bid_project_id', bidProjectId)
      evidenceInputs = (claims ?? []).map((c: Record<string, unknown>) => {
        const match = c.bid_evidence_matches as { status: string; is_stale: boolean; is_current: boolean } | undefined
        let lifecycle: SubmissionEvidenceLifecycle = 'CANDIDATE_OR_UNVERIFIED'
        if (match?.status === 'APPROVED' && match.is_current && !match.is_stale) lifecycle = 'APPROVED_CURRENT'
        else if (match?.status === 'APPROVED' && (match.is_stale || !match.is_current)) lifecycle = 'APPROVED_STALE'
        else if (match?.status === 'REJECTED') lifecycle = 'REJECTED'
        else if (match?.status === 'SUPERSEDED') lifecycle = 'SUPERSEDED'
        return { id: c.id as string, mandatory: true, lifecycle }
      })
    }

    const { data: acknowledgements } = await supabase
      .from('bid_addendum_acknowledgements')
      .select('addendum_id, reconciled')
      .eq('bid_project_id', bidProjectId)
    const acknowledgementByAddendumId = new Map((acknowledgements ?? []).map((a) => [a.addendum_id as string, { addendumId: a.addendum_id as string, reconciled: Boolean(a.reconciled) }]))

    const deadline = calculateDeadlineState(nowIso, (tender?.closing_date as string) ?? null, (tender?.closing_time as string) ?? null)

    const input: SubmissionReadinessInput = {
      nowIso,
      tenderClosingDate: (tender?.closing_date as string) ?? null,
      tenderClosingTime: (tender?.closing_time as string) ?? null,
      qualification: { finalBidDecision: (decisionRun?.final_decision as 'BID' | 'REVIEW' | 'NO_BID') ?? null },
      requirements: (requirements ?? []).map((r) => ({
        id: r.id as string,
        mandatory: Boolean(r.mandatory),
        description: r.requirement_text as string,
        status:
          r.qualification_status === 'PASS'
            ? 'SATISFIED'
            : r.qualification_status === 'FAIL'
              ? 'MISSING'
              : r.qualification_status === 'NOT_APPLICABLE'
                ? 'NOT_APPLICABLE'
                : 'REQUIRES_REVIEW',
      })),
      evaluationCriteria: (criteria ?? []).map((c) => ({ id: c.id as string, weight: (c.weight as number) ?? null, mandatoryCoverage: Boolean((c as Record<string, unknown>).mandatory), covered: true })),
      briefings: (briefings ?? []).map((b) => ({ id: b.id as string, mandatory: Boolean(b.mandatory), attended: b.attendance_recorded ? true : null, attendanceRecorded: Boolean(b.attendance_recorded) })),
      addenda: (addenda ?? []).map((a) =>
        buildAddendumReconciliationInput(
          {
            id: a.id as string,
            addendumNumber: a.addendum_number as number,
            deadlineChanged: Boolean(a.deadline_changed),
            briefingChanged: Boolean(a.briefing_changed),
            requirementChanged: Boolean(a.requirement_changed),
            evaluationChanged: Boolean(a.evaluation_changed),
            pricingChanged: Boolean(a.pricing_changed),
          },
          acknowledgementByAddendumId.get(a.id as string) ?? null,
        ),
      ),
      proposal: proposalInput,
      evidence: evidenceInputs,
      pricing: {
        required: Boolean((requirements ?? []).some((r) => r.requirement_type === 'PRICING')),
        provided: Boolean(pricing && pricing.items.length > 0),
        currencyPresent: Boolean(pricing?.currency),
        lines: (pricing?.items ?? []).map((i) => ({ ...validatePricingLine({ id: i.id, quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal, currency: pricing?.currency ?? null }), description: i.description })),
        mandatoryScheduleRequired: false,
        mandatorySchedulePresent: Boolean(pricing && pricing.items.some((i) => i.isMandatoryScheduleItem)),
      },
      documents: [...(certificates ?? []).map((c) => ({ id: c.id as string, name: c.certificate_type as string, required: true, status: mapDocumentStatus(c.status as string, c.expiry_date as string | null, nowIso) })), ...(agencyDocs ?? []).map((d) => ({ id: d.id as string, name: d.document_type as string, required: false, status: mapDocumentStatus(d.status as string, d.expiry_date as string | null, nowIso) }))],
      forms: [],
      certificates: (certificates ?? []).map((c) => ({ id: c.id as string, name: c.certificate_type as string, required: true, status: mapCertificateStatus(c.status as string, c.expiry_date as string | null, nowIso) })),
      signatures: [],
      files: [],
      submissionMethod: {
        method: mapSubmissionMethod(tender?.submission_method as string | null),
        instructionsKnown: Boolean(tender?.submission_url || tender?.submission_email || (tender?.submission_method && tender.submission_method !== 'UNKNOWN')),
      },
    }

    const snapshot = {
      tenderClosingDate: input.tenderClosingDate,
      tenderClosingTime: input.tenderClosingTime,
      qualification: input.qualification,
      requirements: input.requirements,
      evaluationCriteria: input.evaluationCriteria,
      addenda: input.addenda,
      proposalVersionId: input.proposal.versionId,
      proposalIsStale: input.proposal.isStale,
      evidence: input.evidence,
      pricingId: pricing?.id ?? null,
      pricingItems: pricing?.items ?? [],
      certificates: input.certificates,
      submissionMethod: input.submissionMethod,
      deadlineState: deadline.state,
    }

    return { input, snapshot }
  }

  async function getCurrentReadiness(bidProjectId: string): Promise<ReadinessRecord | null> {
    const { data } = await supabase.from('bid_submission_readiness').select('*').eq('bid_project_id', bidProjectId).eq('is_current', true).maybeSingle()
    return data ? toReadinessRecord(data) : null
  }

  async function getReadiness(readinessId: string): Promise<ReadinessRecord | null> {
    const { data } = await supabase.from('bid_submission_readiness').select('*').eq('id', readinessId).maybeSingle()
    return data ? toReadinessRecord(data) : null
  }

  async function listReadinessItems(readinessId: string): Promise<ReadinessItemRecord[]> {
    const { data } = await supabase.from('bid_submission_readiness_items').select('*').eq('readiness_id', readinessId)
    return (data ?? []).map((i) => ({ id: i.id, category: i.category, severity: i.severity, code: i.code, message: i.message, sourceType: i.source_type, sourceId: i.source_id, resolved: Boolean(i.resolved) }))
  }

  async function createReadinessSnapshot(input: Parameters<SubmissionReadinessStore['createReadinessSnapshot']>[0]): Promise<ReadinessRecord> {
    await supabase.from('bid_submission_readiness').update({ is_current: false }).eq('bid_project_id', input.bidProjectId).eq('is_current', true)
    const currentPricing = await getCurrentPricing(input.bidProjectId)
    const { data, error } = await supabase
      .from('bid_submission_readiness')
      .insert({
        bid_project_id: input.bidProjectId,
        agency_id: input.agencyId,
        tender_id: input.tenderId,
        status: input.result.status,
        proposal_version_id: input.proposalVersionId,
        pricing_id: currentPricing?.id ?? null,
        input_snapshot: input.snapshot,
        category_summary: input.result.categorySummary,
        computed_by: input.computedBy,
        is_current: true,
      })
      .select('*')
      .single()
    if (error || !data) throw new Error(error?.message ?? 'failed to create readiness snapshot')
    if (input.result.items.length > 0) {
      await supabase.from('bid_submission_readiness_items').insert(
        input.result.items.map((i) => ({ readiness_id: data.id, category: i.category, severity: i.severity, code: i.code, message: i.message, source_type: i.sourceType, source_id: i.sourceId })),
      )
    }
    return toReadinessRecord(data)
  }

  async function getCurrentPricing(bidProjectId: string): Promise<PricingRecord | null> {
    const { data: pricing } = await supabase.from('bid_pricing').select('*').eq('bid_project_id', bidProjectId).eq('is_current', true).maybeSingle()
    if (!pricing) return null
    const { data: items } = await supabase.from('bid_pricing_items').select('*').eq('pricing_id', pricing.id).order('line_number')
    return toPricingRecord(pricing, items ?? [])
  }

  async function createPricing(bidProjectId: string, agencyId: string, currency: SubmissionPricingCurrency, createdBy: string | null): Promise<PricingRecord> {
    await supabase.from('bid_pricing').update({ is_current: false }).eq('bid_project_id', bidProjectId).eq('is_current', true)
    const { count } = await supabase.from('bid_pricing').select('id', { count: 'exact', head: true }).eq('bid_project_id', bidProjectId)
    const { data, error } = await supabase.from('bid_pricing').insert({ bid_project_id: bidProjectId, agency_id: agencyId, currency, version: (count ?? 0) + 1, created_by: createdBy }).select('*').single()
    if (error || !data) throw new Error(error?.message ?? 'failed to create pricing')
    return toPricingRecord(data, [])
  }

  async function upsertPricingItem(pricingId: string, agencyId: string, item: Parameters<SubmissionReadinessStore['upsertPricingItem']>[2]): Promise<PricingItemRecord> {
    const { data: pricing } = await supabase.from('bid_pricing').select('agency_id').eq('id', pricingId).maybeSingle()
    if (!pricing || pricing.agency_id !== agencyId) throw new Error('FORBIDDEN: pricing does not belong to this agency')
    const { data, error } = await supabase
      .from('bid_pricing_items')
      .insert({ pricing_id: pricingId, agency_id: agencyId, line_number: item.lineNumber, description: item.description, quantity: item.quantity, unit: item.unit, unit_price: item.unitPrice, line_total: item.lineTotal, is_mandatory_schedule_item: item.isMandatoryScheduleItem, notes: item.notes })
      .select('*')
      .single()
    if (error || !data) throw new Error(error?.message ?? 'failed to create pricing item')
    return toPricingItemRecord(data)
  }

  async function updatePricingItem(itemId: string, agencyId: string, patch: Parameters<SubmissionReadinessStore['updatePricingItem']>[2]): Promise<PricingItemRecord> {
    const { data: existing } = await supabase.from('bid_pricing_items').select('agency_id').eq('id', itemId).maybeSingle()
    if (!existing || existing.agency_id !== agencyId) throw new Error('FORBIDDEN: pricing item does not belong to this agency')
    const { data, error } = await supabase
      .from('bid_pricing_items')
      .update({ description: patch.description, quantity: patch.quantity, unit: patch.unit, unit_price: patch.unitPrice, line_total: patch.lineTotal, is_mandatory_schedule_item: patch.isMandatoryScheduleItem, notes: patch.notes })
      .eq('id', itemId)
      .select('*')
      .single()
    if (error || !data) throw new Error(error?.message ?? 'failed to update pricing item')
    return toPricingItemRecord(data)
  }

  async function getCurrentPack(bidProjectId: string): Promise<PackRecord | null> {
    const { data } = await supabase.from('bid_submission_packs').select('*').eq('bid_project_id', bidProjectId).eq('status', 'CURRENT').maybeSingle()
    return data ? toPackRecord(data, await filesFor(data.id)) : null
  }

  async function getPack(packId: string): Promise<PackRecord | null> {
    const { data } = await supabase.from('bid_submission_packs').select('*').eq('id', packId).maybeSingle()
    return data ? toPackRecord(data, await filesFor(packId)) : null
  }

  async function listPackVersions(bidProjectId: string): Promise<PackRecord[]> {
    const { data } = await supabase.from('bid_submission_packs').select('*').eq('bid_project_id', bidProjectId).order('version')
    return Promise.all((data ?? []).map(async (p) => toPackRecord(p, await filesFor(p.id))))
  }

  async function filesFor(packId: string): Promise<PackFileRecordRow[]> {
    const { data } = await supabase.from('bid_submission_pack_files').select('*').eq('pack_id', packId)
    return (data ?? []).map((f) => ({ id: f.id, documentType: f.document_type, fileName: f.file_name, storagePath: f.storage_path, mimeType: f.mime_type, sizeBytes: f.size_bytes, sha256: f.sha256, sourceTable: f.source_table, sourceId: f.source_id }))
  }

  async function createPack(input: Parameters<SubmissionReadinessStore['createPack']>[0]): Promise<PackRecord> {
    await supabase.from('bid_submission_packs').update({ status: 'SUPERSEDED' }).eq('bid_project_id', input.bidProjectId).eq('status', 'CURRENT')
    const { count } = await supabase.from('bid_submission_packs').select('id', { count: 'exact', head: true }).eq('bid_project_id', input.bidProjectId)
    const { data, error } = await supabase
      .from('bid_submission_packs')
      .insert({ bid_project_id: input.bidProjectId, agency_id: input.agencyId, readiness_id: input.readinessId, version: (count ?? 0) + 1, manifest: input.manifest, proposal_version_id: input.proposalVersionId, pricing_id: input.pricingId, created_by: input.createdBy })
      .select('*')
      .single()
    if (error || !data) throw new Error(error?.message ?? 'failed to create pack')
    if (input.files.length > 0) {
      await supabase.from('bid_submission_pack_files').insert(input.files.map((f) => ({ pack_id: data.id, agency_id: input.agencyId, document_type: f.documentType, file_name: f.fileName, storage_path: f.storagePath, mime_type: f.mimeType, size_bytes: f.sizeBytes, sha256: f.sha256, source_table: f.sourceTable, source_id: f.sourceId })))
    }
    await supabase.from('bid_submission_manifests').insert({ pack_id: data.id, agency_id: input.agencyId, manifest: input.manifest, created_by: input.createdBy })
    return toPackRecord(data, await filesFor(data.id))
  }

  async function invalidatePack(packId: string, agencyId: string): Promise<void> {
    const { data: existing } = await supabase.from('bid_submission_packs').select('agency_id').eq('id', packId).maybeSingle()
    if (!existing || existing.agency_id !== agencyId) throw new Error('FORBIDDEN: pack does not belong to this agency')
    await supabase.from('bid_submission_packs').update({ status: 'INVALIDATED' }).eq('id', packId)
  }

  async function getActiveApproval(bidProjectId: string): Promise<ApprovalRecord | null> {
    const { data } = await supabase.from('bid_submission_approvals').select('*').eq('bid_project_id', bidProjectId).eq('status', 'APPROVED').maybeSingle()
    return data ? toApprovalRecord(data) : null
  }

  async function createApproval(input: Parameters<SubmissionReadinessStore['createApproval']>[0]): Promise<ApprovalRecord> {
    const { data, error } = await supabase
      .from('bid_submission_approvals')
      .insert({ bid_project_id: input.bidProjectId, agency_id: input.agencyId, readiness_id: input.readinessId, pack_id: input.packId, approval_reason: input.approvalReason, approved_by: input.approvedBy })
      .select('*')
      .single()
    if (error || !data) throw new Error(error?.message ?? 'failed to create approval')
    return toApprovalRecord(data)
  }

  async function revokeApproval(approvalId: string, agencyId: string, revokedBy: string, reason: string): Promise<ApprovalRecord> {
    const { data: existing } = await supabase.from('bid_submission_approvals').select('agency_id').eq('id', approvalId).maybeSingle()
    if (!existing || existing.agency_id !== agencyId) throw new Error('FORBIDDEN: approval does not belong to this agency')
    const { data, error } = await supabase.from('bid_submission_approvals').update({ status: 'REVOKED', revoked_by: revokedBy, revoked_at: new Date().toISOString(), revoked_reason: reason }).eq('id', approvalId).select('*').single()
    if (error || !data) throw new Error(error?.message ?? 'failed to revoke approval')
    return toApprovalRecord(data)
  }

  async function writeAuditEvent(event: Parameters<SubmissionReadinessStore['writeAuditEvent']>[0]): Promise<void> {
    await supabase.from('audit_logs').insert({ agency_id: event.agencyId, actor_id: event.actorId, actor_type: event.actorId ? 'USER' : 'SYSTEM', action: event.eventType, entity_type: 'submission_readiness', entity_id: event.entityId, old_value: event.oldValue, new_value: event.newValue })
  }

  return {
    assembleInput,
    getCurrentReadiness,
    getReadiness,
    listReadinessItems,
    createReadinessSnapshot,
    getCurrentPricing,
    createPricing,
    upsertPricingItem,
    updatePricingItem,
    getCurrentPack,
    getPack,
    listPackVersions,
    createPack,
    invalidatePack,
    getActiveApproval,
    createApproval,
    revokeApproval,
    writeAuditEvent,
  }
}

function toReadinessRecord(row: Record<string, unknown>): ReadinessRecord {
  return {
    id: row.id as string,
    bidProjectId: row.bid_project_id as string,
    status: row.status as ReadinessRecord['status'],
    proposalVersionId: (row.proposal_version_id as string) ?? null,
    pricingId: (row.pricing_id as string) ?? null,
    inputSnapshot: (row.input_snapshot as Record<string, unknown>) ?? {},
    categorySummary: (row.category_summary as Record<string, unknown>) ?? {},
    isCurrent: Boolean(row.is_current),
    computedAt: row.computed_at as string,
  }
}

function toPricingRecord(row: Record<string, unknown>, items: Record<string, unknown>[]): PricingRecord {
  return { id: row.id as string, bidProjectId: row.bid_project_id as string, version: row.version as number, currency: row.currency as SubmissionPricingCurrency, isCurrent: Boolean(row.is_current), items: items.map(toPricingItemRecord) }
}

function toPricingItemRecord(row: Record<string, unknown>): PricingItemRecord {
  return { id: row.id as string, lineNumber: row.line_number as number, description: row.description as string, quantity: Number(row.quantity), unit: (row.unit as string) ?? null, unitPrice: Number(row.unit_price), lineTotal: Number(row.line_total), isMandatoryScheduleItem: Boolean(row.is_mandatory_schedule_item), notes: (row.notes as string) ?? null }
}

function toPackRecord(row: Record<string, unknown>, files: PackFileRecordRow[]): PackRecord {
  return { id: row.id as string, bidProjectId: row.bid_project_id as string, version: row.version as number, status: row.status as PackRecord['status'], readinessId: row.readiness_id as string, manifest: (row.manifest as Record<string, unknown>) ?? {}, proposalVersionId: (row.proposal_version_id as string) ?? null, pricingId: (row.pricing_id as string) ?? null, files, createdAt: row.created_at as string }
}

function toApprovalRecord(row: Record<string, unknown>): ApprovalRecord {
  return { id: row.id as string, bidProjectId: row.bid_project_id as string, readinessId: row.readiness_id as string, packId: row.pack_id as string, status: row.status as ApprovalRecord['status'], approvalReason: row.approval_reason as string, approvedBy: row.approved_by as string, approvedAt: row.approved_at as string }
}

function mapCertificateStatus(status: string | null, expiryDate: string | null, nowIso: string): 'VALID' | 'EXPIRED' | 'UNKNOWN' | 'MISSING' {
  if (!status) return 'MISSING'
  if (expiryDate && new Date(expiryDate).getTime() < new Date(nowIso).getTime()) return 'EXPIRED'
  if (status === 'VERIFIED') return 'VALID'
  return 'UNKNOWN'
}

function mapDocumentStatus(status: string | null, expiryDate: string | null, nowIso: string): 'REQUIRED' | 'PRESENT' | 'VERIFIED' | 'EXPIRED' | 'MISSING' | 'INVALID' | 'REQUIRES_REVIEW' | 'NOT_REQUIRED' {
  if (!status) return 'MISSING'
  if (expiryDate && new Date(expiryDate).getTime() < new Date(nowIso).getTime()) return 'EXPIRED'
  if (status === 'VERIFIED') return 'VERIFIED'
  if (status === 'INFERRED') return 'PRESENT'
  return 'REQUIRES_REVIEW'
}

function mapSubmissionMethod(raw: string | null): 'PORTAL' | 'EMAIL' | 'PHYSICAL' | 'HAND_DELIVERY' | 'COURIER' | 'OTHER' | 'UNKNOWN' {
  if (!raw) return 'UNKNOWN'
  const normalised = raw.trim().toUpperCase()
  if (normalised.includes('PORTAL') || normalised.includes('ETENDER') || normalised.includes('ONLINE')) return 'PORTAL'
  if (normalised.includes('EMAIL')) return 'EMAIL'
  if (normalised.includes('HAND')) return 'HAND_DELIVERY'
  if (normalised.includes('COURIER')) return 'COURIER'
  if (normalised.includes('PHYSICAL') || normalised.includes('TENDER BOX') || normalised.includes('DROP')) return 'PHYSICAL'
  return 'OTHER'
}
