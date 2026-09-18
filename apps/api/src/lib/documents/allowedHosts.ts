import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Resolves the download allow-list for one document (Phase 6 §4): a
 * document's URL is only ever fetched from the hostname of the
 * `tender_sources` row it was actually discovered from — never an
 * arbitrary, unbounded allow-list. A document with no recorded
 * source (e.g. manually added) falls back to its own already-recorded
 * `file_url` hostname, which is at least self-consistent (it can
 * never be redirected to fetch a DIFFERENT host than the one already
 * on file) — documented as a narrower guarantee than a source-backed
 * allow-list in docs/DOCUMENT-INGESTION.md.
 */
export async function resolveAllowedHostsForDocument(
  supabase: SupabaseClient,
  sourceId: string | null,
  fallbackUrl: string | null,
): Promise<string[]> {
  if (sourceId) {
    const { data, error } = await supabase.from('tender_sources').select('base_url').eq('id', sourceId).maybeSingle()
    if (!error && data?.base_url) {
      const hostname = safeHostname(data.base_url)
      if (hostname) return [hostname]
    }
  }
  const hostname = fallbackUrl ? safeHostname(fallbackUrl) : null
  return hostname ? [hostname] : []
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}
