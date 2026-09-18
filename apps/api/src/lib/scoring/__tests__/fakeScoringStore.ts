import { randomUUID } from 'node:crypto'
import type { ScoringStore, ScoringRunRecord, ScoringConfigurationRecord } from '../store.js'
import type { ScoredComponent, ScoredGate, ScoringInput } from '../types.js'
import { DEFAULT_SCORING_CONFIGURATION } from '../defaultConfig.js'
import { baseInput } from './fixtures.js'

export interface FakeScoringStoreState {
  runs: ScoringRunRecord[]
  components: Record<string, ScoredComponent[]>
  drivers: Record<string, unknown[]>
  risks: Record<string, unknown[]>
  gates: Record<string, ScoredGate[]>
}

/**
 * In-memory fake mirroring lib/qualification/__tests__/fakeQualificationStore.ts,
 * one layer down for the scoring engine's orchestration lifecycle
 * (Phase 10 §32/§33/§47) — lets runScoring.ts be tested without a
 * database, same discipline as Phase 8.
 */
export function createFakeScoringStore(overrides: { input?: ScoringInput; configVersionId?: string; snapshotSeed?: number; state?: FakeScoringStoreState } = {}): { store: ScoringStore; state: FakeScoringStoreState } {
  const state: FakeScoringStoreState = overrides.state ?? { runs: [], components: {}, drivers: {}, risks: {}, gates: {} }
  const snapshotSeed = overrides.snapshotSeed ?? 1
  const configVersionId = overrides.configVersionId ?? 'config-v1'

  const store: ScoringStore = {
    async getCurrentConfiguration(): Promise<ScoringConfigurationRecord> {
      return { versionId: configVersionId, config: DEFAULT_SCORING_CONFIGURATION }
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
    async createRun(input) {
      const id = randomUUID()
      state.runs.push({
        id,
        tenderId: input.tenderId,
        agencyId: input.agencyId,
        status: 'QUEUED',
        scoringConfigurationVersionId: input.scoringConfigurationVersionId,
        overallScore: null,
        dataCompleteness: null,
        decisionSignal: null,
        deadlineStatus: 'UNKNOWN',
        timezoneUnknown: true,
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
        overallScore: patch.overallScore !== undefined ? patch.overallScore : run.overallScore,
        dataCompleteness: patch.dataCompleteness !== undefined ? patch.dataCompleteness : run.dataCompleteness,
        decisionSignal: patch.decisionSignal !== undefined ? patch.decisionSignal : run.decisionSignal,
        deadlineStatus: patch.deadlineStatus ?? run.deadlineStatus,
        timezoneUnknown: patch.timezoneUnknown ?? run.timezoneUnknown,
        inputSnapshot: patch.inputSnapshot ?? run.inputSnapshot,
      })
    },
    async markPreviousRunsNotCurrent(tenderId, agencyId, exceptRunId) {
      for (const r of state.runs) {
        if (r.tenderId === tenderId && r.agencyId === agencyId && r.id !== exceptRunId) r.isCurrent = false
      }
    },
    async saveComponents(runId, components) {
      state.components[runId] = components
    },
    async saveDrivers(runId, drivers) {
      state.drivers[runId] = drivers
    },
    async saveRisks(runId, risks) {
      state.risks[runId] = risks
    },
    async saveGates(runId, gates) {
      state.gates[runId] = gates
    },
  }

  return {
    store,
    state,
  }
}
