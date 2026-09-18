import type { AgencyEvidenceRef, RuleResult, TenderEvidenceRef } from '../types.js'
import { compareDates } from './date.js'

export interface BriefingRuleInput {
  mandatory: boolean
  briefingRequired: boolean | null
  /** UTC ISO 8601. */
  briefingDate: string | null
  /** UTC ISO 8601, passed by caller. */
  now: string
  attendance: 'ATTENDED' | 'NOT_ATTENDED' | 'UNKNOWN'
  /** Only true when the tender's own rules explicitly make non-attendance disqualifying AND evidence establishes non-attendance (Phase 8 §20) — this module never assumes that on its own. */
  nonAttendanceEstablishedAsDisqualifying: boolean
  agencyEvidence: AgencyEvidenceRef[]
  tenderEvidence: TenderEvidenceRef[]
}

/**
 * BRIEFING rule (Phase 8 §20): compulsory briefing attendance.
 *  - briefing_required=true and date in the future -> REQUIRES_ACTION
 *    ("attend the briefing").
 *  - briefing already occurred, no attendance evidence -> UNKNOWN,
 *    UNLESS the tender's rules explicitly make non-attendance
 *    disqualifying AND evidence establishes non-attendance.
 *  - attendance confirmed -> PASS.
 */
export function evaluateBriefingRule(input: BriefingRuleInput): RuleResult {
  const { mandatory, briefingRequired, briefingDate, now, attendance, nonAttendanceEstablishedAsDisqualifying, agencyEvidence, tenderEvidence } = input
  const base = { mandatory, agencyEvidence, tenderEvidence, evaluatedBy: 'DETERMINISTIC_RULE' as const, confidence: null }

  if (briefingRequired === null) {
    return { ...base, status: 'UNKNOWN', explanation: 'Whether a briefing is compulsory for this tender could not be determined.', requiresHumanReview: false, actions: [] }
  }
  if (!briefingRequired) {
    return { ...base, status: 'PASS', explanation: 'No compulsory briefing is required for this tender.', requiresHumanReview: false, actions: [] }
  }

  if (attendance === 'ATTENDED') {
    return { ...base, status: 'PASS', explanation: 'Compulsory briefing attendance is confirmed.', requiresHumanReview: false, actions: [] }
  }

  if (attendance === 'NOT_ATTENDED' && nonAttendanceEstablishedAsDisqualifying) {
    return { ...base, status: 'FAIL', explanation: 'Non-attendance of the compulsory briefing is confirmed and the tender rules establish this as disqualifying.', requiresHumanReview: false, actions: [] }
  }

  if (briefingDate) {
    const cmp = compareDates(briefingDate, now)
    if (cmp !== null && cmp > 0) {
      return {
        ...base,
        status: 'REQUIRES_ACTION',
        explanation: `A compulsory briefing is scheduled for ${briefingDate}, which has not yet occurred.`,
        requiresHumanReview: false,
        actions: [{ description: 'Attend the compulsory briefing.', priority: mandatory ? 'CRITICAL' : 'HIGH', dueDate: briefingDate }],
      }
    }
  }

  // Briefing already occurred (or date unknown) with no attendance
  // evidence and no established disqualification — UNKNOWN, never
  // auto-FAIL (Phase 8 §20).
  return {
    ...base,
    status: 'UNKNOWN',
    explanation: 'A compulsory briefing appears to have occurred, but there is no verified record of this agency\'s attendance.',
    requiresHumanReview: true,
    actions: [],
  }
}
