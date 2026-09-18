import type { AgencyEvidenceRef, EvidenceRef, TenderEvidenceRef } from './types.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Pure shape validation for an evidence reference (Phase 8 §27/§38).
 * This does NOT verify a tender-evidence ref belongs to the right
 * tender or an agency-evidence ref belongs to the right agency — that
 * requires a database lookup and lives in the repository layer
 * (repositories/tenderQualification.ts), mirroring Phase 7's
 * evidence/resolver.ts split between shape validation (pure) and
 * server-side resolution (I/O). Malicious/malformed ids (SQL-shaped,
 * path-traversal-shaped, oversized) are rejected here before ever
 * reaching a query.
 */
export function isWellFormedEvidenceRef(ref: EvidenceRef): boolean {
  if (ref.kind === 'AGENCY') {
    return UUID_RE.test(ref.agencyEvidenceId)
  }
  if (!UUID_RE.test(ref.documentId)) return false
  if (ref.documentVersionId !== null && !UUID_RE.test(ref.documentVersionId)) return false
  if (ref.sectionId !== null && !UUID_RE.test(ref.sectionId)) return false
  if (ref.chunkId !== null && !UUID_RE.test(ref.chunkId)) return false
  if (ref.pageId !== null && !UUID_RE.test(ref.pageId)) return false
  if (typeof ref.evidenceText !== 'string') return false
  return true
}

export function dedupeTenderEvidence(refs: TenderEvidenceRef[]): TenderEvidenceRef[] {
  const seen = new Set<string>()
  const out: TenderEvidenceRef[] = []
  for (const ref of refs) {
    const key = ref.chunkId ?? `${ref.documentId}:${ref.sectionId ?? ''}:${ref.evidenceText}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ref)
  }
  return out
}

export function dedupeAgencyEvidence(refs: AgencyEvidenceRef[]): AgencyEvidenceRef[] {
  const seen = new Set<string>()
  const out: AgencyEvidenceRef[] = []
  for (const ref of refs) {
    if (seen.has(ref.agencyEvidenceId)) continue
    seen.add(ref.agencyEvidenceId)
    out.push(ref)
  }
  return out
}

/** A requirement that must resolve PASS needs at least one agency evidence reference — mirrors the DB-level CHECK constraint on the legacy `tender_requirements.qualification_status` column (Phase 2 §10) as an application-layer invariant for the new result model too. */
export function passRequiresAgencyEvidence(status: string, agencyEvidence: AgencyEvidenceRef[]): boolean {
  if (status !== 'PASS') return true
  return agencyEvidence.length > 0
}
