/**
 * Deterministic opportunity scoring weights (spec §22).
 * This is the single source of truth for the scoring formula —
 * the Scoring Engine (apps/api) imports these weights rather than
 * hard-coding them, and the AI scoring-support agent (later phase)
 * imports them to know what it is allowed to suggest values for.
 */
export const SCORING_WEIGHTS = {
  serviceFit: 20,
  qualification: 20,
  experience: 15,
  functionality: 15,
  commercialValue: 10,
  competition: 5,
  timeAvailable: 5,
  complianceRisk: 5,
  strategicValue: 5,
} as const

export const SCORING_TOTAL = Object.values(SCORING_WEIGHTS).reduce((a, b) => a + b, 0)

export const SCORE_CLASSIFICATION_BANDS = [
  { min: 90, max: 100, decision: 'PRIORITY_BID' },
  { min: 80, max: 89, decision: 'BID' },
  { min: 70, max: 79, decision: 'REVIEW' },
  { min: 60, max: 69, decision: 'CONDITIONAL' },
  { min: 0, max: 59, decision: 'NO_BID' },
] as const

/** Default deadline reminder offsets, in hours before closing (spec §33). Configurable per agency later. */
export const DEFAULT_DEADLINE_REMINDERS_HOURS = [24 * 14, 24 * 7, 24 * 3, 24, 2] as const
