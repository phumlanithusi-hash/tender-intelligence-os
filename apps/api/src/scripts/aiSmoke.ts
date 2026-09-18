#!/usr/bin/env node
/**
 * Live OpenAI smoke check (Phase 7 §38): `pnpm --filter api ai:smoke`.
 *
 * Requires a real OPENAI_API_KEY. In this sandbox one is (almost
 * certainly) not configured, and outbound access to api.openai.com is
 * expected to be blocked by the egress allowlist regardless — this
 * script must report that honestly (SKIPPED / unreachable) and MUST
 * NEVER be edited to fabricate a successful live call, exactly like
 * etendersSmoke.ts's binding instruction for the eTenders adapter.
 *
 * NEVER run as part of `pnpm test`/`pnpm e2e`/CI, and NEVER writes to
 * the database or touches any real tender — it builds a synthetic,
 * in-memory tender fixture and runs one real classification call
 * against it only, via a throwaway in-memory `AiStore` (no Supabase
 * client involved at all).
 */
import { randomUUID } from 'node:crypto'
import { logger } from '../lib/logger.js'
import { loadAiConfig, isAiConfigured } from '../lib/ai/config.js'
import { createOpenAiClient } from '../lib/ai/client.js'
import { runClassificationAgent } from '../lib/ai/agents/classification/agent.js'
import type { ChunkForContext } from '../lib/ai/store.js'

function buildInMemorySmokeStore(): { tenderId: string; chunk: ChunkForContext } {
  const tenderId = randomUUID()
  const documentId = randomUUID()
  const documentVersionId = randomUUID()
  const chunk: ChunkForContext = {
    id: randomUUID(),
    documentId,
    documentVersionId,
    sectionId: null,
    pageStart: 1,
    pageEnd: 1,
    text: 'The successful bidder shall be appointed to provide graphic design and printing services for a period of two years, including compulsory attendance of a briefing session.',
    charCount: 180,
  }
  return { tenderId, chunk }
}

async function main(): Promise<number> {
  const config = loadAiConfig()

  logger.info('ai:smoke — checking configuration and live reachability (no database writes will occur)')

  if (!isAiConfigured(config)) {
    logger.warn(
      'ai:smoke result: SKIPPED — OPENAI_API_KEY is not configured in this environment. Not a failure and not a fabricated pass. ' +
        'See docs/AI-ARCHITECTURE.md for this project\'s known environment limitation.',
    )
    return 0
  }

  const { tenderId, chunk } = buildInMemorySmokeStore()
  const client = createOpenAiClient(config.apiKey!)

  const startedAt = Date.now()
  try {
    const result = await runClassificationAgent(client, {
      model: config.model,
      tender: {
        id: tenderId,
        title: 'Synthetic smoke-test tender — appointment of a graphic design service provider',
        organisation: 'Smoke Test Municipality',
        category: 'Marketing',
        description: 'A synthetic fixture used only to verify live OpenAI reachability. Not a real tender.',
        closingDate: null,
        closingTime: null,
        province: null,
        municipality: null,
        estimatedValue: null,
        contractDuration: null,
        briefingRequired: false,
        briefingDate: null,
        briefingLocation: null,
        briefingUrl: null,
      },
      services: [{ id: randomUUID(), name: 'Graphic Design' }],
      chunks: [chunk],
      limits: { maxDocumentChunks: config.maxDocumentChunks, maxContextChars: config.maxContextChars },
    })
    const latencyMs = Date.now() - startedAt

    logger.info(
      { model: config.model, latencyMs, relevance: result.raw.relevance.value, usage: result.usage },
      'ai:smoke result: PASS — live call succeeded and passed schema validation',
    )
    return 0
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ err: message }, 'ai:smoke result: FAIL — live call failed')
    return 1
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'ai:smoke result: FAIL — crashed')
    process.exit(1)
  })
