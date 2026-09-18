import type { SupabaseClient } from '@supabase/supabase-js'
import { tenderDocumentProcessingSchema, type TenderDocumentProcessingRow } from '@tender-os/schemas'

/** Read-only repository over `tender_document_processing` (Phase 6 §2/§25). */
export async function getTenderDocumentProcessing(
  supabase: SupabaseClient,
  versionId: string,
): Promise<TenderDocumentProcessingRow | null> {
  const { data, error } = await supabase
    .from('tender_document_processing')
    .select('*')
    .eq('document_version_id', versionId)
    .maybeSingle()
  if (error) throw error
  return data ? tenderDocumentProcessingSchema.parse(data) : null
}
