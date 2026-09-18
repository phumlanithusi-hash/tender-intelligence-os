import { describe, it, expect } from 'vitest'
import { runBidDecision, BidDecisionRunAlreadyActiveError } from '../runBidDecision.js'
import { createFakeBidDecisionStore } from './fakeBidDecisionStore.js'
import { baseInput } from './fixtures.js'

describe('runBidDecision — Phase 11 §39/§40 lifecycle', () => {
  it('creates a completed, current run with a system decision', async () => {
    const { store, state } = createFakeBidDecisionStore()
    const result = await runBidDecision(store, { tenderId: 'tender-1', agencyId: 'agency-1', triggeredBy: 'user-1' })
    expect(result.reused).toBe(false)
    expect(result.decision).toBe('BID')
    const run = state.runs.find((r) => r.id === result.runId)!
    expect(run.status).toBe('COMPLETED')
    expect(run.isCurrent).toBe(true)
    expect(run.systemDecision).toBe('BID')
    expect(state.auditEvents.some((e) => e.eventType === 'BID_DECISION_CREATED')).toBe(true)
  })

  it('rejects a second concurrent run for the same tender+agency', async () => {
    const { store } = createFakeBidDecisionStore()
    await store.createRun({ tenderId: 'tender-1', agencyId: 'agency-1', bidPolicyVersionId: 'p1', scoringRunId: null, triggeredBy: null })
    await expect(runBidDecision(store, { tenderId: 'tender-1', agencyId: 'agency-1', triggeredBy: null })).rejects.toBeInstanceOf(BidDecisionRunAlreadyActiveError)
  })

  it('reuses the current run when policy version and input snapshot are unchanged (idempotency)', async () => {
    const { store, state } = createFakeBidDecisionStore()
    const first = await runBidDecision(store, { tenderId: 'tender-1', agencyId: 'agency-1', triggeredBy: null })
    const second = await runBidDecision(store, { tenderId: 'tender-1', agencyId: 'agency-1', triggeredBy: null })
    expect(second.runId).toBe(first.runId)
    expect(second.reused).toBe(true)
    expect(state.runs.filter((r) => r.tenderId === 'tender-1')).toHaveLength(1)
  })

  it('a new snapshot (e.g. a Phase 10 rescoring) produces a new run rather than reusing', async () => {
    const { store, state } = createFakeBidDecisionStore({ snapshotSeed: 1 })
    await runBidDecision(store, { tenderId: 'tender-1', agencyId: 'agency-1', triggeredBy: null })
    const { store: store2 } = createFakeBidDecisionStore({ snapshotSeed: 2, state })
    const second = await runBidDecision(store2, { tenderId: 'tender-1', agencyId: 'agency-1', triggeredBy: null })
    expect(state.runs.filter((r) => r.tenderId === 'tender-1')).toHaveLength(2)
    expect(state.runs.find((r) => r.id === second.runId)!.isCurrent).toBe(true)
    expect(state.runs.find((r) => r.id !== second.runId)!.isCurrent).toBe(false)
  })

  it('human override: system decision remains stored, final decision reflects the override, and audit event is written', async () => {
    const failInput = { ...baseInput(), scoringResult: { ...baseInput().scoringResult, overallScore: 20 } }
    const { store, state } = createFakeBidDecisionStore({ input: failInput })
    const result = await runBidDecision(store, { tenderId: 'tender-1', agencyId: 'agency-1', triggeredBy: null })
    expect(result.decision).toBe('NO_BID')

    const updated = await store.applyOverride(result.runId, { humanDecision: 'BID', overrideReason: 'Strategic client acquisition opportunity approved by executive team.', overriddenBy: 'exec-1', overriddenAt: new Date().toISOString() })
    expect(updated.systemDecision).toBe('NO_BID')
    expect(updated.humanDecision).toBe('BID')
    expect(updated.finalDecision).toBe('BID')
    expect(state.auditEvents.some((e) => e.eventType === 'BID_DECISION_OVERRIDDEN')).toBe(true)
  })

  it('override without a reason fails validation', async () => {
    const { store } = createFakeBidDecisionStore()
    const result = await runBidDecision(store, { tenderId: 'tender-1', agencyId: 'agency-1', triggeredBy: null })
    await expect(store.applyOverride(result.runId, { humanDecision: 'BID', overrideReason: '', overriddenBy: 'user-1', overriddenAt: new Date().toISOString() })).rejects.toThrow()
    await expect(store.applyOverride(result.runId, { humanDecision: 'BID', overrideReason: '   ', overriddenBy: 'user-1', overriddenAt: new Date().toISOString() })).rejects.toThrow()
  })
})
