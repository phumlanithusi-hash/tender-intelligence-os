import { VALUE_BANDS } from '@tender-os/constants'
import type { FinancialSummary, FinancialSummaryInput, PriceVarianceResult, ValueBandResult } from './types.js'

/**
 * Phase 17 §32/§61/§62/§63 — value bands and financial analytics.
 * UNKNOWN values are always excluded from the arithmetic, never
 * coerced to 0 (spec §61); the three money facts (our bid price,
 * winning award value, estimated tender value) are always distinct
 * inputs and never conflated (spec §62).
 */
export function valueBand(value: number | null): ValueBandResult {
  if (value === null || Number.isNaN(value) || value < 0) return { band: 'UNKNOWN', label: 'Unknown' }
  for (const band of VALUE_BANDS) {
    if (value >= band.min && (band.max === null || value < band.max)) {
      return { band: band.key, label: band.label }
    }
  }
  return { band: 'UNKNOWN', label: 'Unknown' }
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  const midValue = sorted[mid]
  if (midValue === undefined) return null
  if (sorted.length % 2 === 0) {
    const prevValue = sorted[mid - 1]
    return prevValue === undefined ? midValue : (prevValue + midValue) / 2
  }
  return midValue
}

export function summarizeFinancials(input: FinancialSummaryInput): FinancialSummary {
  const known = input.awardValues.filter((v) => typeof v === 'number' && !Number.isNaN(v) && v >= 0)
  if (known.length === 0) {
    return { total: 0, average: null, median: null, largest: null, smallest: null, countKnown: 0 }
  }
  const sorted = [...known].sort((a, b) => a - b)
  const total = known.reduce((sum, v) => sum + v, 0)
  return {
    total,
    average: total / known.length,
    median: median(sorted),
    largest: sorted[sorted.length - 1] ?? null,
    smallest: sorted[0] ?? null,
    countKnown: known.length,
  }
}

/**
 * Price variance is always SYSTEM_CALCULATED and always phrased as an
 * observation of a recorded difference — never as a causal claim about
 * why we lost (spec §63/§86).
 */
export function calculatePriceVariance(ourBidValue: number | null, winningAwardValue: number | null): PriceVarianceResult {
  if (ourBidValue === null || winningAwardValue === null || winningAwardValue === 0) {
    return { variancePercent: null, label: 'Price variance unknown — one or both verified values are missing.' }
  }
  const variancePercent = ((ourBidValue - winningAwardValue) / winningAwardValue) * 100
  const direction = variancePercent >= 0 ? 'higher than' : 'lower than'
  return {
    variancePercent,
    label: `Our recorded bid was ${Math.abs(variancePercent).toFixed(1)}% ${direction} the winning award value (SYSTEM_CALCULATED; not asserted as the reason for the outcome).`,
  }
}
