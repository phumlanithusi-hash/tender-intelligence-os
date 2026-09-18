import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AttemptRecord,
  BidContext,
  ConfirmationRecord,
  ReceiptRecord,
  SubmissionExecutionRecord,
  SubmissionExecutionStore,
} from './store.js'

/**
 * Production `SubmissionExecutionStore` over the privileged
 * service-role Supabase client, mirroring
 * createSupabaseSubmissionReadinessStore exactly. All writes bypass
 * RLS — never called with a browser-scoped client
 * (routes/submissionExecution.ts enforces that).
 */
export function createSupabaseSubmissionExecutionStore(supabase: SupabaseClient): SubmissionExecutionStore {
  async function getBidContext(bidProjectId: string, agencyId: string): Promise<BidContext | null> {
    const { data: project } = await supabase.from('bid_strategy_projects').select('id, tender_id, agency_id, bid_decision_run_id').eq('id', bidProjectId).maybeSingle()
    if (!project || project.agency_id !== agencyId) return null

    const [{ data: tender }, { data: decisionRun }] = await Promise.all([
      supabase.from('tenders').select('closing_date, closing_time, submission_method, submission_url, submission_email').eq('id', project.tender_id).maybeSingle(),
      project.bid_decision_run_id ? supabase.from('bid_decision_runs').select('final_decision').eq('id', project.bid_decision_run_id).maybeSingle() : Promise.resolve({ data: null }),
    ])

    return {
      bidProjectId,
      agencyId,
      tenderId: project.tender_id as string,
      finalBidDecision: (decisionRun?.final_decision as 'BID' | 'REVIEW' | 'NO_BID') ?? null,
      humanOverrideToBid: false,
      tenderClosingDate: (tender?.closing_date as string) ?? null,
      tenderClosingTime: (tender?.closing_time as string) ?? null,
      tenderSubmissionMethod: (tender?.submission_method as string) ?? null,
      tenderSubmissionUrl: (tender?.submission_url as string) ?? null,
      tenderSubmissionEmail: (tender?.submission_email as string) ?? null,
      documentEvidenceMethod: null,
    }
  }

  async function getReadinessContext(bidProjectId: string) {
    const { data: readiness } = await supabase.from('bid_submission_readiness').select('id, status').eq('bid_project_id', bidProjectId).eq('is_current', true).maybeSingle()
    if (!readiness) return { readinessId: null, status: null, blockerCount: 0 }
    const { data: items } = await supabase.from('bid_submission_readiness_items').select('id').eq('readiness_id', readiness.id).eq('severity', 'BLOCKER')
    return { readinessId: readiness.id as string, status: readiness.status as string, blockerCount: (items ?? []).length }
  }

  async function getPackContext(bidProjectId: string) {
    const { data: pack } = await supabase.from('bid_submission_packs').select('id, version, status, manifest').eq('bid_project_id', bidProjectId).eq('status', 'CURRENT').maybeSingle()
    if (!pack) return { packId: null, version: null, status: null, manifestHash: null, files: [] }
    const { data: files } = await supabase.from('bid_submission_pack_files').select('file_name, storage_path, mime_type, size_bytes, sha256').eq('pack_id', pack.id)
    const manifest = (pack.manifest as Record<string, unknown>) ?? {}
    return {
      packId: pack.id as string,
      version: pack.version as number,
      status: pack.status as 'CURRENT' | 'SUPERSEDED' | 'INVALIDATED',
      manifestHash: (manifest.generatedAt as string) ?? null,
      files: (files ?? []).map((f) => ({ fileName: f.file_name as string, storagePath: (f.storage_path as string) ?? null, mimeType: (f.mime_type as string) ?? null, sizeBytes: (f.size_bytes as number) ?? null, sha256: f.sha256 as string })),
    }
  }

  async function getApprovalContext(bidProjectId: string) {
    const { data: approval } = await supabase.from('bid_submission_approvals').select('id, status, pack_id, readiness_id').eq('bid_project_id', bidProjectId).eq('status', 'APPROVED').maybeSingle()
    if (!approval) return { approvalId: null, status: null, packId: null, readinessId: null }
    return { approvalId: approval.id as string, status: approval.status as 'APPROVED' | 'REVOKED' | 'SUPERSEDED', packId: approval.pack_id as string, readinessId: approval.readiness_id as string }
  }

  async function getExecution(bidProjectId: string): Promise<SubmissionExecutionRecord | null> {
    const { data } = await supabase.from('bid_submission_executions').select('*').eq('bid_project_id', bidProjectId).maybeSingle()
    return data ? toExecutionRecord(data) : null
  }

  async function upsertExecution(bidProjectId: string, agencyId: string, tenderId: string, patch: Partial<SubmissionExecutionRecord>, expectedVersion: number | null): Promise<SubmissionExecutionRecord> {
    const { data: existing } = await supabase.from('bid_submission_executions').select('id, version').eq('bid_project_id', bidProjectId).maybeSingle()
    const row = toRow(patch)

    if (existing) {
      if (expectedVersion !== null && existing.version !== expectedVersion) {
        throw new Error(`CONFLICT: submission execution has changed since it was last read (expected version ${expectedVersion}, found ${existing.version}).`)
      }
      const { data, error } = await supabase.from('bid_submission_executions').update({ ...row, version: existing.version + 1 }).eq('id', existing.id).select('*').single()
      if (error || !data) throw new Error(error?.message ?? 'failed to update submission execution')
      return toExecutionRecord(data)
    }

    const { data, error } = await supabase.from('bid_submission_executions').insert({ bid_project_id: bidProjectId, agency_id: agencyId, tender_id: tenderId, ...row }).select('*').single()
    if (error || !data) throw new Error(error?.message ?? 'failed to create submission execution')
    return toExecutionRecord(data)
  }

  async function listConfirmations(submissionExecutionId: string): Promise<ConfirmationRecord[]> {
    const { data } = await supabase.from('bid_submission_confirmations').select('*').eq('submission_execution_id', submissionExecutionId).order('confirmed_at')
    return (data ?? []).map(toConfirmationRecord)
  }

  async function getLatestActiveConfirmation(submissionExecutionId: string): Promise<ConfirmationRecord | null> {
    const { data } = await supabase.from('bid_submission_confirmations').select('*').eq('submission_execution_id', submissionExecutionId).eq('invalidated', false).order('confirmed_at', { ascending: false }).limit(1).maybeSingle()
    return data ? toConfirmationRecord(data) : null
  }

  async function createConfirmation(input: Parameters<SubmissionExecutionStore['createConfirmation']>[0]): Promise<ConfirmationRecord> {
    const { data, error } = await supabase
      .from('bid_submission_confirmations')
      .insert({
        submission_execution_id: input.submissionExecutionId,
        agency_id: input.agencyId,
        readiness_id: input.readinessId,
        pack_id: input.packId,
        pack_version: input.packVersion,
        pack_hash: input.packHash,
        manifest_hash: input.manifestHash,
        submission_method: input.submissionMethod,
        target_value: input.targetValue,
        deadline_at: input.deadlineAt,
        statement: input.statement,
        confirmed_by: input.confirmedBy,
      })
      .select('*')
      .single()
    if (error || !data) throw new Error(error?.message ?? 'failed to create confirmation')
    return toConfirmationRecord(data)
  }

  async function invalidateConfirmation(confirmationId: string, agencyId: string, reason: string): Promise<void> {
    await supabase.from('bid_submission_confirmations').update({ invalidated: true, invalidated_reason: reason, invalidated_at: new Date().toISOString() }).eq('id', confirmationId).eq('agency_id', agencyId)
  }

  async function listAttempts(submissionExecutionId: string): Promise<AttemptRecord[]> {
    const { data } = await supabase.from('bid_submission_attempts').select('*').eq('submission_execution_id', submissionExecutionId).order('attempt_number')
    return (data ?? []).map(toAttemptRecord)
  }

  async function getActiveAttempt(submissionExecutionId: string): Promise<AttemptRecord | null> {
    const { data } = await supabase.from('bid_submission_attempts').select('*').eq('submission_execution_id', submissionExecutionId).eq('status', 'STARTED').maybeSingle()
    return data ? toAttemptRecord(data) : null
  }

  async function createAttempt(input: Parameters<SubmissionExecutionStore['createAttempt']>[0]): Promise<AttemptRecord> {
    const { data, error } = await supabase
      .from('bid_submission_attempts')
      .insert({
        submission_execution_id: input.submissionExecutionId,
        agency_id: input.agencyId,
        attempt_number: input.attemptNumber,
        method: input.method,
        pack_id: input.packId,
        pack_version: input.packVersion,
        pack_hash: input.packHash,
        manifest_hash: input.manifestHash,
        initiated_by: input.initiatedBy,
        confirmation_id: input.confirmationId,
        idempotency_key: input.idempotencyKey,
        started_at: input.startedAt,
      })
      .select('*')
      .single()
    if (error || !data) throw new Error(error?.message ?? 'failed to create attempt')
    return toAttemptRecord(data)
  }

  async function completeAttempt(attemptId: string, agencyId: string, patch: Parameters<SubmissionExecutionStore['completeAttempt']>[2]): Promise<AttemptRecord> {
    const { data: existing } = await supabase.from('bid_submission_attempts').select('agency_id').eq('id', attemptId).maybeSingle()
    if (!existing || existing.agency_id !== agencyId) throw new Error('FORBIDDEN: attempt does not belong to this agency')
    const { data, error } = await supabase
      .from('bid_submission_attempts')
      .update({
        status: patch.status,
        completed_at: new Date().toISOString(),
        provider_name: patch.providerName,
        provider_reference: patch.providerReference,
        external_submission_id: patch.externalSubmissionId,
        response_status: patch.responseStatus,
        response_code: patch.responseCode,
        error_code: patch.errorCode,
        error_message: patch.errorMessage,
        retryable: patch.retryable,
        human_action_required: patch.humanActionRequired,
      })
      .eq('id', attemptId)
      .select('*')
      .single()
    if (error || !data) throw new Error(error?.message ?? 'failed to complete attempt')
    return toAttemptRecord(data)
  }

  async function listReceipts(submissionExecutionId: string): Promise<ReceiptRecord[]> {
    const { data } = await supabase.from('bid_submission_receipts').select('*').eq('submission_execution_id', submissionExecutionId).order('captured_at')
    return (data ?? []).map(toReceiptRecord)
  }

  async function createReceipt(input: Parameters<SubmissionExecutionStore['createReceipt']>[0]): Promise<ReceiptRecord> {
    const { data, error } = await supabase
      .from('bid_submission_receipts')
      .insert({
        submission_execution_id: input.submissionExecutionId,
        attempt_id: input.attemptId,
        agency_id: input.agencyId,
        receipt_type: input.receiptType,
        provider_name: input.providerName,
        provider_reference: input.providerReference,
        receipt_url: input.receiptUrl,
        receipt_file: input.receiptFile,
        receipt_hash: input.receiptHash,
        issued_at: input.issuedAt,
        captured_by: input.capturedBy,
        verification_status: input.verificationStatus,
        notes: input.notes,
      })
      .select('*')
      .single()
    if (error || !data) throw new Error(error?.message ?? 'failed to create receipt')
    return toReceiptRecord(data)
  }

  async function updateReceiptVerification(receiptId: string, agencyId: string, verificationStatus: ReceiptRecord['verificationStatus'], notes: string | null): Promise<ReceiptRecord> {
    const { data: existing } = await supabase.from('bid_submission_receipts').select('agency_id').eq('id', receiptId).maybeSingle()
    if (!existing || existing.agency_id !== agencyId) throw new Error('FORBIDDEN: receipt does not belong to this agency')
    const { data, error } = await supabase.from('bid_submission_receipts').update({ verification_status: verificationStatus, notes }).eq('id', receiptId).select('*').single()
    if (error || !data) throw new Error(error?.message ?? 'failed to update receipt')
    return toReceiptRecord(data)
  }

  async function writeAuditEvent(event: Parameters<SubmissionExecutionStore['writeAuditEvent']>[0]): Promise<void> {
    await supabase.from('audit_logs').insert({ agency_id: event.agencyId, actor_id: event.actorId, actor_type: event.actorId ? 'USER' : 'SYSTEM', action: event.eventType, entity_type: 'submission_execution', entity_id: event.entityId, old_value: event.oldValue, new_value: event.newValue })
  }

  return {
    getBidContext,
    getReadinessContext,
    getPackContext,
    getApprovalContext,
    getExecution,
    upsertExecution,
    listConfirmations,
    getLatestActiveConfirmation,
    createConfirmation,
    invalidateConfirmation,
    listAttempts,
    getActiveAttempt,
    createAttempt,
    completeAttempt,
    listReceipts,
    createReceipt,
    updateReceiptVerification,
    writeAuditEvent,
  }
}

function toRow(patch: Partial<SubmissionExecutionRecord>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (patch.status !== undefined) row.status = patch.status
  if (patch.submissionMethod !== undefined) row.submission_method = patch.submissionMethod
  if (patch.automationStatus !== undefined) row.automation_status = patch.automationStatus
  if (patch.targetKind !== undefined) row.target_kind = patch.targetKind
  if (patch.targetValue !== undefined) row.target_value = patch.targetValue
  if (patch.approvedReadinessId !== undefined) row.approved_readiness_id = patch.approvedReadinessId
  if (patch.submissionPackId !== undefined) row.submission_pack_id = patch.submissionPackId
  if (patch.submissionPackVersion !== undefined) row.submission_pack_version = patch.submissionPackVersion
  if (patch.submissionPackHash !== undefined) row.submission_pack_hash = patch.submissionPackHash
  if (patch.manifestHash !== undefined) row.manifest_hash = patch.manifestHash
  if (patch.confirmedBy !== undefined) row.confirmed_by = patch.confirmedBy
  if (patch.confirmedAt !== undefined) row.confirmed_at = patch.confirmedAt
  if (patch.startedAt !== undefined) row.started_at = patch.startedAt
  if (patch.completedAt !== undefined) row.completed_at = patch.completedAt
  if (patch.providerName !== undefined) row.provider_name = patch.providerName
  if (patch.providerReference !== undefined) row.provider_reference = patch.providerReference
  if (patch.externalSubmissionId !== undefined) row.external_submission_id = patch.externalSubmissionId
  if (patch.failureCode !== undefined) row.failure_code = patch.failureCode
  if (patch.failureMessage !== undefined) row.failure_message = patch.failureMessage
  if (patch.retryable !== undefined) row.retryable = patch.retryable
  if (patch.physicalStage !== undefined) row.physical_stage = patch.physicalStage
  return row
}

function toExecutionRecord(row: Record<string, unknown>): SubmissionExecutionRecord {
  return {
    id: row.id as string,
    bidProjectId: row.bid_project_id as string,
    agencyId: row.agency_id as string,
    tenderId: row.tender_id as string,
    status: row.status as SubmissionExecutionRecord['status'],
    submissionMethod: row.submission_method as SubmissionExecutionRecord['submissionMethod'],
    automationStatus: row.automation_status as SubmissionExecutionRecord['automationStatus'],
    targetKind: (row.target_kind as string) ?? null,
    targetValue: (row.target_value as string) ?? null,
    approvedReadinessId: (row.approved_readiness_id as string) ?? null,
    submissionPackId: (row.submission_pack_id as string) ?? null,
    submissionPackVersion: (row.submission_pack_version as number) ?? null,
    submissionPackHash: (row.submission_pack_hash as string) ?? null,
    manifestHash: (row.manifest_hash as string) ?? null,
    confirmedBy: (row.confirmed_by as string) ?? null,
    confirmedAt: (row.confirmed_at as string) ?? null,
    startedAt: (row.started_at as string) ?? null,
    completedAt: (row.completed_at as string) ?? null,
    providerName: (row.provider_name as string) ?? null,
    providerReference: (row.provider_reference as string) ?? null,
    externalSubmissionId: (row.external_submission_id as string) ?? null,
    failureCode: (row.failure_code as SubmissionExecutionRecord['failureCode']) ?? null,
    failureMessage: (row.failure_message as string) ?? null,
    retryable: row.retryable === null || row.retryable === undefined ? null : Boolean(row.retryable),
    physicalStage: row.physical_stage as SubmissionExecutionRecord['physicalStage'],
    version: row.version as number,
  }
}

function toConfirmationRecord(row: Record<string, unknown>): ConfirmationRecord {
  return {
    id: row.id as string,
    submissionExecutionId: row.submission_execution_id as string,
    agencyId: row.agency_id as string,
    readinessId: row.readiness_id as string,
    packId: row.pack_id as string,
    packVersion: row.pack_version as number,
    packHash: row.pack_hash as string,
    manifestHash: row.manifest_hash as string,
    submissionMethod: row.submission_method as ConfirmationRecord['submissionMethod'],
    targetValue: (row.target_value as string) ?? null,
    deadlineAt: (row.deadline_at as string) ?? null,
    statement: row.statement as string,
    confirmedBy: row.confirmed_by as string,
    confirmedAt: row.confirmed_at as string,
    invalidated: Boolean(row.invalidated),
  }
}

function toAttemptRecord(row: Record<string, unknown>): AttemptRecord {
  return {
    id: row.id as string,
    submissionExecutionId: row.submission_execution_id as string,
    agencyId: row.agency_id as string,
    attemptNumber: row.attempt_number as number,
    status: row.status as AttemptRecord['status'],
    method: row.method as AttemptRecord['method'],
    packId: row.pack_id as string,
    packVersion: row.pack_version as number,
    packHash: row.pack_hash as string,
    manifestHash: row.manifest_hash as string,
    initiatedBy: row.initiated_by as string,
    confirmationId: row.confirmation_id as string,
    idempotencyKey: row.idempotency_key as string,
    startedAt: row.started_at as string,
    completedAt: (row.completed_at as string) ?? null,
    providerName: (row.provider_name as string) ?? null,
    providerReference: (row.provider_reference as string) ?? null,
    externalSubmissionId: (row.external_submission_id as string) ?? null,
    responseStatus: (row.response_status as string) ?? null,
    responseCode: (row.response_code as string) ?? null,
    errorCode: (row.error_code as AttemptRecord['errorCode']) ?? null,
    errorMessage: (row.error_message as string) ?? null,
    retryable: row.retryable === null || row.retryable === undefined ? null : Boolean(row.retryable),
    humanActionRequired: Boolean(row.human_action_required),
  }
}

function toReceiptRecord(row: Record<string, unknown>): ReceiptRecord {
  return {
    id: row.id as string,
    submissionExecutionId: row.submission_execution_id as string,
    attemptId: (row.attempt_id as string) ?? null,
    agencyId: row.agency_id as string,
    receiptType: row.receipt_type as ReceiptRecord['receiptType'],
    providerName: (row.provider_name as string) ?? null,
    providerReference: (row.provider_reference as string) ?? null,
    receiptUrl: (row.receipt_url as string) ?? null,
    receiptFile: (row.receipt_file as string) ?? null,
    receiptHash: (row.receipt_hash as string) ?? null,
    issuedAt: (row.issued_at as string) ?? null,
    capturedAt: row.captured_at as string,
    capturedBy: (row.captured_by as string) ?? null,
    verificationStatus: row.verification_status as ReceiptRecord['verificationStatus'],
    notes: (row.notes as string) ?? null,
  }
}
