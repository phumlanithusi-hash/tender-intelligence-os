/**
 * Phase 2 domain enums — kept in exact sync with the Postgres enum
 * types they mirror (database/migrations/20260910200010_enums.sql).
 * These are the read-side vocabulary for the catalogue tables the
 * Phase 2 read-only repositories expose (docs/DATABASE.md §5); they
 * are additive to shared/constants/src/provenance.ts, not a
 * replacement for it.
 */

export const TENDER_STATUS = [
  'DISCOVERED',
  'VERIFYING',
  'VERIFIED',
  'OPEN',
  'CLOSING_SOON',
  'CLOSED',
  'CANCELLED',
  'AWARDED',
  'WITHDRAWN',
  'UNKNOWN',
] as const
export type TenderStatus = (typeof TENDER_STATUS)[number]

export const SOURCE_TYPE = [
  'OFFICIAL',
  'GOVERNMENT',
  'MUNICIPAL',
  'SOE',
  'AGGREGATOR',
  'MANUAL',
  'OTHER',
] as const
export type SourceType = (typeof SOURCE_TYPE)[number]

export const AUTHORITY_LEVEL = ['PRIMARY', 'SECONDARY', 'DISCOVERY'] as const
export type AuthorityLevel = (typeof AUTHORITY_LEVEL)[number]

// Phase 9 §4/§5: extended (not duplicated) with the Phase 9 requirement
// taxonomy — QUALIFICATION, FUNCTIONALITY, COMMERCIAL, PRICE, PREFERENCE,
// LOCAL_CONTENT, CONTRACTUAL, INFORMATIONAL. This one enum/column now
// serves both the original Phase 2 usage and the Phase 9 taxonomy axis;
// Phase 8's separate `category` column (QUALIFICATION_CATEGORY) remains a
// different axis (agency-evidence check category) and is untouched.
export const REQUIREMENT_TYPE = [
  'ELIGIBILITY',
  'ADMINISTRATIVE',
  'TECHNICAL',
  'EXPERIENCE',
  'FINANCIAL',
  'TAX',
  'CSD',
  'B_BBEE',
  'COMPANY_REGISTRATION',
  'CERTIFICATION',
  'REFERENCE',
  'BRIEFING',
  'PRICING',
  'SUBMISSION',
  'TEAM',
  'CAPACITY',
  'GEOGRAPHIC',
  'LEGAL',
  'OTHER',
  'QUALIFICATION',
  'FUNCTIONALITY',
  'COMMERCIAL',
  'PRICE',
  'PREFERENCE',
  'LOCAL_CONTENT',
  'CONTRACTUAL',
  'INFORMATIONAL',
] as const
export type RequirementType = (typeof REQUIREMENT_TYPE)[number]

/** Pipeline extraction status — distinct from qualification_status (provenance.ts). */
export const EXTRACTION_STATUS = ['PENDING', 'EXTRACTED', 'FAILED', 'NEEDS_REVIEW', 'NOT_APPLICABLE'] as const
export type ExtractionStatus = (typeof EXTRACTION_STATUS)[number]

export const SCORING_METHOD = ['POINTS', 'PERCENTAGE', 'PASS_FAIL', 'RATIO', 'OTHER'] as const
export type ScoringMethod = (typeof SCORING_METHOD)[number]

export const DOCUMENT_TYPE = [
  'TOR',
  'RFP',
  'RFQ',
  'BID_DOCUMENT',
  'SBD_FORM',
  'PRICING_SCHEDULE',
  'SPECIFICATION',
  'ANNEXURE',
  'ADDENDUM',
  'BRIEFING_DOCUMENT',
  'DRAWING',
  'OTHER',
] as const
export type DocumentType = (typeof DOCUMENT_TYPE)[number]

export const RISK_TYPE = [
  'QUALIFICATION',
  'COMPLIANCE',
  'COMMERCIAL',
  'DELIVERY',
  'CAPACITY',
  'COMPETITION',
  'DEADLINE',
  'CONTRACT',
  'PRICING',
  'DOCUMENTATION',
  'STRATEGIC',
  'OTHER',
] as const
export type RiskType = (typeof RISK_TYPE)[number]

export const RISK_STATUS = ['OPEN', 'MITIGATED', 'ACCEPTED', 'CLOSED'] as const
export type RiskStatus = (typeof RISK_STATUS)[number]

export const ACTOR_TYPE = ['USER', 'SYSTEM', 'AGENT'] as const
export type ActorType = (typeof ACTOR_TYPE)[number]

/**
 * Phase 4 — source registry operational vocabulary (mirrors
 * database/migrations/20260911100000_source_registry.sql's new
 * enums exactly).
 */

/** Operational state of a source's code-level adapter — independent of `SourceHealth`. */
export const ADAPTER_STATE = ['NOT_IMPLEMENTED', 'CONFIGURED', 'ACTIVE', 'PAUSED', 'FAILED', 'DISABLED'] as const
export type AdapterState = (typeof ADAPTER_STATE)[number]

export const SOURCE_SCAN_STATUS = ['QUEUED', 'RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED'] as const
export type SourceScanStatus = (typeof SOURCE_SCAN_STATUS)[number]

/** Lifecycle of one source's appearance of a tender (`tender_source_records.source_status`) — Phase 5 §6/§9. */
export const SOURCE_RECORD_STATUS = ['ACTIVE', 'STALE', 'REMOVED', 'SUPERSEDED'] as const
export type SourceRecordStatus = (typeof SOURCE_RECORD_STATUS)[number]

export const SOURCE_ERROR_TYPE = [
  'NETWORK',
  'TIMEOUT',
  'HTTP',
  'AUTHENTICATION',
  'RATE_LIMIT',
  'PARSING',
  'DOCUMENT',
  'VALIDATION',
  'UNKNOWN',
] as const
export type SourceErrorType = (typeof SOURCE_ERROR_TYPE)[number]
