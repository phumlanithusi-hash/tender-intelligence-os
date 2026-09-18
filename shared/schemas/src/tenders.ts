import { z } from 'zod'
import {
  TENDER_STATUS,
  SOURCE_TYPE,
  AUTHORITY_LEVEL,
  SOURCE_HEALTH,
  REQUIREMENT_TYPE,
  EXTRACTION_STATUS,
  SCORING_METHOD,
  SEVERITY,
  DOCUMENT_TYPE,
  RISK_TYPE,
  RISK_STATUS,
  ACTOR_TYPE,
  BID_DECISION,
  ADAPTER_STATE,
  SOURCE_SCAN_STATUS,
  SOURCE_ERROR_TYPE,
  SOURCE_RECORD_STATUS,
} from '@tender-os/constants'
import { qualificationStatusSchema } from './provenance.js'

/**
 * Read-side row schemas for the Phase 2 shared-catalogue tables
 * (docs/DATABASE.md §5) exposed by apps/api's read-only repositories.
 * These validate what comes back from Supabase, not what the app
 * writes — every optional/nullable field mirrors a nullable database
 * column (Phase 2 §5: "nullable values are preferable to invented
 * information"), so a repository response is never widened to look
 * more complete than the underlying data actually is.
 */

export const tenderSourceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  base_url: z.string(),
  source_type: z.enum(SOURCE_TYPE),
  authority_level: z.enum(AUTHORITY_LEVEL),
  jurisdiction: z.string().nullable(),
  active: z.boolean(),
  // Postgres `interval` comes back from PostgREST as its text
  // representation (e.g. "1 day", "12:00:00") — never parsed into a
  // number of seconds here, so a repository can't silently misread a
  // unit (Phase 4 §12: "represent scan frequency").
  scan_frequency: z.string(),
  requires_login: z.boolean(),
  supports_documents: z.boolean(),
  requires_manual_ingestion: z.boolean(),
  last_scan_at: z.string().nullable(),
  last_success_at: z.string().nullable(),
  last_failure_at: z.string().nullable(),
  error_count: z.number().int(),
  health_status: z.enum(SOURCE_HEALTH),
  // Phase 4 §7: which code-level adapter (if any) implements this
  // source, and its operational state. `adapter_key` null is the
  // canonical "NOT CONNECTED" signal (Phase 4 §5/§20) — never
  // inferred from anything else.
  adapter_key: z.string().nullable(),
  adapter_state: z.enum(ADAPTER_STATE),
  paused_at: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type TenderSourceRow = z.infer<typeof tenderSourceSchema>

/**
 * A source's scan/run history (Phase 4 §9). Read-only from the API's
 * perspective — rows are written only by the (future, Phase 5+) scan
 * runner via the privileged service-role client, never by a browser
 * client directly.
 */
export const tenderSourceScanSchema = z.object({
  id: z.string().uuid(),
  source_id: z.string().uuid(),
  started_at: z.string(),
  completed_at: z.string().nullable(),
  status: z.enum(SOURCE_SCAN_STATUS),
  records_discovered: z.number().int(),
  records_processed: z.number().int(),
  records_failed: z.number().int(),
  documents_discovered: z.number().int(),
  records_duplicate: z.number().int().default(0),
  retry_count: z.number().int().default(0),
  error_count: z.number().int(),
  error_message: z.string().nullable(),
  execution_id: z.string().nullable(),
  adapter_version: z.string().nullable(),
  created_at: z.string(),
})
export type TenderSourceScanRow = z.infer<typeof tenderSourceScanSchema>

/**
 * A structured source error (Phase 4 §10). Never carries a credential
 * or secret — `metadata` is free-form non-sensitive diagnostic
 * context only (enforced by review/convention at write time, since
 * Postgres cannot itself distinguish a secret string from any other).
 */
export const tenderSourceErrorSchema = z.object({
  id: z.string().uuid(),
  source_id: z.string().uuid(),
  scan_id: z.string().uuid().nullable(),
  error_type: z.enum(SOURCE_ERROR_TYPE),
  severity: z.enum(SEVERITY),
  message: z.string(),
  url: z.string().nullable(),
  status_code: z.number().int().nullable(),
  retryable: z.boolean(),
  occurred_at: z.string(),
  resolved_at: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
})
export type TenderSourceErrorRow = z.infer<typeof tenderSourceErrorSchema>

/**
 * Aggregate counts for the Source Registry dashboard (Phase 4 §14).
 * Every field is a real count from the database — never fabricated
 * (Phase 4 §14: "Do not fabricate numbers").
 */
export const tenderSourceSummarySchema = z.object({
  totalSources: z.number().int(),
  active: z.number().int(),
  healthy: z.number().int(),
  warning: z.number().int(),
  failed: z.number().int(),
  notConnected: z.number().int(),
})
export type TenderSourceSummary = z.infer<typeof tenderSourceSummarySchema>

/** Result of a (possibly no-op) health check run against a source's adapter (Phase 4 §20). */
export const sourceHealthCheckResultSchema = z.object({
  sourceId: z.string().uuid(),
  status: z.enum(SOURCE_HEALTH),
  adapterState: z.enum(ADAPTER_STATE),
  message: z.string(),
  checkedAt: z.string(),
})
export type SourceHealthCheckResult = z.infer<typeof sourceHealthCheckResultSchema>

export const tenderSchema = z.object({
  id: z.string().uuid(),
  tender_number: z.string().nullable(),
  title: z.string(),
  organisation: z.string().nullable(),
  entity_type: z.string().nullable(),
  province: z.string().nullable(),
  municipality: z.string().nullable(),
  category: z.string().nullable(),
  description: z.string().nullable(),
  published_date: z.string().nullable(),
  closing_date: z.string().nullable(),
  closing_time: z.string().nullable(),
  briefing_required: z.boolean(),
  briefing_date: z.string().nullable(),
  briefing_location: z.string().nullable(),
  briefing_url: z.string().nullable(),
  estimated_value: z.number().nullable(),
  contract_duration: z.string().nullable(),
  submission_method: z.string().nullable(),
  submission_url: z.string().nullable(),
  submission_email: z.string().nullable(),
  original_document_url: z.string().nullable(),
  status: z.enum(TENDER_STATUS),
  confidence_score: z.number().nullable(),
  discovered_at: z.string(),
  verified_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type TenderRow = z.infer<typeof tenderSchema>

export const serviceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  active: z.boolean(),
  sort_order: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type ServiceRow = z.infer<typeof serviceSchema>

export const serviceSubcategorySchema = z.object({
  id: z.string().uuid(),
  service_id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  active: z.boolean(),
  sort_order: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type ServiceSubcategoryRow = z.infer<typeof serviceSubcategorySchema>

export const tenderRequirementSchema = z.object({
  id: z.string().uuid(),
  tender_id: z.string().uuid(),
  requirement_type: z.enum(REQUIREMENT_TYPE),
  requirement_text: z.string(),
  mandatory: z.boolean(),
  severity: z.enum(SEVERITY).nullable(),
  source_document_id: z.string().uuid().nullable(),
  page_number: z.number().int().nullable(),
  section_reference: z.string().nullable(),
  evidence_text: z.string().nullable(),
  confidence: z.number().nullable(),
  extraction_status: z.enum(EXTRACTION_STATUS),
  // Agency-specific fit against THIS caller's evidence. Under RLS this
  // repository only ever sees the requesting agency's own
  // qualification_status/qualification_evidence_id for a shared
  // requirement row — see docs/DATABASE.md §5.
  qualification_status: qualificationStatusSchema,
  qualification_evidence_id: z.string().uuid().nullable(),
  qualification_notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type TenderRequirementRow = z.infer<typeof tenderRequirementSchema>

export const tenderEvaluationCriterionSchema = z.object({
  id: z.string().uuid(),
  tender_id: z.string().uuid(),
  criterion: z.string(),
  description: z.string().nullable(),
  weight: z.number().nullable(),
  scoring_method: z.enum(SCORING_METHOD).nullable(),
  minimum_score: z.number().nullable(),
  source_document_id: z.string().uuid().nullable(),
  page_number: z.number().int().nullable(),
  evidence_text: z.string().nullable(),
  confidence: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type TenderEvaluationCriterionRow = z.infer<typeof tenderEvaluationCriterionSchema>

/**
 * A source-specific appearance of a tender (Phase 2 §4, Phase 5 §6):
 * the per-source raw/audit record `tenders` itself is deliberately
 * NOT — see `tender_source_records` in
 * database/migrations/20260910200080_tenders_core.sql. `tender_id` is
 * nullable because a source record can, in principle, exist before
 * (or without) a canonical tender being matched/created for it yet,
 * though Phase 5's ingestion pipeline always creates both together.
 */
export const tenderSourceRecordSchema = z.object({
  id: z.string().uuid(),
  tender_id: z.string().uuid().nullable(),
  source_id: z.string().uuid(),
  external_id: z.string().nullable(),
  source_url: z.string().nullable(),
  discovered_at: z.string(),
  last_seen_at: z.string(),
  source_status: z.enum(SOURCE_RECORD_STATUS),
  raw_title: z.string().nullable(),
  raw_description: z.string().nullable(),
  raw_closing_date: z.string().nullable(),
  raw_closing_time: z.string().nullable(),
  raw_organisation: z.string().nullable(),
  raw_data: z.record(z.string(), z.unknown()).nullable(),
  content_hash: z.string().nullable(),
  document_hash: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type TenderSourceRecordRow = z.infer<typeof tenderSourceRecordSchema>

export const tenderDocumentSchema = z.object({
  id: z.string().uuid(),
  tender_id: z.string().uuid(),
  source_id: z.string().uuid().nullable(),
  document_type: z.enum(DOCUMENT_TYPE),
  filename: z.string(),
  file_url: z.string().nullable(),
  storage_path: z.string().nullable(),
  mime_type: z.string().nullable(),
  file_size: z.number().nullable(),
  file_hash: z.string().nullable(),
  version: z.number().int(),
  published_at: z.string().nullable(),
  downloaded_at: z.string().nullable(),
  is_original: z.boolean(),
  is_addendum: z.boolean(),
  extraction_status: z.enum(EXTRACTION_STATUS),
  ocr_required: z.boolean(),
  current_version_id: z.string().uuid().nullable().optional(),
  classification: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type TenderDocumentRow = z.infer<typeof tenderDocumentSchema>

export const tenderAddendumSchema = z.object({
  id: z.string().uuid(),
  tender_id: z.string().uuid(),
  // Phase 20 §5: nullable now — a DIFF_ENGINE-detected addendum (a
  // structural change surfaced by the continuous surveillance/diff
  // engine on a re-scan, spec §20 4A) has no single new source
  // document to point at, unlike the original Phase 2 §9 DOCUMENT
  // path. `detected_via` says which case this is; the DB constraint
  // `tender_addenda_document_required_for_document_path` enforces that
  // document_id is still mandatory whenever detected_via = 'DOCUMENT'.
  document_id: z.string().uuid().nullable(),
  addendum_number: z.number().int(),
  published_at: z.string().nullable(),
  summary: z.string().nullable(),
  deadline_changed: z.boolean(),
  briefing_changed: z.boolean(),
  requirement_changed: z.boolean(),
  evaluation_changed: z.boolean(),
  pricing_changed: z.boolean(),
  other_changes: z.string().nullable(),
  // Phase 20 additions (additive, all with safe defaults so pre-Phase-20
  // rows parse unchanged):
  content_hash: z.string().nullable(),
  impact_assessment: z.record(z.unknown()),
  detected_via: z.enum(['DOCUMENT', 'DIFF_ENGINE']),
  created_at: z.string(),
})
export type TenderAddendumRow = z.infer<typeof tenderAddendumSchema>

export const tenderBriefingSchema = z.object({
  id: z.string().uuid(),
  tender_id: z.string().uuid(),
  mandatory: z.boolean(),
  date: z.string().nullable(),
  start_time: z.string().nullable(),
  end_time: z.string().nullable(),
  location: z.string().nullable(),
  online_url: z.string().nullable(),
  registration_required: z.boolean(),
  registration_deadline: z.string().nullable(),
  attendance_recorded: z.boolean(),
  notes: z.string().nullable(),
  source_document_id: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type TenderBriefingRow = z.infer<typeof tenderBriefingSchema>

/**
 * A tender's opportunity score is agency-relative — under RLS this is
 * always exactly the requesting agency's own score row(s) for a
 * tender, never another agency's (docs/DATABASE.md §5). Application
 * code computed every value here; the API never recomputes or
 * re-derives a score, only reads what the database already holds
 * (Phase 2 §13: "application code must calculate the final score").
 */
export const tenderScoreSchema = z.object({
  id: z.string().uuid(),
  tender_id: z.string().uuid(),
  agency_id: z.string().uuid(),
  service_fit: z.number(),
  qualification_likelihood: z.number(),
  relevant_experience: z.number(),
  functionality_potential: z.number(),
  commercial_value: z.number(),
  competition: z.number(),
  time_available: z.number(),
  compliance_risk: z.number(),
  strategic_value: z.number(),
  total_score: z.number(),
  score_class: z.enum(BID_DECISION),
  mandatory_failure: z.boolean(),
  mandatory_failure_reason: z.string().nullable(),
  scoring_version: z.string(),
  calculated_at: z.string(),
})
export type TenderScoreRow = z.infer<typeof tenderScoreSchema>

export const tenderRiskSchema = z.object({
  id: z.string().uuid(),
  tender_id: z.string().uuid(),
  agency_id: z.string().uuid().nullable(),
  risk_type: z.enum(RISK_TYPE),
  severity: z.enum(SEVERITY),
  description: z.string(),
  evidence: z.string().nullable(),
  source_document_id: z.string().uuid().nullable(),
  mitigation: z.string().nullable(),
  status: z.enum(RISK_STATUS),
  confidence: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type TenderRiskRow = z.infer<typeof tenderRiskSchema>

/**
 * Activity/audit entries for a tender. Under RLS this is visible only
 * to ADMIN users of the entry's own agency (or agency-null,
 * system-wide entries) — see database/migrations/
 * 20260910200180_rls_policies.sql's audit_logs policy. A non-admin
 * caller simply sees an empty activity list, not an error.
 */
export const auditLogSchema = z.object({
  id: z.string().uuid(),
  agency_id: z.string().uuid().nullable(),
  actor_id: z.string().uuid().nullable(),
  actor_type: z.enum(ACTOR_TYPE),
  agent_name: z.string().nullable(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string().uuid().nullable(),
  old_value: z.unknown().nullable(),
  new_value: z.unknown().nullable(),
  created_at: z.string(),
})
export type AuditLogRow = z.infer<typeof auditLogSchema>

export const watchlistItemSchema = z.object({
  id: z.string().uuid(),
  agency_id: z.string().uuid(),
  user_id: z.string().uuid(),
  tender_id: z.string().uuid(),
  notes: z.string().nullable(),
  created_at: z.string(),
})
export type WatchlistItemRow = z.infer<typeof watchlistItemSchema>

export const savedFilterSchema = z.object({
  id: z.string().uuid(),
  agency_id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string(),
  filter: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  updated_at: z.string(),
})
export type SavedFilterRow = z.infer<typeof savedFilterSchema>

/**
 * Aggregate KPI counts for the Tender Radar header strip (Phase 3
 * §4). Every field is a real count from the database — a field this
 * environment cannot yet compute (e.g. estimated value, before any
 * tender has one) is null, rendered by the frontend as "—", never a
 * fabricated number (Phase 3 §4: "never invent numbers").
 */
export const tenderSummarySchema = z.object({
  openTenders: z.number().int(),
  relevant: z.number().int().nullable(),
  priorityBid: z.number().int().nullable(),
  closingWithin7Days: z.number().int(),
  briefingsRequired: z.number().int(),
  addendaRecent: z.number().int(),
  estimatedValueTotal: z.number().nullable(),
})
export type TenderSummary = z.infer<typeof tenderSummarySchema>
