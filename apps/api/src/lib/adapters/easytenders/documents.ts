import type { DocumentReference } from '../types.js'
import { isAllowedDocumentUrl } from './allowlist.js'
import type { EasyTendersTransport, RawDocumentLink } from './types.js'

/** Document DISCOVERY only — same rule as adapters/etenders/documents.ts: identify url/filename/type, never download bytes, never surface a link outside the allow-list. */
export function toDocumentReferences(links: RawDocumentLink[], baseUrl = 'https://easytenders.co.za'): DocumentReference[] {
  const refs: DocumentReference[] = []
  for (const link of links) {
    if (!link.url) continue
    let absolute: string
    try {
      absolute = new URL(link.url, baseUrl).toString()
    } catch {
      continue
    }
    if (!isAllowedDocumentUrl(absolute)) continue

    const filename = deriveFilename(link.label, absolute)
    refs.push({ url: absolute, filename, mimeType: guessMimeTypeFromFilename(filename) ?? undefined })
  }
  return refs
}

function deriveFilename(label: string | null, url: string): string {
  const fromLabel = label?.trim()
  if (fromLabel && fromLabel.length > 0) return fromLabel
  try {
    const parsed = new URL(url)
    return parsed.pathname.split('/').filter(Boolean).pop() ?? 'document'
  } catch {
    return 'document'
  }
}

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

export async function fetchEasyTendersDocuments(
  transport: EasyTendersTransport,
  slug: string,
  detailUrl: string,
): Promise<DocumentReference[]> {
  const raw = await transport.fetchDetailPage(detailUrl, slug)
  return toDocumentReferences(raw.documents)
}
