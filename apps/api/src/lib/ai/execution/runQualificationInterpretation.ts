import type { OpenAiClient } from '../types.js'
import type { QualificationAiStore } from '../qualificationAiStore.js'
import type { AiConfig } from '../config.js'
import { runQualificationInterpretationAgent } from '../agents/qualification/agent.js'
import { resolveEvidenceRefs } from '../evidence/resolver.js'
import { gateTruthByEvidence } from '../evidence/validator.js'
import { withProviderRetry } from './retry.js'
import { logAiRunStarted, logAiRunCompleted, logAiRunFailed, logAiSchemaInvalid, logAiRequiresReview } from './audit.js'
import { AiMalformedOutputError, AiSchemaValidationError, AiRunAlreadyActiveError, AiNotConfiguredError } from '../errors.js'
import type { QualificationCandidate } from '../agents/qualification/prompt.js'

export interface RunQualificationInterpretationInput {
  tenderId: string
  agencyId: string
  triggeredBy: string | null
  /** Candidate requirement texts identified by an earlier DETERMINISTIC step (e.g. Phase 7 apparentRequirements, or manually entered PROVISIONAL requirements) — the agent interprets these, it never invents new candidates (Phase 8 §6/§26). */
  candidates: QualificationCandidate[]
}

export interface RunQualificationInterpretationDeps {
  store: QualificationAiStore
  client: OpenAiClient
  config: AiConfig
}

/**
 * Full run lifecycle for QualificationInterpretationAgent (Phase 8
 * §26/§27), mirroring runClassification's lifecycle (Phase 7
 * §21/§22/§33) exactly: QUEUED -> RUNNING -> COMPLETED/REQUIRES_REVIEW/
 * FAILED, idempotent per (tender, agency, agent), evidence
 * server-resolved and never trusted from the model, one interpretation
 * row + one claim + N evidence rows per candidate. This produces
 * ONLY category/ruleType/mandatoryStatus/interpretation — never a
 * qualification result; results.ts/runQualification.ts (deterministic
 * engine) is the only thing that ever writes a PASS/FAIL/UNKNOWN/
 * REQUIRES_ACTION.
 */
export async function runQualificationInterpretation(deps: RunQualificationInterpretationDeps, input: RunQualificationInterpretationInput) {
  const { store, client, config } = deps
  if (!config.apiKey) throw new AiNotConfiguredError()

  const active = await store.findActiveInterpretationRun(input.tenderId, input.agencyId)
  if (active) throw new AiRunAlreadyActiveError(active.id)

  const run = await store.createInterpretationRun({
    tenderId: input.tenderId,
    agencyId: input.agencyId,
    model: config.model,
    promptVersion: 'pending',
    inputRefs: { candidateCount: input.candidates.length },
    triggeredBy: input.triggeredBy,
  })

  const startedAt = new Date()
  await store.updateRun(run.id, { status: 'RUNNING', startedAt: startedAt.toISOString() })
  logAiRunStarted({ runId: run.id, tenderId: input.tenderId, agencyId: input.agencyId, model: config.model })

  try {
    const chunks = await store.listChunksForTender(input.tenderId, config.maxDocumentChunks * 2)

    const { result: agentResult, retries } = await withProviderRetry(
      () =>
        runQualificationInterpretationAgent(client, {
          model: config.model,
          candidates: input.candidates,
          chunks,
          limits: { maxDocumentChunks: config.maxDocumentChunks, maxContextChars: config.maxContextChars },
        }),
      { maxRetries: config.maxRetries },
    )

    let requiresReview = false
    const validationErrors: string[] = []
    const interpretationIds: string[] = []

    for (const item of agentResult.raw.interpretations) {
      const candidate = input.candidates[item.candidateIndex]
      const candidateText = candidate?.text ?? '(unknown candidate — index out of range)'
      if (!candidate) {
        requiresReview = true
        validationErrors.push(`interpretation[${item.candidateIndex}]: model referenced a candidateIndex outside the supplied candidate list`)
      }

      const ev = await resolveEvidenceRefs(store, input.tenderId, item.evidence)
      const gate = gateTruthByEvidence(item.truth, ev)
      const reviewNeeded = gate.requiresReview || item.requiresReview || item.mandatoryStatus === 'UNKNOWN'
      if (reviewNeeded) {
        requiresReview = true
        if (gate.note) validationErrors.push(`interpretation[${item.candidateIndex}]: ${gate.note}`)
      }

      const claim = await store.createClaim({
        runId: run.id,
        claimType: 'QUALIFICATION_INTERPRETATION',
        claimKey: `qualificationInterpretation:${item.candidateIndex}`,
        claimText: candidateText,
        truth: gate.truth,
        confidence: item.confidence,
        evidenceResolved: gate.evidenceResolved,
      })
      for (const e of ev.resolved) {
        await store.createEvidence({
          claimId: claim.id,
          documentId: e.documentId,
          documentVersionId: e.documentVersionId,
          pageId: null,
          sectionId: e.sectionId,
          chunkId: e.chunkId,
          pageNumber: e.pageNumber,
          evidenceText: e.evidenceText,
        })
      }

      const interpretation = await store.createInterpretation({
        runId: run.id,
        claimId: claim.id,
        requirementText: candidateText,
        category: item.category,
        ruleType: item.ruleType,
        mandatoryStatus: item.mandatoryStatus,
        interpretation: item.interpretation,
        truth: gate.truth,
        confidence: item.confidence,
      })
      interpretationIds.push(interpretation.id)
    }

    const durationMs = Date.now() - startedAt.getTime()
    const status = requiresReview ? 'REQUIRES_REVIEW' : 'COMPLETED'

    await store.updateRun(run.id, {
      status,
      rawOutput: agentResult.raw,
      validationStatus: requiresReview ? 'REQUIRES_REVIEW' : 'VALID',
      validationErrors,
      contextTruncated: agentResult.truncated,
      retryCount: retries,
      inputTokensEstimate: agentResult.usage.inputTokens,
      outputTokensEstimate: agentResult.usage.outputTokens,
      durationMs,
      completedAt: new Date().toISOString(),
    })

    if (requiresReview) logAiRequiresReview({ runId: run.id, tenderId: input.tenderId, reason: validationErrors.join('; ') })
    logAiRunCompleted({ runId: run.id, tenderId: input.tenderId, status, durationMs })

    return { runId: run.id, interpretationIds, status }
  } catch (err) {
    const durationMs = Date.now() - startedAt.getTime()
    if (err instanceof AiMalformedOutputError) {
      await store.updateRun(run.id, { status: 'FAILED', validationStatus: 'MALFORMED_JSON', error: err.message, errorStage: 'PARSE', durationMs, completedAt: new Date().toISOString() })
      logAiSchemaInvalid({ runId: run.id, tenderId: input.tenderId, issues: [err.message] })
      logAiRunFailed({ runId: run.id, tenderId: input.tenderId, errorStage: 'PARSE', error: err.message })
      return { runId: run.id, interpretationIds: [], status: 'FAILED' as const }
    }
    if (err instanceof AiSchemaValidationError) {
      await store.updateRun(run.id, { status: 'FAILED', validationStatus: 'SCHEMA_INVALID', validationErrors: err.issues, error: err.message, errorStage: 'SCHEMA_VALIDATION', durationMs, completedAt: new Date().toISOString() })
      logAiSchemaInvalid({ runId: run.id, tenderId: input.tenderId, issues: err.issues })
      logAiRunFailed({ runId: run.id, tenderId: input.tenderId, errorStage: 'SCHEMA_VALIDATION', error: err.message })
      return { runId: run.id, interpretationIds: [], status: 'FAILED' as const }
    }
    const message = err instanceof Error ? err.message : String(err)
    await store.updateRun(run.id, { status: 'FAILED', error: message, errorStage: 'PROVIDER', durationMs, completedAt: new Date().toISOString() })
    logAiRunFailed({ runId: run.id, tenderId: input.tenderId, errorStage: 'PROVIDER', error: message })
    return { runId: run.id, interpretationIds: [], status: 'FAILED' as const }
  }
}

export { AiRunAlreadyActiveError } from '../errors.js'
