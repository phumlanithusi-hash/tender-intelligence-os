import { describe, expect, it } from 'vitest'
import { calculateSubmissionReadiness } from '../engine.js'
import { readyBaseline } from './fixtures.js'

/**
 * Phase 15 §57 — 36 engine tests. Mirrors the fixture-clone-and-flip
 * pattern from lib/bidDecision/__tests__/evaluateBidDecision.test.ts.
 */
describe('calculateSubmissionReadiness (Phase 15 §8-§11)', () => {
  it('a fully satisfied package is READY_TO_SUBMIT with zero blockers/warnings', () => {
    const result = calculateSubmissionReadiness(readyBaseline())
    expect(result.status).toBe('READY_TO_SUBMIT')
    expect(result.blockerCount).toBe(0)
    expect(result.warningCount).toBe(0)
  })

  it('a mandatory requirement MISSING is a hard blocker', () => {
    const input = readyBaseline()
    input.requirements[0]!.status = 'MISSING'
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.items.some((i) => i.code === 'MANDATORY_REQUIREMENT_UNRESOLVED')).toBe(true)
  })

  it('an optional (non-mandatory) requirement missing is only a warning', () => {
    const input = readyBaseline()
    input.requirements.push({ id: 'req-2', mandatory: false, status: 'MISSING', description: 'Nice-to-have' })
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('REQUIRES_REVIEW')
    expect(result.items.some((i) => i.code === 'REQUIREMENT_UNRESOLVED' && i.severity === 'WARNING')).toBe(true)
  })

  it('an UNKNOWN/REQUIRES_REVIEW requirement state is REQUIRES_REVIEW, never an automatic failure', () => {
    const input = readyBaseline()
    input.requirements[0]!.status = 'REQUIRES_REVIEW'
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('REQUIRES_REVIEW')
  })

  it('a covered evaluation criterion contributes no items', () => {
    const result = calculateSubmissionReadiness(readyBaseline())
    expect(result.items.filter((i) => i.category === 'EVALUATION_COVERAGE')).toHaveLength(0)
  })

  it('an uncovered, non-mandatory evaluation criterion is a warning', () => {
    const input = readyBaseline()
    input.evaluationCriteria[0]!.covered = false
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('REQUIRES_REVIEW')
    expect(result.items.some((i) => i.code === 'EVALUATION_CRITERION_UNCOVERED')).toBe(true)
  })

  it('an uncovered evaluation criterion the tender makes mandatory is a hard blocker', () => {
    const input = readyBaseline()
    input.evaluationCriteria[0]!.covered = false
    input.evaluationCriteria[0]!.mandatoryCoverage = true
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.items.some((i) => i.code === 'MANDATORY_EVALUATION_CRITERION_UNCOVERED')).toBe(true)
  })

  it('mandatory evaluation criterion evidence-missing style blocker composes with other categories independently', () => {
    const input = readyBaseline()
    input.evaluationCriteria[0]!.covered = false
    input.evaluationCriteria[0]!.mandatoryCoverage = true
    input.requirements[0]!.status = 'MISSING'
    const result = calculateSubmissionReadiness(input)
    expect(result.categorySummary.EVALUATION_COVERAGE.blockers).toBe(1)
    expect(result.categorySummary.MANDATORY_REQUIREMENTS.blockers).toBe(1)
  })

  it('APPROVED_CURRENT evidence satisfies a final requirement with no items raised', () => {
    const result = calculateSubmissionReadiness(readyBaseline())
    expect(result.items.filter((i) => i.category === 'EVIDENCE')).toHaveLength(0)
  })

  it('APPROVED_STALE mandatory evidence is a hard blocker', () => {
    const input = readyBaseline()
    input.evidence[0]!.lifecycle = 'APPROVED_STALE'
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.items.some((i) => i.code === 'STALE_MANDATORY_EVIDENCE')).toBe(true)
  })

  it('REJECTED evidence used in the package is always a hard blocker regardless of mandatory flag', () => {
    const input = readyBaseline()
    input.evidence[0]!.mandatory = false
    input.evidence[0]!.lifecycle = 'REJECTED'
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.items.some((i) => i.code === 'REJECTED_EVIDENCE_USED')).toBe(true)
  })

  it('an unsupported claim (mandatory candidate/unverified evidence) blocks', () => {
    const input = readyBaseline()
    input.evidence[0]!.lifecycle = 'CANDIDATE_OR_UNVERIFIED'
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.items.some((i) => i.code === 'MANDATORY_EVIDENCE_MISSING')).toBe(true)
  })

  it('a stale proposal (relative to upstream changes) is a hard blocker', () => {
    const input = readyBaseline()
    input.proposal.isStale = true
    input.proposal.staleReason = 'Tender addendum published after this version.'
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.items.some((i) => i.code === 'PROPOSAL_STALE')).toBe(true)
  })

  it('a material unreconciled addendum requiring acknowledgement blocks', () => {
    const input = readyBaseline()
    input.addenda.push({ id: 'add-1', addendumNumber: 1, isMaterial: true, acknowledgementRequired: true, acknowledged: false, reconciled: false })
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.items.some((i) => i.code === 'REQUIRED_ADDENDUM_NOT_ACKNOWLEDGED')).toBe(true)
  })

  it('a material addendum with no explicit acknowledgement requirement, unreconciled, is REQUIRES_REVIEW not BLOCKED', () => {
    const input = readyBaseline()
    input.addenda.push({ id: 'add-2', addendumNumber: 2, isMaterial: true, acknowledgementRequired: false, acknowledged: false, reconciled: false })
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('REQUIRES_REVIEW')
    expect(result.items.some((i) => i.code === 'MATERIAL_ADDENDUM_UNRECONCILED_REVIEW')).toBe(true)
  })

  it('a compulsory briefing that was attended raises no items', () => {
    const input = readyBaseline()
    input.briefings.push({ id: 'brief-1', mandatory: true, attended: true, attendanceRecorded: true })
    const result = calculateSubmissionReadiness(input)
    expect(result.items.filter((i) => i.category === 'BRIEFING')).toHaveLength(0)
  })

  it('a compulsory briefing explicitly missed is a hard blocker', () => {
    const input = readyBaseline()
    input.briefings.push({ id: 'brief-2', mandatory: true, attended: false, attendanceRecorded: true })
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.items.some((i) => i.code === 'COMPULSORY_BRIEFING_MISSED')).toBe(true)
  })

  it('a compulsory briefing with unknown attendance is REQUIRES_REVIEW, never inferred as attended or missed', () => {
    const input = readyBaseline()
    input.briefings.push({ id: 'brief-3', mandatory: true, attended: null, attendanceRecorded: false })
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('REQUIRES_REVIEW')
    expect(result.items.some((i) => i.code === 'BRIEFING_ATTENDANCE_UNKNOWN')).toBe(true)
  })

  it('complete pricing with matching arithmetic raises no items', () => {
    const result = calculateSubmissionReadiness(readyBaseline())
    expect(result.items.filter((i) => i.category === 'PRICING')).toHaveLength(0)
  })

  it('required pricing not provided is a hard blocker', () => {
    const input = readyBaseline()
    input.pricing.provided = false
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.items.some((i) => i.code === 'PRICING_MISSING')).toBe(true)
  })

  it('a pricing line total that does not match quantity x unit price is a hard blocker (deterministic arithmetic)', () => {
    const input = readyBaseline()
    input.pricing.lines[0]!.totalMatchesArithmetic = false
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.items.some((i) => i.code === 'PRICING_ARITHMETIC_MISMATCH')).toBe(true)
  })

  it('a mandatory document present and verified raises no items', () => {
    const result = calculateSubmissionReadiness(readyBaseline())
    expect(result.items.filter((i) => i.category === 'MANDATORY_DOCUMENTS')).toHaveLength(0)
  })

  it('a mandatory document missing is a hard blocker', () => {
    const input = readyBaseline()
    input.documents[0]!.status = 'MISSING'
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.items.some((i) => i.code === 'MANDATORY_DOCUMENT_MISSING_OR_INVALID')).toBe(true)
  })

  it('an optional document missing is only a warning', () => {
    const input = readyBaseline()
    input.documents.push({ id: 'doc-2', name: 'Optional case study', required: false, status: 'MISSING' })
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('REQUIRES_REVIEW')
    expect(result.items.some((i) => i.code === 'OPTIONAL_DOCUMENT_MISSING')).toBe(true)
  })

  it('a required certificate that has expired is a hard blocker', () => {
    const input = readyBaseline()
    input.certificates[0]!.status = 'EXPIRED'
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.items.some((i) => i.code === 'REQUIRED_CERTIFICATE_EXPIRED')).toBe(true)
  })

  it('a required certificate that is missing is a hard blocker', () => {
    const input = readyBaseline()
    input.certificates[0]!.status = 'MISSING'
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.items.some((i) => i.code === 'REQUIRED_CERTIFICATE_MISSING')).toBe(true)
  })

  it('a required form that is missing is a hard blocker', () => {
    const input = readyBaseline()
    input.forms[0]!.attached = false
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.items.some((i) => i.code === 'MANDATORY_FORM_MISSING')).toBe(true)
  })

  it('a required signature that is missing is a hard blocker', () => {
    const input = readyBaseline()
    input.signatures[0]!.status = 'MISSING'
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.items.some((i) => i.code === 'REQUIRED_SIGNATURE_MISSING')).toBe(true)
  })

  it('an invalid required file format is a hard blocker', () => {
    const input = readyBaseline()
    input.files[0]!.formatValid = false
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.items.some((i) => i.code === 'INVALID_FILE_FORMAT')).toBe(true)
  })

  it('a file exceeding the maximum size is a hard blocker', () => {
    const input = readyBaseline()
    input.files[0]!.sizeValid = false
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.items.some((i) => i.code === 'FILE_TOO_LARGE')).toBe(true)
  })

  it('an invalid file name against a declared naming convention is a hard blocker', () => {
    const input = readyBaseline()
    input.files[0]!.nameResult = 'DOES_NOT_MATCH_CONVENTION'
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.items.some((i) => i.code === 'INVALID_FILE_NAME')).toBe(true)
  })

  it('NO_NAMING_RULE never blocks (no naming convention exists for this tender)', () => {
    const result = calculateSubmissionReadiness(readyBaseline())
    expect(result.items.filter((i) => i.code === 'INVALID_FILE_NAME')).toHaveLength(0)
  })

  it('a known submission method with known instructions raises no items', () => {
    const result = calculateSubmissionReadiness(readyBaseline())
    expect(result.items.filter((i) => i.category === 'SUBMISSION_METHOD')).toHaveLength(0)
  })

  it('an unknown submission method is only a warning, never invented', () => {
    const input = readyBaseline()
    input.submissionMethod = { method: null, instructionsKnown: false }
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('REQUIRES_REVIEW')
    expect(result.items.some((i) => i.code === 'SUBMISSION_METHOD_UNKNOWN')).toBe(true)
  })

  it('a deadline that is still open raises no deadline items', () => {
    const result = calculateSubmissionReadiness(readyBaseline())
    expect(result.items.filter((i) => i.category === 'DEADLINE')).toHaveLength(0)
    expect(result.deadline.state).toBe('OPEN')
  })

  it('a deadline closing within 72 hours is informational only, never blocking', () => {
    const input = readyBaseline()
    input.nowIso = '2026-09-29T10:00:00Z' // closing 2026-10-01T12:00:00Z, ~50h away
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('READY_TO_SUBMIT')
    expect(result.deadline.state).toBe('CLOSING_SOON')
  })

  it('a deadline that has passed is always a hard blocker regardless of everything else being satisfied', () => {
    const input = readyBaseline()
    input.nowIso = '2026-10-02T00:00:00Z'
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.deadline.state).toBe('CLOSED')
    expect(result.items.some((i) => i.code === 'SUBMISSION_DEADLINE_PASSED')).toBe(true)
  })

  it('precedence: a single blocker overrides an otherwise all-green package (BLOCKED > REQUIRES_REVIEW > READY_TO_SUBMIT)', () => {
    const input = readyBaseline()
    input.documents.push({ id: 'doc-warn', name: 'Optional extra', required: false, status: 'MISSING' })
    input.certificates[0]!.status = 'MISSING'
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.blockerCount).toBeGreaterThan(0)
    expect(result.warningCount).toBeGreaterThan(0)
  })

  it('precedence: warnings alone (no blockers) yield REQUIRES_REVIEW, never READY_TO_SUBMIT', () => {
    const input = readyBaseline()
    input.certificates[0]!.status = 'UNKNOWN'
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('REQUIRES_REVIEW')
    expect(result.blockerCount).toBe(0)
  })

  it('a NO_BID authoritative decision always blocks readiness (Phase 15 never overrides Phase 11)', () => {
    const input = readyBaseline()
    input.qualification.finalBidDecision = 'NO_BID'
    const result = calculateSubmissionReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.items.some((i) => i.code === 'BID_DECISION_IS_NO_BID')).toBe(true)
  })
})
