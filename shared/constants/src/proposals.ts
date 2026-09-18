/**
 * Phase 14 — Bid Proposal Generation & Document Assembly. Mirrors
 * evidenceMatching.ts/bidStrategy.ts exactly. RESEARCHER may draft
 * sections, attach evidence, and trigger AI generation ("draft") but
 * never review/approve/reject — the same view/generate/decide role
 * split Phase 13 established for evidence matches.
 */
export const PROPOSAL_VIEW_ROLES = ['ADMIN', 'BID_MANAGER', 'RESEARCHER'] as const
export const PROPOSAL_EDIT_ROLES = ['ADMIN', 'BID_MANAGER', 'RESEARCHER'] as const
export const PROPOSAL_REVIEW_ROLES = ['ADMIN', 'BID_MANAGER'] as const

export const PROPOSAL_STATUS = ['DRAFT', 'GENERATING', 'REQUIRES_REVIEW', 'IN_REVIEW', 'APPROVED_INTERNAL', 'BLOCKED', 'SUPERSEDED'] as const
export type ProposalStatus = (typeof PROPOSAL_STATUS)[number]

export const PROPOSAL_SECTION_TYPE = [
  'COVER',
  'EXECUTIVE_SUMMARY',
  'UNDERSTANDING_OF_REQUIREMENT',
  'APPROACH',
  'METHODOLOGY',
  'PROJECT_PLAN',
  'DELIVERABLES',
  'TEAM',
  'EXPERIENCE',
  'CASE_STUDIES',
  'TECHNICAL_RESPONSE',
  'CREATIVE_RESPONSE',
  'MEDIA_RESPONSE',
  'DIGITAL_RESPONSE',
  'QUALITY_ASSURANCE',
  'RISK_MANAGEMENT',
  'IMPLEMENTATION',
  'TIMELINE',
  'SOCIAL_VALUE',
  'LOCAL_CONTENT',
  'TRANSFORMATION',
  'SUSTAINABILITY',
  'GOVERNANCE',
  'REPORTING',
  'REFERENCES',
  'CREDENTIALS',
  'COMPLIANCE',
  'APPENDICES',
  'OTHER',
] as const
export type ProposalSectionType = (typeof PROPOSAL_SECTION_TYPE)[number]

export const PROPOSAL_SECTION_STATUS = ['DRAFT', 'AI_GENERATED', 'REQUIRES_REVIEW', 'IN_REVIEW', 'APPROVED_INTERNAL', 'REJECTED', 'STALE'] as const
export type ProposalSectionStatus = (typeof PROPOSAL_SECTION_STATUS)[number]

export const PROPOSAL_BLOCK_TYPE = [
  'HEADING',
  'PARAGRAPH',
  'BULLET_LIST',
  'NUMBERED_LIST',
  'TABLE',
  'CALLOUT',
  'QUOTE',
  'STAT',
  'IMAGE',
  'CASE_STUDY',
  'TEAM_MEMBER',
  'TIMELINE',
  'REQUIREMENT_RESPONSE',
  'EVIDENCE_REFERENCE',
  'PLACEHOLDER',
] as const
export type ProposalBlockType = (typeof PROPOSAL_BLOCK_TYPE)[number]

export const CONTENT_ORIGIN = ['AI_GENERATED', 'HUMAN_AUTHORED', 'AI_REVISED', 'IMPORTED'] as const
export type ContentOrigin = (typeof CONTENT_ORIGIN)[number]

export const CLAIM_SUPPORT_STATUS = ['SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED', 'REQUIRES_REVIEW'] as const
export type ClaimSupportStatus = (typeof CLAIM_SUPPORT_STATUS)[number]

/** Phase 14 §22 (binding constraint): precedence BLOCKED > REQUIRES_REVIEW > READY_FOR_INTERNAL_REVIEW, enforced in lib/proposals/compliance.ts, never in the DB. */
export const PROPOSAL_COMPLIANCE_RESULT = ['READY_FOR_INTERNAL_REVIEW', 'REQUIRES_REVIEW', 'BLOCKED'] as const
export type ProposalComplianceResult = (typeof PROPOSAL_COMPLIANCE_RESULT)[number]

export const PROPOSAL_COMPLIANCE_ISSUE_SEVERITY = ['BLOCKER', 'WARNING'] as const
export type ProposalComplianceIssueSeverity = (typeof PROPOSAL_COMPLIANCE_ISSUE_SEVERITY)[number]

export const PROPOSAL_GENERATION_STATUS = ['SUCCEEDED', 'FAILED', 'REJECTED_INVALID_OUTPUT', 'AI_UNAVAILABLE'] as const
export type ProposalGenerationStatus = (typeof PROPOSAL_GENERATION_STATUS)[number]

export const PROPOSAL_REQUIREMENT_COVERAGE = ['COVERED', 'PARTIAL', 'NOT_COVERED'] as const
export type ProposalRequirementCoverage = (typeof PROPOSAL_REQUIREMENT_COVERAGE)[number]

export const PROPOSAL_REVIEW_ACTION = ['REVIEWED', 'APPROVED', 'REJECTED'] as const
export type ProposalReviewAction = (typeof PROPOSAL_REVIEW_ACTION)[number]

export const PROPOSAL_MISSING_INFO_STATUS = ['OPEN', 'RESOLVED'] as const
export type ProposalMissingInfoStatus = (typeof PROPOSAL_MISSING_INFO_STATUS)[number]

export const PROPOSAL_DOCUMENT_FORMAT = ['DOCX', 'PDF'] as const
export type ProposalDocumentFormat = (typeof PROPOSAL_DOCUMENT_FORMAT)[number]

/** Phase 14 §14/§18 — the current generation contract/prompt version, bumped whenever the schema or prompt materially changes so generations remain reproducible/comparable across history. */
export const PROPOSAL_GENERATION_PROMPT_VERSION = 'proposal-section-v1'

/** Phase 14 §7 — the default blueprint always includes these section types when the tender has any content at all (cover + executive summary + compliance are near-universal); every other type is conditionally added by lib/proposals/blueprint.ts based on tender/strategy data. */
export const PROPOSAL_ALWAYS_INCLUDED_SECTION_TYPES: ProposalSectionType[] = ['COVER', 'EXECUTIVE_SUMMARY', 'COMPLIANCE']
