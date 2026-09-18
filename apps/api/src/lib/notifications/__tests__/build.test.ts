import { describe, expect, it } from 'vitest'
import {
  buildAddendumDetectedNotification,
  buildDeadlineNotification,
  buildDedupKey,
  buildDocumentProcessingFailedNotification,
  buildNewRelevantTenderNotification,
  buildOutcomeConflictNotification,
  buildOutcomeDetectedNotification,
  buildOutcomeRequiresReviewNotification,
  buildSubmissionOutcomeUnknownNotification,
  buildTenderUpdatedNotification,
} from '../build.js'

describe('buildDedupKey', () => {
  it('is deterministic for the same fact', () => {
    expect(buildDedupKey('OUTCOME_DETECTED', 'tender_outcome', 'a1', 'agency-1')).toBe(buildDedupKey('OUTCOME_DETECTED', 'tender_outcome', 'a1', 'agency-1'))
  })

  it('differs when any component differs', () => {
    expect(buildDedupKey('OUTCOME_DETECTED', 'tender_outcome', 'a1', 'agency-1')).not.toBe(buildDedupKey('OUTCOME_DETECTED', 'tender_outcome', 'a2', 'agency-1'))
  })

  it('omits an undefined extra rather than embedding "undefined"', () => {
    expect(buildDedupKey('TENDER_UPDATED', 'tender', 't1')).toBe('TENDER_UPDATED:tender:t1')
  })
})

describe('per-trigger builders', () => {
  it('OUTCOME_DETECTED is agency-scoped and links to the tender_outcome entity', () => {
    const n = buildOutcomeDetectedNotification({ agencyId: 'ag1', tenderOutcomeId: 'o1', tenderId: 't1', bidStrategyProjectId: 'bp1', outcomeStatus: 'AWARDED' })
    expect(n.eventType).toBe('OUTCOME_DETECTED')
    expect(n.agencyId).toBe('ag1')
    expect(n.entityType).toBe('tender_outcome')
    expect(n.entityId).toBe('o1')
    expect(n.userId).toBeNull()
    expect(n.dedupKey).toContain('ag1')
  })

  it('OUTCOME_CONFLICT links to the conflict entity, not the outcome', () => {
    const n = buildOutcomeConflictNotification({ agencyId: 'ag1', conflictId: 'c1', tenderOutcomeId: 'o1', tenderId: 't1', bidStrategyProjectId: 'bp1', fieldName: 'winner_name' })
    expect(n.eventType).toBe('OUTCOME_CONFLICT')
    expect(n.entityType).toBe('outcome_conflict')
    expect(n.entityId).toBe('c1')
  })

  it('OUTCOME_REQUIRES_REVIEW links to the bid project and carries the reconciliation reason', () => {
    const n = buildOutcomeRequiresReviewNotification({ agencyId: 'ag1', bidStrategyProjectId: 'bp1', tenderOutcomeId: 'o1', tenderId: 't1', reason: 'winner not yet resolved' })
    expect(n.eventType).toBe('OUTCOME_REQUIRES_REVIEW')
    expect(n.entityId).toBe('bp1')
    expect(n.payload?.reason).toBe('winner not yet resolved')
  })

  it('DOCUMENT_PROCESSING_FAILED never invents an agency when the document has none resolved yet', () => {
    const n = buildDocumentProcessingFailedNotification({ agencyId: null, documentId: 'd1', tenderId: 't1', state: 'INVALID', error: 'malformed PDF' })
    expect(n.agencyId).toBeNull()
    expect(n.payload?.error).toBe('malformed PDF')
  })

  it('ADDENDUM_DETECTED, TENDER_UPDATED, deadline and follow-up builders each produce a distinct dedup key per fact', () => {
    const a = buildAddendumDetectedNotification({ agencyId: 'ag1', bidStrategyProjectId: 'bp1', addendumId: 'ad1', tenderId: 't1', addendumNumber: 1 })
    const b = buildTenderUpdatedNotification({ agencyId: 'ag1', bidStrategyProjectId: 'bp1', tenderId: 't1', updatedAt: '2026-09-01T00:00:00Z' })
    const c = buildDeadlineNotification({ trigger: 'TENDER_DEADLINE', agencyId: 'ag1', bidStrategyProjectId: 'bp1', tenderId: 't1', deadlineIso: '2026-09-10T00:00:00Z', dateBucket: '2026-09-10' })
    const d = buildDeadlineNotification({ trigger: 'BRIEFING_DEADLINE', agencyId: 'ag1', bidStrategyProjectId: 'bp1', tenderId: 't1', deadlineIso: '2026-09-05T00:00:00Z', dateBucket: '2026-09-05' })
    const e = buildSubmissionOutcomeUnknownNotification({ agencyId: 'ag1', bidStrategyProjectId: 'bp1', tenderId: 't1', daysSinceSubmission: 20, dateBucket: '2026-09-12' })
    const keys = [a, b, c, d, e].map((n) => n.dedupKey)
    expect(new Set(keys).size).toBe(keys.length)
    expect(c.eventType).toBe('TENDER_DEADLINE')
    expect(d.eventType).toBe('BRIEFING_DEADLINE')
  })

  it('NEW_RELEVANT_TENDER is user-scoped (not agency-wide)', () => {
    const n = buildNewRelevantTenderNotification({ userId: 'u1', agencyId: 'ag1', tenderId: 't1', savedFilterId: 'f1' })
    expect(n.userId).toBe('u1')
  })
})
