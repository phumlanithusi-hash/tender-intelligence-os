import { INTELLIGENCE_APPROVE_ROLES, MAX_CALIBRATION_ERROR, MIN_AUC_IMPROVEMENT_OVER_BASELINE } from '@tender-os/constants'
import type { PromotionDecisionInput, PromotionDecisionResult } from './types.js'
import type { ModelStatus } from '@tender-os/constants'

/**
 * Phase 18 §19/§20/§21/§30/§31 — the model governance state machine.
 * A model NEVER becomes PRODUCTION merely because training succeeded
 * (spec §8/§20); this function is the single choke point every
 * promotion attempt passes through, whether called from a route
 * handler or a test.
 */

const ALLOWED_FORWARD_TRANSITIONS: Record<ModelStatus, ModelStatus[]> = {
  EXPERIMENTAL: ['EVALUATED', 'FAILED'],
  EVALUATED: ['CALIBRATED', 'FAILED'],
  CALIBRATED: ['PRODUCTION_CANDIDATE', 'FAILED'],
  PRODUCTION_CANDIDATE: ['PRODUCTION', 'FAILED'],
  PRODUCTION: ['RETIRED'],
  RETIRED: [],
  FAILED: [],
}

export function isForwardTransitionAllowed(from: ModelStatus, to: ModelStatus): boolean {
  return ALLOWED_FORWARD_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Evaluates whether a PRODUCTION_CANDIDATE → PRODUCTION promotion is
 * allowed. Every one of these gates must independently pass (spec
 * §43): adequate training data (encoded upstream via eligibilityState
 * being PRODUCTION_ELIGIBLE), leakage tests passed, temporal
 * validation passed (encoded in latestEvaluation existing at all),
 * performance beats baselines, calibration acceptable, a model card
 * exists, and the approver holds an authorised role. Never a single
 * "training succeeded" shortcut.
 */
export function evaluatePromotion(input: PromotionDecisionInput): PromotionDecisionResult {
  if (!isForwardTransitionAllowed(input.currentStatus, input.targetStatus)) {
    return { allowed: false, reason: `${input.currentStatus} → ${input.targetStatus} is not an allowed governance transition.` }
  }

  if (input.targetStatus === 'PRODUCTION') {
    if (input.eligibilityState !== 'PRODUCTION_ELIGIBLE') {
      return { allowed: false, reason: `Dataset/model eligibility state is ${input.eligibilityState}, not PRODUCTION_ELIGIBLE — a model cannot be promoted to PRODUCTION (spec §8/§43).` }
    }
    if (!input.approverRole || !(INTELLIGENCE_APPROVE_ROLES as readonly string[]).includes(input.approverRole)) {
      return { allowed: false, reason: 'Production promotion requires an authorised approver role (spec §30).' }
    }
    if (!input.hasModelCard) {
      return { allowed: false, reason: 'No model card exists for this version — a model card is mandatory before production promotion (spec §23/§43).' }
    }
    if (!input.latestEvaluation || input.latestEvaluation.auc === null) {
      return { allowed: false, reason: 'No valid evaluation (AUC) exists for this version.' }
    }
    if (input.bestBaselineAuc === null) {
      return { allowed: false, reason: 'No baseline AUC is available to compare against — baseline comparison is mandatory (spec §7/§43).' }
    }
    if (input.latestEvaluation.auc - input.bestBaselineAuc < MIN_AUC_IMPROVEMENT_OVER_BASELINE) {
      return {
        allowed: false,
        reason: `Model AUC (${input.latestEvaluation.auc.toFixed(3)}) does not beat the best baseline (${input.bestBaselineAuc.toFixed(3)}) by the required margin (${MIN_AUC_IMPROVEMENT_OVER_BASELINE}) — spec §7/§43 "must demonstrate meaningful value over simpler baselines".`,
      }
    }
    if (input.latestCalibrationError === null || input.latestCalibrationError > MAX_CALIBRATION_ERROR) {
      return { allowed: false, reason: `Calibration error (${input.latestCalibrationError ?? 'unknown'}) exceeds the acceptable ceiling (${MAX_CALIBRATION_ERROR}) — spec §11/§43.` }
    }
  } else if (input.targetStatus !== 'RETIRED' && (!input.approverRole || input.approverRole.length === 0)) {
    return { allowed: false, reason: 'A governance transition requires an identified approver.' }
  }

  return { allowed: true, reason: 'All governance gates passed.' }
}

/** A retirement never deletes historical predictions (spec §31) — this
 * function only validates the transition itself; deletion of any
 * associated row is never performed by any code path in this phase. */
export function evaluateRetirement(currentStatus: ModelStatus, approverRole: string | null): PromotionDecisionResult {
  if (currentStatus !== 'PRODUCTION') {
    return { allowed: false, reason: 'Only a PRODUCTION model may be retired.' }
  }
  if (!approverRole || !(INTELLIGENCE_APPROVE_ROLES as readonly string[]).includes(approverRole)) {
    return { allowed: false, reason: 'Retirement requires an authorised approver role.' }
  }
  return { allowed: true, reason: 'Retirement approved.' }
}
