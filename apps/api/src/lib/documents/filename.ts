/**
 * Filename sanitisation and storage path construction (Phase 6 §3):
 * "Storage path deterministic and safe... Sanitise filenames. Prevent
 * path traversal, arbitrary filesystem paths, unsafe characters,
 * collisions." A document's filename is untrusted external input
 * (Phase 6 §4/§33) — it may contain `../`, absolute paths, null
 * bytes, control characters, or reserved names, and must never be
 * used to construct a storage path directly.
 */

const UNSAFE_CHARS = /[^a-zA-Z0-9._-]/g
const MAX_FILENAME_LENGTH = 180

/**
 * Reduces a filename to a safe basename: strips any directory
 * component (defeats `../../etc/passwd`, absolute paths, and
 * backslash-style traversal), strips control/null characters, and
 * replaces every remaining unsafe character with `_`. Never returns
 * an empty string, `.` or `..`.
 */
export function sanitiseFilename(rawFilename: string): string {
  // eslint-disable-next-line no-control-regex -- deliberately stripping control chars from untrusted input
  const noControlChars = rawFilename.replace(/[\x00-\x1f\x7f]/g, '')
  // Strip any path component from either separator style, then take
  // only the final segment — this is what defeats traversal, not a
  // blacklist of "../" substrings (which is trivially bypassable).
  const basename = noControlChars.split(/[/\\]/).filter(Boolean).pop() ?? ''

  let safe = basename.replace(UNSAFE_CHARS, '_')
  safe = safe.replace(/^\.+/, '') // no leading dots (hidden files / bare "." / "..")
  safe = safe.trim()

  if (safe.length === 0) safe = 'document'
  if (safe.length > MAX_FILENAME_LENGTH) {
    const dot = safe.lastIndexOf('.')
    const ext = dot > 0 && dot > safe.length - 12 ? safe.slice(dot) : ''
    safe = safe.slice(0, MAX_FILENAME_LENGTH - ext.length) + ext
  }
  return safe
}

/**
 * Deterministic, safe storage path (Phase 6 §3):
 * `tenders/{tender_id}/documents/{document_id}/v{version}/{filename}`.
 * `tenderId`/`documentId` are always our own generated UUIDs (never
 * externally supplied), and `filename` is always the sanitised form —
 * this function never accepts a raw, unsanitised filename.
 */
export function buildStoragePath(
  tenderId: string,
  documentId: string,
  version: number,
  sanitisedFilename: string,
): string {
  if (!/^[0-9a-f-]{36}$/i.test(tenderId) || !/^[0-9a-f-]{36}$/i.test(documentId)) {
    throw new Error('buildStoragePath requires UUID tenderId/documentId, never externally-supplied path segments')
  }
  return `tenders/${tenderId}/documents/${documentId}/v${version}/${sanitisedFilename}`
}
