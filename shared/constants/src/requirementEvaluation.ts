/**
 * Phase 9 — Requirement & Evaluation Extraction enums, kept in exact
 * sync with database/migrations/20260911180000_requirement_evaluation_extraction.sql.
 *
 * The requirement taxonomy itself is NOT redefined here — it reuses the
 * existing `REQUIREMENT_TYPE` enum from tenders.ts (extended with the
 * Phase 9 values), since it is the same axis as the original Phase 2
 * `tender_requirements.requirement_type` column. This file only adds the
 * NEW vocabulary Phase 9 introduces: evaluation criterion types and the
 * view/action roles for the new endpoints.
 */

/** Evaluation criterion type (Phase 9 §17). UNKNOWN when the tender's own wording doesn't make the type clear — never guessed. */
export const EVALUATION_CRITERION_TYPE = [
  'FUNCTIONALITY',
  'PRICE',
  'PREFERENCE',
  'LOCAL_CONTENT',
  'TECHNICAL',
  'PRESENTATION',
  'INTERVIEW',
  'OTHER',
  'UNKNOWN',
] as const
export type EvaluationCriterionType = (typeof EVALUATION_CRITERION_TYPE)[number]

/** Roles permitted to view requirement/evaluation extraction output (Phase 9 §37, mirrors AI_VIEW_ROLES/QUALIFICATION_VIEW_ROLES). */
export const REQUIREMENT_EVALUATION_VIEW_ROLES = ['ADMIN', 'BID_MANAGER', 'RESEARCHER'] as const
/** Roles permitted to trigger extraction or record a human review decision (Phase 9 §37, mirrors AI_ACTION_ROLES/QUALIFICATION_ACTION_ROLES). */
export const REQUIREMENT_EVALUATION_ACTION_ROLES = ['ADMIN', 'BID_MANAGER'] as const

/** Agent identity recorded on tender_ai_runs.agent_name for this phase's agent (Phase 9 §8). */
export const REQUIREMENT_EXTRACTION_AGENT_NAME = 'RequirementExtractionAgent'
