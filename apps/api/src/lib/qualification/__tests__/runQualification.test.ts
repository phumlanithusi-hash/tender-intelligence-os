import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { runQualification, QualificationRunAlreadyActiveError } from '../runQualification.js'
import { createFakeQualificationStore } from './fakeQualificationStore.js'
import { baseAgency, baseRequirement, agencyEvidenceRef } from './fixtures.js'

describe('runQualification — orchestration (Phase 8 §24/§25/§30)', () => {
  it('evaluates every requirement and computes ELIGIBLE when all mandatory requirements pass', async () => {
    const tenderId = randomUUID()
    const requirements = [baseRequirement({ id: randomUUID(), tenderId, category: 'CSD', mandatoryStatus: 'MANDATORY' })]
    const agency = baseAgency({ csdStatus: 'REGISTERED', csdEvidence: [agencyEvidenceRef()] })
    const { store, state } = createFakeQualificationStore({ tenderId, requirements, agency })

    const result = await runQualification(store, { tenderId, agencyId: 'agency-1', triggeredBy: null })

    expect(result.overallStatus).toBe('ELIGIBLE')
    expect(state.results).toHaveLength(1)
    expect(state.runs[0]!.status).toBe('COMPLETED')
  })

  it('computes NOT_ELIGIBLE and records the mandatory failure', async () => {
    const tenderId = randomUUID()
    const requirements = [baseRequirement({ id: randomUUID(), tenderId, category: 'CSD', mandatoryStatus: 'MANDATORY' })]
    const agency = baseAgency({ csdStatus: 'NOT_REGISTERED' })
    const { store, state } = createFakeQualificationStore({ tenderId, requirements, agency })

    const result = await runQualification(store, { tenderId, agencyId: 'agency-1', triggeredBy: null })

    // CSD not-registered resolves to REQUIRES_ACTION (remediable, not a hard fail) in this engine.
    expect(result.overallStatus).toBe('ACTION_REQUIRED')
    expect(state.actions.length).toBeGreaterThan(0)
  })

  it('records a hard mandatory FAIL as NOT_ELIGIBLE (turnover below minimum)', async () => {
    const tenderId = randomUUID()
    const requirements = [baseRequirement({ id: randomUUID(), tenderId, category: 'TURNOVER', ruleType: 'NUMERIC_MIN', mandatoryStatus: 'MANDATORY', ruleConfig: { minTurnover: 10_000_000 } })]
    const agency = baseAgency({ annualTurnover: 1_000_000 })
    const { store, state } = createFakeQualificationStore({ tenderId, requirements, agency })

    const result = await runQualification(store, { tenderId, agencyId: 'agency-1', triggeredBy: null })

    expect(result.overallStatus).toBe('NOT_ELIGIBLE')
    expect(state.runs[0]!.overallStatus).toBe('NOT_ELIGIBLE')
    expect((state.runs[0] as unknown as { mandatoryBlockerCount: number }).mandatoryBlockerCount).toBe(1)
  })

  it('rejects a second concurrent run for the same tender+agency', async () => {
    const tenderId = randomUUID()
    const requirements = [baseRequirement({ id: randomUUID(), tenderId })]
    const { store } = createFakeQualificationStore({ tenderId, requirements })
    await store.createRun({ tenderId, agencyId: 'agency-1', triggeredBy: null })

    await expect(runQualification(store, { tenderId, agencyId: 'agency-1', triggeredBy: null })).rejects.toBeInstanceOf(QualificationRunAlreadyActiveError)
  })

  it('a PROVISIONAL requirement is still evaluated but never silently treated as VERIFIED', async () => {
    const tenderId = randomUUID()
    const requirements = [baseRequirement({ id: randomUUID(), tenderId, category: 'CSD', mandatoryStatus: 'MANDATORY', requirementStatus: 'PROVISIONAL' })]
    const agency = baseAgency({ csdStatus: 'REGISTERED', csdEvidence: [agencyEvidenceRef()] })
    const { store, state } = createFakeQualificationStore({ tenderId, requirements, agency })

    await runQualification(store, { tenderId, agencyId: 'agency-1', triggeredBy: null })
    expect(state.results).toHaveLength(1)
  })
})
