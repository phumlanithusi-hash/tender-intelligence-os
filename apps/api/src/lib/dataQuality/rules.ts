import type { DataQualityRule, DataQualitySeverity } from '@tender-os/constants'

/**
 * Phase 19 §17/§18 — deterministic data-quality rules. PURE, zero-I/O:
 * every function here takes already-fetched rows (plain objects, the
 * exact shape the caller's Supabase query returned) and returns
 * violation candidates. The caller (dataQualityStore.ts) is the only
 * place that talks to the database, mirroring every other engine in
 * this codebase (lib/submissionReadiness/engine.ts,
 * lib/bidDecision/*, lib/intelligence/*).
 *
 * A rule never fabricates a problem: every candidate below is derived
 * from a real, already-confirmed data condition (a null column, a
 * duplicate key, a missing FK-linked evidence row) — never an AI
 * guess, never a heuristic "looks wrong" judgement (spec §34 AI
 * boundary: deterministic systems remain authoritative for data
 * quality status).
 */

export interface ViolationCandidate {
  rule: DataQualityRule
  severity: DataQualitySeverity
  entityType: string
  entityId: string
  agencyId: string | null
  details: Record<string, unknown>
}

function v(rule: DataQualityRule, severity: DataQualitySeverity, entityType: string, entityId: string, agencyId: string | null, details: Record<string, unknown> = {}): ViolationCandidate {
  return { rule, severity, entityType, entityId, agencyId, details }
}

export interface TenderRow {
  id: string
  tenderNumber: string | null
  status: string
  closingDate: string | null
}

/** A tender still open for bidding with no closing date is unusable for deadline-driven workflows (Phase 15 deadline engine, watchlist alerts). Cancelled/withdrawn/awarded tenders are excluded — their closing date being absent is not itself a live problem. */
export function checkTendersMissingClosingDate(tenders: TenderRow[]): ViolationCandidate[] {
  const liveStatuses = new Set(['DISCOVERED', 'VERIFYING', 'VERIFIED', 'OPEN', 'CLOSING_SOON'])
  return tenders
    .filter((t) => liveStatuses.has(t.status) && !t.closingDate)
    .map((t) => v('TENDER_MISSING_CLOSING_DATE', 'HIGH', 'tenders', t.id, null, { tenderNumber: t.tenderNumber, status: t.status }))
}

/** Every tender should be traceable to at least one source appearance with a real URL (spec §17/§26 provenance requirement) — a tender with none can never be re-verified against its origin. */
export function checkTendersMissingSourceUrl(tenderIds: string[], tenderIdsWithSourceUrl: Set<string>): ViolationCandidate[] {
  return tenderIds.filter((id) => !tenderIdsWithSourceUrl.has(id)).map((id) => v('TENDER_MISSING_SOURCE_URL', 'MEDIUM', 'tenders', id, null))
}

export interface TenderNumberGroup {
  tenderNumber: string
  ids: string[]
}

/** `tenders.tender_number` carries no DB-level uniqueness constraint (a tender_number can legitimately be re-used across amendment cycles by some organs of state) — this rule surfaces the case for human review rather than silently merging or ignoring it. */
export function checkDuplicateTenderNumbers(groups: TenderNumberGroup[]): ViolationCandidate[] {
  return groups
    .filter((g) => g.tenderNumber && g.ids.length > 1)
    .flatMap((g) => g.ids.map((id) => v('DUPLICATE_TENDER_NUMBER', 'CRITICAL', 'tenders', id, null, { tenderNumber: g.tenderNumber, duplicateCount: g.ids.length })))
}

export interface SourceRecordGroup {
  sourceId: string
  externalId: string
  ids: string[]
}

/** `tender_source_records` already has a DB-level unique constraint on (source_id, external_id) for INSERT paths that respect it — this rule is a defense-in-depth check for rows that predate the constraint or reached the table by another path. */
export function checkDuplicateSourceRecords(groups: SourceRecordGroup[]): ViolationCandidate[] {
  return groups
    .filter((g) => g.ids.length > 1)
    .flatMap((g) => g.ids.map((id) => v('DUPLICATE_SOURCE_RECORD', 'HIGH', 'tender_source_records', id, null, { sourceId: g.sourceId, externalId: g.externalId, duplicateCount: g.ids.length })))
}

export interface DocumentRow {
  id: string
  downloadedAt: string | null
  fileHash: string | null
}

/** A document recorded as downloaded but with no content hash cannot be integrity-checked against a later re-download (spec §6/§13 document-versioning requirement). */
export function checkDocumentsMissingHash(documents: DocumentRow[]): ViolationCandidate[] {
  return documents.filter((d) => d.downloadedAt && !d.fileHash).map((d) => v('DOCUMENT_MISSING_HASH', 'MEDIUM', 'tender_documents', d.id, null))
}

export interface RequirementRow {
  id: string
  mandatory: boolean
  qualificationStatus: string | null
}

/** A mandatory requirement whose qualification status has never been assessed (still UNKNOWN, the safe default — Phase 2 §10) after the tender has moved past discovery is a completeness gap, not a failure — surfaced as LOW severity, never a blocker. */
export function checkMandatoryRequirementsWithoutAssessment(requirements: RequirementRow[]): ViolationCandidate[] {
  return requirements
    .filter((r) => r.mandatory && (r.qualificationStatus === null || r.qualificationStatus === 'UNKNOWN'))
    .map((r) => v('REQUIREMENT_WITHOUT_EVIDENCE', 'LOW', 'tender_requirements', r.id, null))
}

export interface OutcomeRow {
  id: string
  outcomeStatus: string
  winnerName: string | null
  provenance: string
  sourceDocumentId: string | null
  sourceEvidenceRef: string | null
}

/** An AWARDED outcome recorded with provenance OTHER (the weakest, catch-all provenance tier) has no traceable origin — a real gap in the truth hierarchy (spec §9: OFFICIAL VERIFIED FACT > OFFICIAL BUT UNVERIFIED > SECONDARY SOURCE > HUMAN REPORTED > UNKNOWN). */
export function checkOutcomesWithoutProvenance(outcomes: OutcomeRow[]): ViolationCandidate[] {
  return outcomes.filter((o) => o.outcomeStatus === 'AWARDED' && o.provenance === 'OTHER').map((o) => v('OUTCOME_WITHOUT_PROVENANCE', 'HIGH', 'tender_outcomes', o.id, null, { outcomeStatus: o.outcomeStatus }))
}

/** A recorded winner with no linked source document AND no evidence reference is an unbacked claim — this system never treats a winner name as fact without something to point at (spec §10/§16 binding constraint). */
export function checkWinnersWithoutEvidence(outcomes: OutcomeRow[]): ViolationCandidate[] {
  return outcomes
    .filter((o) => o.outcomeStatus === 'AWARDED' && o.winnerName && !o.sourceDocumentId && !o.sourceEvidenceRef)
    .map((o) => v('WINNER_WITHOUT_EVIDENCE', 'CRITICAL', 'tender_outcomes', o.id, null, { winnerName: o.winnerName }))
}

export interface SubmissionExecutionRow {
  id: string
  agencyId: string
  status: string
  hasVerifiedReceipt: boolean
}

/** A bid recorded as SUBMITTED/SUBMISSION_REPORTED with no receipt ever reaching VERIFIED is exactly the gap spec §16/§40 (Phase 16 Known Limitation) warns about: never assert a real submission happened without confirmable evidence. This is a completeness flag, not an accusation — a legitimate submission with slow provider confirmation looks identical until the receipt arrives. */
export function checkSubmittedBidsWithoutVerifiedEvidence(executions: SubmissionExecutionRow[]): ViolationCandidate[] {
  return executions
    .filter((e) => (e.status === 'SUBMITTED' || e.status === 'SUBMISSION_REPORTED') && !e.hasVerifiedReceipt)
    .map((e) => v('BID_SUBMITTED_WITHOUT_VERIFIED_EVIDENCE', 'CRITICAL', 'bid_submission_executions', e.id, e.agencyId, { status: e.status }))
}
