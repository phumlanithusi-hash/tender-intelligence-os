/**
 * Phase 7 AI Discovery & Classification enums — kept in exact sync
 * with database/migrations/20260911140000_ai_classification.sql.
 * These are pure vocabulary; the actual service taxonomy used for
 * classification comes from the DB `services` table (Phase 2 §6),
 * never a hard-coded list here (Phase 7 §6).
 */

export const AI_RUN_STATUS = ['QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'REQUIRES_REVIEW'] as const
export type AiRunStatus = (typeof AI_RUN_STATUS)[number]

/** Phase 7 §2: FACT / INFERENCE / UNKNOWN / UNVERIFIED. */
export const AI_TRUTH_STATE = ['FACT', 'INFERENCE', 'UNKNOWN', 'UNVERIFIED'] as const
export type AiTruthState = (typeof AI_TRUTH_STATE)[number]

export const AI_RELEVANCE = ['RELEVANT', 'POSSIBLY_RELEVANT', 'NOT_RELEVANT', 'UNKNOWN'] as const
export type AiRelevance = (typeof AI_RELEVANCE)[number]

export const AI_TENDER_TYPE = [
  'RFP',
  'RFQ',
  'TENDER',
  'EOI',
  'PANEL',
  'FRAMEWORK',
  'APPOINTMENT',
  'QUOTATION',
  'OTHER',
  'UNKNOWN',
] as const
export type AiTenderType = (typeof AI_TENDER_TYPE)[number]

export const AI_GEOGRAPHIC_SCOPE = [
  'NATIONAL',
  'PROVINCIAL',
  'MUNICIPAL',
  'LOCAL',
  'MULTI_PROVINCE',
  'INTERNATIONAL',
  'UNKNOWN',
] as const
export type AiGeographicScope = (typeof AI_GEOGRAPHIC_SCOPE)[number]

export const AI_BRIEFING_STATUS = ['REQUIRED', 'OPTIONAL', 'NOT_REQUIRED', 'UNKNOWN'] as const
export type AiBriefingStatus = (typeof AI_BRIEFING_STATUS)[number]

export const AI_REQUIREMENT_KIND = [
  'MIN_YEARS_EXPERIENCE',
  'REQUIRED_SERVICES',
  'COMPULSORY_BRIEFING',
  'CSD_REGISTRATION',
  'B_BBEE',
  'TAX_COMPLIANCE',
  'PROFESSIONAL_REGISTRATION',
  'CERTIFICATION',
  'GEOGRAPHIC_REQUIREMENT',
  'REFERENCE_REQUIREMENT',
  'TURNOVER_REQUIREMENT',
  'OTHER',
] as const
export type AiRequirementKind = (typeof AI_REQUIREMENT_KIND)[number]

export const AI_CLAIM_TYPE = [
  'RELEVANCE',
  'TENDER_TYPE',
  'INTENT',
  'DELIVERABLE',
  'GEOGRAPHY',
  'CONTRACT',
  'BRIEFING',
  'APPARENT_REQUIREMENT',
  'CONFLICT',
  'SUMMARY',
  // Phase 9 §30 — RequirementExtractionAgent claim types.
  'REQUIREMENT_EXTRACTION',
  'EVALUATION_CRITERION_EXTRACTION',
  'EVALUATION_GATE_EXTRACTION',
] as const
export type AiClaimType = (typeof AI_CLAIM_TYPE)[number]

export const AI_CONFLICT_FIELD = ['CLOSING_DATE', 'CLOSING_TIME', 'BRIEFING_DATE', 'BRIEFING_LOCATION', 'OTHER'] as const
export type AiConflictField = (typeof AI_CONFLICT_FIELD)[number]

/** Roles permitted to view AI classification output (Phase 7 §29/§36). */
export const AI_VIEW_ROLES = ['ADMIN', 'BID_MANAGER', 'RESEARCHER'] as const
/** Roles permitted to trigger/re-trigger a classification run — an operational action, not a read. */
export const AI_ACTION_ROLES = ['ADMIN', 'BID_MANAGER'] as const

/** Config-driven context bounds (Phase 7 §26) — defaults; overridable via env in apps/api/src/lib/ai/config.ts. */
export const AI_DEFAULT_MAX_DOCUMENT_CHUNKS = 40
export const AI_DEFAULT_MAX_CONTEXT_CHARS = 60_000
/** Rough estimate only (chars/4) — never billed on, just used for the truncation budget and cost visibility (Phase 7 §26/§28). */
export const AI_DEFAULT_MAX_TOKENS_ESTIMATE = 16_000
