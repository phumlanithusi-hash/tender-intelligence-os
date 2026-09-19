#!/usr/bin/env node
/**
 * Live TenderBulletins smoke check: `pnpm --filter api tenderbulletins:smoke`.
 * Same rules as etendersSmoke.ts — connects to the REAL public
 * `/search` page, performs the single discovery pass this source
 * supports, never writes to the database, never run in CI, and must
 * report its REAL outcome honestly (never edited to fabricate a
 * success).
 */
import { logger } from '../lib/logger.js'
import { checkTenderBulletinsHealth } from '../lib/adapters/tenderbulletins/health.js'
import { discoverTenderBulletins } from '../lib/adapters/tenderbulletins/discover.js'
import { createPlaywrightTransport } from '../lib/adapters/tenderbulletins/transport/playwrightTransport.js'

async function main(): Promise<number> {
  const transport = createPlaywrightTransport()

  logger.info('tenderbulletins:smoke — checking live reachability (no database writes will occur)')
  const health = await checkTenderBulletinsHealth(transport)
  logger.info({ status: health.status, message: health.message }, 'live reachability result')

  if (health.status !== 'HEALTHY') {
    logger.warn(
      { status: health.status },
      'TenderBulletins is not reachable from this environment — this is reported honestly, not worked around.',
    )
    return 1
  }

  logger.info('reachable — attempting the single supported live discovery pass')
  try {
    const { discovered, unidentifiableRowCount } = await discoverTenderBulletins(transport)
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
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'tenderbulletins:smoke crashed')
    process.exit(1)
  })
