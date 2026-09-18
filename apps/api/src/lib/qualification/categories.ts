import { QUALIFICATION_CATEGORY, type QualificationCategory } from '@tender-os/constants'

/**
 * Category metadata (Phase 8 §5) — a configurable table, not hard-coded
 * UI-only logic. `defaultRuleType` is only a suggestion used when a
 * requirement has no explicit ruleType (e.g. a PROVISIONAL AI-derived
 * candidate) — evaluator.ts falls through to MANUAL_REVIEW when even
 * that is absent, never guessing a rule shape it cannot justify.
 */
export const QUALIFICATION_CATEGORY_LABELS: Record<QualificationCategory, string> = {
  CSD: 'Central Supplier Database registration',
  TAX: 'Tax compliance',
  B_BBEE: 'B-BBEE status',
  COMPANY_REGISTRATION: 'Company registration',
  YEARS_IN_BUSINESS: 'Years in business',
  TURNOVER: 'Annual turnover',
  RELEVANT_EXPERIENCE: 'Relevant experience',
  REFERENCES: 'References',
  PROFESSIONAL_REGISTRATION: 'Professional registration',
  CERTIFICATION: 'Certification',
  INSURANCE: 'Insurance',
  KEY_PERSONNEL: 'Key personnel',
  CAPACITY: 'Capacity',
  EQUIPMENT: 'Equipment',
  GEOGRAPHIC: 'Geographic requirement',
  COMPULSORY_BRIEFING: 'Compulsory briefing',
  JV_SUBCONTRACTING: 'Joint venture / subcontracting',
  FINANCIAL: 'Financial requirement',
  MANDATORY_FORM: 'Mandatory form',
  DECLARATION: 'Declaration',
  SIGNATURE: 'Signature',
  SUBMISSION: 'Submission requirement',
  OTHER: 'Other',
  UNKNOWN: 'Unclassified',
}

export function isKnownQualificationCategory(value: string): value is QualificationCategory {
  return (QUALIFICATION_CATEGORY as readonly string[]).includes(value)
}
