import { describe, expect, it } from 'vitest'
import { isAddendumMaterial, buildAddendumReconciliationInput } from '../reconciliation.js'

const base = { id: 'a1', addendumNumber: 1, deadlineChanged: false, briefingChanged: false, requirementChanged: false, evaluationChanged: false, pricingChanged: false }

describe('isAddendumMaterial', () => {
  it('is false when no *_changed flag is set', () => {
    expect(isAddendumMaterial(base)).toBe(false)
  })

  it('is true when any single *_changed flag is set', () => {
    expect(isAddendumMaterial({ ...base, deadlineChanged: true })).toBe(true)
    expect(isAddendumMaterial({ ...base, briefingChanged: true })).toBe(true)
    expect(isAddendumMaterial({ ...base, requirementChanged: true })).toBe(true)
    expect(isAddendumMaterial({ ...base, evaluationChanged: true })).toBe(true)
    expect(isAddendumMaterial({ ...base, pricingChanged: true })).toBe(true)
  })
})

describe('buildAddendumReconciliationInput', () => {
  it('a non-material addendum never requires acknowledgement, regardless of ack state', () => {
    const result = buildAddendumReconciliationInput(base, null)
    expect(result.isMaterial).toBe(false)
    expect(result.acknowledgementRequired).toBe(false)
    expect(result.acknowledged).toBe(false)
    expect(result.reconciled).toBe(false)
  })

  it('a material addendum with no acknowledgement record is unacknowledged and unreconciled', () => {
    const result = buildAddendumReconciliationInput({ ...base, pricingChanged: true }, null)
    expect(result.isMaterial).toBe(true)
    expect(result.acknowledgementRequired).toBe(true)
    expect(result.acknowledged).toBe(false)
    expect(result.reconciled).toBe(false)
  })

  it('a material addendum with an acknowledgement record is acknowledged, reconciled state comes from the record', () => {
    const acked = buildAddendumReconciliationInput({ ...base, deadlineChanged: true }, { addendumId: 'a1', reconciled: false })
    expect(acked.acknowledged).toBe(true)
    expect(acked.reconciled).toBe(false)

    const reconciled = buildAddendumReconciliationInput({ ...base, deadlineChanged: true }, { addendumId: 'a1', reconciled: true })
    expect(reconciled.acknowledged).toBe(true)
    expect(reconciled.reconciled).toBe(true)
  })

  it('never fabricates acknowledgement from the addendum alone — only a real acknowledgement record flips it true', () => {
    const materialUnacked = buildAddendumReconciliationInput({ ...base, evaluationChanged: true, pricingChanged: true }, null)
    expect(materialUnacked.acknowledged).toBe(false)
  })
})
