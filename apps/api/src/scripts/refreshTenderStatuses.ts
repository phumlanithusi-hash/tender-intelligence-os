#!/usr/bin/env node
/**
 * Status refresh sweep: `pnpm --filter api tenders:refresh-status`.
 *
 * Re-scans only correct a tender's status when the source still lists
 * it (repositories/tenders.ts's re-derivation on update). Most sources
 * drop a tender from their listing once it closes, so without this
 * sweep a tender that disappears while OPEN/CLOSING_SOON would stay
 * "active" forever. This re-applies the same pure, closing-date-based
 * deriveTenderStatus to every tender in an auto-derivable status, and
 * never touches CANCELLED/AWARDED/WITHDRAWN/UNKNOWN.
 *
 * Run by .github/workflows/scheduled-scans.yml after every scan batch.
 * Exits non-zero on any database error.
 */
import type { TenderStatus } from '@tender-os/constants'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { logger } from '../lib/logger.js'
import { deriveTenderStatus, isAutoDerivableStatus } from '../lib/ingestion/deriveTenderStatus.js'

const PAGE_SIZE = 1000

async function main(): Promise<number> {
  const admin = getSupabaseAdmin()
  if (!admin) {
    logger.error('Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) — cannot refresh statuses.')
    return 1
  }

  // Group ids by their new status so the writes are one update per
  // status value rather than one per tender.
  const changes = new Map<TenderStatus, string[]>()
  let checked = 0

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from('tenders')
      .select('id, status, closing_date')
      .order('id')
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break

    for (const row of data as { id: string; status: TenderStatus; closing_date: string | null }[]) {
      if (!isAutoDerivableStatus(row.status)) continue
      checked++
      const derived = deriveTenderStatus(row.closing_date)
      if (derived === row.status) continue
      const ids = changes.get(derived) ?? []
      ids.push(row.id)
      changes.set(derived, ids)
    }

    if (data.length < PAGE_SIZE) break
  }

  const summary: Record<string, number> = {}
  for (const [status, ids] of changes) {
    // Chunked to keep the `in (...)` filter well under URL length limits.
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await admin.from('tenders').update({ status }).in('id', ids.slice(i, i + 200))
      if (error) throw error
    }
    summary[status] = ids.length
  }

  logger.info({ checked, updated: summary }, 'tender status refresh finished')
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    logger.error({ err }, 'tender status refresh failed')
    process.exit(1)
  })
