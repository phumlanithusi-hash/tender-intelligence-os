#!/usr/bin/env node
/**
 * Live eTenders smoke check (Phase 5 §30): `pnpm --filter api etenders:smoke`.
 *
 * Connects to the REAL public site (headless Chromium,
 * transport/playwrightTransport.ts) and performs the smallest
 * possible discovery pass — one page, a handful of rows — purely to
 * confirm the live mechanism still works. It NEVER writes to the
 * database (no `IngestionStore`, no scan/tender/source-record rows
 * created) and is NEVER run as part of `pnpm test`/`pnpm e2e`/CI — it
 * is a manually-invoked, standalone script only.
 *
 * CRITICAL (Phase 5's binding instruction): this script must report
 * its REAL outcome. If the live site cannot be reached from wherever
 * this runs (as is expected in this project's sandboxed build
 * environment — outbound network access to etenders.gov.za is
 * blocked there), it prints that honestly and exits non-zero. It must
 * NEVER be edited to fabricate a success.
 */
import { logger } from '../lib/logger.js'
import { checkEtendersHealth } from '../lib/adapters/etenders/health.js'
import { discoverEtenders } from '../lib/adapters/etenders/discover.js'
import { createPlaywrightTransport } from '../lib/adapters/etenders/transport/playwrightTransport.js'

async function main(): Promise<number> {
  const transport = createPlaywrightTransport()

  logger.info('etenders:smoke — checking live reachability (no database writes will occur)')
  const health = await checkEtendersHealth(transport)
  logger.info({ status: health.status, message: health.message }, 'live reachability result')

  if (health.status !== 'HEALTHY') {
    logger.warn(
      { status: health.status },
      'eTenders is not reachable from this environment — this is reported honestly, not worked around. ' +
        'See docs/SCRAPING-ARCHITECTURE.md for this project\'s known environment limitation.',
    )
    return 1
  }

  logger.info('reachable — attempting a minimal (1 page, small page size) live discovery pass')
  try {
    const { discovered, unidentifiableRowCount } = await discoverEtenders(transport, {
      statusFilter: 'OPEN',
      pageSize: 5,
      maxPages: 1,
    })
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
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'etenders:smoke crashed')
    process.exit(1)
  })
