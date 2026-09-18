import { MIN_SEGMENT_SAMPLE_SIZE } from '@tender-os/constants'
import type { AbstentionCheckInput, AbstentionCheckResult } from './types.js'

/**
 * Phase 18 §13 — mandatory prediction abstention. Checked in a fixed,
 * documented order; the FIRST applicable reason is returned — a
 * numerical prediction is never forced merely because the UI expects
 * one (spec §13).
 */
export function evaluateAbstention(input: AbstentionCheckInput): AbstentionCheckResult {
  if (input.eligibilityState === 'LEAKAGE_DETECTED') {
    return { shouldAbstain: true, reason: 'LEAKAGE_DETECTED', detail: 'A leakage finding was detected in the underlying dataset — no prediction can be trusted until this is resolved.' }
  }
  if (input.eligibilityState === 'INSUFFICIENT_DATA' || input.eligibilityState === 'INSUFFICIENT_LABELS' || input.eligibilityState === 'INSUFFICIENT_VARIATION' || input.eligibilityState === 'HIGH_CLASS_IMBALANCE') {
    return { shouldAbstain: true, reason: 'INSUFFICIENT_VERIFIED_OUTCOMES', detail: `Dataset eligibility state is ${input.eligibilityState} — not enough verified historical data exists to justify any prediction.` }
  }
  if (input.modelStatus !== 'PRODUCTION') {
    return { shouldAbstain: true, reason: 'MODEL_NOT_PRODUCTION_ELIGIBLE', detail: `No PRODUCTION model exists (current status: ${input.modelStatus ?? 'none'}) — a prediction requires an explicitly approved production model.` }
  }
  if (input.segmentSampleSize !== null && input.segmentSampleSize < MIN_SEGMENT_SAMPLE_SIZE) {
    return { shouldAbstain: true, reason: 'INSUFFICIENT_SEGMENT_SAMPLE', detail: `Only ${input.segmentSampleSize} training observation(s) exist for this segment — below the minimum of ${MIN_SEGMENT_SAMPLE_SIZE}.` }
  }
  if (!input.hasCriticalFeatures) {
    return { shouldAbstain: true, reason: 'MISSING_CRITICAL_FEATURES', detail: 'One or more critical decision-time features are missing for this tender/bid.' }
  }
  if (input.distributionShift?.shiftDetected) {
    return { shouldAbstain: true, reason: 'DISTRIBUTION_SHIFT', detail: input.distributionShift.reasons.join(' ') }
  }
  if (input.calibrationError !== null && input.calibrationError > 0.15) {
    return { shouldAbstain: true, reason: 'CALIBRATION_INSUFFICIENT', detail: `Calibration error (${input.calibrationError.toFixed(3)}) is too high to trust the predicted probability numerically.` }
  }
  return { shouldAbstain: false, reason: null, detail: 'All abstention checks passed — a prediction may be issued.' }
}
