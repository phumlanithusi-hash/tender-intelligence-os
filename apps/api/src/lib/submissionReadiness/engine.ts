import type { SubmissionComplianceCategory, SubmissionReadinessStatus } from '@tender-os/constants'
import { SUBMISSION_COMPLIANCE_CATEGORY } from '@tender-os/constants'
import { calculateDeadlineState } from './deadline.js'
import type { SubmissionCategorySummary, SubmissionReadinessInput, SubmissionReadinessItem, SubmissionReadinessResult } from './types.js'

/**
 * Phase 15 §8/§9/§10/§11 — the FINAL COMPLIANCE ENGINE. PURE, zero-I/O
 * (no database, network, or OpenAI calls — spec §8 binding
 * constraint), fully deterministic: the same input always produces
 * the same output. Never decides Bid/No-Bid, never touches Bid
 * Strategy, never edits Approved Evidence (Phase 15 §3 authoritative
 * decision boundary) — it answers exactly one question: given the
 * current bid decision and all available bid artifacts, is this
 * package ready to submit?
 *
 * Precedence is always BLOCKED > REQUIRES_REVIEW > READY_TO_SUBMIT
 * (spec §10/§11 binding constraint), mirroring
 * lib/proposals/compliance.ts and lib/bidStrategy/readiness.ts
 * exactly: a package can be arbitrarily complete and still BLOCKED by
 * a single mandatory unresolved issue. UNKNOWN is never silently
 * treated as a failure (§12) — it becomes REQUIRES_REVIEW unless the
 * tender explicitly proves a mandatory item is missing/invalid/expired,
 * in which case it is a hard BLOCKER (§11).
 */
export function calculateSubmissionReadiness(input: SubmissionReadinessInput): SubmissionReadinessResult {
  const items: SubmissionReadinessItem[] = []

  const blocker = (category: SubmissionComplianceCategory, code: string, message: string, sourceType: string | null = null, sourceId: string | null = null) =>
    items.push({ category, severity: 'BLOCKER', code, message, sourceType, sourceId })
  const warning = (category: SubmissionComplianceCategory, code: string, message: string, sourceType: string | null = null, sourceId: string | null = null) =>
    items.push({ category, severity: 'WARNING', code, message, sourceType, sourceId })
  const info = (category: SubmissionComplianceCategory, code: string, message: string, sourceType: string | null = null, sourceId: string | null = null) =>
    items.push({ category, severity: 'INFO', code, message, sourceType, sourceId })

  // --- 1. QUALIFICATION (Phase 15 §3/§13) — the authoritative Phase 11 decision, never re-decided here. ---
  if (input.qualification.finalBidDecision === 'NO_BID') {
    blocker('QUALIFICATION', 'BID_DECISION_IS_NO_BID', 'The authoritative Bid/No-Bid decision (Phase 11) is NO_BID; a submission package cannot be readied.')
  } else if (input.qualification.finalBidDecision === null) {
    warning('QUALIFICATION', 'BID_DECISION_UNKNOWN', 'No authoritative Bid/No-Bid decision was found for this bid project.')
  }

  // --- 2. MANDATORY_REQUIREMENTS + final requirement reconciliation (Phase 15 §13/§14). ---
  for (const req of input.requirements) {
    switch (req.status) {
      case 'MISSING':
      case 'BLOCKED':
        if (req.mandatory) blocker('MANDATORY_REQUIREMENTS', 'MANDATORY_REQUIREMENT_UNRESOLVED', `Mandatory requirement is ${req.status.toLowerCase()}: ${req.description}`, 'TENDER_REQUIREMENT', req.id)
        else warning('MANDATORY_REQUIREMENTS', 'REQUIREMENT_UNRESOLVED', `Requirement is ${req.status.toLowerCase()}: ${req.description}`, 'TENDER_REQUIREMENT', req.id)
        break
      case 'PARTIALLY_SATISFIED':
        if (req.mandatory) warning('MANDATORY_REQUIREMENTS', 'MANDATORY_REQUIREMENT_PARTIAL', `Mandatory requirement is only partially satisfied: ${req.description}`, 'TENDER_REQUIREMENT', req.id)
        break
      case 'REQUIRES_REVIEW':
        warning('MANDATORY_REQUIREMENTS', 'REQUIREMENT_REQUIRES_REVIEW', `Requirement status is unknown and requires human review: ${req.description}`, 'TENDER_REQUIREMENT', req.id)
        break
      case 'SATISFIED':
      case 'NOT_APPLICABLE':
        break
    }
  }

  // --- 3. EVALUATION_COVERAGE (Phase 15 §15). ---
  for (const c of input.evaluationCriteria) {
    if (!c.covered) {
      if (c.mandatoryCoverage) blocker('EVALUATION_COVERAGE', 'MANDATORY_EVALUATION_CRITERION_UNCOVERED', 'An evaluation criterion the tender makes mandatory has no proposal coverage.', 'EVALUATION_CRITERION', c.id)
      else warning('EVALUATION_COVERAGE', 'EVALUATION_CRITERION_UNCOVERED', 'An evaluation criterion has no proposal coverage.', 'EVALUATION_CRITERION', c.id)
    }
  }

  // --- 4. BRIEFING (Phase 15 §25) — never infer attendance. ---
  for (const b of input.briefings) {
    if (!b.mandatory) continue
    if (b.attended === false) blocker('BRIEFING', 'COMPULSORY_BRIEFING_MISSED', 'A compulsory briefing was explicitly missed.', 'TENDER_BRIEFING', b.id)
    else if (b.attended === null || !b.attendanceRecorded) warning('BRIEFING', 'BRIEFING_ATTENDANCE_UNKNOWN', 'A compulsory briefing exists and attendance has not been confirmed.', 'TENDER_BRIEFING', b.id)
  }

  // --- 5. ADDENDA (Phase 15 §26) — never silently assume the proposal remains valid. ---
  for (const a of input.addenda) {
    if (a.acknowledgementRequired && !a.acknowledged) {
      blocker('ADDENDA', 'REQUIRED_ADDENDUM_NOT_ACKNOWLEDGED', `Addendum ${a.addendumNumber} requires acknowledgement and has not been acknowledged.`, 'TENDER_ADDENDUM', a.id)
    }
    if (a.isMaterial && !a.reconciled) {
      if (a.acknowledgementRequired) blocker('ADDENDA', 'MATERIAL_ADDENDUM_UNRECONCILED', `Addendum ${a.addendumNumber} is material and has not been reconciled against the current proposal/pricing/evidence.`, 'TENDER_ADDENDUM', a.id)
      else warning('ADDENDA', 'MATERIAL_ADDENDUM_UNRECONCILED_REVIEW', `Addendum ${a.addendumNumber} is material and has not yet been reconciled.`, 'TENDER_ADDENDUM', a.id)
    }
  }

  // --- 6. PROPOSAL (Phase 15 §17). ---
  if (!input.proposal.exists) {
    blocker('PROPOSAL', 'PROPOSAL_MISSING', 'No proposal exists for this bid project.')
  } else {
    if (!input.proposal.matchesTender || !input.proposal.matchesBidProject) {
      blocker('PROPOSAL', 'PROPOSAL_IDENTITY_MISMATCH', 'The proposal does not match this tender/bid project.', 'PROPOSAL_VERSION', input.proposal.versionId)
    }
    if (!input.proposal.isCurrentVersion) {
      warning('PROPOSAL', 'PROPOSAL_NOT_CURRENT_VERSION', 'The proposal version being checked is not the current version.', 'PROPOSAL_VERSION', input.proposal.versionId)
    }
    if (input.proposal.isStale) {
      blocker('PROPOSAL', 'PROPOSAL_STALE', input.proposal.staleReason ?? 'The proposal is stale relative to upstream changes (tender, addendum, strategy or evidence) and has not been reconciled.', 'PROPOSAL_VERSION', input.proposal.versionId)
    }
    if (input.proposal.complianceResult === 'BLOCKED') {
      blocker('PROPOSAL', 'PROPOSAL_COMPLIANCE_BLOCKED', 'The Phase 14 proposal compliance engine reports this proposal as BLOCKED.', 'PROPOSAL_VERSION', input.proposal.versionId)
    } else if (input.proposal.complianceResult === 'REQUIRES_REVIEW') {
      warning('PROPOSAL', 'PROPOSAL_COMPLIANCE_REQUIRES_REVIEW', 'The Phase 14 proposal compliance engine reports this proposal as REQUIRES_REVIEW.', 'PROPOSAL_VERSION', input.proposal.versionId)
    } else if (input.proposal.complianceResult === null) {
      warning('PROPOSAL', 'PROPOSAL_COMPLIANCE_UNKNOWN', 'No Phase 14 proposal compliance result has been computed yet.', 'PROPOSAL_VERSION', input.proposal.versionId)
    }
    for (const missing of input.proposal.missingRequiredSections) {
      blocker('PROPOSAL', 'REQUIRED_PROPOSAL_SECTION_MISSING', `Required proposal section is missing: ${missing}.`, 'PROPOSAL_VERSION', input.proposal.versionId)
    }
  }

  // --- 7. EVIDENCE (Phase 15 §16) — only APPROVED+CURRENT evidence satisfies a final need. ---
  for (const e of input.evidence) {
    if (e.lifecycle === 'APPROVED_CURRENT') continue
    if (e.lifecycle === 'REJECTED') {
      blocker('EVIDENCE', 'REJECTED_EVIDENCE_USED', 'Evidence attached to this package was REJECTED and cannot support a final claim.', 'EVIDENCE', e.id)
    } else if (e.lifecycle === 'APPROVED_STALE' || e.lifecycle === 'SUPERSEDED') {
      if (e.mandatory) blocker('EVIDENCE', 'STALE_MANDATORY_EVIDENCE', 'Mandatory evidence is stale or superseded and must be re-verified.', 'EVIDENCE', e.id)
      else warning('EVIDENCE', 'STALE_EVIDENCE', 'Evidence is stale or superseded.', 'EVIDENCE', e.id)
    } else {
      // CANDIDATE_OR_UNVERIFIED
      if (e.mandatory) blocker('EVIDENCE', 'MANDATORY_EVIDENCE_MISSING', 'Mandatory evidence has not been approved (still a candidate or unverified).', 'EVIDENCE', e.id)
      else warning('EVIDENCE', 'EVIDENCE_NOT_YET_APPROVED', 'Evidence has not yet been approved.', 'EVIDENCE', e.id)
    }
  }

  // --- 8. PRICING (Phase 15 §18/§19) — deterministic arithmetic only. ---
  if (input.pricing.required && !input.pricing.provided) {
    blocker('PRICING', 'PRICING_MISSING', 'The tender requires pricing and none has been provided.')
  } else if (input.pricing.provided) {
    if (input.pricing.required && !input.pricing.currencyPresent) {
      blocker('PRICING', 'PRICING_CURRENCY_MISSING', 'Pricing is required to declare a currency and none is present.')
    }
    if (input.pricing.mandatoryScheduleRequired && !input.pricing.mandatorySchedulePresent) {
      blocker('PRICING', 'MANDATORY_PRICING_SCHEDULE_MISSING', 'The tender requires a prescribed pricing schedule (e.g. BOQ) and it is not attached.')
    }
    for (const line of input.pricing.lines) {
      if (!line.quantityValid || !line.unitPriceValid) {
        blocker('PRICING', 'PRICING_LINE_INVALID', `Pricing line "${line.description}" has an invalid quantity or unit price.`, 'PRICING_ITEM', line.id)
      } else if (!line.totalMatchesArithmetic) {
        blocker('PRICING', 'PRICING_ARITHMETIC_MISMATCH', `Pricing line "${line.description}" total does not match quantity × unit price.`, 'PRICING_ITEM', line.id)
      } else if (!line.currencyPresent && !input.pricing.required) {
        warning('PRICING', 'PRICING_LINE_CURRENCY_MISSING', `Pricing line "${line.description}" has no currency set.`, 'PRICING_ITEM', line.id)
      }
    }
  }

  // --- 9. MANDATORY_DOCUMENTS (Phase 15 §20/§21). ---
  for (const doc of input.documents) {
    if (doc.status === 'NOT_REQUIRED') continue
    if (doc.status === 'MISSING' || doc.status === 'INVALID') {
      if (doc.required) blocker('MANDATORY_DOCUMENTS', 'MANDATORY_DOCUMENT_MISSING_OR_INVALID', `Required document "${doc.name}" is ${doc.status.toLowerCase()}.`, 'AGENCY_DOCUMENT', doc.id)
      else warning('MANDATORY_DOCUMENTS', 'OPTIONAL_DOCUMENT_MISSING', `Optional document "${doc.name}" is missing.`, 'AGENCY_DOCUMENT', doc.id)
    } else if (doc.status === 'EXPIRED') {
      blocker('MANDATORY_DOCUMENTS', 'REQUIRED_DOCUMENT_EXPIRED', `Required document "${doc.name}" has expired.`, 'AGENCY_DOCUMENT', doc.id)
    } else if (doc.status === 'REQUIRES_REVIEW') {
      warning('MANDATORY_DOCUMENTS', 'DOCUMENT_REQUIRES_REVIEW', `Document "${doc.name}" status could not be verified.`, 'AGENCY_DOCUMENT', doc.id)
    }
  }

  // --- 10. FORMS (Phase 15 §23). ---
  for (const form of input.forms) {
    if (!form.required) continue
    if (!form.attached) {
      blocker('FORMS', 'MANDATORY_FORM_MISSING', `Required form "${form.name}" is missing.`, 'FORM', form.id)
    } else if (form.completed === false) {
      blocker('FORMS', 'MANDATORY_FORM_INCOMPLETE', `Required form "${form.name}" is present but not completed.`, 'FORM', form.id)
    } else if (form.signed === false) {
      blocker('SIGNATURES', 'MANDATORY_FORM_UNSIGNED', `Required form "${form.name}" is present but not signed.`, 'FORM', form.id)
    } else if (form.completed === null || form.signed === null) {
      warning('FORMS', 'FORM_COMPLETION_UNVERIFIABLE', `Required form "${form.name}" completion/signature status could not be verified.`, 'FORM', form.id)
    }
  }

  // --- 11. CERTIFICATES (Phase 15 §22). ---
  for (const cert of input.certificates) {
    if (!cert.required) continue
    if (cert.status === 'MISSING') blocker('CERTIFICATES', 'REQUIRED_CERTIFICATE_MISSING', `Required certificate "${cert.name}" is missing.`, 'CERTIFICATE', cert.id)
    else if (cert.status === 'EXPIRED') blocker('CERTIFICATES', 'REQUIRED_CERTIFICATE_EXPIRED', `Required certificate "${cert.name}" has expired.`, 'CERTIFICATE', cert.id)
    else if (cert.status === 'UNKNOWN') warning('CERTIFICATES', 'CERTIFICATE_STATUS_UNKNOWN', `Required certificate "${cert.name}" status is unknown and requires review.`, 'CERTIFICATE', cert.id)
  }

  // --- 12. SIGNATURES (Phase 15 §24). ---
  for (const sig of input.signatures) {
    if (sig.status === 'MISSING') blocker('SIGNATURES', 'REQUIRED_SIGNATURE_MISSING', `Required signature "${sig.name}" is missing.`, 'SIGNATURE', sig.id)
    else if (sig.status === 'REQUIRES_REVIEW') warning('SIGNATURES', 'SIGNATURE_REQUIRES_REVIEW', `Signature "${sig.name}" requires human review.`, 'SIGNATURE', sig.id)
  }

  // --- 13/14/15. FILE_FORMATS / FILE_NAMES / FILE_SIZES (Phase 15 §30/§31). ---
  for (const file of input.files) {
    if (file.required && !file.exists) {
      blocker('FILE_FORMATS', 'REQUIRED_FILE_MISSING', `Required file "${file.fileName}" does not exist.`, 'FILE', file.id)
      continue
    }
    if (file.formatValid === false) blocker('FILE_FORMATS', 'INVALID_FILE_FORMAT', `File "${file.fileName}" is not in an accepted format.`, 'FILE', file.id)
    if (file.sizeValid === false) blocker('FILE_SIZES', 'FILE_TOO_LARGE', `File "${file.fileName}" exceeds the tender's maximum file size.`, 'FILE', file.id)
    if (file.nameResult === 'DOES_NOT_MATCH_CONVENTION') blocker('FILE_NAMES', 'INVALID_FILE_NAME', `File "${file.fileName}" does not match the required naming convention.`, 'FILE', file.id)
    // NO_NAMING_RULE never blocks (§31 binding constraint) — no item raised.
  }

  // --- 16. SUBMISSION_METHOD (Phase 15 §29). ---
  if (input.submissionMethod.method === null || input.submissionMethod.method === 'UNKNOWN') {
    warning('SUBMISSION_METHOD', 'SUBMISSION_METHOD_UNKNOWN', 'The tender submission method could not be determined.')
  } else if (!input.submissionMethod.instructionsKnown) {
    blocker('SUBMISSION_METHOD', 'SUBMISSION_METHOD_INSTRUCTIONS_UNRESOLVED', 'The submission method is known but mandatory submission instructions (URL/email/address/naming/format) are not.')
  }

  // --- 17. DEADLINE (Phase 15 §27/§28) — server time only, never browser time. ---
  const deadline = calculateDeadlineState(input.nowIso, input.tenderClosingDate, input.tenderClosingTime)
  if (deadline.state === 'CLOSED') {
    blocker('DEADLINE', 'SUBMISSION_DEADLINE_PASSED', 'The tender submission deadline has passed.')
  } else if (deadline.state === 'UNKNOWN') {
    warning('DEADLINE', 'SUBMISSION_DEADLINE_UNKNOWN', 'The tender closing date/time could not be determined.')
  } else if (deadline.warning !== 'NONE') {
    info('DEADLINE', `DEADLINE_${deadline.warning}`, `The tender is ${deadline.warning.replace(/_/g, ' ').toLowerCase()}.`)
  }

  // --- Precedence (Phase 15 §10/§11 binding constraint): BLOCKED > REQUIRES_REVIEW > READY_TO_SUBMIT. ---
  const blockerCount = items.filter((i) => i.severity === 'BLOCKER').length
  const warningCount = items.filter((i) => i.severity === 'WARNING').length
  let status: SubmissionReadinessStatus
  if (blockerCount > 0) status = 'BLOCKED'
  else if (warningCount > 0) status = 'REQUIRES_REVIEW'
  else status = 'READY_TO_SUBMIT'

  const categorySummary = Object.fromEntries(
    SUBMISSION_COMPLIANCE_CATEGORY.map((category) => {
      const forCategory = items.filter((i) => i.category === category)
      const summary: SubmissionCategorySummary = {
        blockers: forCategory.filter((i) => i.severity === 'BLOCKER').length,
        warnings: forCategory.filter((i) => i.severity === 'WARNING').length,
        info: forCategory.filter((i) => i.severity === 'INFO').length,
      }
      return [category, summary]
    }),
  ) as Record<SubmissionComplianceCategory, SubmissionCategorySummary>

  return { status, items, categorySummary, deadline, blockerCount, warningCount }
}
