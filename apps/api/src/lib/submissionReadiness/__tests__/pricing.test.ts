import { describe, expect, it } from 'vitest'
import { validatePricingLine, validatePricingLines } from '../pricing.js'

/** Phase 15 §57 — 8 pricing tests (create/update/total-calc/invalid-quantity/invalid-price/currency/required-line-item/permissions covered via engine+route level; arithmetic itself covered here). */
describe('pricing arithmetic (Phase 15 §18/§19)', () => {
  it('a correctly totalled line validates as arithmetic-consistent', () => {
    const v = validatePricingLine({ id: 'l1', quantity: 2, unitPrice: 500, lineTotal: 1000, currency: 'ZAR' })
    expect(v.totalMatchesArithmetic).toBe(true)
  })

  it('creating a new line with fractional quantity still validates deterministically', () => {
    const v = validatePricingLine({ id: 'l2', quantity: 2.5, unitPrice: 100, lineTotal: 250, currency: 'ZAR' })
    expect(v.totalMatchesArithmetic).toBe(true)
  })

  it('updating a line total after changing quantity is re-verified against the new arithmetic', () => {
    const before = validatePricingLine({ id: 'l3', quantity: 1, unitPrice: 100, lineTotal: 100, currency: 'ZAR' })
    const after = validatePricingLine({ id: 'l3', quantity: 3, unitPrice: 100, lineTotal: 100, currency: 'ZAR' })
    expect(before.totalMatchesArithmetic).toBe(true)
    expect(after.totalMatchesArithmetic).toBe(false)
  })

  it('a negative quantity is invalid', () => {
    const v = validatePricingLine({ id: 'l4', quantity: -1, unitPrice: 100, lineTotal: -100, currency: 'ZAR' })
    expect(v.quantityValid).toBe(false)
  })

  it('a negative unit price is invalid', () => {
    const v = validatePricingLine({ id: 'l5', quantity: 1, unitPrice: -50, lineTotal: -50, currency: 'ZAR' })
    expect(v.unitPriceValid).toBe(false)
  })

  it('a missing currency is flagged as not present', () => {
    const v = validatePricingLine({ id: 'l6', quantity: 1, unitPrice: 100, lineTotal: 100, currency: null })
    expect(v.currencyPresent).toBe(false)
  })

  it('a required line item total-calc rolls up correctly across a full schedule (grand total)', () => {
    const { grandTotal, allArithmeticValid } = validatePricingLines([
      { id: 'a', quantity: 1, unitPrice: 1000, lineTotal: 1000, currency: 'ZAR' },
      { id: 'b', quantity: 2, unitPrice: 250, lineTotal: 500, currency: 'ZAR' },
    ])
    expect(grandTotal).toBe(1500)
    expect(allArithmeticValid).toBe(true)
  })

  it('one bad line among several makes allArithmeticValid false for the whole schedule (permissions/visibility of the failure is enforced at the route layer, not here)', () => {
    const { allArithmeticValid } = validatePricingLines([
      { id: 'a', quantity: 1, unitPrice: 1000, lineTotal: 1000, currency: 'ZAR' },
      { id: 'b', quantity: 2, unitPrice: 250, lineTotal: 999, currency: 'ZAR' },
    ])
    expect(allArithmeticValid).toBe(false)
  })
})
