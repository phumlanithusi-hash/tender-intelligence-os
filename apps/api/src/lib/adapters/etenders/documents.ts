import type { DocumentReference } from '../types.js'
import { isAllowedDocumentUrl } from './allowlist.js'
import type { EtendersTransport, RawDocumentLink } from './types.js'

/**
 * Document DISCOVERY only (Phase 5 §17/§18): identifies document URL,
 * name, and type-if-determinable. Does NOT download file bytes — see
 * docs/SCRAPING-ARCHITECTURE.md for why downloading is deferred in
 * this phase (the same live-network limitation that prevents live
 * discovery validation would make a "successful" download claim in
 * this environment just as unverifiable/untrustworthy).
 *
 * Every URL is resolved against eTenders' own base URL and checked
 * against the domain allow-list (Phase 5 §31) BEFORE it is ever
 * returned to a caller — a document link pointing anywhere else is
 * dropped, not fetched, not fabricated into a fake local reference.
 */
export function toDocumentReferences(
  links: RawDocumentLink[],
  baseUrl = 'https://www.etenders.gov.za',
): DocumentReference[] {
  const refs: DocumentReference[] = []
  for (const link of links) {
    if (!link.url) continue
    let absolute: string
    try {
      absolute = new URL(link.url, baseUrl).toString()
    } catch {
      continue // Unparseable URL — dropped, never guessed at.
    }
    if (!isAllowedDocumentUrl(absolute)) continue // Phase 5 §31: never surface a document reference outside the source's own domain.

    const filename = deriveFilename(link.label, absolute)
    refs.push({
      url: absolute,
      filename,
      mimeType: guessMimeTypeFromFilename(filename) ?? undefined,
    })
  }
  return refs
}

function deriveFilename(label: string | null, url: string): string {
  const fromLabel = label?.trim()
  if (fromLabel && fromLabel.length > 0) return fromLabel
  try {
    const parsed = new URL(url)
    const last = parsed.pathname.split('/').filter(Boolean).pop()
    return last ?? 'document'
  } catch {
    return 'document'
  }
}

/** Determined only from an unambiguous filename extension — never from unchecked source-supplied content-type/label text (Phase 5 §31: MIME spoofing risk). */
function guessMimeTypeFromFilename(filename: string): string | null {
  const ext = filename.toLowerCase().split('.').pop()
  switch (ext) {
    case 'pdf':
      return 'application/pdf'
    case 'doc':
      return 'application/msword'
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'xls':
      return 'application/vnd.ms-excel'
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'zip':
      return 'application/zip'
    default:
      return null
  }
}

/**
 * Fetches document references for one discovered opportunity by
 * loading its detail page (documents are only listed there, not on
 * the summary listing) — implements `TenderSourceAdapter.fetchDocuments`.
 */
export async function fetchEtendersDocuments(
  transport: EtendersTransport,
  externalId: string,
  detailUrl: string,
): Promise<DocumentReference[]> {
  const raw = await transport.fetchDetailPage(detailUrl, externalId)
  return toDocumentReferences(raw.documents)
}
