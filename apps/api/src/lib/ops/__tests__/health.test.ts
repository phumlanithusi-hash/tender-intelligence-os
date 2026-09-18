import { describe, expect, it } from 'vitest'
import { buildOpsHealthDashboard } from '../health.js'

const baseInput = {
  sources: { totalSources: 3, activeSources: 2, healthySources: 1, warningSources: 1, failedSources: 0, notConnectedSources: 1, lastScanAt: null },
  documents: { queued: 1, processing: 0, completed: 2, failed: 0, requiresReview: 0 },
  ai: { totalRuns: 5, failedRuns: 1, requiresReviewRuns: 0, embeddingFailures: 0 },
  outcomes: { verified: 1, unknown: 2, conflicting: 0, requiresFollowUp: 0 },
  jobs: { queuedScans: 0, runningScans: 0, failedScans: 0 },
  storage: { documentsWithStoragePath: 2, documentsMissingStoragePath: 0 },
}

describe('buildOpsHealthDashboard', () => {
  it('stamps the given generatedAt and passes every section through unchanged', () => {
    const dashboard = buildOpsHealthDashboard(baseInput, '2026-09-13T00:00:00.000Z')
    expect(dashboard.generatedAt).toBe('2026-09-13T00:00:00.000Z')
    expect(dashboard.sources).toEqual(baseInput.sources)
    expect(dashboard.documents).toEqual(baseInput.documents)
    expect(dashboard.ai).toEqual(baseInput.ai)
    expect(dashboard.outcomes).toEqual(baseInput.outcomes)
    expect(dashboard.jobs).toEqual(baseInput.jobs)
    expect(dashboard.storage).toEqual(baseInput.storage)
  })

  it('never exposes any credential-shaped field', () => {
    const dashboard = buildOpsHealthDashboard(baseInput, '2026-09-13T00:00:00.000Z')
    const serialized = JSON.stringify(dashboard).toLowerCase()
    expect(serialized).not.toMatch(/key|secret|token|password/)
  })
})
