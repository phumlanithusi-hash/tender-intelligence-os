import { describe, it, expect } from 'vitest'
import { computeGates } from '../gates.js'
import { computeDecisionSignal } from '../decisionSignal.js'
import { baseInput, config } from './fixtures.js'
import { evaluateOpportunity } from '../computeScore.js'

describe('computeGates — Phase 10 §29/§30/§31 precedence and evaluation', () => {
  it('evaluates all five gate types every run, never omitting one', () => {
    const { gates } = computeGates(baseInput())
    const types = gates.map((g) => g.gateType).sort()
    expect(types).toEqual(['COMPULSORY_BRIEFING_FAILURE', 'CRITICAL_COMPLIANCE_FAILURE', 'MANDATORY_QUALIFICATION_FAILURE', 'MANDATORY_REQUIREMENT_FAILURE', 'SUBMISSION_DEADLINE_PASSED'].sort())
  })

  it('unknown closing date → SUBMISSION_DEADLINE_PASSED is UNKNOWN, not OK and not TRIGGERED', () => {
    const { gates, deadlineStatus } = computeGates(baseInput({ deadline: { closingDate: null, closingTime: null } }))
    expect(gates.find((g) => g.gateType === 'SUBMISSION_DEADLINE_PASSED')?.status).toBe('UNKNOWN')
    expect(deadlineStatus).toBe('UNKNOWN')
  })

  it('a compulsory briefing with unknown attendance does not automatically fail (§29)', () => {
    const { gates } = computeGates(baseInput({ briefing: { required: true, attendance: 'UNKNOWN', evidence: [] } }))
    expect(gates.find((g) => g.gateType === 'COMPULSORY_BRIEFING_FAILURE')?.status).toBe('UNKNOWN')
  })
})

describe('computeDecisionSignal — precedence order (Phase 10 §24)', () => {
  it('a triggered gate overrides an otherwise-INSUFFICIENT_DATA-worthy completeness', () => {
    const components = evaluateOpportunity(
      baseInput({ qualification: { runId: 'r', overallStatus: 'NOT_ELIGIBLE', runUpdatedAt: '', results: [{ requirementId: 'x', status: 'FAIL', mandatory: true, explanation: '', tenderEvidence: [], agencyEvidence: [] }] } }),
      config,
    ).components
    const gates = computeGates(
      baseInput({ qualification: { runId: 'r', overallStatus: 'NOT_ELIGIBLE', runUpdatedAt: '', results: [{ requirementId: 'x', status: 'FAIL', mandatory: true, explanation: '', tenderEvidence: [], agencyEvidence: [] }] } }),
    ).gates
    expect(computeDecisionSignal(90, 1, components, gates, config)).toBe('BLOCKED')
  })

  it('below-threshold completeness forces INSUFFICIENT_DATA even with a high raw score and no gates triggered', () => {
    const components = evaluateOpportunity(baseInput(), config).components
    const noGates = computeGates(baseInput()).gates.map((g) => ({ ...g, status: 'OK' as const }))
    expect(computeDecisionSignal(95, 0.2, components, noGates, config)).toBe('INSUFFICIENT_DATA')
  })

  it('a critical dimension (QUALIFICATION) being UNKNOWN forces INSUFFICIENT_DATA even above the completeness threshold', () => {
    const components = evaluateOpportunity(baseInput({ qualification: { runId: null, overallStatus: null, runUpdatedAt: null, results: [] } }), config).components
    const noGates = computeGates(baseInput()).gates.map((g) => ({ ...g, status: 'OK' as const }))
    // Force completeness high by pretending enough other weight is known — the qualification component itself stays UNKNOWN.
    expect(computeDecisionSignal(95, 0.9, components, noGates, config)).toBe('INSUFFICIENT_DATA')
  })

  it('falls through to band lookup only when no gate triggered and completeness/critical checks pass', () => {
    const components = evaluateOpportunity(baseInput(), config).components
    const noGates = computeGates(baseInput()).gates.map((g) => ({ ...g, status: 'OK' as const }))
    expect(computeDecisionSignal(82, 1, components, noGates, config)).toBe('HIGH_PRIORITY')
    expect(computeDecisionSignal(70, 1, components, noGates, config)).toBe('PROMISING')
    expect(computeDecisionSignal(55, 1, components, noGates, config)).toBe('REVIEW')
    expect(computeDecisionSignal(20, 1, components, noGates, config)).toBe('LOW_PRIORITY')
  })
})
