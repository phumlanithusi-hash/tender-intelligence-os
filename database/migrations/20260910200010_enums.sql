-- Phase 2: enumerated types.
-- Enums are used everywhere a value must be one of a fixed, known set
-- (docs/DATABASE.md §1) so an invalid state is rejected by the database
-- itself, not only by application code.

-- Shared confidence/provenance vocabulary (docs/AI-ARCHITECTURE.md §2).
-- "Do not allow INFERRED or UNVERIFIED information to silently appear
-- as verified tender facts" (Phase 2 §23) is enforced by requiring
-- every source-derived fact-bearing table to carry one of these.
create type evidence_status as enum ('VERIFIED', 'INFERRED', 'UNVERIFIED', 'UNKNOWN');

create type source_type as enum ('OFFICIAL', 'GOVERNMENT', 'MUNICIPAL', 'SOE', 'AGGREGATOR', 'MANUAL', 'OTHER');
create type authority_level as enum ('PRIMARY', 'SECONDARY', 'DISCOVERY');
create type source_health as enum ('HEALTHY', 'WARNING', 'FAILED', 'DISABLED');

create type tender_status as enum (
  'DISCOVERED', 'VERIFYING', 'VERIFIED', 'OPEN', 'CLOSING_SOON',
  'CLOSED', 'CANCELLED', 'AWARDED', 'WITHDRAWN', 'UNKNOWN'
);

create type source_record_status as enum ('ACTIVE', 'STALE', 'REMOVED', 'SUPERSEDED');

create type municipality_type as enum ('METRO', 'DISTRICT', 'LOCAL');
create type geographic_scope_type as enum ('NATIONAL', 'PROVINCE', 'DISTRICT', 'METRO', 'LOCAL_MUNICIPALITY', 'CUSTOM_AREA');

create type document_type as enum (
  'TOR', 'RFP', 'RFQ', 'BID_DOCUMENT', 'SBD_FORM', 'PRICING_SCHEDULE',
  'SPECIFICATION', 'ANNEXURE', 'ADDENDUM', 'BRIEFING_DOCUMENT', 'DRAWING', 'OTHER'
);
create type extraction_status as enum ('PENDING', 'EXTRACTED', 'FAILED', 'NEEDS_REVIEW', 'NOT_APPLICABLE');

create type requirement_type as enum (
  'ELIGIBILITY', 'ADMINISTRATIVE', 'TECHNICAL', 'EXPERIENCE', 'FINANCIAL',
  'TAX', 'CSD', 'B_BBEE', 'COMPANY_REGISTRATION', 'CERTIFICATION', 'REFERENCE',
  'BRIEFING', 'PRICING', 'SUBMISSION', 'TEAM', 'CAPACITY', 'GEOGRAPHIC', 'LEGAL', 'OTHER'
);
-- Qualification status of a requirement against THIS agency's evidence.
-- Never defaulted to PASS; UNKNOWN is the safe default (Phase 2 §10,
-- docs/AI-ARCHITECTURE.md §1).
create type qualification_status as enum ('PASS', 'FAIL', 'UNKNOWN', 'REQUIRES_ACTION', 'NOT_APPLICABLE');
create type severity as enum ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

create type scoring_method as enum ('POINTS', 'PERCENTAGE', 'PASS_FAIL', 'RATIO', 'OTHER');

create type bid_decision as enum ('PRIORITY_BID', 'BID', 'REVIEW', 'CONDITIONAL', 'NO_BID', 'UNDECIDED');

create type risk_type as enum (
  'QUALIFICATION', 'COMPLIANCE', 'COMMERCIAL', 'DELIVERY', 'CAPACITY',
  'COMPETITION', 'DEADLINE', 'CONTRACT', 'PRICING', 'DOCUMENTATION', 'STRATEGIC', 'OTHER'
);
create type risk_status as enum ('OPEN', 'MITIGATED', 'ACCEPTED', 'CLOSED');

create type user_role as enum ('ADMIN', 'BID_MANAGER', 'RESEARCHER', 'WRITER', 'REVIEWER', 'VIEWER');

create type bid_project_status as enum ('DRAFTING', 'REVIEW', 'READY', 'SUBMITTED', 'WON', 'LOST', 'WITHDRAWN');
create type bid_section_status as enum ('EMPTY', 'DRAFTED', 'REVIEWED', 'APPROVED');
create type bid_review_status as enum ('OPEN', 'RESOLVED');
create type compliance_state as enum ('READY', 'BLOCKED');

create type evidence_type as enum ('CASE_STUDY', 'DOCUMENT', 'CERTIFICATE', 'TEAM_MEMBER', 'CLIENT_REFERENCE', 'POLICY', 'OTHER');

create type award_confidence as enum ('VERIFIED', 'ESTIMATED', 'INFERRED');

create type competitor_activity_type as enum ('BID_PARTICIPATION', 'AWARD', 'WITHDRAWAL', 'OTHER');

create type notification_event_type as enum (
  'NEW_RELEVANT_TENDER', 'CLOSING_SOON', 'COMPULSORY_BRIEFING', 'NEW_ADDENDUM',
  'QUALIFICATION_BLOCKER', 'SCORE_CHANGE', 'BID_REVIEW', 'COMPLIANCE_BLOCKER', 'AWARD_OUTCOME'
);
create type notification_channel as enum ('IN_APP', 'EMAIL');

create type actor_type as enum ('USER', 'SYSTEM', 'AGENT');
