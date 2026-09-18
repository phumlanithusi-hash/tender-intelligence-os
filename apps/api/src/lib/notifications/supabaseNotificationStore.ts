import type { SupabaseClient } from '@supabase/supabase-js'
import { notificationSchema, type NotificationRow } from '@tender-os/schemas'
import type { CreateNotificationInput, NotificationStore } from './types.js'

/**
 * Production NotificationStore over the service-role Supabase client
 * — bypasses RLS; only ever called from routes/notifications.ts and
 * the trigger call sites (routes/outcomes.ts,
 * routes/tenderDocuments.ts). Mirrors createSupabaseOutcomeStore /
 * createSupabaseDataQualityStore's shape for consistency.
 */
export function createSupabaseNotificationStore(supabase: SupabaseClient): NotificationStore {
  return {
    async create(input: CreateNotificationInput): Promise<NotificationRow> {
      const { data: existing } = await supabase.from('notifications').select('*').eq('dedup_key', input.dedupKey).maybeSingle()
      if (existing) return notificationSchema.parse(existing)

      const { data, error } = await supabase
        .from('notifications')
        .insert({
          user_id: input.userId,
          agency_id: input.agencyId,
          event_type: input.eventType,
          channel: 'IN_APP',
          payload: input.payload ?? null,
          entity_type: input.entityType,
          entity_id: input.entityId,
          related_tender_id: input.relatedTenderId ?? null,
          bid_strategy_project_id: input.bidStrategyProjectId ?? null,
          dedup_key: input.dedupKey,
        })
        .select('*')
        .single()

      if (error) {
        // Unique-violation race: another concurrent detector already
        // created this exact fact — read it back rather than erroring
        // (same idempotency pattern as bid_addendum_acknowledgements).
        if ((error as { code?: string }).code === '23505') {
          const { data: raced } = await supabase.from('notifications').select('*').eq('dedup_key', input.dedupKey).single()
          if (raced) return notificationSchema.parse(raced)
        }
        throw error
      }
      return notificationSchema.parse(data)
    },

    async list(filter) {
      let query = supabase
        .from('notifications')
        .select('*')
        .eq('agency_id', filter.agencyId)
        .or(`user_id.is.null,user_id.eq.${filter.userId}`)
        .order('created_at', { ascending: false })
        .limit(filter.limit)
      if (filter.unreadOnly) query = query.is('read_at', null)
      if (!filter.includeDismissed) query = query.is('dismissed_at', null)
      const { data } = await query
      return (data ?? []).map((row) => notificationSchema.parse(row))
    },

    async countUnread(agencyId, userId) {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('agency_id', agencyId)
        .or(`user_id.is.null,user_id.eq.${userId}`)
        .is('read_at', null)
        .is('dismissed_at', null)
      return count ?? 0
    },

    async markRead(id, agencyId, userId) {
      const { data } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id)
        .eq('agency_id', agencyId)
        .or(`user_id.is.null,user_id.eq.${userId}`)
        .select('*')
        .maybeSingle()
      return data ? notificationSchema.parse(data) : null
    },

    async dismiss(id, agencyId, userId) {
      const { data } = await supabase
        .from('notifications')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('id', id)
        .eq('agency_id', agencyId)
        .or(`user_id.is.null,user_id.eq.${userId}`)
        .select('*')
        .maybeSingle()
      return data ? notificationSchema.parse(data) : null
    },
  }
}
