#!/usr/bin/env node
/**
 * Manual TenderBulletins scan command: `pnpm --filter api tenderbulletins:scan`.
 * Identical structure/behaviour to etendersScan.ts — see that file's
 * comments for the full rationale. Only the adapter key and log
 * labels differ. Note: this source's discover() always does a single
 * pass (no pagination — see adapters/tenderbulletins/types.ts), and
 * every processed record's per-item detail/document fetch is the
 * honest, limited stub described in adapters/tenderbulletins/adapter.ts
 * (no public detail page or documents exist on this source).
 */
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { logger } from '../lib/logger.js'
import { getAdapter } from '../lib/adapters/registry.js'
import '../lib/adapters/index.js'
import { listTenderSources, updateTenderSourceState } from '../repositories/tenderSources.js'
import { countConsecutiveFailedScans } from '../repositories/tenderSourceScans.js'
import { computeSourceHealth } from '../lib/sourceHealth.js'
import { createSupabaseIngestionStore } from '../lib/ingestion/supabaseIngestionStore.js'
import { runEtendersScan } from '../lib/ingestion/scanRunner.js'
import { TENDERBULLETINS_ADAPTER_KEY } from '../lib/adapters/tenderbulletins/adapter.js'

async function main(): Promise<number> {
  const admin = getSupabaseAdmin()
  if (!admin) {
    logger.error('Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) — cannot run a scan.')
    return 1
  }

  const adapter = getAdapter(TENDERBULLETINS_ADAPTER_KEY)
  if (!adapter) {
    logger.error('The TenderBulletins adapter is not registered — nothing to run.')
    return 1
  }

  const { rows } = await listTenderSources(admin, { limit: 100, offset: 0 })
  const source = rows.find((r) => r.adapter_key === TENDERBULLETINS_ADAPTER_KEY)
  if (!source) {
    logger.error(`No tender_sources row has adapter_key = "${TENDERBULLETINS_ADAPTER_KEY}" — nothing to scan.`)
    return 1
  }

  const store = createSupabaseIngestionStore(admin)
  const executionId = `manual-${new Date().toISOString()}`

  logger.info({ sourceId: source.id, executionId }, 'starting manual TenderBulletins scan')
  const result = await runEtendersScan(store, adapter, { sourceId: source.id, executionId })

  const checkedAt = new Date().toISOString()
  const consecutiveFailedScans = await countConsecutiveFailedScans(admin, source.id)
  const healthStatus = computeSourceHealth({
    hasAdapter: true,
    active: source.active,
    adapterState: source.adapter_state,
    consecutiveFailedScans,
  })
  await updateTenderSourceState(admin, source.id, {
    healthStatus,
    lastSuccessAt: result.status !== 'FAILED' ? checkedAt : undefined,
    lastFailureAt: result.status === 'FAILED' ? checkedAt : undefined,
  })

  logger.info(
    {
      scanId: result.scanId,
      status: result.status,
      recordsDiscovered: result.recordsDiscovered,
      recordsProcessed: result.recordsProcessed,
      recordsFailed: result.recordsFailed,
      documentsDiscovered: result.documentsDiscovered,
      errorCount: result.errorCount,
    },
    'TenderBulletins scan finished',
  )

  return result.status === 'FAILED' ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'TenderBulletins scan crashed')
    process.exit(1)
  })
