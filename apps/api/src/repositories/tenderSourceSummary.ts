import type { SupabaseClient } from '@supabase/supabase-js'
import { tenderSourceSummarySchema, type TenderSourceSummary } from '@tender-os/schemas'

/**
 * Source Registry dashboard summary (Phase 4 §14). `tender_sources`
 * is a small configuration table (a few dozen rows at most, not the
 * potentially-huge `tenders` table) — reading every row and reducing
 * counts in the API process is the right call here, not a violation
 * of "don't fetch the entire database" (that rule is about `tenders`,
 * Phase 3 §21). Every number is a real count of real rows — never
 * fabricated (Phase 4 §14: "Do not fabricate numbers").
 */
export async function getTenderSourceSummary(supabase: SupabaseClient): Promise<TenderSourceSummary> {
  const { data, error } = await supabase.from('tender_sources').select('active, adapter_key, health_status')
  if (error) throw error

  const rows = (data ?? []) as Array<{ active: boolean; adapter_key: string | null; health_status: string }>

  const summary = {
    totalSources: rows.length,
    active: 0,
    healthy: 0,
    warning: 0,
    failed: 0,
    notConnected: 0,
  }

  for (const row of rows) {
    if (row.active) summary.active += 1
    if (row.adapter_key === null) {
      summary.notConnected += 1
      continue
    }
    if (row.health_status === 'HEALTHY') summary.healthy += 1
    else if (row.health_status === 'WARNING') summary.warning += 1
    else if (row.health_status === 'FAILED') summary.failed += 1
  }

  return tenderSourceSummarySchema.parse(summary)
}
