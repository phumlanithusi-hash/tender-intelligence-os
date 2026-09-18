import { createHash } from 'node:crypto'

/** SHA-256 hex digest of a document's bytes (Phase 6 §5/§6) — the sole basis for deduplication and versioning identity. */
export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
