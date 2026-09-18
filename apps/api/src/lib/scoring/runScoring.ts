import type { ScoringStore } from './store.js'
import { evaluateOpportunity } from './computeScore.js'
import { logger } from '../logger.js'

export class ScoringRunAlreadyActiveError extends Error {
  readonly existingRunId: string
  constructor(existingRunId: string) {
    super(`A scoring run is already active for this tender (run ${existingRunId}).`)
    this.name = 'ScoringRunAlreadyActiveError'
    this.existingRunId = existingRunId
  }
}

export interface RunScoringInput {
  tenderId: string
  agencyId: string
  triggeredBy: string | null
  now?: string
}

function snapshotsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Full scoring run lifecycle (Phase 10 §32/§33/§47), mirroring
 * lib/qualification/runQualification.ts exactly: one active run per
 * tender+agency, append-only history via `is_current`, and — new for
 * this phase — an IDEMPOTENCY GUARD (§47): if the current run already
 * used the same scoring configuration version AND the same input
 * snapshot (nothing in qualification/requirements/evaluation
 * criteria/agency evidence/geography/strategic profile has changed
 * since), this returns the existing current run instead of creating a
 * pointless duplicate. A new scoring CONFIGURATION version always
 * creates a new run even with identical tender/agency state.
 */
export async function runScoring(store: ScoringStore, input: RunScoringInput) {
  const active = await store.findActiveRun(input.tenderId, input.agencyId)
  if (active) throw new ScoringRunAlreadyActiveError(active.id)

  const now = input.now ?? new Date().toISOString()
  const { versionId, config } = await store.getCurrentConfiguration()
  const { input: scoringInput, snapshot } = await store.assembleInput(input.tenderId, input.agencyId, now)

  const current = await store.findCurrentRun(input.tenderId, input.agencyId)
  if (current && current.status === 'COMPLETED' && current.scoringConfigurationVersionId === versionId && snapshotsEqual(current.inputSnapshot, snapshot)) {
    return { runId: current.id, reused: true, overallScore: current.overallScore, decisionSignal: current.decisionSignal }
  }

  const run = await store.createRun({ tenderId: input.tenderId, agencyId: input.agencyId, scoringConfigurationVersionId: versionId, triggeredBy: input.triggeredBy })
  await store.updateRun(run.id, { status: 'RUNNING', startedAt: now })

  try {
    const result = evaluateOpportunity(scoringInput, config)

    await Promise.all([store.saveComponents(run.id, result.components), store.saveDrivers(run.id, result.drivers), store.saveRisks(run.id, result.risks), store.saveGates(run.id, result.gates)])

    await store.markPreviousRunsNotCurrent(input.tenderId, input.agencyId, run.id)
    await store.updateRun(run.id, {
      status: 'COMPLETED',
      overallScore: result.overallScore,
      dataCompleteness: result.dataCompleteness,
      decisionSignal: result.decisionSignal,
      deadlineStatus: result.deadlineStatus,
      timezoneUnknown: result.timezoneUnknown,
      inputSnapshot: snapshot,
      completedAt: new Date().toISOString(),
    })

    return { runId: run.id, reused: false, overallScore: result.overallScore, decisionSignal: result.decisionSignal }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await store.updateRun(run.id, { status: 'FAILED', error: message, completedAt: new Date().toISOString() })
    logger.error({ err, tenderId: input.tenderId, agencyId: input.agencyId }, 'scoring run failed')
    const decisionSignal: null = null
    return { runId: run.id, reused: false, overallScore: null, decisionSignal, failed: true }
  }
}
