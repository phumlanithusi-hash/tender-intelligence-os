#!/usr/bin/env node
/**
 * Live City of Cape Town smoke check: `pnpm --filter api
 * capetown:smoke`. Same rules as every other adapter's smoke script.
 * Note: unlike other adapters, this source's ENTIRE discovery pass
 * (all pages) happens inside one browser session with no
 * page-by-page control — there's no cheaper "1 page" variant to run,
 * so this smoke test runs the real, complete discovery pass. It still
 * writes nothing to the database.
 */
import { logger } from '../lib/logger.js'
import { checkCapeTownHealth } from '../lib/adapters/capetown/health.js'
import { discoverCapeTown } from '../lib/adapters/capetown/discover.js'
import { createPlaywrightTransport, DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG } from '../lib/adapters/capetown/transport/playwrightTransport.js'

async function main(): Promise<number> {
  const transport = createPlaywrightTransport()
  const listingUrl = new URL(DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG.listingPath, DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG.baseUrl).toString()

  logger.info('capetown:smoke — checking live reachability (no database writes will occur)')
  const health = await checkCapeTownHealth(transport)
  logger.info({ status: health.status, message: health.message }, 'live reachability result')

  if (health.status !== 'HEALTHY') {
    logger.warn({ status: health.status }, 'City of Cape Town is not reachable from this environment — this is reported honestly, not worked around.')
    return 1
  }

  logger.info('reachable — attempting the full live discovery pass (this source has no cheaper partial option)')
  try {
    const { discovered, unidentifiableRowCount } = await discoverCapeTown(transport, listingUrl)
    logger.info({ discoveredCount: discovered.length, unidentifiableRowCount }, 'live discovery pass completed — no data was imported (smoke test only)')
    return 0
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'live discovery pass failed')
    return 1
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'capetown:smoke crashed')
    process.exit(1)
  })
