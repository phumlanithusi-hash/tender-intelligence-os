import type { SupabaseClient } from '@supabase/supabase-js'
import { tenderDocumentPageSchema, type TenderDocumentPageRow } from '@tender-os/schemas'

/** Read-only repository over `tender_document_pages` (Phase 6 §12/§25). */
export async function listTenderDocumentPages(
  supabase: SupabaseClient,
  versionId: string,
): Promise<TenderDocumentPageRow[]> {
  const { data, error } = await supabase
    .from('tender_document_pages')
    .select('*')
    .eq('document_version_id', versionId)
    .order('page_number', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row) => tenderDocumentPageSchema.parse(row))
}
