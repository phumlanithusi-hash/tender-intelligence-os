#!/usr/bin/env node
/**
 * Live OpenAI embeddings smoke check (Phase 13): `pnpm --filter api
 * ai:embedding:smoke`. Mirrors aiSmoke.ts's binding instruction
 * exactly: requires a real OPENAI_API_KEY, and in this sandbox one is
 * (almost certainly) not configured, and outbound access to
 * api.openai.com is expected to be blocked by the egress allowlist
 * regardless — this script MUST report that honestly (SKIPPED /
 * unreachable) and MUST NEVER be edited to fabricate a successful live
 * call.
 *
 * NEVER run as part of `pnpm test`/`pnpm e2e`/CI, and NEVER writes to
 * the database or touches any real agency evidence — it embeds one
 * synthetic, in-memory string only.
 */
import { logger } from '../lib/logger.js'
import { loadAiConfig, isAiConfigured } from '../lib/ai/config.js'
import { createOpenAiEmbeddingClient } from '../lib/ai/embeddingClient.js'

async function main(): Promise<number> {
  const config = loadAiConfig()

  logger.info('ai:embedding:smoke — checking configuration and live reachability (no database writes will occur)')

  if (!isAiConfigured(config)) {
    logger.warn(
      'ai:embedding:smoke result: SKIPPED — OPENAI_API_KEY is not configured in this environment. Not a failure and not a fabricated pass. ' +
        'See docs/AI-ARCHITECTURE.md and docs/EVIDENCE-MATCHING.md for this project\'s known environment limitation.',
    )
    return 0
  }

  const client = createOpenAiEmbeddingClient(config.apiKey!)
  const startedAt = Date.now()
  try {
    const vector = await client.embed('Synthetic smoke-test evidence snippet — not a real agency document.', config.embeddingModel)
    const latencyMs = Date.now() - startedAt
    logger.info({ model: config.embeddingModel, latencyMs, dimensions: vector.length }, 'ai:embedding:smoke result: PASS — live embeddings call succeeded')
    return 0
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ err: message }, 'ai:embedding:smoke result: FAIL — live call failed')
    return 1
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'ai:embedding:smoke result: FAIL — crashed')
    process.exit(1)
  })
