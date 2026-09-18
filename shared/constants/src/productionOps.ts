/**
 * Phase 19 — Production Integration, Data Completeness & Intelligence
 * Operations. Mirrors submissionReadiness.ts/intelligence.ts exactly:
 * roles reuse the existing RBAC vocabulary, nothing new is invented.
 */

/** Reuses the existing submission-readiness role vocabulary — anyone who can view submission readiness can view/acknowledge addenda for that same bid project. */
export const ADDENDUM_ACK_ROLES = ['ADMIN', 'BID_MANAGER'] as const
export const ADDENDUM_VIEW_ROLES = ['ADMIN', 'BID_MANAGER', 'RESEARCHER', 'VIEWER'] as const

/** Data-quality dashboard: any authenticated role may view; only ADMIN/BID_MANAGER may run a scan or resolve/dismiss a violation (spec §18 — a data-quality finding is not silently dismissed by just anyone). */
export const DATA_QUALITY_VIEW_ROLES = ['ADMIN', 'BID_MANAGER', 'RESEARCHER', 'VIEWER'] as const
export const DATA_QUALITY_MANAGE_ROLES = ['ADMIN', 'BID_MANAGER'] as const

/** Operational health dashboard (spec §16) — read-only, viewable by any authenticated role; it never exposes secrets/credentials (spec §16 binding constraint). */
export const OPS_HEALTH_VIEW_ROLES = ['ADMIN', 'BID_MANAGER', 'RESEARCHER', 'VIEWER'] as const

export const DATA_QUALITY_SEVERITY = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const
export type DataQualitySeverity = (typeof DATA_QUALITY_SEVERITY)[number]

export const DATA_QUALITY_VIOLATION_STATUS = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'] as const
export type DataQualityViolationStatus = (typeof DATA_QUALITY_VIOLATION_STATUS)[number]

/**
 * Deterministic rule vocabulary (spec §18 "at minimum"). Each rule id
 * is the exact string written into `data_quality_violations.rule` —
 * never a UI label computed separately, so the audit trail and the
 * dashboard can never drift out of sync with each other.
 */
export const DATA_QUALITY_RULES = [
  'TENDER_MISSING_CLOSING_DATE',
  'TENDER_MISSING_SOURCE_URL',
  'DUPLICATE_TENDER_NUMBER',
  'DUPLICATE_SOURCE_RECORD',
  'DOCUMENT_MISSING_HASH',
  'REQUIREMENT_WITHOUT_EVIDENCE',
  'OUTCOME_WITHOUT_PROVENANCE',
  'WINNER_WITHOUT_EVIDENCE',
  'BID_SUBMITTED_WITHOUT_VERIFIED_EVIDENCE',
] as const
export type DataQualityRule = (typeof DATA_QUALITY_RULES)[number]

/**
 * Phase 19 audit event vocabulary, written into the existing free-text
 * `audit_logs.action` exactly as every prior phase does.
 */
export const PRODUCTION_OPS_AUDIT_EVENTS = [
  'ADDENDUM_ACKNOWLEDGED',
  'DATA_QUALITY_SCAN_RUN',
  'DATA_QUALITY_VIOLATION_DETECTED',
  'DATA_QUALITY_VIOLATION_RESOLVED',
  'DATA_QUALITY_VIOLATION_DISMISSED',
] as const
export type ProductionOpsAuditEvent = (typeof PRODUCTION_OPS_AUDIT_EVENTS)[number]
