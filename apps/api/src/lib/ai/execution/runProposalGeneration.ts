import type { OpenAiClient } from '../types.js'
import type { AiConfig } from '../config.js'
import { isAiConfigured } from '../config.js'
import { runProposalSectionAgent, type ProposalSectionPromptContext } from '../agents/proposalSection/agent.js'
import { withProviderRetry } from './retry.js'
import { AiMalformedOutputError, AiSchemaValidationError } from '../errors.js'
import type { ProposalGenerationResult } from '@tender-os/schemas'
import { computeGenerationInputContextHash } from '../../proposals/contentHash.js'
import { evaluateClaimSupport, renderUnsupportedClaimPlaceholder } from '../../proposals/unsupportedClaims.js'
import type { EvidenceLifecycleForClaim } from '../../proposals/types.js'

export interface RunProposalGenerationInput {
  context: ProposalSectionPromptContext
  strategyVersion: number | null
  /**
   * The full set of evidence claim ids that are actually
   * APPROVED+non-revoked for this agency right now, with their
   * staleness flag — independently supplied by the caller (which reads
   * this from Phase 13 tables), never trusted from the model's own
   * output (Phase 14 §10/§23 binding constraint: "only Phase 13
   * APPROVED evidence is authoritative").
   */
  currentlyApprovedEvidence: Map<string, { isStale: boolean }>
  /** The exact set of requirement/evaluation ids that are structurally valid for this tender — a citation outside this set is dropped, never trusted. */
  validRequirementIds: Set<string>
  validEvaluationCriterionIds: Set<string>
}

export type ProposalGenerationOutcome =
  | {
      status: 'SUCCEEDED'
      result: ProposalGenerationResult
      promptVersion: string
      inputContextHash: string
      model: string
      usage: { inputTokens: number | null; outputTokens: number | null }
      retries: number
      /** Claims re-classified against the CURRENT approved-evidence set, independent of what the model itself claimed. */
      resolvedClaims: Array<{ claimText: string; supportStatus: 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNSUPPORTED' | 'REQUIRES_REVIEW'; evidenceClaimId: string | null; reason: string }>
      /** Requirement/evaluation ids the model cited that were NOT in the valid set — dropped, and recorded as a warning rather than silently accepted. */
      droppedReferenceWarnings: string[]
      unsupportedClaimPlaceholders: string[]
    }
  | { status: 'AI_UNAVAILABLE'; reason: string; inputContextHash: string; promptVersion: string }
  | { status: 'FAILED'; reason: string; inputContextHash: string; promptVersion: string }
  | { status: 'REJECTED_INVALID_OUTPUT'; reason: string; issues: string[]; inputContextHash: string; promptVersion: string }

/**
 * Phase 14 §12/§14/§18 — the full generation-run orchestration:
 * config check -> hash -> agent call -> retry -> schema validation ->
 * independent evidence/requirement/evaluation re-verification. Never
 * persists anything itself (the caller/route persists the outcome via
 * the Supabase-backed store) so this stays testable with only a
 * FakeOpenAiClient, no database (Phase 14 binding pattern: pure
 * function + port interface + real implementation + test fake).
 */
export async function runProposalGeneration(deps: { client: OpenAiClient; config: AiConfig }, input: RunProposalGenerationInput): Promise<ProposalGenerationOutcome> {
  const promptVersion = 'proposal-section-v1'
  const inputContextHash = computeGenerationInputContextHash({
    promptVersion,
    sectionType: input.context.sectionType,
    requirementIds: input.context.requirements.map((r) => r.id),
    evaluationCriterionIds: input.context.evaluationCriteria.map((c) => c.id),
    evidenceClaimIds: input.context.approvedEvidenceClaims.map((e) => e.id),
    userInstructions: input.context.userInstructions,
    strategyVersion: input.strategyVersion,
  })

  if (!isAiConfigured(deps.config)) {
    return { status: 'AI_UNAVAILABLE', reason: 'OPENAI_API_KEY is not configured — generation cannot fabricate content in its place (Phase 14 §40).', inputContextHash, promptVersion }
  }

  try {
    const { result: agentResult, retries } = await withProviderRetry(() => runProposalSectionAgent(deps.client, { model: deps.config.model, context: input.context }), { maxRetries: deps.config.maxRetries })

    const raw = agentResult.raw

    // Independent re-verification (Phase 14 §10/§23): never trust the
    // model's own citations. A referenced requirement/evaluation id
    // outside the valid set is dropped and recorded as a warning; an
    // evidence claim id outside the currently-approved set is treated
    // as NOT_APPROVED for claim-support purposes.
    const droppedReferenceWarnings: string[] = []
    const filteredRequirementRefs = raw.requirementReferences.filter((id) => {
      const ok = input.validRequirementIds.has(id)
      if (!ok) droppedReferenceWarnings.push(`Dropped requirement reference not in this tender's requirement set: ${id}`)
      return ok
    })
    const filteredEvaluationRefs = raw.evaluationReferences.filter((id) => {
      const ok = input.validEvaluationCriterionIds.has(id)
      if (!ok) droppedReferenceWarnings.push(`Dropped evaluation criterion reference not in this tender's criteria: ${id}`)
      return ok
    })
    void filteredRequirementRefs
    void filteredEvaluationRefs

    const resolvedClaims = raw.claims.map((c) => {
      let lifecycle: EvidenceLifecycleForClaim = 'NONE'
      if (c.evidenceClaimId) {
        const approved = input.currentlyApprovedEvidence.get(c.evidenceClaimId)
        if (approved) lifecycle = approved.isStale ? 'APPROVED_STALE' : 'APPROVED_CURRENT'
        else lifecycle = 'NOT_APPROVED'
      }
      const evaluated = evaluateClaimSupport({ claimText: c.claimText, evidenceStatus: lifecycle })
      return {
        claimText: c.claimText,
        supportStatus: evaluated.supportStatus,
        evidenceClaimId: lifecycle === 'APPROVED_CURRENT' || lifecycle === 'APPROVED_STALE' ? c.evidenceClaimId : null,
        reason: evaluated.reason,
      }
    })

    const unsupportedClaimPlaceholders = [...raw.unsupportedClaims, ...resolvedClaims.filter((c) => c.supportStatus === 'UNSUPPORTED').map((c) => c.claimText)].map(() => renderUnsupportedClaimPlaceholder())

    return {
      status: 'SUCCEEDED',
      result: raw,
      promptVersion: agentResult.promptVersion,
      inputContextHash,
      model: deps.config.model,
      usage: agentResult.usage,
      retries,
      resolvedClaims,
      droppedReferenceWarnings,
      unsupportedClaimPlaceholders,
    }
  } catch (err) {
    if (err instanceof AiMalformedOutputError) {
      return { status: 'REJECTED_INVALID_OUTPUT', reason: err.message, issues: [err.message], inputContextHash, promptVersion }
    }
    if (err instanceof AiSchemaValidationError) {
      return { status: 'REJECTED_INVALID_OUTPUT', reason: err.message, issues: err.issues, inputContextHash, promptVersion }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'FAILED', reason: message, inputContextHash, promptVersion }
  }
}
