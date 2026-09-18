import { describe, expect, it } from 'vitest'
import { evaluateMilestoneAtRisk } from '../milestones.js'

describe('evaluateMilestoneAtRisk (Phase 12 §19) — deterministic AT_RISK rule', () => {
  const now = '2026-09-11T00:00:00Z'

  it('leaves a milestone due far in the future as UPCOMING', () => {
    expect(evaluateMilestoneAtRisk('UPCOMING', '2026-12-01', now)).toBe('UPCOMING')
  })

  it('marks a milestone due within the configured window as AT_RISK', () => {
    expect(evaluateMilestoneAtRisk('UPCOMING', '2026-09-13', now)).toBe('AT_RISK')
  })

  it('marks a past-due, still-open milestone as MISSED', () => {
    expect(evaluateMilestoneAtRisk('IN_PROGRESS', '2026-09-01', now)).toBe('MISSED')
  })

  it('never overrides a COMPLETED milestone', () => {
    expect(evaluateMilestoneAtRisk('COMPLETED', '2026-09-01', now)).toBe('COMPLETED')
  })

  it('never overrides a MISSED milestone back to AT_RISK', () => {
    expect(evaluateMilestoneAtRisk('MISSED', '2026-09-01', now)).toBe('MISSED')
  })
})
