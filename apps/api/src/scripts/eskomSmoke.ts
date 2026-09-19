#!/usr/bin/env node
/**
 * Live Eskom smoke check: `pnpm --filter api eskom:smoke`. Same rules
 * as every other adapter's smoke script: connects to the REAL public
 * site, performs the smallest possible discovery pass (one page),
 * never writes to the database, never run in CI, and must report its
 * REAL outcome honestly.
 */
import { logger } from '../lib/logger.js'
import { checkEskomHealth } from '../lib/adapters/eskom/health.js'
import { discoverEskom } from '../lib/adapters/eskom/discover.js'
import { createPlaywrightTransport, DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG } from '../lib/adapters/eskom/transport/playwrightTransport.js'

async function main(): Promise<number> {
  const transport = createPlaywrightTransport()

  logger.info('eskom:smoke — checking live reachability (no database writes will occur)')
  const health = await checkEskomHealth(transport)
  logger.info({ status: health.status, message: health.message }, 'live reachability result')

  if (health.status !== 'HEALTHY') {
    logger.warn({ status: health.status }, 'Eskom is not reachable from this environment — this is reported honestly, not worked around.')
    return 1
  }

  logger.info('reachable — attempting a minimal (1 page) live discovery pass')
  try {
    const { discovered, unidentifiableRowCount } = await discoverEskom(transport, DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG.baseUrl, { maxPages: 1, pageSize: 20 })
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
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'eskom:smoke crashed')
    process.exit(1)
  })
