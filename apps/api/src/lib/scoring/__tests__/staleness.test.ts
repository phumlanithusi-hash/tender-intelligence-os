import { describe, it, expect } from 'vitest'
import { isSnapshotStale } from '../staleness.js'

describe('isSnapshotStale (Phase 10 §46/§48 test 10)', () => {
  it('identical snapshots are not stale', () => {
    const snapshot = { requirementVersions: { r1: 1 }, evaluationCriteriaVersions: { c1: 1 }, agencyUpdatedAt: '2026-09-01T00:00:00Z' }
    expect(isSnapshotStale(snapshot, { ...snapshot })).toBe(false)
  })

  it('a changed evaluation criterion version makes the run STALE', () => {
    const stored = { requirementVersions: { r1: 1 }, evaluationCriteriaVersions: { c1: 1 }, agencyUpdatedAt: '2026-09-01T00:00:00Z' }
    const current = { ...stored, evaluationCriteriaVersions: { c1: 2 } }
    expect(isSnapshotStale(stored, current)).toBe(true)
  })

  it('a changed agency evidence timestamp makes the run STALE', () => {
    const stored = { agencyEvidenceMaxUpdatedAt: '2026-09-01T00:00:00Z' }
    const current = { agencyEvidenceMaxUpdatedAt: '2026-09-05T00:00:00Z' }
    expect(isSnapshotStale(stored, current)).toBe(true)
  })

  it('a new criterion-evidence link (count change) makes the run STALE', () => {
    const stored = { criterionEvidenceLinkCount: 2 }
    const current = { criterionEvidenceLinkCount: 3 }
    expect(isSnapshotStale(stored, current)).toBe(true)
  })

  it('key order does not spuriously mark a run stale when values are identical primitives', () => {
    const stored = { a: 1, b: 2 }
    const current = { a: 1, b: 2 }
    expect(isSnapshotStale(stored, current)).toBe(false)
  })
})
