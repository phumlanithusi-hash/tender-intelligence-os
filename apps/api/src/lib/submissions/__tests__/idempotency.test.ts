import { describe, expect, it } from 'vitest'
import { computeSubmissionIdempotencyKey } from '../idempotency.js'

describe('computeSubmissionIdempotencyKey (Phase 16 §50)', () => {
  const params = { agencyId: 'agency-1', bidProjectId: 'bid-1', packVersionId: 'pack-1:3', submissionTarget: 'tenders@agency.gov.za', confirmationId: 'confirm-1' }

  it('is deterministic for identical inputs', () => {
    expect(computeSubmissionIdempotencyKey(params)).toBe(computeSubmissionIdempotencyKey(params))
  })

  it('changes when the pack version changes', () => {
    expect(computeSubmissionIdempotencyKey(params)).not.toBe(computeSubmissionIdempotencyKey({ ...params, packVersionId: 'pack-1:4' }))
  })

  it('changes when the confirmation changes', () => {
    expect(computeSubmissionIdempotencyKey(params)).not.toBe(computeSubmissionIdempotencyKey({ ...params, confirmationId: 'confirm-2' }))
  })

  it('changes when the target changes', () => {
    expect(computeSubmissionIdempotencyKey(params)).not.toBe(computeSubmissionIdempotencyKey({ ...params, submissionTarget: 'other@agency.gov.za' }))
  })
})
