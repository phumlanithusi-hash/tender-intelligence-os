import type { SupabaseClient } from '@supabase/supabase-js'
import { tenderDocumentChunkSchema, type TenderDocumentChunkRow } from '@tender-os/schemas'

/** Read-only repository over `tender_document_chunks` (Phase 6 §14/§25). */
export async function listTenderDocumentChunks(
  supabase: SupabaseClient,
  versionId: string,
): Promise<TenderDocumentChunkRow[]> {
  const { data, error } = await supabase
    .from('tender_document_chunks')
    .select('*')
    .eq('document_version_id', versionId)
    .order('chunk_index', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row) => tenderDocumentChunkSchema.parse(row))
}
