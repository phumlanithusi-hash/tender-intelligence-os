/**
 * Phase 17 — Awards, Outcomes, Win/Loss Intelligence & Procurement
 * Learning. Mirrors database/migrations/20260912200000_awards_outcomes_intelligence.sql
 * enums exactly. See docs/OUTCOME-INTELLIGENCE.md.
 */

/** Tender-level outcome status (spec §6) — what happened to the TENDER, not our bid. */
export const OUTCOME_STATUS = [
  'UNKNOWN', 'OPEN', 'AWARD_PENDING', 'AWARDED', 'CANCELLED', 'WITHDRAWN', 'NO_AWARD', 'DISPUTED',
] as const
export type OutcomeStatus = (typeof OUTCOME_STATUS)[number]

/** Our own bid's result (spec §7) — deliberately separate from OutcomeStatus. */
export const BID_RESULT = [
  'NOT_SUBMITTED', 'SUBMITTED', 'WON', 'LOST', 'DISQUALIFIED', 'WITHDRAWN', 'UNKNOWN',
] as const
export type BidResult = (typeof BID_RESULT)[number]

/** Provenance of an outcome record (spec §4/§14). */
export const OUTCOME_PROVENANCE = [
  'OFFICIAL_SOURCE', 'TENDER_DOCUMENT', 'PROVIDER_RECEIPT', 'AGENCY_RECORD', 'HUMAN_REPORTED', 'SYSTEM_CALCULATED', 'OTHER',
] as const
export type OutcomeProvenance = (typeof OUTCOME_PROVENANCE)[number]

/** Structured loss reason categories (spec §19), configurable in spirit — fixed enum for now. */
export const LOSS_REASON_CATEGORY = [
  'PRICE', 'EVALUATION_SCORE', 'TECHNICAL_NON_COMPLIANCE', 'MANDATORY_REQUIREMENT',
  'LATE_SUBMISSION', 'INCOMPLETE_SUBMISSION', 'INSUFFICIENT_EVIDENCE', 'CAPACITY',
  'EXPERIENCE', 'BEE_SOCIO_ECONOMIC', 'LOCAL_CONTENT', 'PRESENTATION', 'BRIEFING',
  'COMMERCIAL_TERMS', 'STRATEGIC_FIT', 'WITHDRAWN', 'CLIENT_CANCELLED', 'UNKNOWN', 'OTHER',
] as const
export type LossReasonCategory = (typeof LOSS_REASON_CATEGORY)[number]

/** Provenance of a loss reason specifically (spec §20) — distinct from OutcomeProvenance's vocabulary. */
export const LOSS_REASON_PROVENANCE = ['OFFICIAL', 'HUMAN_REPORTED', 'SYSTEM_INFERRED', 'UNKNOWN'] as const
export type LossReasonProvenance = (typeof LOSS_REASON_PROVENANCE)[number]

export const OUTCOME_CONFLICT_STATUS = ['OPEN', 'RESOLVED', 'DISMISSED'] as const
export type OutcomeConflictStatus = (typeof OUTCOME_CONFLICT_STATUS)[number]

/** Competitor data quality (spec §65) — distinct from the shared DataConfidence vocabulary. */
export const COMPETITOR_DATA_QUALITY = ['OBSERVED', 'VERIFIED', 'INFERRED', 'UNKNOWN'] as const
export type CompetitorDataQuality = (typeof COMPETITOR_DATA_QUALITY)[number]

/** A competitor's own recorded role/result on one tender (spec §12). */
export const COMPETITOR_RESULT = ['BIDDER', 'WINNER', 'SHORTLISTED', 'DISQUALIFIED', 'UNKNOWN'] as const
export type CompetitorResult = (typeof COMPETITOR_RESULT)[number]

/** Reconciled submission-status basis used when deriving BidResult (spec §23). */
export const SUBMISSION_STATUS_SNAPSHOT = [
  'VERIFIED_SUBMITTED', 'SUBMISSION_REPORTED', 'NOT_SUBMITTED', 'UNKNOWN',
] as const
export type SubmissionStatusSnapshot = (typeof SUBMISSION_STATUS_SNAPSHOT)[number]

/** Configurable tender/award value bands (spec §32). Upper bound is exclusive except the last. */
export const VALUE_BANDS = [
  { key: 'UNDER_100K', label: '< R100k', min: 0, max: 100_000 },
  { key: 'R100K_500K', label: 'R100k–500k', min: 100_000, max: 500_000 },
  { key: 'R500K_1M', label: 'R500k–1m', min: 500_000, max: 1_000_000 },
  { key: 'R1M_5M', label: 'R1m–5m', min: 1_000_000, max: 5_000_000 },
  { key: 'R5M_10M', label: 'R5m–10m', min: 5_000_000, max: 10_000_000 },
  { key: 'OVER_10M', label: '> R10m', min: 10_000_000, max: null },
] as const
export type ValueBandKey = (typeof VALUE_BANDS)[number]['key']

/** Roles allowed to view/manage/verify outcomes (spec §18 — reuse existing RBAC). */
export const OUTCOME_VIEW_ROLES = ['ADMIN', 'BID_MANAGER', 'RESEARCHER', 'WRITER', 'REVIEWER', 'VIEWER'] as const
export const OUTCOME_MANAGE_ROLES = ['ADMIN', 'BID_MANAGER'] as const
export const OUTCOME_VERIFY_ROLES = ['ADMIN', 'BID_MANAGER', 'REVIEWER'] as const

/** Minimum sample size before a category/organisation metric is shown as a headline figure rather than caveated (spec §31). */
export const MIN_MEANINGFUL_SAMPLE_SIZE = 5

/** Days after submission with no known outcome before "OUTCOME FOLLOW-UP REQUIRED" (spec §55). */
export const OUTCOME_FOLLOW_UP_DAYS = 45
