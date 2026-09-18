import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseNotificationStore } from './supabaseNotificationStore.js'
import type { CreateNotificationInput } from './types.js'

/**
 * Shared fan-out helper (spec §15) for any shared, tender-level fact
 * (an outcome, a conflict, a document-processing failure) that needs
 * to reach every agency with a live bid project on the affected
 * tender — the agency scope is always derived server-side from
 * `bid_strategy_projects`, never trusted from the caller (spec §24).
 * Each per-agency notification is independently deduplicated by
 * `dedup_key`, so re-running this never creates duplicates.
 */
export async function notifyAgenciesForTender(
  supabase: SupabaseClient,
  tenderId: string,
  build: (agencyId: string, bidStrategyProjectId: string) => CreateNotificationInput,
): Promise<void> {
  const { data: projects } = await supabase.from('bid_strategy_projects').select('id, agency_id').eq('tender_id', tenderId)
  if (!projects || projects.length === 0) return
  const store = createSupabaseNotificationStore(supabase)
  for (const project of projects) {
    await store.create(build(project.agency_id as string, project.id as string))
  }
}
