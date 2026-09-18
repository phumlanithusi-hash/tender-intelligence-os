import { describe, it, expect } from 'vitest'
import { runScoring, ScoringRunAlreadyActiveError } from '../runScoring.js'
import { createFakeScoringStore } from './fakeScoringStore.js'

describe('runScoring — Phase 10 §32/§33/§47 lifecycle', () => {
  it('creates a COMPLETED run and persists components/drivers/risks/gates', async () => {
    const { store, state } = createFakeScoringStore()
    const result = await runScoring(store, { tenderId: 't1', agencyId: 'a1', triggeredBy: 'u1', now: '2026-09-11T00:00:00Z' })
    expect(result.reused).toBe(false)
    expect(result.overallScore).not.toBeNull()
    const run = state.runs.find((r) => r.id === result.runId)!
    expect(run.status).toBe('COMPLETED')
    expect(state.components[result.runId]).toHaveLength(6)
    expect(state.gates[result.runId]).toHaveLength(5)
  })

  it('idempotent: an unchanged input + unchanged config version reuses the current run rather than creating a duplicate', async () => {
    const { store, state } = createFakeScoringStore()
    const first = await runScoring(store, { tenderId: 't1', agencyId: 'a1', triggeredBy: 'u1', now: '2026-09-11T00:00:00Z' })
    const second = await runScoring(store, { tenderId: 't1', agencyId: 'a1', triggeredBy: 'u1', now: '2026-09-11T00:01:00Z' })
    expect(second.reused).toBe(true)
    expect(second.runId).toBe(first.runId)
    expect(state.runs.filter((r) => r.tenderId === 't1' && r.agencyId === 'a1')).toHaveLength(1)
  })

  it('a changed input snapshot creates a NEW run and marks the previous one not-current, without mutating its data', async () => {
    const { store, state } = createFakeScoringStore({ snapshotSeed: 1 })
    const first = await runScoring(store, { tenderId: 't1', agencyId: 'a1', triggeredBy: 'u1', now: '2026-09-11T00:00:00Z' })
    const { store: store2 } = createFakeScoringStore({ snapshotSeed: 2, state })
    const second = await runScoring(store2, { tenderId: 't1', agencyId: 'a1', triggeredBy: 'u1', now: '2026-09-11T01:00:00Z' })
    expect(second.reused).toBe(false)
    expect(second.runId).not.toBe(first.runId)
    const firstRun = state.runs.find((r) => r.id === first.runId)!
    const secondRun = state.runs.find((r) => r.id === second.runId)!
    expect(firstRun.isCurrent).toBe(false)
    expect(secondRun.isCurrent).toBe(true)
    // Historical run is preserved, not deleted or overwritten (Phase 10 §33/§49 versioning test).
    expect(firstRun.overallScore).not.toBeNull()
  })

  it('a new scoring configuration version always creates a new run, even with identical tender/agency state', async () => {
    const { store, state } = createFakeScoringStore({ configVersionId: 'config-v1' })
    const first = await runScoring(store, { tenderId: 't1', agencyId: 'a1', triggeredBy: 'u1', now: '2026-09-11T00:00:00Z' })
    const { store: store2 } = createFakeScoringStore({ configVersionId: 'config-v2', state })
    const second = await runScoring(store2, { tenderId: 't1', agencyId: 'a1', triggeredBy: 'u1', now: '2026-09-11T01:00:00Z' })
    expect(second.runId).not.toBe(first.runId)
  })

  it('rejects a second run while one is already QUEUED/RUNNING for the same tender+agency', async () => {
    const { store, state } = createFakeScoringStore()
    state.runs.push({
      id: 'active-run',
      tenderId: 't1',
      agencyId: 'a1',
      status: 'RUNNING',
      scoringConfigurationVersionId: 'config-v1',
      overallScore: null,
      dataCompleteness: null,
      decisionSignal: null,
      deadlineStatus: 'UNKNOWN',
      timezoneUnknown: true,
      isCurrent: true,
      inputSnapshot: {},
      createdAt: new Date().toISOString(),
    })
    await expect(runScoring(store, { tenderId: 't1', agencyId: 'a1', triggeredBy: 'u1' })).rejects.toBeInstanceOf(ScoringRunAlreadyActiveError)
  })

  it('cross-agency isolation: a run for agency A does not block or get reused for agency B on the same tender', async () => {
    const { store, state } = createFakeScoringStore()
    const a = await runScoring(store, { tenderId: 't1', agencyId: 'agency-a', triggeredBy: 'u1', now: '2026-09-11T00:00:00Z' })
    const { store: store2 } = createFakeScoringStore({ state })
    const b = await runScoring(store2, { tenderId: 't1', agencyId: 'agency-b', triggeredBy: 'u2', now: '2026-09-11T00:00:00Z' })
    expect(a.runId).not.toBe(b.runId)
    expect(state.runs.find((r) => r.id === a.runId)?.agencyId).toBe('agency-a')
    expect(state.runs.find((r) => r.id === b.runId)?.agencyId).toBe('agency-b')
  })
})
