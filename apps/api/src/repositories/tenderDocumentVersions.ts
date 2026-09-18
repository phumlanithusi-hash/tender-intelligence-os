import type { SupabaseClient } from '@supabase/supabase-js'
import { tenderDocumentVersionSchema, type TenderDocumentVersionRow } from '@tender-os/schemas'

/** Read-only repository over `tender_document_versions` (Phase 6 §7/§25). */
export async function listTenderDocumentVersions(
  supabase: SupabaseClient,
  documentId: string,
): Promise<TenderDocumentVersionRow[]> {
  const { data, error } = await supabase
    .from('tender_document_versions')
    .select('*')
    .eq('document_id', documentId)
    .order('version', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row) => tenderDocumentVersionSchema.parse(row))
}

export async function getTenderDocumentVersionById(
  supabase: SupabaseClient,
  versionId: string,
): Promise<TenderDocumentVersionRow | null> {
  const { data, error } = await supabase.from('tender_document_versions').select('*').eq('id', versionId).maybeSingle()
  if (error) throw error
  return data ? tenderDocumentVersionSchema.parse(data) : null
}
