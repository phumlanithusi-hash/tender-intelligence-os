import { createHash } from 'node:crypto'

/**
 * Deterministic content hash for change detection (Phase 5 §6/§19):
 * the same field values always hash to the same string, so a
 * re-scanned record that hasn't actually changed can be recognised as
 * "confirmed, not amended" without a field-by-field diff at every
 * call site. Field ORDER is fixed (not derived from object key
 * iteration order) so the hash is stable across process restarts and
 * V8 versions.
 */
export function computeContentHash(fields: Record<string, string | number | boolean | null | undefined>): string {
  const orderedKeys = Object.keys(fields).sort()
  const canonical = orderedKeys.map((key) => `${key}=${String(fields[key] ?? '')}`).join('')
  return createHash('sha256').update(canonical).digest('hex')
}
