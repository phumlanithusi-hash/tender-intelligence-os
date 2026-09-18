/**
 * Phase 20 — Enterprise Hardening, Continuous Surveillance & System
 * Convergence. Reuses the existing RBAC vocabulary throughout
 * (nothing new is invented) — mirrors productionOps.ts exactly.
 */

/** Surveillance (continuous ingestion diff engine, polling schedule) — a read of poll status/addenda detected is available to any role that can already see the Source Registry; triggering an on-demand scan is an operational action gated more tightly. */
export const SURVEILLANCE_VIEW_ROLES = ['ADMIN', 'BID_MANAGER', 'RESEARCHER', 'VIEWER'] as const
export const SURVEILLANCE_MANAGE_ROLES = ['ADMIN', 'BID_MANAGER'] as const

/** How a `tender_addenda` row was produced (spec §20 4A/4B): a real source document (Phase 2 §9 original path) or the Phase 20 structural diff engine detecting a change with no distinct new document. */
export const ADDENDUM_DETECTED_VIA = ['DOCUMENT', 'DIFF_ENGINE'] as const
export type AddendumDetectedVia = (typeof ADDENDUM_DETECTED_VIA)[number]

/**
 * Anonymized cross-agency benchmarking (spec §20 4C). Viewable by any
 * authenticated role — it is deliberately never agency-scoped, and
 * never exposes a group smaller than the k-anonymity floor.
 */
export const BENCHMARK_VIEW_ROLES = ['ADMIN', 'BID_MANAGER', 'RESEARCHER', 'WRITER', 'REVIEWER', 'VIEWER'] as const
export const BENCHMARK_MANAGE_ROLES = ['ADMIN'] as const

/** k-anonymity floor (spec §3/§20 5): a category/region/metric group with fewer than this many distinct contributing entities is never displayed, only a masked INSUFFICIENT_BENCHMARK_DATA marker. */
export const BENCHMARK_MIN_GROUP_SIZE = 5

export const BENCHMARK_METRIC_TYPES = ['CYCLE_DAYS', 'PRICE_VARIANCE', 'VOLUME'] as const
export type BenchmarkMetricType = (typeof BENCHMARK_METRIC_TYPES)[number]

/**
 * End-to-end audit / chain-of-custody (spec §20 4D). Restricted to
 * ADMIN only, matching the existing `audit_logs` visibility rule
 * exactly (docs/SECURITY.md §9) — a full cross-entity lineage view is
 * at least as sensitive as the underlying audit_logs table it reads
 * alongside.
 */
export const AUDIT_TRAIL_VIEW_ROLES = ['ADMIN'] as const

/**
 * The exact lineage stages spec §20 4D names: "Source Scan → Tender
 * Import → Requirement Extraction → Strategy Generation → Evidence
 * Match → Human Signoff → Submission" — plus two Phase 20 additions
 * this system can now truthfully record (addendum detection/
 * acknowledgement) and outcome recording, so the same viewer can also
 * answer "what happened after submission."
 */
export const AUDIT_TRAIL_STAGES = [
  'SOURCE_SCAN',
  'TENDER_IMPORT',
  'REQUIREMENT_EXTRACTION',
  'STRATEGY_GENERATION',
  'EVIDENCE_MATCH',
  'HUMAN_SIGNOFF',
  'SUBMISSION',
  'ADDENDUM_DETECTED',
  'ADDENDUM_ACKNOWLEDGED',
  'OUTCOME_RECORDED',
] as const
export type AuditTrailStage = (typeof AUDIT_TRAIL_STAGES)[number]

/** Phase 20 audit event vocabulary, written into the existing free-text `audit_logs.action` exactly as every prior phase does. */
export const PHASE20_AUDIT_EVENTS = [
  'ADDENDUM_DETECTED_BY_DIFF_ENGINE',
  'SURVEILLANCE_SCAN_RUN',
  'BENCHMARK_RECOMPUTED',
] as const
export type Phase20AuditEvent = (typeof PHASE20_AUDIT_EVENTS)[number]
