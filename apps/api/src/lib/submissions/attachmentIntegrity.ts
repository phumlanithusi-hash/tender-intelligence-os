/**
 * Phase 16 §16 — EMAIL ATTACHMENT INTEGRITY. Before sending, every
 * attachment is verified against the approved manifest (filename,
 * size, SHA-256, MIME type, pack version). Any mismatch BLOCKS the
 * send outright — never silently substituted or ignored.
 */
export interface ManifestFile {
  fileName: string
  sizeBytes: number | null
  sha256: string
  mimeType: string | null
}

export interface AttachmentIntegrityResult {
  valid: boolean
  mismatches: string[]
}

export function verifyAttachmentsAgainstManifest(manifestFiles: readonly ManifestFile[], candidateFiles: readonly ManifestFile[]): AttachmentIntegrityResult {
  const mismatches: string[] = []

  if (manifestFiles.length !== candidateFiles.length) {
    mismatches.push(`Attachment count (${candidateFiles.length}) does not match the approved manifest (${manifestFiles.length}).`)
  }

  const byName = new Map(candidateFiles.map((f) => [f.fileName, f]))
  for (const expected of manifestFiles) {
    const actual = byName.get(expected.fileName)
    if (!actual) {
      mismatches.push(`Approved file "${expected.fileName}" is missing from the outgoing attachments.`)
      continue
    }
    if (actual.sha256 !== expected.sha256) mismatches.push(`Attachment "${expected.fileName}" content hash does not match the approved manifest.`)
    if (expected.sizeBytes !== null && actual.sizeBytes !== expected.sizeBytes) mismatches.push(`Attachment "${expected.fileName}" size does not match the approved manifest.`)
    if (expected.mimeType !== null && actual.mimeType !== expected.mimeType) mismatches.push(`Attachment "${expected.fileName}" MIME type does not match the approved manifest.`)
  }

  return { valid: mismatches.length === 0, mismatches }
}
