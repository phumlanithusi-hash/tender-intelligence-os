import type { QualificationStore } from './store.js'
import { evaluateRequirement } from './evaluator.js'
import { computeOverallStatus, summarizeResults } from './status.js'
import type { EvaluationContext, RuleResult } from './types.js'
import { logQualificationRunStarted, logQualificationRunCompleted, logQualificationRunFailed, logQualificationMandatoryBlocker } from './audit.js'

export class QualificationRunAlreadyActiveError extends Error {
  readonly existingRunId: string
  constructor(existingRunId: string) {
    super(`A qualification evaluation run is already active for this tender (run ${existingRunId}).`)
    this.name = 'QualificationRunAlreadyActiveError'
    this.existingRunId = existingRunId
  }
}

export interface RunQualificationInput {
  tenderId: string
  agencyId: string
  triggeredBy: string | null
  /** UTC ISO 8601 — injected so the whole run is reproducible/testable; defaults to real time only at the route layer. */
  now?: string
}

/**
 * Full qualification evaluation run lifecycle (Phase 8 §24/§25/§30).
 * Fetches the tender's structured requirements + this agency's
 * evidence snapshot, runs the pure deterministic engine
 * (evaluator.ts) over every requirement, computes the overall status
 * with the documented precedence (status.ts), and persists one
 * `tender_qualification_results` row + its evidence + any actions per
 * requirement, plus a run summary. Mirrors the Phase 7
 * `runClassification` lifecycle shape (idempotent, one active run per
 * tender+agency, append-only history via `is_current`).
 */
export async function runQualification(store: QualificationStore, input: RunQualificationInput) {
  const active = await store.findActiveRun(input.tenderId, input.agencyId)
  if (active) throw new QualificationRunAlreadyActiveError(active.id)

  const tenderContext = await store.getTenderContext(input.tenderId)
  if (!tenderContext) throw new Error('Tender not found')

  const run = await store.createRun({ tenderId: input.tenderId, agencyId: input.agencyId, triggeredBy: input.triggeredBy })
  const startedAt = new Date()
  await store.updateRun(run.id, { status: 'RUNNING', startedAt: startedAt.toISOString() })
  logQualificationRunStarted({ runId: run.id, tenderId: input.tenderId, agencyId: input.agencyId })

  try {
    const [requirements, agency] = await Promise.all([store.getRequirements(input.tenderId), store.getAgencySnapshot(input.agencyId)])

    const evalContext: EvaluationContext = {
      now: input.now ?? new Date().toISOString(),
      tenderClosingDate: tenderContext.closingDate,
      briefingDate: tenderContext.briefingDate,
      briefingRequired: tenderContext.briefingRequired,
    }

    const results: RuleResult[] = []
    for (const requirement of requirements) {
      const result = evaluateRequirement(requirement, agency, evalContext)
      results.push(result)

      const persisted = await store.createResult({ runId: run.id, requirementId: requirement.id, tenderId: input.tenderId, agencyId: input.agencyId, result })
      for (const action of result.actions) {
        await store.createAction({
          runId: run.id,
          resultId: persisted.id,
          requirementId: requirement.id,
          tenderId: input.tenderId,
          agencyId: input.agencyId,
          description: action.description,
          priority: action.priority,
          dueDate: action.dueDate,
        })
      }
    }

    const overallStatus = computeOverallStatus(results)
    const summary = summarizeResults(results)

    if (summary.mandatoryBlockerCount > 0) {
      logQualificationMandatoryBlocker({ runId: run.id, tenderId: input.tenderId, agencyId: input.agencyId, count: summary.mandatoryBlockerCount })
    }

    await store.markPreviousRunsNotCurrent(input.tenderId, input.agencyId, run.id)
    await store.updateRun(run.id, {
      status: 'COMPLETED',
      overallStatus,
      mandatoryBlockerCount: summary.mandatoryBlockerCount,
      actionRequiredCount: summary.actionRequiredCount,
      requiresReviewCount: summary.requiresReviewCount,
      requirementCount: summary.requirementCount,
      completedAt: new Date().toISOString(),
    })

    logQualificationRunCompleted({ runId: run.id, tenderId: input.tenderId, overallStatus })
    return { runId: run.id, overallStatus, summary }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await store.updateRun(run.id, { status: 'FAILED', error: message, completedAt: new Date().toISOString() })
    logQualificationRunFailed({ runId: run.id, tenderId: input.tenderId, error: message })
    return { runId: run.id, overallStatus: 'UNKNOWN' as const, summary: null, failed: true }
  }
}
