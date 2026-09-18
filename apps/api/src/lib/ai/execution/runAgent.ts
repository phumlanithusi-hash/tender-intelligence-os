import type { OpenAiClient } from '../types.js'
import type { AiStore } from '../store.js'
import type { AiConfig } from '../config.js'
import { runClassificationAgent } from '../agents/classification/agent.js'
import { resolveEvidenceRefs, type ResolvedEvidence } from '../evidence/resolver.js'
import { gateTruthByEvidence } from '../evidence/validator.js'
import { withProviderRetry } from './retry.js'
import { logAiRunStarted, logAiRunCompleted, logAiRunFailed, logAiSchemaInvalid, logAiRequiresReview } from './audit.js'
import { AiMalformedOutputError, AiSchemaValidationError, AiRunAlreadyActiveError, AiNotConfiguredError } from '../errors.js'
import type { RawEvidenceRef } from '../agents/classification/schema.js'

export interface RunClassificationInput {
  tenderId: string
  agencyId: string
  triggeredBy: string | null
}

export interface RunClassificationDeps {
  store: AiStore
  client: OpenAiClient
  config: AiConfig
}

/**
 * Full run lifecycle orchestration (Phase 7 §21): QUEUED -> RUNNING ->
 * COMPLETED/PARTIAL/FAILED/REQUIRES_REVIEW. This is the composable,
 * idempotent, retryable, observable stage function a future BullMQ
 * worker would call per job unchanged (Phase 7 §33 — same seam
 * pattern as `processDocument`/`reprocessDocumentVersion` in
 * lib/documents/pipeline.ts). The classify/reclassify HTTP routes in
 * this phase call it via fire-and-forget instead of awaiting the full
 * OpenAI round trip inline, since no BullMQ wiring exists yet in this
 * codebase (verified — see docs/AI-ARCHITECTURE.md "Queue seam").
 *
 * Idempotency (Phase 7 §22/§36): a QUEUED/RUNNING run for the same
 * (tender, agency) already existing throws `AiRunAlreadyActiveError`
 * — callers surface this as 409, never silently starting a second
 * concurrent run. The database itself also enforces this via a
 * partial unique index, closing the race window between the check
 * and the insert.
 */
export async function runClassification(deps: RunClassificationDeps, input: RunClassificationInput) {
  const { store, client, config } = deps

  if (!config.apiKey) throw new AiNotConfiguredError()

  const active = await store.findActiveRun(input.tenderId, input.agencyId)
  if (active) throw new AiRunAlreadyActiveError(active.id)

  const tender = await store.getTender(input.tenderId)
  if (!tender) throw new Error('Tender not found')

  const run = await store.createRun({
    tenderId: input.tenderId,
    agencyId: input.agencyId,
    model: config.model,
    promptVersion: 'pending',
    inputRefs: {},
    triggeredBy: input.triggeredBy,
  })

  const startedAt = new Date()
  await store.updateRun(run.id, { status: 'RUNNING', startedAt: startedAt.toISOString() })
  logAiRunStarted({ runId: run.id, tenderId: input.tenderId, agencyId: input.agencyId, model: config.model })

  try {
    const [services, chunks] = await Promise.all([
      store.getAgencyServices(input.agencyId),
      store.listChunksForTender(input.tenderId, config.maxDocumentChunks * 2),
    ])

    const { result: agentResult, retries } = await withProviderRetry(
      () =>
        runClassificationAgent(client, {
          model: config.model,
          tender,
          services,
          chunks,
          limits: { maxDocumentChunks: config.maxDocumentChunks, maxContextChars: config.maxContextChars },
        }),
      { maxRetries: config.maxRetries },
    )

    const raw = agentResult.raw
    let requiresReview = false
    const validationErrors: string[] = []

    // --- Relevance -------------------------------------------------
    const relevanceEvidence = await resolveEvidenceRefs(store, input.tenderId, raw.relevance.evidence)
    const relevanceGate = gateTruthByEvidence(raw.relevance.truth, relevanceEvidence)
    if (relevanceGate.requiresReview) {
      requiresReview = true
      validationErrors.push(`relevance: ${relevanceGate.note}`)
    }

    const tenderTypeEvidence = await resolveEvidenceRefs(store, input.tenderId, raw.tenderType.evidence)
    const tenderTypeGate = gateTruthByEvidence(raw.tenderType.truth, tenderTypeEvidence)
    if (tenderTypeGate.requiresReview) {
      requiresReview = true
      validationErrors.push(`tenderType: ${tenderTypeGate.note}`)
    }

    const intentEvidence = await resolveEvidenceRefs(store, input.tenderId, raw.intent.evidence)
    const intentGate = gateTruthByEvidence(raw.intent.truth, intentEvidence)
    if (intentGate.requiresReview) {
      requiresReview = true
      validationErrors.push(`intent: ${intentGate.note}`)
    }

    const geographyEvidence = await resolveEvidenceRefs(store, input.tenderId, raw.geography.evidence)
    const geographyGate = gateTruthByEvidence(raw.geography.truth, geographyEvidence)
    if (geographyGate.requiresReview) {
      requiresReview = true
      validationErrors.push(`geography: ${geographyGate.note}`)
    }

    const contractEvidence = await resolveEvidenceRefs(store, input.tenderId, raw.contract.evidence)
    const contractGate = gateTruthByEvidence(raw.contract.truth, contractEvidence)
    if (contractGate.requiresReview) {
      requiresReview = true
      validationErrors.push(`contract: ${contractGate.note}`)
    }

    const briefingEvidence = await resolveEvidenceRefs(store, input.tenderId, raw.briefing.evidence)
    const briefingGate = gateTruthByEvidence(raw.briefing.truth, briefingEvidence)
    if (briefingGate.requiresReview) {
      requiresReview = true
      validationErrors.push(`briefing: ${briefingGate.note}`)
    }

    // Only assign services the agency actually has configured
    // (never invent a service outside the supplied taxonomy — Phase 7 §6).
    const validServiceIds = new Set(services.map((s) => s.id))
    const services_ = raw.services
      .filter((s) => validServiceIds.has(s.serviceId))
      .map((s) => ({ serviceId: s.serviceId, serviceName: services.find((x) => x.id === s.serviceId)!.name, confidence: s.confidence }))

    // --- Persist classification -------------------------------------------------
    const classification = await store.createClassification({
      runId: run.id,
      tenderId: input.tenderId,
      agencyId: input.agencyId,
      relevance: { value: raw.relevance.value, truth: relevanceGate.truth, confidence: raw.relevance.confidence },
      tenderType: { value: raw.tenderType.value, truth: tenderTypeGate.truth, confidence: raw.tenderType.confidence },
      intent: { text: raw.intent.text || null, truth: intentGate.truth, confidence: raw.intent.confidence },
      services: services_,
      geography: {
        scope: raw.geography.scope,
        provinceId: null,
        municipalityId: null,
        truth: geographyGate.truth,
        confidence: raw.geography.confidence,
      },
      contract: {
        value: {
          durationText: raw.contract.durationText,
          estimatedValue: raw.contract.estimatedValue,
          procurementMethod: raw.contract.procurementMethod,
          isFrameworkOrPanel: raw.contract.isFrameworkOrPanel,
          numberOfSuppliers: raw.contract.numberOfSuppliers,
          appointmentPeriod: raw.contract.appointmentPeriod,
        },
        truth: contractGate.truth,
        confidence: raw.contract.confidence,
      },
      briefing: {
        value: {
          status: raw.briefing.status,
          date: raw.briefing.date,
          time: raw.briefing.time,
          location: raw.briefing.location,
          url: raw.briefing.url,
          isOnline: raw.briefing.isOnline,
          registrationRequired: raw.briefing.registrationRequired,
        },
        status: raw.briefing.status,
        truth: briefingGate.truth,
        confidence: raw.briefing.confidence,
      },
      summary: { text: raw.summary.text || null, truth: raw.summary.truth },
    })

    await store.markPreviousClassificationsNotCurrent(input.tenderId, input.agencyId, classification.id)

    await persistClaim(store, run.id, classification.id, 'RELEVANCE', 'relevance', raw.relevance.value, relevanceGate, relevanceEvidence.resolved)
    await persistClaim(store, run.id, classification.id, 'TENDER_TYPE', 'tenderType', raw.tenderType.value, tenderTypeGate, tenderTypeEvidence.resolved)
    await persistClaim(store, run.id, classification.id, 'INTENT', 'intent', raw.intent.text, intentGate, intentEvidence.resolved)
    await persistClaim(store, run.id, classification.id, 'GEOGRAPHY', 'geography', raw.geography.scope, geographyGate, geographyEvidence.resolved)
    await persistClaim(store, run.id, classification.id, 'CONTRACT', 'contract', JSON.stringify(raw.contract), contractGate, contractEvidence.resolved)
    await persistClaim(store, run.id, classification.id, 'BRIEFING', 'briefing', JSON.stringify(raw.briefing), briefingGate, briefingEvidence.resolved)

    // --- Deliverables (Phase 7 §10) -------------------------------------------------
    for (const [i, d] of raw.deliverables.entries()) {
      const ev = await resolveEvidenceRefs(store, input.tenderId, d.evidence)
      const gate = gateTruthByEvidence(d.truth, ev)
      if (gate.requiresReview) {
        requiresReview = true
        validationErrors.push(`deliverable[${i}]: ${gate.note}`)
      }
      const deliverable = await store.createDeliverable(classification.id, d.text, gate.truth, d.confidence)
      await persistClaim(store, run.id, classification.id, 'DELIVERABLE', `deliverable:${deliverable.id}`, d.text, gate, ev.resolved)
    }

    // --- Apparent requirements (discovery only — Phase 7 §13) -------------------------------------------------
    for (const [i, r] of raw.apparentRequirements.entries()) {
      const ev = await resolveEvidenceRefs(store, input.tenderId, r.evidence)
      const gate = gateTruthByEvidence(r.truth, ev)
      if (gate.requiresReview) {
        requiresReview = true
        validationErrors.push(`apparentRequirement[${i}]: ${gate.note}`)
      }
      const requirement = await store.createRequirement(classification.id, r.kind, r.text, gate.truth, r.confidence)
      await persistClaim(store, run.id, classification.id, 'APPARENT_REQUIREMENT', `apparentRequirement:${requirement.id}`, r.text, gate, ev.resolved)
    }

    // --- Deadline/field conflicts (Phase 7 §15) -------------------------------------------------
    for (const c of raw.conflicts) {
      const ev = await resolveEvidenceRefs(store, input.tenderId, c.evidence)
      if (ev.resolved.length === 0) {
        // A conflict claim with no verifiable evidence is not
        // recorded as a conflict at all — it would just be an
        // unverified assertion, and Phase 7 §17 forbids fabricated
        // evidence from ever reaching a persisted record.
        requiresReview = true
        validationErrors.push(`conflict[${c.field}]: no evidence resolved for claimed document value`)
        continue
      }
      const gate = { truth: 'UNVERIFIED', evidenceResolved: true, requiresReview: false, note: null }
      const claim = await persistClaim(store, run.id, classification.id, 'CONFLICT', `conflict:${c.field}`, c.documentValue, gate, ev.resolved)
      const dbValue = conflictDbValue(tender, c.field)
      await store.createConflict({
        runId: run.id,
        classificationId: classification.id,
        tenderId: input.tenderId,
        field: c.field,
        dbValue,
        documentValue: c.documentValue,
        claimId: claim.id,
      })
    }

    const durationMs = Date.now() - startedAt.getTime()
    const status = requiresReview ? 'REQUIRES_REVIEW' : 'COMPLETED'

    await store.updateRun(run.id, {
      status,
      rawOutput: raw,
      validationStatus: requiresReview ? 'REQUIRES_REVIEW' : 'VALID',
      validationErrors,
      contextTruncated: agentResult.truncated,
      retryCount: retries,
      inputTokensEstimate: agentResult.usage.inputTokens,
      outputTokensEstimate: agentResult.usage.outputTokens,
      durationMs,
      completedAt: new Date().toISOString(),
    })

    if (requiresReview) {
      logAiRequiresReview({ runId: run.id, tenderId: input.tenderId, reason: validationErrors.join('; ') })
    }
    logAiRunCompleted({ runId: run.id, tenderId: input.tenderId, status, durationMs })

    return { runId: run.id, classificationId: classification.id, status }
  } catch (err) {
    const durationMs = Date.now() - startedAt.getTime()
    if (err instanceof AiMalformedOutputError) {
      await store.updateRun(run.id, {
        status: 'FAILED',
        validationStatus: 'MALFORMED_JSON',
        error: err.message,
        errorStage: 'PARSE',
        durationMs,
        completedAt: new Date().toISOString(),
      })
      logAiSchemaInvalid({ runId: run.id, tenderId: input.tenderId, issues: [err.message] })
      logAiRunFailed({ runId: run.id, tenderId: input.tenderId, errorStage: 'PARSE', error: err.message })
      return { runId: run.id, classificationId: null, status: 'FAILED' as const }
    }
    if (err instanceof AiSchemaValidationError) {
      await store.updateRun(run.id, {
        status: 'FAILED',
        validationStatus: 'SCHEMA_INVALID',
        validationErrors: err.issues,
        error: err.message,
        errorStage: 'SCHEMA_VALIDATION',
        durationMs,
        completedAt: new Date().toISOString(),
      })
      logAiSchemaInvalid({ runId: run.id, tenderId: input.tenderId, issues: err.issues })
      logAiRunFailed({ runId: run.id, tenderId: input.tenderId, errorStage: 'SCHEMA_VALIDATION', error: err.message })
      return { runId: run.id, classificationId: null, status: 'FAILED' as const }
    }

    const message = err instanceof Error ? err.message : String(err)
    await store.updateRun(run.id, {
      status: 'FAILED',
      error: message,
      errorStage: 'PROVIDER',
      durationMs,
      completedAt: new Date().toISOString(),
    })
    logAiRunFailed({ runId: run.id, tenderId: input.tenderId, errorStage: 'PROVIDER', error: message })
    return { runId: run.id, classificationId: null, status: 'FAILED' as const }
  }
}

async function persistClaim(
  store: AiStore,
  runId: string,
  classificationId: string | null,
  claimType: string,
  claimKey: string,
  claimText: string,
  gate: { truth: string; evidenceResolved: boolean },
  resolvedEvidence: ResolvedEvidence[],
) {
  const claim = await store.createClaim({
    runId,
    classificationId,
    claimType,
    claimKey,
    claimText,
    truth: gate.truth,
    confidence: null,
    evidenceResolved: gate.evidenceResolved,
  })
  for (const ev of resolvedEvidence) {
    await store.createEvidence({
      claimId: claim.id,
      documentId: ev.documentId,
      documentVersionId: ev.documentVersionId,
      pageId: null,
      sectionId: ev.sectionId,
      chunkId: ev.chunkId,
      pageNumber: ev.pageNumber,
      evidenceText: ev.evidenceText,
    })
  }
  return claim
}

function conflictDbValue(tender: { closingDate: string | null; closingTime: string | null; briefingDate: string | null; briefingLocation: string | null }, field: string): string | null {
  switch (field) {
    case 'CLOSING_DATE':
      return tender.closingDate
    case 'CLOSING_TIME':
      return tender.closingTime
    case 'BRIEFING_DATE':
      return tender.briefingDate
    case 'BRIEFING_LOCATION':
      return tender.briefingLocation
    default:
      return null
  }
}

// Re-export for route/idempotency error handling.
export { AiRunAlreadyActiveError } from '../errors.js'
export type { RawEvidenceRef }
