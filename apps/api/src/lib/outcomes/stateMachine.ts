import { OUTCOME_FOLLOW_UP_DAYS } from '@tender-os/constants'
import type { DataConfidence } from '@tender-os/constants'

/**
 * Phase 17 §18/§55 — the human outcome review workflow and the
 * follow-up detector. Both are pure/deterministic; nothing here ever
 * auto-promotes a record to VERIFIED or auto-marks a stale submission
 * as LOST (spec §55: "Never auto-mark as lost").
 */
export type OutcomeReviewStage = 'DISCOVERED' | 'EVIDENCE_ATTACHED' | 'HUMAN_REVIEW' | 'VERIFIED'

export interface ReviewTransitionInput {
  currentStage: OutcomeReviewStage
  targetStage: OutcomeReviewStage
  hasEvidence: boolean
  reviewerRoleAllowed: boolean
}
export interface ReviewTransitionResult {
  allowed: boolean
  reason: string
}

const ALLOWED_TRANSITIONS: Record<OutcomeReviewStage, OutcomeReviewStage[]> = {
  DISCOVERED: ['EVIDENCE_ATTACHED'],
  EVIDENCE_ATTACHED: ['HUMAN_REVIEW', 'DISCOVERED'],
  HUMAN_REVIEW: ['VERIFIED', 'EVIDENCE_ATTACHED'],
  VERIFIED: [],
}

export function transitionOutcomeReview(input: ReviewTransitionInput): ReviewTransitionResult {
  if (!ALLOWED_TRANSITIONS[input.currentStage].includes(input.targetStage)) {
    return { allowed: false, reason: `Cannot move from ${input.currentStage} to ${input.targetStage}.` }
  }
  if (input.targetStage === 'VERIFIED') {
    if (!input.hasEvidence) return { allowed: false, reason: 'An outcome cannot be VERIFIED without attached evidence (spec §16).' }
    if (!input.reviewerRoleAllowed) return { allowed: false, reason: 'This user\'s role is not permitted to verify outcomes (spec §18).' }
  }
  return { allowed: true, reason: `${input.currentStage} -> ${input.targetStage} is a valid transition.` }
}

/** VERIFIED requires evidence + an allowed reviewer; anything else stays UNVERIFIED/INFERRED/UNKNOWN (spec §16: "never promote to VERIFIED merely because it looks right"). */
export function resolveTruthStatus(hasEvidence: boolean, humanVerified: boolean, systemInferred: boolean): DataConfidence {
  if (humanVerified && hasEvidence) return 'VERIFIED'
  if (systemInferred) return 'INFERRED'
  if (hasEvidence) return 'UNVERIFIED'
  return 'UNKNOWN'
}

export interface FollowUpInput {
  submissionStatus: 'VERIFIED_SUBMITTED' | 'SUBMISSION_REPORTED' | 'NOT_SUBMITTED' | 'UNKNOWN'
  outcomeKnown: boolean
  submittedAtIso: string | null
  nowIso: string
  followUpDays?: number
}
export interface FollowUpResult {
  requiresFollowUp: boolean
  daysSinceSubmission: number | null
  reason: string
}

/** Phase 17 §55 — a submitted bid with no known outcome after `followUpDays` needs a human to check the official source. Never auto-marks LOST. */
export function evaluateOutcomeFollowUp(input: FollowUpInput): FollowUpResult {
  if (input.submissionStatus === 'NOT_SUBMITTED' || input.submissionStatus === 'UNKNOWN') {
    return { requiresFollowUp: false, daysSinceSubmission: null, reason: 'No confirmed submission — follow-up not applicable.' }
  }
  if (input.outcomeKnown) {
    return { requiresFollowUp: false, daysSinceSubmission: null, reason: 'Outcome is already known.' }
  }
  if (!input.submittedAtIso) {
    return { requiresFollowUp: false, daysSinceSubmission: null, reason: 'No submission timestamp recorded — cannot compute elapsed time.' }
  }
  const days = Math.floor((new Date(input.nowIso).getTime() - new Date(input.submittedAtIso).getTime()) / 86_400_000)
  const threshold = input.followUpDays ?? OUTCOME_FOLLOW_UP_DAYS
  return {
    requiresFollowUp: days >= threshold,
    daysSinceSubmission: days,
    reason:
      days >= threshold
        ? `${days} days since submission with no known outcome (>= ${threshold}-day threshold) — recommend checking the official source. Not auto-marked as lost.`
        : `${days} days since submission — within the ${threshold}-day follow-up threshold.`,
  }
}
