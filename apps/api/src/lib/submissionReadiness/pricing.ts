/**
 * Phase 15 §18/§19 — PURE, zero-I/O, deterministic pricing arithmetic.
 * Never invents, estimates, or optimises a price (binding constraint
 * §18) — every function here only validates arithmetic the agency
 * itself entered.
 */

export interface PricingLineInput {
  id: string
  quantity: number
  unitPrice: number
  lineTotal: number
  currency: string | null
}

export interface PricingLineValidation {
  id: string
  quantityValid: boolean
  unitPriceValid: boolean
  expectedTotal: number
  totalMatchesArithmetic: boolean
  currencyPresent: boolean
}

const EPSILON = 0.01

/** validatePricingLine: deterministic arithmetic check for one pricing line (Phase 15 §19). */
export function validatePricingLine(line: PricingLineInput): PricingLineValidation {
  const quantityValid = Number.isFinite(line.quantity) && line.quantity >= 0
  const unitPriceValid = Number.isFinite(line.unitPrice) && line.unitPrice >= 0
  const expectedTotal = quantityValid && unitPriceValid ? Math.round(line.quantity * line.unitPrice * 100) / 100 : NaN
  const totalMatchesArithmetic = quantityValid && unitPriceValid && Math.abs(expectedTotal - line.lineTotal) <= EPSILON
  return {
    id: line.id,
    quantityValid,
    unitPriceValid,
    expectedTotal,
    totalMatchesArithmetic,
    currencyPresent: Boolean(line.currency && line.currency.trim().length > 0),
  }
}

/** validatePricingLines: applies validatePricingLine across a full schedule and sums the grand total. */
export function validatePricingLines(lines: PricingLineInput[]): { validations: PricingLineValidation[]; grandTotal: number; allArithmeticValid: boolean } {
  const validations = lines.map(validatePricingLine)
  const grandTotal = lines.reduce((sum, l) => sum + (Number.isFinite(l.lineTotal) ? l.lineTotal : 0), 0)
  const allArithmeticValid = validations.every((v) => v.quantityValid && v.unitPriceValid && v.totalMatchesArithmetic && v.currencyPresent)
  return { validations, grandTotal: Math.round(grandTotal * 100) / 100, allArithmeticValid }
}
