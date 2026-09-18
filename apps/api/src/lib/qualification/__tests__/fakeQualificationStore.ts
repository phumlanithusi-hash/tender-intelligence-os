import { randomUUID } from 'node:crypto'
import type { QualificationOverallStatus } from '@tender-os/constants'
import type { QualificationStore, QualificationRunRecord, TenderQualificationContext } from '../store.js'
import type { AgencyEvidenceSnapshot, QualificationRequirement, RuleResult } from '../types.js'
import { baseAgency } from './fixtures.js'

export interface FakeQualificationStoreSeed {
  tenderId: string
  requirements: QualificationRequirement[]
  agency?: AgencyEvidenceSnapshot
  context?: TenderQualificationContext
}

export interface FakeQualificationStoreState {
  runs: Array<QualificationRunRecord & Record<string, unknown>>
  results: Array<{ id: string; runId: string; requirementId: string; result: RuleResult }>
  actions: Array<{ id: string; runId: string; resultId: string; requirementId: string; description: string; priority: string; dueDate: string | null }>
  reviews: Array<{ id: string; runId: string; requirementId: string | null; reviewerId: string; decision: string; note: string | null }>
}

export function createFakeQualificationStore(seed: FakeQualificationStoreSeed): { store: QualificationStore; state: FakeQualificationStoreState } {
  const state: FakeQualificationStoreState = { runs: [], results: [], actions: [], reviews: [] }

  const store: QualificationStore = {
    async getRequirements(tenderId) {
      return tenderId === seed.tenderId ? seed.requirements : []
    },
    async getAgencySnapshot() {
      return seed.agency ?? baseAgency()
    },
    async getTenderContext(tenderId): Promise<TenderQualificationContext | null> {
      if (tenderId !== seed.tenderId) return null
      return seed.context ?? { closingDate: '2026-10-01T12:00:00Z', briefingDate: null, briefingRequired: false }
    },
    async findActiveRun(tenderId, agencyId) {
      const active = state.runs.find((r) => r.tenderId === tenderId && r.agencyId === agencyId && ['QUEUED', 'RUNNING'].includes(r.status))
      return active ? { id: active.id, tenderId: active.tenderId, agencyId: active.agencyId, status: active.status } : null
    },
    async createRun(input) {
      const id = randomUUID()
      state.runs.push({ id, tenderId: input.tenderId, agencyId: input.agencyId, status: 'QUEUED' })
      return { id, tenderId: input.tenderId, agencyId: input.agencyId, status: 'QUEUED' }
    },
    async updateRun(runId, patch) {
      const run = state.runs.find((r) => r.id === runId)
      if (!run) throw new Error('run not found')
      Object.assign(run, patch)
    },
    async markPreviousRunsNotCurrent() {
      // no-op for single-run tests
    },
    async createResult(input) {
      const id = randomUUID()
      state.results.push({ id, runId: input.runId, requirementId: input.requirementId, result: input.result })
      return { id }
    },
    async createAction(input) {
      const id = randomUUID()
      state.actions.push({ id, runId: input.runId, resultId: input.resultId, requirementId: input.requirementId, description: input.description, priority: input.priority, dueDate: input.dueDate })
      return { id }
    },
    async createReview(input) {
      const id = randomUUID()
      state.reviews.push({ id, runId: input.runId, requirementId: input.requirementId, reviewerId: input.reviewerId, decision: input.decision, note: input.note })
      return { id }
    },
  }

  return { store, state }
}

export type { QualificationOverallStatus }
