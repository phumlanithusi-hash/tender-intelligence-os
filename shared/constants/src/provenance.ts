/**
 * Provenance vocabulary (AI-ARCHITECTURE.md §2, spec §3).
 * Two distinct label sets — do not conflate them.
 */

/** Data confidence: is this fact true, and where did it come from. */
export const DATA_CONFIDENCE = ['VERIFIED', 'INFERRED', 'UNVERIFIED', 'UNKNOWN'] as const
export type DataConfidence = (typeof DATA_CONFIDENCE)[number]

/** Output type: what kind of statement is this. */
export const OUTPUT_TYPE = ['FACT', 'INFERENCE', 'RECOMMENDATION'] as const
export type OutputType = (typeof OUTPUT_TYPE)[number]

/**
 * Qualification engine statuses (spec §24; matches the database's
 * `qualification_status` enum, database/migrations/20260910200010_enums.sql).
 * UNKNOWN must never be treated as PASS. NOT_APPLICABLE added in Phase 2
 * for requirements that do not apply to a given tender/agency pairing.
 */
export const QUALIFICATION_STATUS = [
  'PASS',
  'FAIL',
  'UNKNOWN',
  'REQUIRES_ACTION',
  'NOT_APPLICABLE',
] as const
export type QualificationStatus = (typeof QUALIFICATION_STATUS)[number]

/** Final submission compliance gate (spec §32). */
export const COMPLIANCE_STATE = ['READY', 'BLOCKED'] as const
export type ComplianceState = (typeof COMPLIANCE_STATE)[number]

/** Source health states (spec §14). */
export const SOURCE_HEALTH = ['HEALTHY', 'WARNING', 'FAILED', 'DISABLED'] as const
export type SourceHealth = (typeof SOURCE_HEALTH)[number]

/** Opportunity score classification bands (spec §22). */
export const BID_DECISION = [
  'PRIORITY_BID',
  'BID',
  'REVIEW',
  'CONDITIONAL',
  'NO_BID',
  'UNDECIDED',
] as const
export type BidDecision = (typeof BID_DECISION)[number]

/** Red-team / compliance issue severity (spec §31). */
export const SEVERITY = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const
export type Severity = (typeof SEVERITY)[number]
