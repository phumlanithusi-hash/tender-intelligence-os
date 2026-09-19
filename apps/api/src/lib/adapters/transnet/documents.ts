import type { DocumentReference } from '../types.js'
import { isAllowedDocumentUrl } from './allowlist.js'

/**
 * Document DISCOVERY only — same rule as every other adapter's
 * documents.ts. Transnet exposes exactly one attachment URL per
 * tender (a server-generated bundle, same shape as Eskom's single
 * "download all" link) — no per-document listing exists on either
 * JSON endpoint. The filename is synthesised from the tender's own
 * id since the URL itself carries no reliable filename, and the mime
 * type is left unset rather than guessed (the endpoint's actual
 * content type was never confirmed).
 */
export function toDocumentReferences(attachment: string | null, externalId: string): DocumentReference[] {
  if (!attachment) return []
  if (!isAllowedDocumentUrl(attachment)) return []
  return [{ url: attachment, filename: `transnet-tender-${externalId}-attachment` }]
}
