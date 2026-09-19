import type { DocumentReference } from '../types.js'
import { isAllowedDocumentUrl } from './allowlist.js'

/**
 * Document DISCOVERY only — same rule as every other adapter's
 * documents.ts. Eskom exposes exactly one document link per tender: a
 * server-generated "download all" bundle (no per-document listing
 * exists on the public card), so this returns at most one
 * `DocumentReference` per tender rather than guessing at individual
 * file names inside the bundle. The filename is synthesised from the
 * tender's own id since the URL itself carries no filename, and the
 * mime type is left unset rather than guessed (the endpoint's actual
 * content type — zip vs. something else — was never confirmed).
 */
export function toDocumentReferences(downloadAllDocsUrl: string | null, externalId: string, baseUrl: string): DocumentReference[] {
  if (!downloadAllDocsUrl) return []
  let absolute: string
  try {
    absolute = new URL(downloadAllDocsUrl, baseUrl).toString()
  } catch {
    return []
  }
  if (!isAllowedDocumentUrl(absolute)) return []
  return [{ url: absolute, filename: `eskom-tender-${externalId}-all-documents` }]
}
