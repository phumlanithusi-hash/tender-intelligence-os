import { randomUUID } from 'node:crypto'
import type { BidOutcomeRecord, LossReasonRecord, OutcomeConflictRecord, OutcomeStore, TenderOutcomeRecord } from '../store.js'

/** In-memory OutcomeStore fake for route/unit tests — mirrors fakeSubmissionExecutionStore.ts's shape. */
export function createFakeOutcomeStore(): OutcomeStore {
  const tenderOutcomes = new Map<string, TenderOutcomeRecord>()
  const bidOutcomes = new Map<string, BidOutcomeRecord>() // keyed by bidProjectId
  const lossReasons: LossReasonRecord[] = []
  const conflicts: OutcomeConflictRecord[] = []

  return {
    async listTenderOutcomes(filters) {
      return [...tenderOutcomes.values()].filter((o) => (!filters.tenderId || o.tenderId === filters.tenderId) && (!filters.outcomeStatus || o.outcomeStatus === filters.outcomeStatus)).slice(0, filters.limit)
    },
    async getTenderOutcome(id) {
      return tenderOutcomes.get(id) ?? null
    },
    async getCurrentTenderOutcomeForTender(tenderId) {
      return [...tenderOutcomes.values()].find((o) => o.tenderId === tenderId && o.isCurrent) ?? null
    },
    async createTenderOutcome(record) {
      const now = new Date().toISOString()
      const row: TenderOutcomeRecord = { ...record, id: randomUUID(), createdAt: now, updatedAt: now }
      if (row.isCurrent) {
        for (const existing of tenderOutcomes.values()) {
          if (existing.tenderId === row.tenderId) existing.isCurrent = false
        }
      }
      tenderOutcomes.set(row.id, row)
      return row
    },
    async updateTenderOutcome(id, patch) {
      const existing = tenderOutcomes.get(id)
      if (!existing) throw new Error('not found')
      const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() }
      tenderOutcomes.set(id, updated)
      return updated
    },
    async verifyTenderOutcome(id, verifiedBy, verifiedAt) {
      const existing = tenderOutcomes.get(id)
      if (!existing) throw new Error('not found')
      const updated = { ...existing, truthStatus: 'VERIFIED' as const, verifiedBy, verifiedAt, updatedAt: new Date().toISOString() }
      tenderOutcomes.set(id, updated)
      return updated
    },
    async getBidOutcome(bidProjectId) {
      return bidOutcomes.get(bidProjectId) ?? null
    },
    async upsertBidOutcome(record) {
      const row: BidOutcomeRecord = { ...record, id: randomUUID() }
      bidOutcomes.set(record.bidProjectId, row)
      return row
    },
    async addLossReason(record) {
      const row: LossReasonRecord = { ...record, id: randomUUID(), recordedAt: new Date().toISOString() }
      lossReasons.push(row)
      return row
    },
    async listLossReasons(bidOutcomeId) {
      return lossReasons.filter((r) => r.bidOutcomeId === bidOutcomeId)
    },
    async createConflict(record) {
      const row: OutcomeConflictRecord = { ...record, id: randomUUID(), discoveredAt: new Date().toISOString() }
      conflicts.push(row)
      return row
    },
    async listConflicts(tenderOutcomeId) {
      return conflicts.filter((c) => c.tenderOutcomeId === tenderOutcomeId)
    },
    async resolveConflict(id, status, resolvedBy, resolvedAt, notes) {
      const conflict = conflicts.find((c) => c.id === id)
      if (!conflict) throw new Error('not found')
      conflict.status = status
      conflict.resolvedBy = resolvedBy
      conflict.resolvedAt = resolvedAt
      conflict.resolutionNotes = notes
      return conflict
    },
  }
}
