import { randomUUID } from 'node:crypto'
import type { AttemptRecord, BidContext, ConfirmationRecord, ReceiptRecord, SubmissionExecutionStore } from '../store.js'
import type { SubmissionExecutionRecord } from '../store.js'

export interface FakeExecutionState {
  bid: BidContext
  readiness: { readinessId: string | null; status: string | null; blockerCount: number }
  pack: { packId: string | null; version: number | null; status: 'CURRENT' | 'SUPERSEDED' | 'INVALIDATED' | null; manifestHash: string | null; files: Array<{ fileName: string; storagePath: string | null; mimeType: string | null; sizeBytes: number | null; sha256: string }> }
  approval: { approvalId: string | null; status: 'APPROVED' | 'REVOKED' | 'SUPERSEDED' | null; packId: string | null; readinessId: string | null }
  executions: SubmissionExecutionRecord[]
  confirmations: ConfirmationRecord[]
  attempts: AttemptRecord[]
  receipts: ReceiptRecord[]
  auditEvents: Array<{ eventType: string; entityId: string }>
}

export function makeDefaultState(overrides: Partial<FakeExecutionState> = {}): FakeExecutionState {
  return {
    bid: { bidProjectId: 'bid-1', agencyId: 'agency-1', tenderId: 'tender-1', finalBidDecision: 'BID', humanOverrideToBid: false, tenderClosingDate: '2026-12-31', tenderClosingTime: '17:00:00', tenderSubmissionMethod: 'Online portal', tenderSubmissionUrl: 'https://etenders.gov.za/x', tenderSubmissionEmail: null, documentEvidenceMethod: null },
    readiness: { readinessId: 'readiness-1', status: 'READY_TO_SUBMIT', blockerCount: 0 },
    pack: { packId: 'pack-1', version: 1, status: 'CURRENT', manifestHash: 'manifest-hash-1', files: [{ fileName: 'proposal.pdf', storagePath: 'x', mimeType: 'application/pdf', sizeBytes: 100, sha256: 'file-hash-1' }] },
    approval: { approvalId: 'approval-1', status: 'APPROVED', packId: 'pack-1', readinessId: 'readiness-1' },
    executions: [],
    confirmations: [],
    attempts: [],
    receipts: [],
    auditEvents: [],
    ...overrides,
  }
}

export function createFakeSubmissionExecutionStore(state: FakeExecutionState): SubmissionExecutionStore {
  return {
    async getBidContext(bidProjectId, agencyId) {
      if (state.bid.bidProjectId !== bidProjectId || state.bid.agencyId !== agencyId) return null
      return state.bid
    },
    async getReadinessContext() {
      return state.readiness
    },
    async getPackContext() {
      return state.pack
    },
    async getApprovalContext() {
      return state.approval
    },
    async getExecution(bidProjectId) {
      return state.executions.find((e) => e.bidProjectId === bidProjectId) ?? null
    },
    async upsertExecution(bidProjectId, agencyId, tenderId, patch, expectedVersion) {
      let existing = state.executions.find((e) => e.bidProjectId === bidProjectId)
      if (existing) {
        if (expectedVersion !== null && existing.version !== expectedVersion) throw new Error('CONFLICT: stale version')
        Object.assign(existing, patch, { version: existing.version + 1 })
        return existing
      }
      existing = {
        id: randomUUID(),
        bidProjectId,
        agencyId,
        tenderId,
        status: 'NOT_READY',
        submissionMethod: 'UNKNOWN',
        automationStatus: 'UNKNOWN',
        targetKind: null,
        targetValue: null,
        approvedReadinessId: null,
        submissionPackId: null,
        submissionPackVersion: null,
        submissionPackHash: null,
        manifestHash: null,
        confirmedBy: null,
        confirmedAt: null,
        startedAt: null,
        completedAt: null,
        providerName: null,
        providerReference: null,
        externalSubmissionId: null,
        failureCode: null,
        failureMessage: null,
        retryable: null,
        physicalStage: 'NOT_STARTED',
        version: 1,
        ...patch,
      }
      state.executions.push(existing)
      return existing
    },
    async listConfirmations(submissionExecutionId) {
      return state.confirmations.filter((c) => c.submissionExecutionId === submissionExecutionId)
    },
    async getLatestActiveConfirmation(submissionExecutionId) {
      const rows = state.confirmations.filter((c) => c.submissionExecutionId === submissionExecutionId && !c.invalidated)
      return rows[rows.length - 1] ?? null
    },
    async createConfirmation(input) {
      const record: ConfirmationRecord = { id: randomUUID(), invalidated: false, confirmedAt: input.confirmedAt ?? new Date().toISOString(), ...input }
      state.confirmations.push(record)
      return record
    },
    async invalidateConfirmation(confirmationId) {
      const row = state.confirmations.find((c) => c.id === confirmationId)
      if (row) row.invalidated = true
    },
    async listAttempts(submissionExecutionId) {
      return state.attempts.filter((a) => a.submissionExecutionId === submissionExecutionId)
    },
    async getActiveAttempt(submissionExecutionId) {
      return state.attempts.find((a) => a.submissionExecutionId === submissionExecutionId && a.status === 'STARTED') ?? null
    },
    async createAttempt(input) {
      const record: AttemptRecord = { id: randomUUID(), status: 'STARTED', completedAt: null, providerName: null, providerReference: null, externalSubmissionId: null, responseStatus: null, responseCode: null, errorCode: null, errorMessage: null, retryable: null, humanActionRequired: false, ...input }
      state.attempts.push(record)
      return record
    },
    async completeAttempt(attemptId, agencyId, patch) {
      const row = state.attempts.find((a) => a.id === attemptId)
      if (!row || row.agencyId !== agencyId) throw new Error('FORBIDDEN')
      if (row.status !== 'STARTED') throw new Error('attempt already terminal')
      Object.assign(row, patch, { completedAt: new Date().toISOString() })
      return row
    },
    async listReceipts(submissionExecutionId) {
      return state.receipts.filter((r) => r.submissionExecutionId === submissionExecutionId)
    },
    async createReceipt(input) {
      const record: ReceiptRecord = { id: randomUUID(), capturedAt: input.capturedAt ?? new Date().toISOString(), ...input }
      state.receipts.push(record)
      return record
    },
    async updateReceiptVerification(receiptId, agencyId, verificationStatus, notes) {
      const row = state.receipts.find((r) => r.id === receiptId)
      if (!row || row.agencyId !== agencyId) throw new Error('FORBIDDEN')
      row.verificationStatus = verificationStatus
      row.notes = notes
      return row
    },
    async writeAuditEvent(event) {
      state.auditEvents.push({ eventType: event.eventType, entityId: event.entityId })
    },
  }
}
