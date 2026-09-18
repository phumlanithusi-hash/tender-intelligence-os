import { randomUUID } from 'node:crypto'
import type { BidDecisionStore, BidPolicyRecord } from '../store.js'
import type { BidRuleResult, BidDecisionInput, BidDecisionRunRecord } from '../types.js'
import { DEFAULT_BID_POLICY } from '../defaultPolicy.js'
import { baseInput } from './fixtures.js'

export interface FakeBidDecisionStoreState {
  runs: BidDecisionRunRecord[]
  ruleResults: Record<string, BidRuleResult[]>
  auditEvents: Array<{ eventType: string; entityId: string }>
}

/**
 * In-memory fake mirroring lib/scoring/__tests__/fakeScoringStore.ts,
 * one layer down for the bid-decision orchestration lifecycle (Phase
 * 11 §39/§40) — lets runBidDecision.ts be tested without a database.
 */
export function createFakeBidDecisionStore(overrides: { input?: BidDecisionInput; policyVersionId?: string; snapshotSeed?: number; state?: FakeBidDecisionStoreState } = {}): { store: BidDecisionStore; state: FakeBidDecisionStoreState } {
  const state: FakeBidDecisionStoreState = overrides.state ?? { runs: [], ruleResults: {}, auditEvents: [] }
  const snapshotSeed = overrides.snapshotSeed ?? 1
  const policyVersionId = overrides.policyVersionId ?? 'policy-v1'

  const store: BidDecisionStore = {
    async getCurrentPolicy(): Promise<BidPolicyRecord> {
      return { versionId: policyVersionId, policy: DEFAULT_BID_POLICY }
    },
    async assembleInput(tenderId, agencyId, now) {
      const input = overrides.input ?? baseInput({ tenderId, agencyId, now })
      return { input, snapshot: { seed: snapshotSeed } }
    },
    async buildSnapshot() {
      return { seed: snapshotSeed }
    },
    async findActiveRun(tenderId, agencyId) {
      const active = state.runs.find((r) => r.tenderId === tenderId && r.agencyId === agencyId && (r.status === 'QUEUED' || r.status === 'RUNNING'))
      return active ? { id: active.id } : null
    },
    async findCurrentRun(tenderId, agencyId) {
      return state.runs.find((r) => r.tenderId === tenderId && r.agencyId === agencyId && r.isCurrent) ?? null
    },
    async getRun(runId) {
      return state.runs.find((r) => r.id === runId) ?? null
    },
    async listRuns(tenderId) {
      return state.runs.filter((r) => r.tenderId === tenderId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    },
    async createRun(input) {
      const id = randomUUID()
      state.runs.push({
        id,
        tenderId: input.tenderId,
        agencyId: input.agencyId,
        status: 'QUEUED',
        bidPolicyVersionId: input.bidPolicyVersionId,
        scoringRunId: input.scoringRunId,
        systemDecision: null,
        humanDecision: null,
        finalDecision: null,
        overrideReason: null,
        overriddenBy: null,
        overriddenAt: null,
        bidEffort: 'UNKNOWN',
        bidEffortExplanation: null,
        decisionExplanation: null,
        isCurrent: true,
        inputSnapshot: {},
        createdAt: new Date().toISOString(),
      })
      return { id }
    },
    async updateRun(runId, patch) {
      const run = state.runs.find((r) => r.id === runId)
      if (!run) throw new Error('run not found')
      Object.assign(run, {
        status: patch.status ?? run.status,
        systemDecision: patch.systemDecision !== undefined ? patch.systemDecision : run.systemDecision,
        finalDecision: patch.finalDecision !== undefined ? patch.finalDecision : run.finalDecision,
        bidEffort: patch.bidEffort ?? run.bidEffort,
        bidEffortExplanation: patch.bidEffortExplanation !== undefined ? patch.bidEffortExplanation : run.bidEffortExplanation,
        decisionExplanation: patch.decisionExplanation !== undefined ? patch.decisionExplanation : run.decisionExplanation,
        inputSnapshot: patch.inputSnapshot ?? run.inputSnapshot,
      })
    },
    async markPreviousRunsNotCurrent(tenderId, agencyId, exceptRunId) {
      for (const r of state.runs) {
        if (r.tenderId === tenderId && r.agencyId === agencyId && r.id !== exceptRunId) r.isCurrent = false
      }
    },
    async saveRuleResults(runId, results) {
      state.ruleResults[runId] = results
    },
    async applyOverride(runId, input) {
      if (!input.overrideReason || input.overrideReason.trim().length === 0) throw new Error('An override reason is required.')
      const run = state.runs.find((r) => r.id === runId)
      if (!run) throw new Error('run not found')
      run.humanDecision = input.humanDecision
      run.finalDecision = input.humanDecision
      run.overrideReason = input.overrideReason
      run.overriddenBy = input.overriddenBy
      run.overriddenAt = input.overriddenAt
      state.auditEvents.push({ eventType: 'BID_DECISION_OVERRIDDEN', entityId: runId })
      return run
    },
    async writeAuditEvent(event) {
      state.auditEvents.push({ eventType: event.eventType, entityId: event.entityId })
    },
  }

  return { store, state }
}
