import { createHash } from 'node:crypto'

/**
 * Phase 13 §A/§F — deterministic content hash used to detect when the
 * underlying evidence content has changed since it was embedded. A
 * changed hash is what flags an embedding STALE (never a silent reuse
 * of a now-outdated vector). Pure (node:crypto is in-process hashing,
 * no I/O), so it is independently unit-testable without a database.
 */
export function computeContentHash(parts: Array<string | number | boolean | null | undefined>): string {
  const canonical = parts.map((p) => (p === null || p === undefined ? '' : String(p))).join('')
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}
