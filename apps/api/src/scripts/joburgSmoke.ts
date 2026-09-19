#!/usr/bin/env node
/**
 * Live City of Johannesburg smoke check: `pnpm --filter api
 * joburg:smoke`. Same rules as etendersSmoke.ts/easytendersSmoke.ts:
 * connects to the REAL public site, performs the smallest possible
 * discovery pass (this source only has one page — the whole listing
 * table), never writes to the database, never run in CI, and must
 * report its REAL outcome honestly.
 */
import { logger } from '../lib/logger.js'
import { checkJoburgHealth } from '../lib/adapters/joburg/health.js'
import { discoverJoburg } from '../lib/adapters/joburg/discover.js'
import { createPlaywrightTransport, DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG } from '../lib/adapters/joburg/transport/playwrightTransport.js'

async function main(): Promise<number> {
  const transport = createPlaywrightTransport()
  const listingUrl = new URL(DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG.listingPath, DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG.baseUrl).toString()

  logger.info('joburg:smoke — checking live reachability (no database writes will occur)')
  const health = await checkJoburgHealth(transport)
  logger.info({ status: health.status, message: health.message }, 'live reachability result')

  if (health.status !== 'HEALTHY') {
    logger.warn(
      { status: health.status },
      'City of Johannesburg is not reachable from this environment — this is reported honestly, not worked around.',
    )
    return 1
  }

  logger.info('reachable — attempting the single supported live discovery pass')
  try {
    const { discovered, unidentifiableRowCount } = await discoverJoburg(transport, listingUrl)
    logger.info(
      { discoveredCount: discovered.length, unidentifiableRowCount },
      'live discovery pass completed — no data was imported (smoke test only)',
    )
    return 0
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'live discovery pass failed')
    return 1
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'joburg:smoke crashed')
    process.exit(1)
  })
