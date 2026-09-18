import type { ScoringConfiguration } from './types.js'

/**
 * The exact example values from Phase 10 §5/§6/§8/§15/§24, mirrored from
 * the seed row in database/migrations/20260911220000_opportunity_scoring.sql
 * ('default' configuration, version 1). Used as a fallback when no
 * database is configured (unit tests, local dev without Supabase) — the
 * production path always reads the persisted row via
 * supabaseScoringStore.ts so a config change there is picked up without
 * a code deploy. Keeping both in sync is a documented convention (see
 * docs/SCORING-ENGINE.md "Configuration"), not an import, because the
 * SQL seed must be plain JSON literals.
 */
export const DEFAULT_SCORING_CONFIGURATION: ScoringConfiguration = {
  id: '00000000-0000-0000-0000-000000000011',
  version: 1,
  dimensionWeights: {
    QUALIFICATION: 0.2,
    REQUIREMENT_COVERAGE: 0.2,
    EVALUATION_FIT: 0.2,
    EVIDENCE_STRENGTH: 0.15,
    COMMERCIAL_FIT: 0.15,
    STRATEGIC_FIT: 0.1,
  },
  qualificationStatusScoreMap: {
    ELIGIBLE: 100,
    ACTION_REQUIRED: 60,
    REQUIRES_REVIEW: 40,
    UNKNOWN: 20,
    NOT_ELIGIBLE: 0,
  },
  requirementCoverageValueMap: {
    SUPPORTED: 1,
    PARTIALLY_SUPPORTED: 0.5,
    UNKNOWN: 0,
    ACTION_REQUIRED: 0,
    FAILED: 0,
    NOT_APPLICABLE: null,
  },
  evaluationFitValueMap: {
    STRONG: 1,
    MODERATE: 0.6,
    WEAK: 0.3,
  },
  evidenceStateValueMap: {
    VERIFIED: 1,
    UNVERIFIED: 0.5,
    UNKNOWN: 0,
    MISSING: 0,
    EXPIRED: 0,
  },
  decisionBands: [
    { min: 80, max: 100, signal: 'HIGH_PRIORITY' },
    { min: 65, max: 79, signal: 'PROMISING' },
    { min: 50, max: 64, signal: 'REVIEW' },
    { min: 0, max: 49, signal: 'LOW_PRIORITY' },
  ],
  dataCompletenessInsufficientThreshold: 0.5,
  criticalDimensions: ['QUALIFICATION', 'REQUIREMENT_COVERAGE'],
}

/** Sum-to-1 + shape validation (Phase 10 §5 "sum=1"). Thrown at config-load time, never silently normalised. */
export function assertValidScoringConfiguration(config: ScoringConfiguration): void {
  const weights = Object.values(config.dimensionWeights)
  const sum = weights.reduce((a, b) => a + b, 0)
  if (Math.abs(sum - 1) > 1e-6) {
    throw new Error(`Scoring configuration dimension weights must sum to 1 (got ${sum}).`)
  }
  if (weights.some((w) => w < 0)) {
    throw new Error('Scoring configuration dimension weights must not be negative.')
  }
  if (config.dataCompletenessInsufficientThreshold < 0 || config.dataCompletenessInsufficientThreshold > 1) {
    throw new Error('dataCompletenessInsufficientThreshold must be between 0 and 1.')
  }
}
