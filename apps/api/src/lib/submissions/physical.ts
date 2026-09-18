import type { PhysicalTransitionInput, PhysicalTransitionResult } from './types.js'
import type { SubmissionPhysicalStage } from '@tender-os/constants'

/**
 * Phase 16 §17 — the physical/courier lifecycle gate. Enforces the
 * exact required ordering and evidence-per-transition rule: the
 * system must never mark SUBMITTED merely because DISPATCHED (§17
 * binding constraint), and a stage can never be skipped.
 */
const ORDER: SubmissionPhysicalStage[] = ['NOT_STARTED', 'PREPARED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'SUBMISSION_REPORTED', 'SUBMITTED']

export function canTransitionPhysicalStage(input: PhysicalTransitionInput): PhysicalTransitionResult {
  const fromIdx = ORDER.indexOf(input.currentStage)
  const toIdx = ORDER.indexOf(input.targetStage)
  if (toIdx <= fromIdx) return { allowed: false, reason: `Cannot move backwards or repeat: already at or past ${input.currentStage}.` }
  if (toIdx !== fromIdx + 1) return { allowed: false, reason: 'A physical-submission stage cannot be skipped; transitions must be sequential.' }

  switch (input.targetStage) {
    case 'DISPATCHED':
      if (!input.hasDispatchEvidence) return { allowed: false, reason: 'Dispatch requires a recorded courier name/tracking number or dispatch date.' }
      break
    case 'DELIVERED':
      if (!input.hasDeliveryEvidence) return { allowed: false, reason: 'Delivery requires a recorded delivery date/reference.' }
      break
    case 'SUBMISSION_REPORTED':
      if (!input.hasHumanAttestation) return { allowed: false, reason: 'A human attestation is required before this can be reported as complete.' }
      break
    case 'SUBMITTED':
      if (!input.hasProofOfDelivery) return { allowed: false, reason: 'Verified SUBMITTED status requires proof of delivery, not merely a human report.' }
      break
    default:
      break
  }
  return { allowed: true, reason: 'Transition permitted.' }
}
