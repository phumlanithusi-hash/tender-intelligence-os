import type { OpenAiClient } from '../types.js'
import type { RequirementEvaluationStore, EvidenceLinkInput } from '../requirementEvaluationStore.js'
import type { AiConfig } from '../config.js'
import { REQUIREMENT_EXTRACTION_AGENT_NAME } from '@tender-os/constants'
import { runRequirementExtractionAgent } from '../agents/extraction/agent.js'
import type { RawExtractedRequirement, RawEvaluationCriterion, RawEvaluationGate, RawExtractionConflict } from '../agents/extraction/schema.js'
import { resolveEvidenceRefs, type EvidenceResolutionResult } from '../evidence/resolver.js'
import { gateTruthByEvidence } from '../evidence/validator.js'
import { withProviderRetry } from './retry.js'
import { logAiRunStarted, logAiRunCompleted, logAiRunFailed, logAiSchemaInvalid, logAiRequiresReview } from './audit.js'
import { AiMalformedOutputError, AiSchemaValidationError, AiRunAlreadyActiveError, AiNotConfiguredError } from '../errors.js'
import type { RawEvidenceRef } from '../agents/classification/schema.js'

export interface RunRequirementEvaluationExtractionInput {
  tenderId: string
  triggeredBy: string | null
}

export interface RunRequirementEvaluationExtractionDeps {
  store: RequirementEvaluationStore
  client: OpenAiClient
  config: AiConfig
}

const normalise = (s: string) => s.trim().toLowerCase()

function toEvidenceLinks(resolved: EvidenceResolutionResult): EvidenceLinkInput[] {
  return resolved.resolved.map((e) => ({
    documentId: e.documentId,
    documentVersionId: e.documentVersionId,
    pageId: null,
    sectionId: e.sectionId,
    chunkId: e.chunkId,
    pageNumber: e.pageNumber,
    evidenceText: e.evidenceText,
  }))
}

/**
 * Full run lifecycle for RequirementExtractionAgent (Phase 9 §8/§30/§47),
 * mirroring runClassification/runQualificationInterpretation exactly:
 * QUEUED -> RUNNING -> COMPLETED/REQUIRES_REVIEW/FAILED, idempotent per
 * tender (agency-agnostic — see requirementEvaluationStore.ts), evidence
 * server-resolved and never trusted from the model.
 *
 * Deterministic post-processing pipeline (Phase 9 §47): AI output (already
 * Zod-validated by the agent) -> evidence resolution -> evidence validation
 * (gateTruthByEvidence) -> deterministic normalisation (status/version
 * computation below) -> conflict detection -> persistence. The model NEVER
 * writes a DB row directly — every field below is recomputed/verified here.
 */
export async function runRequirementEvaluationExtraction(deps: RunRequirementEvaluationExtractionDeps, input: RunRequirementEvaluationExtractionInput) {
  const { store, client, config } = deps
  if (!config.apiKey) throw new AiNotConfiguredError()

  const active = await store.findActiveExtractionRun(input.tenderId)
  if (active) throw new AiRunAlreadyActiveError(active.id)

  const run = await store.createExtractionRun({
    tenderId: input.tenderId,
    model: config.model,
    promptVersion: 'pending',
    inputRefs: {},
    triggeredBy: input.triggeredBy,
  })

  const startedAt = new Date()
  await store.updateRun(run.id, { status: 'RUNNING', startedAt: startedAt.toISOString() })
  logAiRunStarted({ runId: run.id, tenderId: input.tenderId, agencyId: null, model: config.model })

  try {
    const chunks = await store.listChunksForTender(input.tenderId, config.maxDocumentChunks * 2)

    const { result: agentResult, retries } = await withProviderRetry(
      () => runRequirementExtractionAgent(client, { model: config.model, chunks, limits: { maxDocumentChunks: config.maxDocumentChunks, maxContextChars: config.maxContextChars } }),
      { maxRetries: config.maxRetries },
    )

    const raw = agentResult.raw
    const validationErrors: string[] = []
    let requiresReview = false
    let unknownCount = 0
    let requiresReviewCount = 0
    let totalRequestedEvidence = 0
    let totalResolvedEvidence = 0

    // Conflicts reference requirement/criterion by array index — resolved
    // up front so the affected rows are created with status CONFLICT from
    // the start (never silently created VERIFIED then quietly changed).
    const conflictedRequirementIndexes = new Set<number>()
    const conflictedCriterionIndexes = new Set<number>()
    for (const c of raw.conflicts) {
      if (c.type === 'REQUIREMENT' && c.requirementIndex !== null) conflictedRequirementIndexes.add(c.requirementIndex)
      if (c.type === 'EVALUATION_CRITERION' && c.criterionIndex !== null) conflictedCriterionIndexes.add(c.criterionIndex)
    }

    // Previous extracted rows, fetched BEFORE any new row is created, so
    // matching never compares a new run's output against itself.
    const previousRequirements = await store.listCurrentExtractedRequirements(input.tenderId)
    const previousCriteria = await store.listCurrentExtractedCriteria(input.tenderId)

    // ---- Requirements (two-pass: create, then link parents) ----
    const requirementIdByIndex = new Map<number, string>()
    for (const item of raw.requirements as RawExtractedRequirement[]) {
      const ev = await resolveEvidenceRefs(store, input.tenderId, item.evidence as RawEvidenceRef[])
      totalRequestedEvidence += item.evidence.length
      totalResolvedEvidence += ev.resolved.length
      const gate = gateTruthByEvidence(item.truth, ev)
      if (item.mandatoryStatus === 'UNKNOWN') unknownCount++

      let requirementStatus: string
      if (conflictedRequirementIndexes.has(item.index)) {
        requirementStatus = 'CONFLICT'
      } else if (gate.requiresReview) {
        requirementStatus = 'REQUIRES_REVIEW'
      } else if (gate.truth === 'FACT' && ev.resolved.length > 0) {
        requirementStatus = 'VERIFIED'
      } else {
        requirementStatus = 'PROVISIONAL'
      }
      if (requirementStatus === 'REQUIRES_REVIEW' || requirementStatus === 'CONFLICT') {
        requiresReview = true
        requiresReviewCount++
        if (gate.note) validationErrors.push(`requirement[${item.index}]: ${gate.note}`)
      }

      const claim = await store.createClaim({
        runId: run.id,
        claimType: 'REQUIREMENT_EXTRACTION',
        claimKey: `requirement:${item.index}`,
        claimText: item.title,
        truth: gate.truth,
        confidence: item.confidence,
        evidenceResolved: gate.evidenceResolved,
      })
      const links = toEvidenceLinks(ev)
      for (const e of links) await store.createEvidence({ claimId: claim.id, ...e })

      const previous = previousRequirements.find((p) => p.category === item.category && normalise(p.title) === normalise(item.title))
      const version = previous ? previous.version + 1 : 1

      const created = await store.createRequirement({
        tenderId: input.tenderId,
        parentRequirementId: null,
        category: item.category,
        title: item.title,
        description: item.description,
        mandatoryStatus: item.mandatoryStatus,
        ruleType: item.ruleType,
        disqualificationRisk: item.disqualificationLanguage,
        sourceTruth: gate.truth,
        requirementStatus,
        confidence: item.confidence,
        version,
        aiRunId: run.id,
        aiClaimId: claim.id,
      })
      requirementIdByIndex.set(item.index, created.id)
      if (links.length > 0) await store.linkRequirementEvidence(created.id, links)
      if (previous) await store.supersedeRequirement(previous.id, created.id, version)
    }
    for (const item of raw.requirements as RawExtractedRequirement[]) {
      if (item.parentIndex === null) continue
      const childId = requirementIdByIndex.get(item.index)
      const parentId = requirementIdByIndex.get(item.parentIndex)
      if (childId && parentId) await store.setRequirementParent(childId, parentId)
      else validationErrors.push(`requirement[${item.index}]: parentIndex ${item.parentIndex} did not resolve to a requirement in this same run`)
    }

    // ---- Evaluation criteria (two-pass) ----
    const criterionIdByIndex = new Map<number, string>()
    for (const item of raw.evaluationFramework.criteria as RawEvaluationCriterion[]) {
      const ev = await resolveEvidenceRefs(store, input.tenderId, item.evidence as RawEvidenceRef[])
      totalRequestedEvidence += item.evidence.length
      totalResolvedEvidence += ev.resolved.length
      const gate = gateTruthByEvidence(item.truth, ev)
      if (item.criterionType === 'UNKNOWN') unknownCount++

      let status: string
      if (conflictedCriterionIndexes.has(item.index)) {
        status = 'CONFLICT'
      } else if (gate.requiresReview) {
        status = 'REQUIRES_REVIEW'
      } else if (gate.truth === 'FACT' && ev.resolved.length > 0) {
        status = 'VERIFIED'
      } else {
        status = 'PROVISIONAL'
      }
      if (status === 'REQUIRES_REVIEW' || status === 'CONFLICT') {
        requiresReview = true
        requiresReviewCount++
        if (gate.note) validationErrors.push(`criterion[${item.index}]: ${gate.note}`)
      }

      const claim = await store.createClaim({
        runId: run.id,
        claimType: 'EVALUATION_CRITERION_EXTRACTION',
        claimKey: `criterion:${item.index}`,
        claimText: item.name,
        truth: gate.truth,
        confidence: item.confidence,
        evidenceResolved: gate.evidenceResolved,
      })
      const links = toEvidenceLinks(ev)
      for (const e of links) await store.createEvidence({ claimId: claim.id, ...e })

      const previous = previousCriteria.find((p) => p.criterionType === item.criterionType && normalise(p.name) === normalise(item.name))
      const version = previous ? previous.version + 1 : 1

      const created = await store.createCriterion({
        tenderId: input.tenderId,
        parentCriterionId: null,
        name: item.name,
        description: item.description || null,
        criterionType: item.criterionType,
        maximumPoints: item.maximumPoints,
        weight: item.weight,
        minimumThreshold: item.minimumThreshold,
        scoringMethod: item.scoringMethod === 'UNKNOWN' ? null : item.scoringMethod,
        scoringBands: item.scoringBands,
        gate: item.gate,
        thresholdType: item.thresholdType,
        formulaText: item.formulaText,
        formulaType: item.formulaType,
        formulaVariables: item.formulaVariables,
        localContentMinPercent: item.localContentMinPercent,
        presentationMandatory: item.presentationMandatory,
        presentationDate: item.presentationDate,
        presentationAttendees: item.presentationAttendees,
        sourceTruth: gate.truth,
        status,
        confidence: item.confidence,
        version,
        aiRunId: run.id,
        aiClaimId: claim.id,
      })
      criterionIdByIndex.set(item.index, created.id)
      if (links.length > 0) await store.linkCriterionEvidence(created.id, links)
      if (previous) await store.supersedeCriterion(previous.id, created.id, version)
    }
    for (const item of raw.evaluationFramework.criteria as RawEvaluationCriterion[]) {
      if (item.parentIndex === null) continue
      const childId = criterionIdByIndex.get(item.index)
      const parentId = criterionIdByIndex.get(item.parentIndex)
      if (childId && parentId) await store.setCriterionParent(childId, parentId)
      else validationErrors.push(`criterion[${item.index}]: parentIndex ${item.parentIndex} did not resolve to a criterion in this same run`)
    }

    // ---- Gates ----
    for (const gateItem of raw.evaluationFramework.gates as RawEvaluationGate[]) {
      const ev = await resolveEvidenceRefs(store, input.tenderId, gateItem.evidence as RawEvidenceRef[])
      totalRequestedEvidence += gateItem.evidence.length
      totalResolvedEvidence += ev.resolved.length
      const gateTruth = gateTruthByEvidence(gateItem.truth, ev)
      const status = gateTruth.requiresReview ? 'REQUIRES_REVIEW' : gateTruth.truth === 'FACT' && ev.resolved.length > 0 ? 'VERIFIED' : 'PROVISIONAL'
      if (status === 'REQUIRES_REVIEW') {
        requiresReview = true
        requiresReviewCount++
      }

      const claim = await store.createClaim({
        runId: run.id,
        claimType: 'EVALUATION_GATE_EXTRACTION',
        claimKey: `gate:${gateItem.index}`,
        claimText: gateItem.name,
        truth: gateTruth.truth,
        confidence: null,
        evidenceResolved: gateTruth.evidenceResolved,
      })
      const links = toEvidenceLinks(ev)
      for (const e of links) await store.createEvidence({ claimId: claim.id, ...e })

      const criterionId = gateItem.criterionIndex !== null ? (criterionIdByIndex.get(gateItem.criterionIndex) ?? null) : null
      const created = await store.createGate({
        tenderId: input.tenderId,
        criterionId,
        name: gateItem.name,
        threshold: gateItem.threshold,
        thresholdType: gateItem.thresholdType,
        description: gateItem.description,
        sourceTruth: gateTruth.truth,
        status,
        aiRunId: run.id,
        aiClaimId: claim.id,
      })
      if (links.length > 0) await store.linkGateEvidence(created.id, links)
    }

    // ---- Conflicts (Phase 9 §28) ----
    let conflictCount = 0
    for (const conflict of raw.conflicts as RawExtractionConflict[]) {
      const evA = await resolveEvidenceRefs(store, input.tenderId, conflict.evidenceA as RawEvidenceRef[])
      const evB = await resolveEvidenceRefs(store, input.tenderId, conflict.evidenceB as RawEvidenceRef[])
      // Never persist a "conflict" the server cannot itself verify with at
      // least one resolvable evidence item on EACH side — otherwise it is
      // just an unverifiable model claim, flagged for review instead.
      if (evA.resolved.length === 0 || evB.resolved.length === 0) {
        requiresReview = true
        requiresReviewCount++
        validationErrors.push(`conflict "${conflict.description}": could not verify both sides' evidence — not persisted as a CONFLICT record.`)
        continue
      }
      conflictCount++
      if (conflict.type === 'REQUIREMENT') {
        const requirementId = conflict.requirementIndex !== null ? (requirementIdByIndex.get(conflict.requirementIndex) ?? null) : null
        await store.createRequirementConflict({
          tenderId: input.tenderId,
          category: 'UNKNOWN',
          description: conflict.description,
          evidenceA: evA.resolved,
          evidenceB: evB.resolved,
          requirementId,
        })
      } else {
        const criterionId = conflict.criterionIndex !== null ? (criterionIdByIndex.get(conflict.criterionIndex) ?? null) : null
        await store.createEvaluationConflict({ tenderId: input.tenderId, criterionId, description: conflict.description, evidenceA: evA.resolved, evidenceB: evB.resolved })
      }
    }

    const evidenceCoverage = totalRequestedEvidence > 0 ? totalResolvedEvidence / totalRequestedEvidence : null
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
      evidenceCoverage,
      conflictCount,
      unknownCount,
      requiresReviewCount,
    })

    if (requiresReview) logAiRequiresReview({ runId: run.id, tenderId: input.tenderId, reason: validationErrors.join('; ') })
    logAiRunCompleted({ runId: run.id, tenderId: input.tenderId, status, durationMs })

    return { runId: run.id, requirementCount: requirementIdByIndex.size, criterionCount: criterionIdByIndex.size, conflictCount, status }
  } catch (err) {
    const durationMs = Date.now() - startedAt.getTime()
    if (err instanceof AiMalformedOutputError) {
      await store.updateRun(run.id, { status: 'FAILED', validationStatus: 'MALFORMED_JSON', error: err.message, errorStage: 'PARSE', durationMs, completedAt: new Date().toISOString() })
      logAiSchemaInvalid({ runId: run.id, tenderId: input.tenderId, issues: [err.message] })
      logAiRunFailed({ runId: run.id, tenderId: input.tenderId, errorStage: 'PARSE', error: err.message })
      return { runId: run.id, requirementCount: 0, criterionCount: 0, conflictCount: 0, status: 'FAILED' as const }
    }
    if (err instanceof AiSchemaValidationError) {
      await store.updateRun(run.id, { status: 'FAILED', validationStatus: 'SCHEMA_INVALID', validationErrors: err.issues, error: err.message, errorStage: 'SCHEMA_VALIDATION', durationMs, completedAt: new Date().toISOString() })
      logAiSchemaInvalid({ runId: run.id, tenderId: input.tenderId, issues: err.issues })
      logAiRunFailed({ runId: run.id, tenderId: input.tenderId, errorStage: 'SCHEMA_VALIDATION', error: err.message })
      return { runId: run.id, requirementCount: 0, criterionCount: 0, conflictCount: 0, status: 'FAILED' as const }
    }
    const message = err instanceof Error ? err.message : String(err)
    await store.updateRun(run.id, { status: 'FAILED', error: message, errorStage: 'PROVIDER', durationMs, completedAt: new Date().toISOString() })
    logAiRunFailed({ runId: run.id, tenderId: input.tenderId, errorStage: 'PROVIDER', error: message })
    return { runId: run.id, requirementCount: 0, criterionCount: 0, conflictCount: 0, status: 'FAILED' as const }
  }
}

export { AiRunAlreadyActiveError } from '../errors.js'
export { REQUIREMENT_EXTRACTION_AGENT_NAME }
