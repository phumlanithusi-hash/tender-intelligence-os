#!/usr/bin/env node
/**
 * Live OpenAI smoke check for Phase 14 (spec §45): `pnpm ai:proposal:smoke`.
 *
 * Requires a real OPENAI_API_KEY. In this sandbox one is (almost
 * certainly) not configured, and outbound access to api.openai.com is
 * expected to be blocked by the egress allowlist regardless (confirmed
 * every AI phase since Phase 7) — this script must report that
 * honestly (SKIPPED) and MUST NEVER be edited to fabricate a
 * successful live call, exactly like aiSmoke.ts's binding instruction.
 *
 * NEVER run as part of `pnpm test`/`pnpm e2e`/CI, and NEVER writes to
 * the database — it builds a synthetic, in-memory section context and
 * runs one real proposal-section generation call against it only, via
 * the pure runProposalSectionAgent (no Supabase client involved).
 */
import { randomUUID } from 'node:crypto'
import { logger } from '../lib/logger.js'
import { loadAiConfig, isAiConfigured } from '../lib/ai/config.js'
import { createOpenAiClient } from '../lib/ai/client.js'
import { runProposalSectionAgent } from '../lib/ai/agents/proposalSection/agent.js'

async function main(): Promise<number> {
  const config = loadAiConfig()

  logger.info('ai:proposal:smoke — checking configuration and live reachability (no database writes will occur)')

  if (!isAiConfigured(config)) {
    logger.warn(
      'ai:proposal:smoke result: SKIPPED — OPENAI_API_KEY is not configured in this environment. Not a failure and not a fabricated pass. ' +
        "See docs/AI-ARCHITECTURE.md for this project's known environment limitation.",
    )
    return 0
  }

  const client = createOpenAiClient(config.apiKey!)
  const requirementId = randomUUID()
  const criterionId = randomUUID()
  const evidenceId = randomUUID()

  const startedAt = Date.now()
  try {
    const result = await runProposalSectionAgent(client, {
      model: config.model,
      context: {
        sectionType: 'EXECUTIVE_SUMMARY',
        sectionTitle: 'Executive Summary',
        sectionObjective: 'Summarise the proposed approach for a synthetic smoke-test tender.',
        requirements: [{ id: requirementId, text: 'The bidder must demonstrate at least two years of relevant experience.', mandatory: true }],
        evaluationCriteria: [{ id: criterionId, text: 'Technical approach and methodology.', weight: 40 }],
        winThemes: [],
        differentiators: [],
        approvedEvidenceClaims: [{ id: evidenceId, entityType: 'AGENCY_CASE_STUDY', summary: 'Delivered a similar synthetic smoke-test project in 2024.' }],
        agencyProfileSummary: null,
        userInstructions: null,
        tenderExcerpts: [],
      },
    })
    const latencyMs = Date.now() - startedAt

    logger.info({ model: config.model, latencyMs, confidence: result.raw.confidence, usage: result.usage }, 'ai:proposal:smoke result: PASS — live call succeeded and passed schema validation')
    return 0
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ err: message }, 'ai:proposal:smoke result: FAIL — live call failed')
    return 1
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'ai:proposal:smoke result: FAIL — crashed')
    process.exit(1)
  })
