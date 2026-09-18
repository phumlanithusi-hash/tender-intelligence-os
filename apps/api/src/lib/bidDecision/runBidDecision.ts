import type { BidDecisionStore } from './store.js'
import { evaluateBidDecision } from './evaluateBidDecision.js'
import { logger } from '../logger.js'

export class BidDecisionRunAlreadyActiveError extends Error {
  readonly existingRunId: string
  constructor(existingRunId: string) {
    super(`A bid-decision run is already active for this tender (run ${existingRunId}).`)
    this.name = 'BidDecisionRunAlreadyActiveError'
    this.existingRunId = existingRunId
  }
}

export interface RunBidDecisionInput {
  tenderId: string
  agencyId: string
  triggeredBy: string | null
  now?: string
}

function snapshotsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Full bid-decision run lifecycle (Phase 11 §39/§40), mirroring
 * lib/scoring/runScoring.ts exactly: one active run per tender+agency,
 * append-only history via `is_current`, and the same idempotency guard
 * — an unchanged policy version + unchanged input snapshot reuses the
 * current run instead of creating a duplicate. A new bid POLICY
 * version, or a new Phase 10 scoring run, always creates a new
 * decision run (Phase 11 §41 staleness conditions).
 */
export async function runBidDecision(store: BidDecisionStore, input: RunBidDecisionInput) {
  const active = await store.findActiveRun(input.tenderId, input.agencyId)
  if (active) throw new BidDecisionRunAlreadyActiveError(active.id)

  const now = input.now ?? new Date().toISOString()
  const { versionId, policy } = await store.getCurrentPolicy(input.agencyId)
  const { input: decisionInput, snapshot } = await store.assembleInput(input.tenderId, input.agencyId, now)

  const current = await store.findCurrentRun(input.tenderId, input.agencyId)
  if (current && current.status === 'COMPLETED' && current.bidPolicyVersionId === versionId && snapshotsEqual(current.inputSnapshot, snapshot)) {
    return { runId: current.id, reused: true, decision: current.finalDecision }
  }

  const run = await store.createRun({ tenderId: input.tenderId, agencyId: input.agencyId, bidPolicyVersionId: versionId, scoringRunId: decisionInput.scoringRunId, triggeredBy: input.triggeredBy })
  await store.updateRun(run.id, { status: 'RUNNING', startedAt: now })

  try {
    const result = evaluateBidDecision(decisionInput, policy)

    await store.saveRuleResults(run.id, result.ruleResults)
    await store.markPreviousRunsNotCurrent(input.tenderId, input.agencyId, run.id)
    await store.updateRun(run.id, {
      status: 'COMPLETED',
      systemDecision: result.decision,
      finalDecision: result.decision, // no override yet on a fresh run
      bidEffort: result.bidEffort,
      bidEffortExplanation: result.bidEffortExplanation,
      decisionExplanation: result.decisionExplanation,
      inputSnapshot: snapshot,
      completedAt: new Date().toISOString(),
    })
    await store.writeAuditEvent({ eventType: 'BID_DECISION_CREATED', agencyId: input.agencyId, actorId: input.triggeredBy, entityId: run.id, oldValue: null, newValue: { decision: result.decision, tenderId: input.tenderId } })

    return { runId: run.id, reused: false, decision: result.decision }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await store.updateRun(run.id, { status: 'FAILED', error: message, completedAt: new Date().toISOString() })
    logger.error({ err, tenderId: input.tenderId, agencyId: input.agencyId }, 'bid decision run failed')
    return { runId: run.id, reused: false, decision: null, failed: true }
  }
}
