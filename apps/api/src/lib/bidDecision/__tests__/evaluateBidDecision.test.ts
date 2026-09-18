import { describe, it, expect } from 'vitest'
import { evaluateBidDecision } from '../evaluateBidDecision.js'
import { baseInput, policy } from './fixtures.js'

describe('evaluateBidDecision — Phase 11 §56 fixtures', () => {
  it('1. clear BID: eligible, high score/coverage/evidence, no blockers', () => {
    const result = evaluateBidDecision(baseInput(), policy)
    expect(result.decision).toBe('BID')
    expect(result.blockers).toHaveLength(0)
  })

  it('2. mandatory failure -> NO_BID regardless of an otherwise-perfect score (hard gate always wins)', () => {
    const qualificationOverride = { runId: 'run-1', overallStatus: 'NOT_ELIGIBLE' as const, runUpdatedAt: '2026-09-01T00:00:00Z', results: [{ requirementId: 'req-1', status: 'FAIL' as const, mandatory: true, explanation: 'B-BBEE certificate expired.', tenderEvidence: [], agencyEvidence: [] }] }
    const input = baseInput({}, { qualification: qualificationOverride })
    // Force an artificially high score to prove the gate — not the score — decides.
    const forcedHighScoreInput = { ...input, scoringResult: { ...input.scoringResult, overallScore: 95 } }
    const result = evaluateBidDecision(forcedHighScoreInput, policy)
    expect(result.decision).toBe('NO_BID')
    expect(result.blockers.some((b) => b.ruleId === 'qualification-not-eligible')).toBe(true)
    expect(forcedHighScoreInput.scoringResult.overallScore).toBe(95)
  })

  it('3. high score but commercial value unknown -> REVIEW', () => {
    const input = baseInput({}, { commercial: { estimatedValue: null, contractDuration: '12 months', agencyMinProjectValue: 100000 } })
    const result = evaluateBidDecision(input, policy)
    expect(result.decision).toBe('REVIEW')
  })

  it('4. closed tender -> NO_BID', () => {
    const input = baseInput({}, { deadline: { closingDate: '2020-01-01', closingTime: null } })
    const result = evaluateBidDecision(input, policy)
    expect(result.decision).toBe('NO_BID')
    expect(result.blockers.some((b) => b.ruleId === 'tender-closed')).toBe(true)
  })

  it('5. briefing attendance unknown (compulsory) -> REVIEW, never NO_BID', () => {
    const input = baseInput({}, { briefing: { required: true, attendance: 'UNKNOWN', evidence: [] } })
    const result = evaluateBidDecision(input, policy)
    expect(result.decision).toBe('REVIEW')
    expect(result.blockers).toHaveLength(0)
  })

  it('6. confirmed missed compulsory briefing -> NO_BID', () => {
    const input = baseInput({}, { briefing: { required: true, attendance: 'NOT_ATTENDED', evidence: [] } })
    const result = evaluateBidDecision(input, policy)
    expect(result.decision).toBe('NO_BID')
    expect(result.blockers.some((b) => b.ruleId === 'compulsory-briefing-missed')).toBe(true)
  })

  it('7. low opportunity score -> NO_BID when the configured threshold is crossed', () => {
    const base = baseInput()
    const lowScore = { ...base.scoringResult, overallScore: 20 }
    const result = evaluateBidDecision(baseInput({ scoringResult: lowScore }), policy)
    expect(result.decision).toBe('NO_BID')
    expect(result.blockers.some((b) => b.ruleId === 'minimum-opportunity-score')).toBe(true)
  })

  it('7b. low opportunity score with NO threshold configured -> never auto NO_BID', () => {
    const base = baseInput()
    const lowScore = { ...base.scoringResult, overallScore: 20 }
    const noThresholdPolicy = { ...policy, minimumOpportunityScore: null }
    const result = evaluateBidDecision(baseInput({ scoringResult: lowScore }), noThresholdPolicy)
    expect(result.decision).not.toBe('NO_BID')
  })

  it('9. multiple simultaneous risks — all applicable rules are still returned, not just the first', () => {
    const input = baseInput(
      { evaluationConflict: { unresolvedCount: 2 } },
      { commercial: { estimatedValue: null, contractDuration: null, agencyMinProjectValue: null }, briefing: { required: true, attendance: 'UNKNOWN', evidence: [] } },
    )
    const result = evaluateBidDecision(input, policy)
    const triggeredIds = result.triggeredRules.map((r) => r.ruleId)
    expect(triggeredIds).toContain('commercial-value-known')
    expect(triggeredIds).toContain('compulsory-briefing-missed')
    expect(triggeredIds).toContain('unresolved-evaluation-conflict')
    expect(result.decision).toBe('REVIEW')
  })

  it('10. unknown non-critical information must NOT automatically cause NO_BID', () => {
    // Strategic fit unknown is configured CONTINUE by default.
    const input = baseInput({}, { strategic: { strategicProfileKnown: false, targetSectors: [], preferredOrgTypes: [], strategicCapabilities: [], tenderOrgType: null, tenderCategory: null } })
    const result = evaluateBidDecision(input, policy)
    expect(result.decision).not.toBe('NO_BID')
  })

  it('11. critical unresolved conflict -> REVIEW', () => {
    const input = baseInput({ evaluationConflict: { unresolvedCount: 1 } })
    const result = evaluateBidDecision(input, policy)
    expect(result.decision).toBe('REVIEW')
  })

  it('every rule is evaluated every run, even when the decision is already determined by an earlier one', () => {
    const input = baseInput({}, { deadline: { closingDate: '2020-01-01', closingTime: null } })
    const result = evaluateBidDecision(input, policy)
    // tender-closed decides NO_BID, but every other rule must still be present.
    expect(result.ruleResults.length).toBeGreaterThan(15)
    expect(result.ruleResults.some((r) => r.ruleId === 'minimum-requirement-coverage')).toBe(true)
  })

  it('determinism: identical input + policy always produces the identical decision (repeat-run invariant, §57)', () => {
    const input = baseInput()
    const first = evaluateBidDecision(input, policy)
    const second = evaluateBidDecision(input, policy)
    expect(second.decision).toBe(first.decision)
    expect(second.ruleResults).toEqual(first.ruleResults)
    expect(second.decisionExplanation).toBe(first.decisionExplanation)
  })

  it('policy change produces a different decision from the same input (versioning invariant, §57)', () => {
    const input = baseInput({ scoringResult: { ...baseInput().scoringResult, overallScore: 60 } })
    const strict = evaluateBidDecision(input, { ...policy, minimumOpportunityScore: { active: true, severity: 'NO_BID', value: 70 } })
    const lenient = evaluateBidDecision(input, { ...policy, minimumOpportunityScore: { active: true, severity: 'NO_BID', value: 50 } })
    expect(strict.decision).toBe('NO_BID')
    expect(lenient.decision).not.toBe('NO_BID')
  })

  it('bid effort is reported separately from opportunity score and never changes the score itself', () => {
    const input = baseInput({ bidEffortInputs: { mandatoryDocumentCount: 20, evaluationCriteriaCount: 10, presentationRequired: true, briefingCompulsory: true, mandatoryFormCount: 15 } })
    const result = evaluateBidDecision(input, policy)
    expect(result.bidEffort).toBe('HIGH')
    expect(input.scoringResult.overallScore).toBe(baseInput().scoringResult.overallScore)
  })
})
