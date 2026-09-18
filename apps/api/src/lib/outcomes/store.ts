import type { BidResult, LossReasonCategory, LossReasonProvenance, OutcomeConflictStatus, OutcomeProvenance, OutcomeStatus } from '@tender-os/constants'
import type { DataConfidence } from '@tender-os/constants'

/**
 * Phase 17 §67 — the outcome store port. A real Supabase-backed
 * implementation (supabaseOutcomeStore.ts) and a test fake
 * (__tests__/fakeOutcomeStore.ts) both implement this; route handlers
 * and the pure engine in this directory never embed SQL themselves.
 */
export interface TenderOutcomeRecord {
  id: string
  tenderId: string
  awardId: string | null
  outcomeStatus: OutcomeStatus
  publishedDate: string | null
  decisionDate: string | null
  winnerName: string | null
  winnerRegistrationNumber: string | null
  winnerProvince: string | null
  winnerEntityType: string | null
  awardValue: number | null
  awardCurrency: string
  contractDuration: string | null
  procurementMethod: string | null
  sourceUrl: string | null
  sourceDocumentId: string | null
  sourceEvidenceRef: string | null
  truthStatus: DataConfidence
  provenance: OutcomeProvenance
  recordedBy: string | null
  recordedAt: string
  verifiedBy: string | null
  verifiedAt: string | null
  notes: string | null
  isCurrent: boolean
  version: number
  supersedesId: string | null
  createdAt: string
  updatedAt: string
}

export interface BidOutcomeRecord {
  id: string
  bidProjectId: string
  agencyId: string
  tenderId: string
  tenderOutcomeId: string | null
  ourResult: BidResult
  ourRank: number | null
  ourScore: number | null
  winningScore: number | null
  disqualificationReason: string | null
  submissionStatusSnapshot: string
  reconciliationBasis: string | null
  reconciledAt: string | null
  truthStatus: DataConfidence
  provenance: OutcomeProvenance
  recordedBy: string | null
  recordedAt: string
  verifiedBy: string | null
  verifiedAt: string | null
  notes: string | null
  isCurrent: boolean
  version: number
}

export interface LossReasonRecord {
  id: string
  bidOutcomeId: string
  agencyId: string
  category: LossReasonCategory
  isPrimary: boolean
  provenance: LossReasonProvenance
  sourceDocumentId: string | null
  notes: string | null
  recordedBy: string | null
  recordedAt: string
}

export interface OutcomeConflictRecord {
  id: string
  tenderOutcomeId: string
  fieldName: string
  existingValue: string | null
  conflictingValue: string | null
  existingSource: string | null
  conflictingSource: string | null
  status: OutcomeConflictStatus
  discoveredAt: string
  resolvedBy: string | null
  resolvedAt: string | null
  resolutionNotes: string | null
}

export interface OutcomeStore {
  listTenderOutcomes(filters: { tenderId?: string; outcomeStatus?: OutcomeStatus; limit: number; cursor?: string }): Promise<TenderOutcomeRecord[]>
  getTenderOutcome(id: string): Promise<TenderOutcomeRecord | null>
  getCurrentTenderOutcomeForTender(tenderId: string): Promise<TenderOutcomeRecord | null>
  createTenderOutcome(record: Omit<TenderOutcomeRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<TenderOutcomeRecord>
  updateTenderOutcome(id: string, patch: Partial<TenderOutcomeRecord>): Promise<TenderOutcomeRecord>
  verifyTenderOutcome(id: string, verifiedBy: string, verifiedAt: string): Promise<TenderOutcomeRecord>

  getBidOutcome(bidProjectId: string): Promise<BidOutcomeRecord | null>
  upsertBidOutcome(record: Omit<BidOutcomeRecord, 'id'>): Promise<BidOutcomeRecord>

  addLossReason(record: Omit<LossReasonRecord, 'id' | 'recordedAt'>): Promise<LossReasonRecord>
  listLossReasons(bidOutcomeId: string): Promise<LossReasonRecord[]>

  createConflict(record: Omit<OutcomeConflictRecord, 'id' | 'discoveredAt'>): Promise<OutcomeConflictRecord>
  listConflicts(tenderOutcomeId: string): Promise<OutcomeConflictRecord[]>
  resolveConflict(id: string, status: 'RESOLVED' | 'DISMISSED', resolvedBy: string, resolvedAt: string, notes: string | null): Promise<OutcomeConflictRecord>
}
