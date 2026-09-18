import { fileTypeFromBuffer } from 'file-type'
import type { DocumentFileKind } from '@tender-os/constants'

export interface DetectedFileType {
  kind: DocumentFileKind
  mimeType: string | null
  /** True when detection came from actual content (magic bytes / structure), false when it fell back to the filename extension. */
  detectedFromContent: boolean
}

/**
 * Detects a file's real type from its bytes (Phase 6 §5: "Do not
 * trust the filename extension alone — detect MIME/file type from
 * actual content (magic bytes) where possible"). `file-type` covers
 * PDF, the OOXML zip-container formats (docx/xlsx/pptx), and common
 * image formats via magic bytes. HTML and plain text have no magic
 * bytes to speak of, so they're detected heuristically from content
 * only after `file-type` finds nothing binary — never from the
 * filename extension alone for those either, since a `.txt` file
 * could just as easily be empty or actually be something else.
 */
export async function detectFileType(bytes: Buffer, filenameHint: string): Promise<DetectedFileType> {
  const sniffed = await fileTypeFromBuffer(bytes)
  if (sniffed) {
    const kind = mapMimeToKind(sniffed.mime)
    if (kind) return { kind, mimeType: sniffed.mime, detectedFromContent: true }
    // A real, magic-byte-confirmed type we don't yet support for
    // extraction (Phase 6 §5: unsupported formats -> REQUIRES_REVIEW,
    // never silently discarded or misclassified).
    return { kind: 'UNKNOWN', mimeType: sniffed.mime, detectedFromContent: true }
  }

  // No binary magic bytes matched. Distinguish HTML / plain text by
  // content, not extension: sample the start of the buffer as UTF-8
  // and look for unambiguous HTML structure.
  const sample = bytes.subarray(0, 4096).toString('utf8')
  if (/<!doctype html/i.test(sample) || /<html[\s>]/i.test(sample)) {
    return { kind: 'HTML', mimeType: 'text/html', detectedFromContent: true }
  }

  if (isLikelyPlainText(bytes)) {
    return { kind: 'TXT', mimeType: 'text/plain', detectedFromContent: true }
  }

  // Genuinely could not determine content type — fall back to the
  // filename extension ONLY to pick a hint for REQUIRES_REVIEW
  // reporting, never to decide it is safe to extract.
  const ext = filenameHint.toLowerCase().split('.').pop()
  if (ext === 'html' || ext === 'htm') return { kind: 'HTML', mimeType: 'text/html', detectedFromContent: false }
  if (ext === 'txt') return { kind: 'TXT', mimeType: 'text/plain', detectedFromContent: false }
  return { kind: 'UNKNOWN', mimeType: null, detectedFromContent: false }
}

function mapMimeToKind(mime: string): DocumentFileKind | null {
  switch (mime) {
    case 'application/pdf':
      return 'PDF'
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'DOCX'
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return 'XLSX'
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return 'PPTX'
    case 'image/png':
    case 'image/jpeg':
    case 'image/tiff':
    case 'image/bmp':
    case 'image/webp':
      return 'IMAGE'
    default:
      return null
  }
}

/** Heuristic: text with no/very few non-printable bytes is treated as plain text (Phase 6 §5). */
function isLikelyPlainText(bytes: Buffer): boolean {
  if (bytes.length === 0) return true
  const sample = bytes.subarray(0, 8192)
  let controlBytes = 0
  for (const byte of sample) {
    if (byte === 0) return false // NUL byte — never treat as text
    const isPrintable = (byte >= 0x20 && byte <= 0x7e) || byte === 0x09 || byte === 0x0a || byte === 0x0d
    const isUtf8Continuation = byte >= 0x80
    if (!isPrintable && !isUtf8Continuation) controlBytes += 1
  }
  return controlBytes / sample.length < 0.02
}
