#!/usr/bin/env node
/**
 * Live OpenAI smoke check for QualificationInterpretationAgent (Phase
 * 8 §40): `pnpm --filter api ai:qualification:smoke`.
 *
 * Requires a real OPENAI_API_KEY. In this sandbox one is (almost
 * certainly) not configured, and outbound access to api.openai.com is
 * expected to be blocked by the egress allowlist regardless — this
 * script must report that honestly (SKIPPED / BLOCKED) and MUST NEVER
 * be edited to fabricate a successful live call, exactly like
 * aiSmoke.ts's binding instruction for TenderClassificationAgent.
 *
 * NEVER run as part of `pnpm test`/`pnpm e2e`/CI, and NEVER writes to
 * the database or touches any real tender — it builds a synthetic
 * candidate requirement text and runs one real interpretation call
 * against it only, via a throwaway in-memory chunk (no Supabase
 * client involved at all).
 */
import { randomUUID } from 'node:crypto'
import { logger } from '../lib/logger.js'
import { loadAiConfig, isAiConfigured } from '../lib/ai/config.js'
import { createOpenAiClient } from '../lib/ai/client.js'
import { runQualificationInterpretationAgent } from '../lib/ai/agents/qualification/agent.js'
import type { ChunkForContext } from '../lib/ai/store.js'

function buildSyntheticChunk(): ChunkForContext {
  return {
    id: randomUUID(),
    documentId: randomUUID(),
    documentVersionId: randomUUID(),
    sectionId: null,
    pageStart: 6,
    pageEnd: 6,
    text: 'Bidders should demonstrate at least five (5) years of experience providing similar communication design services to organs of state. A valid, original Tax Compliance Status PIN must be submitted with the bid.',
    charCount: 210,
  }
}

async function main(): Promise<number> {
  const config = loadAiConfig()

  logger.info('ai:qualification:smoke — checking configuration and live reachability (no database writes will occur)')

  if (!isAiConfigured(config)) {
    logger.warn(
      'ai:qualification:smoke result: SKIPPED — OPENAI_API_KEY is not configured in this environment. Not a failure and not a fabricated pass. ' +
        'See docs/AI-ARCHITECTURE.md for this project\'s known environment limitation.',
    )
    return 0
  }

  const chunk = buildSyntheticChunk()
  const client = createOpenAiClient(config.apiKey!)

  const startedAt = Date.now()
  try {
    const result = await runQualificationInterpretationAgent(client, {
      model: config.model,
      candidates: [
        { index: 0, text: 'Bidders should demonstrate at least five (5) years of experience providing similar communication design services to organs of state.' },
        { index: 1, text: 'A valid, original Tax Compliance Status PIN must be submitted with the bid.' },
      ],
      chunks: [chunk],
      limits: { maxDocumentChunks: config.maxDocumentChunks, maxContextChars: config.maxContextChars },
    })
    const latencyMs = Date.now() - startedAt

    logger.info(
      { model: config.model, latencyMs, interpretationCount: result.raw.interpretations.length, usage: result.usage },
      'ai:qualification:smoke result: PASS — live call succeeded and passed schema validation',
    )
    return 0
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Distinguish network/provider unreachability (BLOCKED — a key is
    // configured but the call could not be made) from a genuine
    // schema/logic failure (FAIL), per Phase 8 §40.
    const looksUnreachable = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|fetch failed|EAI_AGAIN/i.test(message)
    if (looksUnreachable) {
      logger.error({ err: message }, 'ai:qualification:smoke result: BLOCKED — OPENAI_API_KEY is configured but api.openai.com is unreachable from this environment')
      return 0
    }
    logger.error({ err: message }, 'ai:qualification:smoke result: FAIL — live call failed')
    return 1
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'ai:qualification:smoke result: FAIL — crashed')
    process.exit(1)
  })
