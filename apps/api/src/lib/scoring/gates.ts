import type { ScoringInput, ScoredGate } from './types.js'
import { findMandatoryQualificationFailureEvidence } from './dimensions/qualification.js'
import { findMandatoryRequirementFailureEvidence } from './dimensions/requirementCoverage.js'

/**
 * Hard gate layer (Phase 10 §29-§31). Every gate is evaluated and
 * recorded EVERY run — TRIGGERED, OK, or UNKNOWN — never omitted, so
 * "why isn't this BLOCKED" is answerable from the same record as "why is
 * this BLOCKED". A gate only reaches TRIGGERED from information actually
 * available (§29): an unknown compulsory-briefing attendance is UNKNOWN,
 * never a silent pass or a silent fail.
 *
 * Deadline handling (§30): tenders.closing_date/closing_time are stored
 * as a plain date/time with no timezone (Phase 2/5 convention,
 * unchanged) — this is intentionally treated as ALWAYS ambiguous
 * (`timezoneUnknown = true`), never assumed to be SAST or UTC. A tender
 * closing strictly before today (UTC calendar date) is CLOSED; a tender
 * closing today is left OPEN (benefit of the doubt) with the ambiguity
 * flagged, rather than guessed either way.
 *
 * CRITICAL_COMPLIANCE_FAILURE (§29): no distinct deterministic signal
 * exists in the current data model beyond what MANDATORY_QUALIFICATION_
 * FAILURE / MANDATORY_REQUIREMENT_FAILURE already capture — this gate is
 * always recorded as OK in this phase (documented limitation in
 * docs/SCORING-ENGINE.md, not a fabricated trigger condition).
 */
export function computeGates(input: ScoringInput): { gates: ScoredGate[]; deadlineStatus: 'OPEN' | 'CLOSED' | 'UNKNOWN'; timezoneUnknown: boolean } {
  const gates: ScoredGate[] = []

  // 1. MANDATORY_QUALIFICATION_FAILURE
  const qualEvidence = findMandatoryQualificationFailureEvidence(input.qualification)
  if (input.qualification.overallStatus === 'NOT_ELIGIBLE') {
    gates.push({ gateType: 'MANDATORY_QUALIFICATION_FAILURE', status: 'TRIGGERED', description: 'Overall qualification status is NOT_ELIGIBLE — at least one mandatory qualification requirement failed.', evidence: qualEvidence })
  } else if (input.qualification.overallStatus === null) {
    gates.push({ gateType: 'MANDATORY_QUALIFICATION_FAILURE', status: 'UNKNOWN', description: 'Qualification has not been evaluated yet.', evidence: [] })
  } else {
    gates.push({ gateType: 'MANDATORY_QUALIFICATION_FAILURE', status: 'OK', description: 'No mandatory qualification failure recorded.', evidence: [] })
  }

  // 2. MANDATORY_REQUIREMENT_FAILURE
  const { evidence: reqEvidence, descriptions } = findMandatoryRequirementFailureEvidence(input)
  if (descriptions.length > 0) {
    gates.push({ gateType: 'MANDATORY_REQUIREMENT_FAILURE', status: 'TRIGGERED', description: `Mandatory requirement(s) failed: ${descriptions.join('; ')}`, evidence: reqEvidence })
  } else {
    gates.push({ gateType: 'MANDATORY_REQUIREMENT_FAILURE', status: 'OK', description: 'No mandatory requirement failure recorded.', evidence: [] })
  }

  // 3. SUBMISSION_DEADLINE_PASSED
  const { closingDate } = input.deadline
  const timezoneUnknown = true // Phase 10 §30 — tenders.closing_date/closing_time carry no timezone; see module doc.
  let deadlineStatus: 'OPEN' | 'CLOSED' | 'UNKNOWN' = 'UNKNOWN'
  if (!closingDate) {
    gates.push({ gateType: 'SUBMISSION_DEADLINE_PASSED', status: 'UNKNOWN', description: 'Tender closing date is unknown.', evidence: [] })
  } else {
    const today = input.now.slice(0, 10)
    if (closingDate < today) {
      deadlineStatus = 'CLOSED'
      gates.push({ gateType: 'SUBMISSION_DEADLINE_PASSED', status: 'TRIGGERED', description: `Tender closing date (${closingDate}) has passed as of ${today}.`, evidence: [{ kind: 'RULE', rule: 'CLOSING_DATE_PASSED', description: null }] })
    } else {
      deadlineStatus = 'OPEN'
      gates.push({ gateType: 'SUBMISSION_DEADLINE_PASSED', status: 'OK', description: closingDate === today ? `Tender closes today (${closingDate}); exact time unknown (no timezone recorded).` : `Tender closes ${closingDate}.`, evidence: [] })
    }
  }

  // 4. COMPULSORY_BRIEFING_FAILURE
  if (input.briefing.required === true) {
    if (input.briefing.attendance === 'NOT_ATTENDED') {
      gates.push({ gateType: 'COMPULSORY_BRIEFING_FAILURE', status: 'TRIGGERED', description: 'Compulsory briefing attendance is confirmed as missed.', evidence: input.briefing.evidence })
    } else if (input.briefing.attendance === 'ATTENDED') {
      gates.push({ gateType: 'COMPULSORY_BRIEFING_FAILURE', status: 'OK', description: 'Compulsory briefing attendance is confirmed.', evidence: input.briefing.evidence })
    } else {
      gates.push({ gateType: 'COMPULSORY_BRIEFING_FAILURE', status: 'UNKNOWN', description: 'Briefing is compulsory but attendance has not been confirmed.', evidence: [] })
    }
  } else if (input.briefing.required === null) {
    gates.push({ gateType: 'COMPULSORY_BRIEFING_FAILURE', status: 'UNKNOWN', description: 'Whether a briefing is required is unknown.', evidence: [] })
  } else {
    gates.push({ gateType: 'COMPULSORY_BRIEFING_FAILURE', status: 'OK', description: 'No compulsory briefing applies to this tender.', evidence: [] })
  }

  // 5. CRITICAL_COMPLIANCE_FAILURE — see module doc; always OK in this phase.
  gates.push({ gateType: 'CRITICAL_COMPLIANCE_FAILURE', status: 'OK', description: 'No additional critical-compliance signal is modelled beyond the qualification/requirement gates above in this phase.', evidence: [] })

  return { gates, deadlineStatus, timezoneUnknown }
}
