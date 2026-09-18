import type { SupabaseClient } from '@supabase/supabase-js'
import { tenderDocumentSectionSchema, type TenderDocumentSectionRow } from '@tender-os/schemas'

/** Read-only repository over `tender_document_sections` (Phase 6 §13/§25). */
export async function listTenderDocumentSections(
  supabase: SupabaseClient,
  versionId: string,
): Promise<TenderDocumentSectionRow[]> {
  const { data, error } = await supabase
    .from('tender_document_sections')
    .select('*')
    .eq('document_version_id', versionId)
    .order('section_index', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row) => tenderDocumentSectionSchema.parse(row))
}
