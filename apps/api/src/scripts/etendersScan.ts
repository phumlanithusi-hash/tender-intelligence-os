#!/usr/bin/env node
/**
 * Manual eTenders scan command (Phase 5 §22): `pnpm --filter api etenders:scan`.
 *
 * Authenticates via the server's own privileged Supabase service-role
 * key (the same credential every other privileged write in this API
 * already uses — apps/api/src/lib/supabaseAdmin.ts) rather than a
 * separate login step, since this is a server-side operator command
 * run with access to the server's own environment, not a
 * browser-facing action. The key itself is never logged or printed —
 * `logger`'s redaction config already strips
 * `SUPABASE_SERVICE_ROLE_KEY` from any structured log line, and this
 * script never echoes `process.env` directly.
 *
 * Exits 0 on SUCCESS or PARTIAL (a partial scan is still an honestly
 * completed run — Phase 5 §14), and non-zero on FAILED or any
 * uncaught setup error, so this is safe to wire into a future CI/cron
 * job's exit-code check without that job needing to parse output.
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
import { ETENDERS_ADAPTER_KEY } from '../lib/adapters/etenders/adapter.js'

async function main(): Promise<number> {
  const admin = getSupabaseAdmin()
  if (!admin) {
    logger.error('Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) — cannot run a scan.')
    return 1
  }

  const adapter = getAdapter(ETENDERS_ADAPTER_KEY)
  if (!adapter) {
    logger.error('The eTenders adapter is not registered — nothing to run.')
    return 1
  }

  // Finds the (single, expected) source row configured for this
  // adapter — never assumes a hardcoded id, since the actual row's id
  // is only known at runtime once seeded.
  const { rows } = await listTenderSources(admin, { limit: 100, offset: 0 })
  const source = rows.find((r) => r.adapter_key === ETENDERS_ADAPTER_KEY)
  if (!source) {
    logger.error(`No tender_sources row has adapter_key = "${ETENDERS_ADAPTER_KEY}" — nothing to scan.`)
    return 1
  }

  const store = createSupabaseIngestionStore(admin)
  const executionId = `manual-${new Date().toISOString()}`

  logger.info({ sourceId: source.id, executionId }, 'starting manual eTenders scan')
  const result = await runEtendersScan(store, adapter, { sourceId: source.id, executionId })

  // Reflect this scan's outcome onto the source row's own health
  // fields — the same computation the Source Registry's health-check
  // endpoint uses (Phase 4), so a manual CLI scan and an API-triggered
  // health check never disagree about what "healthy" means.
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
    'eTenders scan finished',
  )

  return result.status === 'FAILED' ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'eTenders scan crashed')
    process.exit(1)
  })
