#!/usr/bin/env node
/**
 * Live Transnet smoke check: `pnpm --filter api transnet:smoke`. Same
 * rules as every other adapter's smoke script: connects to the REAL
 * live JSON endpoints, never writes to the database, never run in
 * CI, and must report its REAL outcome honestly. This source has no
 * pagination to limit — a "smoke" pass here is the same single
 * `fetchAllTenders()` call the real scan uses (both endpoints are one
 * request each), so this doubles as a first live discovery pass.
 */
import { logger } from '../lib/logger.js'
import { checkTransnetHealth } from '../lib/adapters/transnet/health.js'
import { discoverTransnet } from '../lib/adapters/transnet/discover.js'
import { createPlaywrightTransport, DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG } from '../lib/adapters/transnet/transport/playwrightTransport.js'

async function main(): Promise<number> {
  const transport = createPlaywrightTransport()

  logger.info('transnet:smoke — checking live reachability (no database writes will occur)')
  const health = await checkTransnetHealth(transport)
  logger.info({ status: health.status, message: health.message }, 'live reachability result')

  if (health.status !== 'HEALTHY') {
    logger.warn({ status: health.status }, 'Transnet e-Tender system is not reachable from this environment — this is reported honestly, not worked around.')
    return 1
  }

  logger.info('reachable — attempting a live discovery pass (Open Tenders endpoint only; see types.ts for why the historical archive endpoint is not called)')
  try {
    const { discovered, unidentifiableRowCount } = await discoverTransnet(transport, DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG.baseUrl)
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
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'transnet:smoke crashed')
    process.exit(1)
  })
