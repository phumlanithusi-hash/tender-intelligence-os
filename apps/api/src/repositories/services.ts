import type { SupabaseClient } from '@supabase/supabase-js'
import {
  serviceSchema,
  serviceSubcategorySchema,
  type ServiceRow,
  type ServiceSubcategoryRow,
} from '@tender-os/schemas'

/**
 * Read-only repository over the service taxonomy (Phase 2 §6). The
 * taxonomy is small and admin-managed, so this returns the full
 * active list rather than paginating — matching-by-service is a
 * later phase's job, not this one's.
 */
export async function listServices(supabase: SupabaseClient): Promise<ServiceRow[]> {
  const { data, error } = await supabase
    .from('services')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true })

  if (error) throw error
  return (data ?? []).map((row) => serviceSchema.parse(row))
}

export async function listServiceSubcategories(
  supabase: SupabaseClient,
  serviceId: string,
): Promise<ServiceSubcategoryRow[]> {
  const { data, error } = await supabase
    .from('service_subcategories')
    .select('*')
    .eq('service_id', serviceId)
    .eq('active', true)
    .order('sort_order', { ascending: true })

  if (error) throw error
  return (data ?? []).map((row) => serviceSubcategorySchema.parse(row))
}
