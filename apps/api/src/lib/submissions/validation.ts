import { isDeadlinePassed } from './deadline.js'
import type { PreflightBlockCode, PreflightInput, PreflightResult } from './types.js'

/**
 * Phase 16 §10 — the deterministic PRE-SUBMISSION VALIDATION GATE. PURE,
 * zero-I/O: every fact this needs is already resolved by the caller.
 * Every one of the spec's five checklists (bid state / readiness /
 * pack / compliance / deadline) is evaluated, and EVERY blocker found
 * is returned — never short-circuited on the first — so the UI can
 * show a human the complete picture in one pass.
 */
export function runPreflightValidation(input: PreflightInput): PreflightResult {
  const blockers: PreflightBlockCode[] = []

  // --- Bid state ---
  if (!input.bidExists) blockers.push('BID_NOT_FOUND')
  if (input.bidExists && !input.bidBelongsToAgency) blockers.push('CROSS_AGENCY')
  if (input.finalBidDecision === 'NO_BID' && !input.humanOverrideToBid) blockers.push('NO_BID_DECISION')

  // --- Readiness / approval ---
  if (input.readinessStatus !== 'READY_TO_SUBMIT' && input.readinessStatus !== 'APPROVED_FOR_SUBMISSION') {
    blockers.push('READINESS_NOT_READY')
  }
  if (input.approvalStatus !== 'APPROVED') {
    blockers.push('NO_VALID_APPROVAL')
  } else if (!input.approvalReferencesCurrentPack || !input.approvalReferencesCurrentReadiness) {
    blockers.push('APPROVAL_STALE')
  }

  // --- Pack ---
  if (!input.packExists) blockers.push('PACK_MISSING')
  if (input.packExists && input.packSuperseded) blockers.push('PACK_SUPERSEDED')
  if (input.packExists && !input.packHashMatches) blockers.push('PACK_HASH_MISMATCH')
  if (input.packExists && !input.manifestHashMatches) blockers.push('MANIFEST_HASH_MISMATCH')
  if (input.packExists && !input.requiredFilesPresent) blockers.push('REQUIRED_FILES_MISSING')

  // --- Compliance ---
  if (input.hasMandatoryComplianceBlocker) blockers.push('MANDATORY_COMPLIANCE_BLOCKER')

  // --- Deadline (server-authoritative time only, §10/§53) ---
  if (isDeadlinePassed(input.nowIso, input.tenderClosingDate, input.tenderClosingTime)) blockers.push('DEADLINE_PASSED')

  // --- Duplicate protection (§22) ---
  if (input.hasExistingConfirmedSubmission && !input.explicitDuplicateOverride) blockers.push('DUPLICATE_SUBMISSION_RISK')

  return { allowed: blockers.length === 0, blockers }
}
