import { MIN_TRAINING_SAMPLE_SIZE } from '@tender-os/constants'
import type { DistributionShiftInput, DistributionShiftResult } from './types.js'

/**
 * Phase 18 §18 — basic distribution-shift detection. Not a
 * sophisticated statistical drift test (KS-test etc. are out of scope
 * for this phase) — a documented, conservative "have we ever seen
 * anything like this?" check, which is enough to justify degrading or
 * refusing a prediction rather than pretending equal reliability
 * everywhere.
 */
export function detectDistributionShift(input: DistributionShiftInput): DistributionShiftResult {
  const reasons: string[] = []

  if (input.trainingSampleSize < MIN_TRAINING_SAMPLE_SIZE) {
    reasons.push(`Training sample size (${input.trainingSampleSize}) is below the minimum considered sufficient to characterise a "normal" population (${MIN_TRAINING_SAMPLE_SIZE}).`)
  }
  if (input.candidateCategory !== null && !input.trainingCategories.has(input.candidateCategory)) {
    reasons.push(`Category "${input.candidateCategory}" was never observed in the training population.`)
  }
  if (input.candidateProvince !== null && !input.trainingProvinces.has(input.candidateProvince)) {
    reasons.push(`Province "${input.candidateProvince}" was never observed in the training population.`)
  }
  if (input.candidateValueBand !== null && !input.trainingValueBands.has(input.candidateValueBand)) {
    reasons.push(`Value band "${input.candidateValueBand}" was never observed in the training population.`)
  }

  return { shiftDetected: reasons.length > 0, reasons }
}
