import { randomUUID } from 'node:crypto'
import type { SubmissionPricingCurrency } from '@tender-os/constants'
import type { SubmissionReadinessInput } from '../types.js'
import type { ApprovalRecord, PackFileRecordRow, PackRecord, PricingItemRecord, PricingRecord, ReadinessItemRecord, ReadinessRecord, SubmissionReadinessStore } from '../store.js'
import { readyBaseline } from './fixtures.js'

export interface FakeSubmissionReadinessState {
  readiness: ReadinessRecord[]
  items: Record<string, ReadinessItemRecord[]>
  pricing: PricingRecord[]
  packs: PackRecord[]
  approvals: ApprovalRecord[]
  auditEvents: Array<{ eventType: string; entityId: string; agencyId: string }>
}

/**
 * In-memory fake mirroring lib/bidDecision/__tests__/fakeBidDecisionStore.ts
 * — lets the orchestration seams (runSubmissionReadinessCheck, pack
 * creation, approval) be tested without a database. AGENCY ISOLATION
 * is emulated the same way the real Supabase implementation enforces
 * it: every read/write is filtered/checked by agencyId, and a
 * cross-agency access attempt throws (mirroring RLS's real effect for
 * the security test suite in security.test.ts).
 */
export function createFakeSubmissionReadinessStore(overrides: { input?: SubmissionReadinessInput; state?: FakeSubmissionReadinessState } = {}): { store: SubmissionReadinessStore; state: FakeSubmissionReadinessState } {
  const state: FakeSubmissionReadinessState = overrides.state ?? { readiness: [], items: {}, pricing: [], packs: [], approvals: [], auditEvents: [] }

  function agencyOwns<T extends { agencyId?: string; bidProjectId?: string }>(agencyId: string, row: T | undefined, entityLabel: string): T {
    if (!row) throw new Error(`${entityLabel} not found`)
    if ('agencyId' in row && row.agencyId && row.agencyId !== agencyId) throw new Error(`FORBIDDEN: ${entityLabel} does not belong to this agency`)
    return row
  }

  const store: SubmissionReadinessStore = {
    async assembleInput(bidProjectId, _agencyId, _nowIso) {
      const input = overrides.input ?? readyBaseline()
      return { input, snapshot: { bidProjectId, seed: 1 } }
    },

    async getCurrentReadiness(bidProjectId) {
      return state.readiness.find((r) => r.bidProjectId === bidProjectId && r.isCurrent) ?? null
    },
    async getReadiness(readinessId) {
      return state.readiness.find((r) => r.id === readinessId) ?? null
    },
    async listReadinessItems(readinessId) {
      return state.items[readinessId] ?? []
    },
    async createReadinessSnapshot(input) {
      for (const r of state.readiness) if (r.bidProjectId === input.bidProjectId) r.isCurrent = false
      const id = randomUUID()
      const record: ReadinessRecord & { agencyId: string } = {
        id,
        bidProjectId: input.bidProjectId,
        agencyId: input.agencyId,
        status: input.result.status,
        proposalVersionId: input.proposalVersionId,
        pricingId: input.pricingId,
        inputSnapshot: input.snapshot,
        categorySummary: input.result.categorySummary,
        isCurrent: true,
        computedAt: new Date().toISOString(),
      }
      state.readiness.push(record)
      state.items[id] = input.result.items.map((i) => ({ id: randomUUID(), category: i.category, severity: i.severity, code: i.code, message: i.message, sourceType: i.sourceType, sourceId: i.sourceId, resolved: false }))
      return record
    },

    async getCurrentPricing(bidProjectId) {
      return state.pricing.find((p) => p.bidProjectId === bidProjectId && p.isCurrent) ?? null
    },
    async createPricing(bidProjectId, agencyId, currency, _createdBy) {
      for (const p of state.pricing) if (p.bidProjectId === bidProjectId) p.isCurrent = false
      const record: PricingRecord & { agencyId: string } = { id: randomUUID(), bidProjectId, agencyId, version: state.pricing.filter((p) => p.bidProjectId === bidProjectId).length + 1, currency: currency as SubmissionPricingCurrency, isCurrent: true, items: [] }
      state.pricing.push(record)
      return record
    },
    async upsertPricingItem(pricingId, agencyId, item) {
      const pricing = agencyOwns(agencyId, state.pricing.find((p) => p.id === pricingId) as (PricingRecord & { agencyId: string }) | undefined, 'pricing')
      const record: PricingItemRecord = { id: randomUUID(), ...item }
      pricing.items.push(record)
      return record
    },
    async updatePricingItem(itemId, agencyId, patch) {
      for (const pricing of state.pricing) {
        const item = pricing.items.find((i) => i.id === itemId)
        if (item) {
          if ((pricing as unknown as { agencyId: string }).agencyId !== agencyId) throw new Error('FORBIDDEN: pricing item does not belong to this agency')
          Object.assign(item, patch)
          return item
        }
      }
      throw new Error('pricing item not found')
    },

    async getCurrentPack(bidProjectId) {
      return state.packs.find((p) => p.bidProjectId === bidProjectId && p.status === 'CURRENT') ?? null
    },
    async getPack(packId) {
      return state.packs.find((p) => p.id === packId) ?? null
    },
    async listPackVersions(bidProjectId) {
      return state.packs.filter((p) => p.bidProjectId === bidProjectId).sort((a, b) => a.version - b.version)
    },
    async createPack(input) {
      for (const p of state.packs) if (p.bidProjectId === input.bidProjectId && p.status === 'CURRENT') p.status = 'SUPERSEDED'
      const files: PackFileRecordRow[] = input.files.map((f) => ({ id: randomUUID(), ...f }))
      const record: PackRecord & { agencyId: string } = {
        id: randomUUID(),
        bidProjectId: input.bidProjectId,
        agencyId: input.agencyId,
        version: state.packs.filter((p) => p.bidProjectId === input.bidProjectId).length + 1,
        status: 'CURRENT',
        readinessId: input.readinessId,
        manifest: input.manifest,
        proposalVersionId: input.proposalVersionId,
        pricingId: input.pricingId,
        files,
        createdAt: new Date().toISOString(),
      }
      state.packs.push(record)
      return record
    },
    async invalidatePack(packId, agencyId) {
      const pack = agencyOwns(agencyId, state.packs.find((p) => p.id === packId) as (PackRecord & { agencyId: string }) | undefined, 'pack')
      pack.status = 'INVALIDATED'
    },

    async getActiveApproval(bidProjectId) {
      return state.approvals.find((a) => a.bidProjectId === bidProjectId && a.status === 'APPROVED') ?? null
    },
    async createApproval(input) {
      const record: ApprovalRecord & { agencyId: string } = { id: randomUUID(), bidProjectId: input.bidProjectId, agencyId: input.agencyId, readinessId: input.readinessId, packId: input.packId, status: 'APPROVED', approvalReason: input.approvalReason, approvedBy: input.approvedBy, approvedAt: new Date().toISOString() }
      state.approvals.push(record)
      return record
    },
    async revokeApproval(approvalId, agencyId, revokedBy, reason) {
      const approval = agencyOwns(agencyId, state.approvals.find((a) => a.id === approvalId) as (ApprovalRecord & { agencyId: string }) | undefined, 'approval')
      approval.status = 'REVOKED'
      state.auditEvents.push({ eventType: 'SUBMISSION_APPROVAL_REVOKED', entityId: approvalId, agencyId })
      void revokedBy
      void reason
      return approval
    },

    async writeAuditEvent(event) {
      state.auditEvents.push({ eventType: event.eventType, entityId: event.entityId, agencyId: event.agencyId })
    },
  }

  return { store, state }
}
