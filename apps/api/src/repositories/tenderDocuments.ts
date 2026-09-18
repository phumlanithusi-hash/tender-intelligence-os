import type { SupabaseClient } from '@supabase/supabase-js'
import { tenderDocumentSchema, type TenderDocumentRow } from '@tender-os/schemas'

/**
 * Read-only repository over `tender_documents` (Phase 2 §9, Phase 3
 * tender-detail view).
 */
export async function listTenderDocuments(
  supabase: SupabaseClient,
  tenderId: string,
): Promise<TenderDocumentRow[]> {
  const { data, error } = await supabase
    .from('tender_documents')
    .select('*')
    .eq('tender_id', tenderId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []).map((row) => tenderDocumentSchema.parse(row))
}

/**
 * Document DISCOVERY records only (Phase 5 §17/§18): a row here means
 * "this file was identified at this URL", never "this file's content
 * has been fetched, opened, or analysed" — `storage_path`, `file_size`
 * and `file_hash` all stay null until an actual download step exists
 * (deliberately deferred this phase — docs/SCRAPING-ARCHITECTURE.md).
 * `downloaded_at` stays null for the same reason.
 */
export interface CreateTenderDocumentInput {
  tenderId: string
  sourceId: string | null
  filename: string
  fileUrl: string
  mimeType: string | null
  publishedAt: string | null
}

/** Read-only single-document lookup (Phase 6 §25 API routes). */
export async function getTenderDocumentById(
  supabase: SupabaseClient,
  tenderId: string,
  documentId: string,
): Promise<TenderDocumentRow | null> {
  const { data, error } = await supabase
    .from('tender_documents')
    .select('*')
    .eq('tender_id', tenderId)
    .eq('id', documentId)
    .maybeSingle()
  if (error) throw error
  return data ? tenderDocumentSchema.parse(data) : null
}

export async function findDocumentByTenderAndUrl(
  supabase: SupabaseClient,
  tenderId: string,
  fileUrl: string,
): Promise<TenderDocumentRow | null> {
  const { data, error } = await supabase
    .from('tender_documents')
    .select('*')
    .eq('tender_id', tenderId)
    .eq('file_url', fileUrl)
    .maybeSingle()
  if (error) throw error
  return data ? tenderDocumentSchema.parse(data) : null
}

/** Discovery-only insert — deduplicated by the caller via `findDocumentByTenderAndUrl` first (Phase 5 §19: "Same document twice must not duplicate stored files"), since this table has no unique constraint of its own to lean on for that. */
export async function createTenderDocument(
  supabase: SupabaseClient,
  input: CreateTenderDocumentInput,
): Promise<TenderDocumentRow> {
  const { data, error } = await supabase
    .from('tender_documents')
    .insert({
      tender_id: input.tenderId,
      source_id: input.sourceId,
      document_type: 'OTHER', // Document type is not determinable from discovery alone in this phase (Phase 5 §17) — never guessed.
      filename: input.filename,
      file_url: input.fileUrl,
      mime_type: input.mimeType,
      version: 1,
      published_at: input.publishedAt,
      is_original: true,
      is_addendum: false,
      extraction_status: 'NOT_APPLICABLE', // No content extraction happens in this phase (Phase 5 §18/§27).
    })
    .select('*')
    .single()
  if (error) throw error
  return tenderDocumentSchema.parse(data)
}
