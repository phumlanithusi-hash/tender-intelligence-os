import { describe, expect, it } from 'vitest'
import { createFakeOpenAiClient, fakeServerError } from '../../testing.js'
import { runProposalGeneration } from '../runProposalGeneration.js'
import type { AiConfig } from '../../config.js'
import type { ProposalSectionPromptContext } from '../../agents/proposalSection/agent.js'

const APPROVED_ID = '33333333-3333-3333-3333-333333333333'
const REQ_ID = '11111111-1111-1111-1111-111111111111'
const CRIT_ID = '22222222-2222-2222-2222-222222222222'
const FOREIGN_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

function context(overrides: Partial<ProposalSectionPromptContext> = {}): ProposalSectionPromptContext {
  return {
    sectionType: 'EXECUTIVE_SUMMARY',
    sectionTitle: 'Executive Summary',
    sectionObjective: 'Summarise the approach.',
    requirements: [{ id: REQ_ID, text: 'Must comply with X', mandatory: true }],
    evaluationCriteria: [{ id: CRIT_ID, text: 'Technical approach', weight: 40 }],
    winThemes: [],
    differentiators: [],
    approvedEvidenceClaims: [{ id: APPROVED_ID, entityType: 'AGENCY_CASE_STUDY', summary: 'Delivered a similar project.' }],
    agencyProfileSummary: null,
    userInstructions: null,
    tenderExcerpts: [],
    ...overrides,
  }
}

function configured(overrides: Partial<AiConfig> = {}): AiConfig {
  return { apiKey: 'sk-test', model: 'gpt-test', embeddingModel: 'text-embedding-3-small', maxDocumentChunks: 20, maxContextChars: 20000, maxTokensEstimate: 8000, maxRetries: 2, ...overrides }
}

function validOutput(overrides: Record<string, unknown> = {}) {
  return {
    sectionTitle: 'Executive Summary',
    sectionPurpose: 'Summarise the approach',
    contentBlocks: [{ blockType: 'PARAGRAPH', text: 'We propose to deliver X.' }],
    claims: [{ claimText: 'We delivered a similar project.', evidenceClaimId: APPROVED_ID }],
    requirementReferences: [REQ_ID],
    evaluationReferences: [CRIT_ID],
    evidenceReferences: [APPROVED_ID],
    warnings: [],
    missingInformation: [],
    unsupportedClaims: [],
    confidence: 0.8,
    ...overrides,
  }
}

describe('runProposalGeneration (Phase 14 §12/§14/§18/§40)', () => {
  it('returns AI_UNAVAILABLE, never fabricated content, when OPENAI_API_KEY is not configured', async () => {
    const client = createFakeOpenAiClient([{ kind: 'content', content: JSON.stringify(validOutput()) }])
    const outcome = await runProposalGeneration(
      { client, config: configured({ apiKey: undefined }) },
      { context: context(), strategyVersion: 1, currentlyApprovedEvidence: new Map(), validRequirementIds: new Set([REQ_ID]), validEvaluationCriterionIds: new Set([CRIT_ID]) },
    )
    expect(outcome.status).toBe('AI_UNAVAILABLE')
    expect(client.calls).toHaveLength(0)
  })

  it('a claim citing a currently-approved, non-stale evidence claim resolves to SUPPORTED', async () => {
    const client = createFakeOpenAiClient([{ kind: 'content', content: JSON.stringify(validOutput()) }])
    const outcome = await runProposalGeneration(
      { client, config: configured() },
      { context: context(), strategyVersion: 1, currentlyApprovedEvidence: new Map([[APPROVED_ID, { isStale: false }]]), validRequirementIds: new Set([REQ_ID]), validEvaluationCriterionIds: new Set([CRIT_ID]) },
    )
    expect(outcome.status).toBe('SUCCEEDED')
    if (outcome.status === 'SUCCEEDED') {
      expect(outcome.resolvedClaims[0]!.supportStatus).toBe('SUPPORTED')
      expect(outcome.model).toBe('gpt-test')
      expect(outcome.promptVersion).toBe('proposal-section-v1')
      expect(outcome.inputContextHash).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it('a claim citing evidence that is NOT in the currently-approved set is downgraded to REQUIRES_REVIEW, never SUPPORTED (candidate/rejected/superseded must never be trusted)', async () => {
    const client = createFakeOpenAiClient([{ kind: 'content', content: JSON.stringify(validOutput()) }])
    const outcome = await runProposalGeneration(
      { client, config: configured() },
      { context: context(), strategyVersion: 1, currentlyApprovedEvidence: new Map(), validRequirementIds: new Set([REQ_ID]), validEvaluationCriterionIds: new Set([CRIT_ID]) },
    )
    expect(outcome.status).toBe('SUCCEEDED')
    if (outcome.status === 'SUCCEEDED') {
      expect(outcome.resolvedClaims[0]!.supportStatus).toBe('REQUIRES_REVIEW')
      expect(outcome.resolvedClaims[0]!.evidenceClaimId).toBeNull()
    }
  })

  it('a claim citing STALE approved evidence resolves to REQUIRES_REVIEW, never silently SUPPORTED', async () => {
    const client = createFakeOpenAiClient([{ kind: 'content', content: JSON.stringify(validOutput()) }])
    const outcome = await runProposalGeneration(
      { client, config: configured() },
      { context: context(), strategyVersion: 1, currentlyApprovedEvidence: new Map([[APPROVED_ID, { isStale: true }]]), validRequirementIds: new Set([REQ_ID]), validEvaluationCriterionIds: new Set([CRIT_ID]) },
    )
    expect(outcome.status).toBe('SUCCEEDED')
    if (outcome.status === 'SUCCEEDED') expect(outcome.resolvedClaims[0]!.supportStatus).toBe('REQUIRES_REVIEW')
  })

  it('a requirement/evaluation reference outside the tender-valid set is dropped and recorded as a warning, never trusted as-is (malicious/cross-tender id defence)', async () => {
    const client = createFakeOpenAiClient([{ kind: 'content', content: JSON.stringify(validOutput({ requirementReferences: [REQ_ID, FOREIGN_ID] })) }])
    const outcome = await runProposalGeneration(
      { client, config: configured() },
      { context: context(), strategyVersion: 1, currentlyApprovedEvidence: new Map([[APPROVED_ID, { isStale: false }]]), validRequirementIds: new Set([REQ_ID]), validEvaluationCriterionIds: new Set([CRIT_ID]) },
    )
    expect(outcome.status).toBe('SUCCEEDED')
    if (outcome.status === 'SUCCEEDED') expect(outcome.droppedReferenceWarnings.some((w) => w.includes(FOREIGN_ID))).toBe(true)
  })

  it('a malformed (non-JSON) model response is recorded as REJECTED_INVALID_OUTPUT, never persisted as content', async () => {
    const client = createFakeOpenAiClient([{ kind: 'content', content: 'not json at all' }])
    const outcome = await runProposalGeneration(
      { client, config: configured() },
      { context: context(), strategyVersion: 1, currentlyApprovedEvidence: new Map(), validRequirementIds: new Set([REQ_ID]), validEvaluationCriterionIds: new Set([CRIT_ID]) },
    )
    expect(outcome.status).toBe('REJECTED_INVALID_OUTPUT')
  })

  it('a schema-invalid response is recorded as REJECTED_INVALID_OUTPUT with issues listed', async () => {
    const client = createFakeOpenAiClient([{ kind: 'content', content: JSON.stringify({ sectionTitle: 'x' }) }])
    const outcome = await runProposalGeneration(
      { client, config: configured() },
      { context: context(), strategyVersion: 1, currentlyApprovedEvidence: new Map(), validRequirementIds: new Set([REQ_ID]), validEvaluationCriterionIds: new Set([CRIT_ID]) },
    )
    expect(outcome.status).toBe('REJECTED_INVALID_OUTPUT')
    if (outcome.status === 'REJECTED_INVALID_OUTPUT') expect(outcome.issues.length).toBeGreaterThan(0)
  })

  it('a transient provider error is retried and eventually succeeds', async () => {
    const client = createFakeOpenAiClient([{ kind: 'error', error: fakeServerError() }, { kind: 'content', content: JSON.stringify(validOutput()) }])
    const outcome = await runProposalGeneration(
      { client, config: configured({ maxRetries: 1 }) },
      { context: context(), strategyVersion: 1, currentlyApprovedEvidence: new Map([[APPROVED_ID, { isStale: false }]]), validRequirementIds: new Set([REQ_ID]), validEvaluationCriterionIds: new Set([CRIT_ID]) },
    )
    expect(outcome.status).toBe('SUCCEEDED')
    expect(client.calls).toHaveLength(2)
  })

  it('a persistent provider failure beyond the retry budget is recorded as FAILED, never fabricated', async () => {
    const client = createFakeOpenAiClient([{ kind: 'error', error: fakeServerError() }, { kind: 'error', error: fakeServerError() }])
    const outcome = await runProposalGeneration(
      { client, config: configured({ maxRetries: 1 }) },
      { context: context(), strategyVersion: 1, currentlyApprovedEvidence: new Map(), validRequirementIds: new Set([REQ_ID]), validEvaluationCriterionIds: new Set([CRIT_ID]) },
    )
    expect(outcome.status).toBe('FAILED')
  })

  it('the input context hash is stable for identical inputs and changes when the evidence set changes (reproducibility, Phase 14 §18)', async () => {
    const client1 = createFakeOpenAiClient([{ kind: 'content', content: JSON.stringify(validOutput()) }])
    const outcome1 = await runProposalGeneration(
      { client: client1, config: configured() },
      { context: context(), strategyVersion: 1, currentlyApprovedEvidence: new Map([[APPROVED_ID, { isStale: false }]]), validRequirementIds: new Set([REQ_ID]), validEvaluationCriterionIds: new Set([CRIT_ID]) },
    )
    const client2 = createFakeOpenAiClient([{ kind: 'content', content: JSON.stringify(validOutput()) }])
    const outcome2 = await runProposalGeneration(
      { client: client2, config: configured() },
      { context: context(), strategyVersion: 1, currentlyApprovedEvidence: new Map([[APPROVED_ID, { isStale: false }]]), validRequirementIds: new Set([REQ_ID]), validEvaluationCriterionIds: new Set([CRIT_ID]) },
    )
    const client3 = createFakeOpenAiClient([{ kind: 'content', content: JSON.stringify(validOutput()) }])
    const outcome3 = await runProposalGeneration(
      { client: client3, config: configured() },
      { context: context({ approvedEvidenceClaims: [] }), strategyVersion: 2, currentlyApprovedEvidence: new Map(), validRequirementIds: new Set([REQ_ID]), validEvaluationCriterionIds: new Set([CRIT_ID]) },
    )
    expect(outcome1.status).toBe('SUCCEEDED')
    expect(outcome2.status).toBe('SUCCEEDED')
    expect(outcome3.status).toBe('SUCCEEDED')
    if (outcome1.status === 'SUCCEEDED' && outcome2.status === 'SUCCEEDED' && outcome3.status === 'SUCCEEDED') {
      expect(outcome1.inputContextHash).toBe(outcome2.inputContextHash)
      expect(outcome1.inputContextHash).not.toBe(outcome3.inputContextHash)
    }
  })
})
