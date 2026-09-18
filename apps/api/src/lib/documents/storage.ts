import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Storage seam (Phase 6 §3): "Use Supabase Storage for tender
 * documents. Keep tender documents private... Never expose
 * service-role credentials to the frontend. Use signed URLs where
 * temporary client access is required." This interface is what the
 * pipeline and routes depend on, so tests can inject an in-memory
 * fake instead of needing a live Supabase project (this sandbox has
 * none configured) while the real implementation below is exactly
 * what runs in production.
 */
export interface DocumentStorage {
  upload(path: string, bytes: Buffer, contentType: string | null): Promise<void>
  download(path: string): Promise<Buffer>
  /** A time-limited signed URL for client access — the ONLY way a browser ever reaches a stored document; the bucket itself stays private and service-role credentials never leave the server. */
  createSignedUrl(path: string, expiresInSeconds: number): Promise<string | null>
}

export const TENDER_DOCUMENTS_BUCKET = 'tender-documents'

/** Production storage backed by a private Supabase Storage bucket (Phase 6 §3). */
export function createSupabaseDocumentStorage(
  supabase: SupabaseClient,
  bucket = TENDER_DOCUMENTS_BUCKET,
): DocumentStorage {
  return {
    async upload(path, bytes, contentType) {
      const { error } = await supabase.storage.from(bucket).upload(path, bytes, {
        contentType: contentType ?? 'application/octet-stream',
        upsert: true, // Safe: `path` is content-addressed via the version's storage path, which already includes a version segment (filename.ts) — an "upsert" here only ever rewrites the exact same bytes under retry, never a different document's file.
      })
      if (error) throw error
    },

    async download(path) {
      const { data, error } = await supabase.storage.from(bucket).download(path)
      if (error) throw error
      return Buffer.from(await data.arrayBuffer())
    },

    async createSignedUrl(path, expiresInSeconds) {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds)
      if (error) return null
      return data.signedUrl
    },
  }
}
