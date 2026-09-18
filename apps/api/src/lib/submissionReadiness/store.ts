import type { SubmissionPricingCurrency } from '@tender-os/constants'
import type { SubmissionReadinessInput, SubmissionReadinessResult } from './types.js'
import type { PricingLineInput } from './pricing.js'

export interface PricingItemRecord {
  id: string
  lineNumber: number
  description: string
  quantity: number
  unit: string | null
  unitPrice: number
  lineTotal: number
  isMandatoryScheduleItem: boolean
  notes: string | null
}

export interface PricingRecord {
  id: string
  bidProjectId: string
  version: number
  currency: SubmissionPricingCurrency
  isCurrent: boolean
  items: PricingItemRecord[]
}

export interface ReadinessRecord {
  id: string
  bidProjectId: string
  status: SubmissionReadinessResult['status']
  proposalVersionId: string | null
  pricingId: string | null
  inputSnapshot: Record<string, unknown>
  categorySummary: Record<string, unknown>
  isCurrent: boolean
  computedAt: string
}

export interface ReadinessItemRecord {
  id: string
  category: string
  severity: string
  code: string
  message: string
  sourceType: string | null
  sourceId: string | null
  resolved: boolean
}

export interface PackFileRecordRow {
  id: string
  documentType: string
  fileName: string
  storagePath: string | null
  mimeType: string | null
  sizeBytes: number | null
  sha256: string
  sourceTable: string | null
  sourceId: string | null
}

export interface PackRecord {
  id: string
  bidProjectId: string
  version: number
  status: 'CURRENT' | 'SUPERSEDED' | 'INVALIDATED'
  readinessId: string
  manifest: Record<string, unknown>
  proposalVersionId: string | null
  pricingId: string | null
  files: PackFileRecordRow[]
  createdAt: string
}

export interface ApprovalRecord {
  id: string
  bidProjectId: string
  readinessId: string
  packId: string
  status: 'APPROVED' | 'REVOKED' | 'SUPERSEDED'
  approvalReason: string
  approvedBy: string
  approvedAt: string
}

/**
 * Port for everything the Phase 15 submission-readiness orchestration
 * layer needs (mirrors lib/bidDecision/store.ts / lib/proposals/store.ts
 * exactly). `assembleInput` performs the real Phase 8-14 aggregation;
 * everything downstream (`calculateSubmissionReadiness`) is pure and
 * untestable-against-a-database on purpose.
 */
export interface SubmissionReadinessStore {
  assembleInput(bidProjectId: string, agencyId: string, nowIso: string): Promise<{ input: SubmissionReadinessInput; snapshot: Record<string, unknown> }>

  getCurrentReadiness(bidProjectId: string): Promise<ReadinessRecord | null>
  getReadiness(readinessId: string): Promise<ReadinessRecord | null>
  listReadinessItems(readinessId: string): Promise<ReadinessItemRecord[]>
  createReadinessSnapshot(input: {
    bidProjectId: string
    agencyId: string
    tenderId: string
    result: SubmissionReadinessResult
    proposalVersionId: string | null
    pricingId: string | null
    snapshot: Record<string, unknown>
    computedBy: string | null
  }): Promise<ReadinessRecord>

  getCurrentPricing(bidProjectId: string): Promise<PricingRecord | null>
  createPricing(bidProjectId: string, agencyId: string, currency: SubmissionPricingCurrency, createdBy: string | null): Promise<PricingRecord>
  upsertPricingItem(pricingId: string, agencyId: string, item: { lineNumber: number; description: string; quantity: number; unit: string | null; unitPrice: number; lineTotal: number; isMandatoryScheduleItem: boolean; notes: string | null }): Promise<PricingItemRecord>
  updatePricingItem(itemId: string, agencyId: string, patch: Partial<{ description: string; quantity: number; unit: string | null; unitPrice: number; lineTotal: number; isMandatoryScheduleItem: boolean; notes: string | null }>): Promise<PricingItemRecord>

  getCurrentPack(bidProjectId: string): Promise<PackRecord | null>
  getPack(packId: string): Promise<PackRecord | null>
  listPackVersions(bidProjectId: string): Promise<PackRecord[]>
  createPack(input: {
    bidProjectId: string
    agencyId: string
    readinessId: string
    proposalVersionId: string | null
    pricingId: string | null
    manifest: Record<string, unknown>
    files: Array<{ documentType: string; fileName: string; storagePath: string | null; mimeType: string | null; sizeBytes: number | null; sha256: string; sourceTable: string | null; sourceId: string | null }>
    createdBy: string | null
  }): Promise<PackRecord>
  invalidatePack(packId: string, agencyId: string): Promise<void>

  getActiveApproval(bidProjectId: string): Promise<ApprovalRecord | null>
  createApproval(input: { bidProjectId: string; agencyId: string; readinessId: string; packId: string; approvalReason: string; approvedBy: string }): Promise<ApprovalRecord>
  revokeApproval(approvalId: string, agencyId: string, revokedBy: string, reason: string): Promise<ApprovalRecord>

  writeAuditEvent(event: { eventType: string; agencyId: string; actorId: string | null; entityId: string; oldValue: Record<string, unknown> | null; newValue: Record<string, unknown> | null }): Promise<void>
}

/** toPricingLineInputs: adapts stored pricing items into the pure pricing engine's input shape. */
export function toPricingLineInputs(record: PricingRecord): PricingLineInput[] {
  return record.items.map((i) => ({ id: i.id, quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal, currency: record.currency }))
}
