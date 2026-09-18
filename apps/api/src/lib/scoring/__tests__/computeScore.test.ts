import { describe, it, expect } from 'vitest'
import { evaluateOpportunity } from '../computeScore.js'
import { baseInput, config } from './fixtures.js'

describe('evaluateOpportunity — Phase 10 §48 fixtures', () => {
  it('1. strong opportunity → HIGH_PRIORITY', () => {
    const result = evaluateOpportunity(baseInput(), config)
    expect(result.decisionSignal).toBe('HIGH_PRIORITY')
    expect(result.overallScore).not.toBeNull()
    expect(result.overallScore).toBeGreaterThanOrEqual(80)
    expect(result.gates.every((g) => g.status !== 'TRIGGERED')).toBe(true)
  })

  it('2. mandatory qualification failure → BLOCKED regardless of everything else being strong', () => {
    const input = baseInput({
      qualification: {
        runId: 'run-1',
        overallStatus: 'NOT_ELIGIBLE',
        runUpdatedAt: '2026-09-01T00:00:00Z',
        results: [{ requirementId: 'req-x', status: 'FAIL', mandatory: true, explanation: 'CSD registration not found.', tenderEvidence: [], agencyEvidence: [] }],
      },
    })
    const result = evaluateOpportunity(input, config)
    expect(result.decisionSignal).toBe('BLOCKED')
    expect(result.gates.find((g) => g.gateType === 'MANDATORY_QUALIFICATION_FAILURE')?.status).toBe('TRIGGERED')
    // The numeric score may still be computed for audit purposes — never suppressed — but never overrides BLOCKED.
    expect(result.overallScore).not.toBeNull()
  })

  it('2b. mandatory requirement (coverage) failure alone also → BLOCKED', () => {
    const reqId = 'req-mandatory'
    const input = baseInput({
      qualification: { runId: 'run-1', overallStatus: 'ACTION_REQUIRED', runUpdatedAt: '2026-09-01T00:00:00Z', results: [{ requirementId: reqId, status: 'FAIL', mandatory: true, explanation: 'Missing tax clearance.', tenderEvidence: [], agencyEvidence: [] }] },
      requirements: [{ id: reqId, mandatoryStatus: 'MANDATORY', requirementType: 'ELIGIBILITY', description: 'Tax clearance required.', version: 1, updatedAt: '2026-09-01T00:00:00Z' }],
    })
    const result = evaluateOpportunity(input, config)
    expect(result.decisionSignal).toBe('BLOCKED')
    expect(result.gates.find((g) => g.gateType === 'MANDATORY_REQUIREMENT_FAILURE')?.status).toBe('TRIGGERED')
  })

  it('3. high score but major unknowns → INSUFFICIENT_DATA (below completeness threshold)', () => {
    const input = baseInput({
      evaluationCriteria: [],
      agencyEvidence: [],
      commercial: { estimatedValue: null, contractDuration: null, agencyMinProjectValue: null },
      strategic: { strategicProfileKnown: false, targetSectors: [], preferredOrgTypes: [], strategicCapabilities: [], tenderOrgType: null, tenderCategory: null },
    })
    const result = evaluateOpportunity(input, config)
    expect(result.dataCompleteness).toBeLessThan(config.dataCompletenessInsufficientThreshold)
    expect(result.decisionSignal).toBe('INSUFFICIENT_DATA')
  })

  it('4. strong qualification, weak evaluation fit → lower evaluation score than qualification score', () => {
    const criterionId = 'crit-weak'
    const input = baseInput({
      evaluationCriteria: [
        {
          id: criterionId,
          criterion: 'Methodology',
          criterionType: 'TECHNICAL',
          weight: 100,
          gate: false,
          minimumScore: null,
          version: 1,
          updatedAt: '2026-09-01T00:00:00Z',
          linkedEvidence: [{ criterionId, evidenceType: 'AGENCY_DOCUMENT', evidenceState: 'UNVERIFIED', evidenceRef: { kind: 'AGENCY', agencyEvidenceId: 'doc-1', description: null } }],
        },
      ],
    })
    const result = evaluateOpportunity(input, config)
    const qual = result.components.find((c) => c.dimension === 'QUALIFICATION')!
    const evalFit = result.components.find((c) => c.dimension === 'EVALUATION_FIT')!
    expect(evalFit.score).toBeLessThan(qual.score!)
  })

  it('5. strong evaluation fit, weak evidence → lower evidence score than evaluation fit', () => {
    const input = baseInput({ agencyEvidence: [{ id: 'cs-1', kind: 'CASE_STUDY', state: 'EXPIRED', evidenceRef: { kind: 'AGENCY', agencyEvidenceId: 'cs-1', description: null }, updatedAt: '2026-01-01T00:00:00Z' }] })
    const result = evaluateOpportunity(input, config)
    const evalFit = result.components.find((c) => c.dimension === 'EVALUATION_FIT')!
    const evidence = result.components.find((c) => c.dimension === 'EVIDENCE_STRENGTH')!
    expect(evidence.score).toBeLessThan(evalFit.score!)
  })

  it('6. unknown tender value → commercial fit is UNKNOWN, never fabricated', () => {
    const input = baseInput({ commercial: { estimatedValue: null, contractDuration: null, agencyMinProjectValue: 100000 } })
    const result = evaluateOpportunity(input, config)
    const commercial = result.components.find((c) => c.dimension === 'COMMERCIAL_FIT')!
    expect(commercial.status).toBe('UNKNOWN')
    expect(commercial.score).toBeNull()
  })

  it('7. missing agency strategic data → strategic fit remains UNKNOWN', () => {
    const input = baseInput({ strategic: { strategicProfileKnown: false, targetSectors: [], preferredOrgTypes: [], strategicCapabilities: [], tenderOrgType: 'MUNICIPALITY', tenderCategory: 'ICT' } })
    const result = evaluateOpportunity(input, config)
    const strategic = result.components.find((c) => c.dimension === 'STRATEGIC_FIT')!
    expect(strategic.status).toBe('UNKNOWN')
    expect(strategic.score).toBeNull()
  })

  it('8a. mandatory briefing — confirmed attendance → gate OK', () => {
    const input = baseInput({ briefing: { required: true, attendance: 'ATTENDED', evidence: [] } })
    const result = evaluateOpportunity(input, config)
    expect(result.gates.find((g) => g.gateType === 'COMPULSORY_BRIEFING_FAILURE')?.status).toBe('OK')
    expect(result.decisionSignal).not.toBe('BLOCKED')
  })

  it('8b. mandatory briefing — unknown attendance → gate UNKNOWN, never a silent pass', () => {
    const input = baseInput({ briefing: { required: true, attendance: 'UNKNOWN', evidence: [] } })
    const result = evaluateOpportunity(input, config)
    expect(result.gates.find((g) => g.gateType === 'COMPULSORY_BRIEFING_FAILURE')?.status).toBe('UNKNOWN')
    expect(result.decisionSignal).not.toBe('BLOCKED')
  })

  it('8c. mandatory briefing — confirmed missed → gate TRIGGERED → BLOCKED', () => {
    const input = baseInput({ briefing: { required: true, attendance: 'NOT_ATTENDED', evidence: [] } })
    const result = evaluateOpportunity(input, config)
    expect(result.gates.find((g) => g.gateType === 'COMPULSORY_BRIEFING_FAILURE')?.status).toBe('TRIGGERED')
    expect(result.decisionSignal).toBe('BLOCKED')
  })

  it('9. evaluation criterion with unknown (null) weight → INTERNAL_FALLBACK used, tender weight untouched', () => {
    const criterionId = 'crit-null-weight'
    const input = baseInput({
      evaluationCriteria: [
        {
          id: criterionId,
          criterion: 'Price',
          criterionType: 'PRICE',
          weight: null,
          gate: false,
          minimumScore: null,
          version: 1,
          updatedAt: '2026-09-01T00:00:00Z',
          linkedEvidence: [{ criterionId, evidenceType: 'AGENCY_DOCUMENT', evidenceState: 'VERIFIED', evidenceRef: { kind: 'AGENCY', agencyEvidenceId: 'doc-1', description: null } }],
        },
      ],
    })
    const result = evaluateOpportunity(input, config)
    const evalFit = result.components.find((c) => c.dimension === 'EVALUATION_FIT')!
    expect(evalFit.metadata.internalFallbackWeighting).toBe(true)
    // The engine never mutates the input object — the criterion's own weight field stays null.
    expect(input.evaluationCriteria[0]?.weight).toBeNull()
  })

  it('closed tender (deadline passed) → SUBMISSION_DEADLINE_PASSED gate triggers BLOCKED', () => {
    const input = baseInput({ deadline: { closingDate: '2020-01-01', closingTime: null } })
    const result = evaluateOpportunity(input, config)
    expect(result.deadlineStatus).toBe('CLOSED')
    expect(result.gates.find((g) => g.gateType === 'SUBMISSION_DEADLINE_PASSED')?.status).toBe('TRIGGERED')
    expect(result.decisionSignal).toBe('BLOCKED')
  })

  it('timezone is always flagged unknown given the current date-only closing_date schema', () => {
    const result = evaluateOpportunity(baseInput(), config)
    expect(result.timezoneUnknown).toBe(true)
  })
})

describe('evaluateOpportunity — determinism and property checks (Phase 10 §49/§50)', () => {
  it('same input + same config → identical result on repeat runs', () => {
    const input = baseInput()
    const r1 = evaluateOpportunity(input, config)
    const r2 = evaluateOpportunity(input, config)
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2))
  })

  it('0 <= overallScore <= 100 whenever known', () => {
    const result = evaluateOpportunity(baseInput(), config)
    expect(result.overallScore).toBeGreaterThanOrEqual(0)
    expect(result.overallScore).toBeLessThanOrEqual(100)
  })

  it('every component score is within 0-100 or null', () => {
    const result = evaluateOpportunity(baseInput(), config)
    for (const c of result.components) {
      if (c.score !== null) {
        expect(c.score).toBeGreaterThanOrEqual(0)
        expect(c.score).toBeLessThanOrEqual(100)
      } else {
        expect(c.status).not.toBe('KNOWN')
      }
    }
  })

  it('sum of configured dimension weights is 1', () => {
    const sum = Object.values(config.dimensionWeights).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1)
  })

  it('UNKNOWN is never silently treated as a positive/PASS contribution: an all-unknown input never yields HIGH_PRIORITY/PROMISING', () => {
    const input = baseInput({
      qualification: { runId: null, overallStatus: null, runUpdatedAt: null, results: [] },
      requirements: [],
      evaluationCriteria: [],
      agencyEvidence: [],
      commercial: { estimatedValue: null, contractDuration: null, agencyMinProjectValue: null },
      strategic: { strategicProfileKnown: false, targetSectors: [], preferredOrgTypes: [], strategicCapabilities: [], tenderOrgType: null, tenderCategory: null },
    })
    const result = evaluateOpportunity(input, config)
    expect(result.overallScore).toBeNull()
    expect(result.decisionSignal).toBe('INSUFFICIENT_DATA')
  })

  it('mandatory failure ⇒ BLOCKED even when every other dimension is maximally strong', () => {
    const input = baseInput({
      qualification: { runId: 'run-1', overallStatus: 'NOT_ELIGIBLE', runUpdatedAt: '2026-09-01T00:00:00Z', results: [{ requirementId: 'x', status: 'FAIL', mandatory: true, explanation: 'fail', tenderEvidence: [], agencyEvidence: [] }] },
    })
    const result = evaluateOpportunity(input, config)
    expect(result.decisionSignal).toBe('BLOCKED')
  })
})
