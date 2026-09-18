/**
 * Controlled, clearly-labelled test fixtures for the Phase 18
 * predictive-intelligence E2E flow — synthetic only, never presented
 * as real production training data (spec §33/§39).
 */

export const FIXTURE_ME_ADMIN = {
  id: '00000000-0000-4000-8000-0000000000e2',
  email: 'e2e-fixture@tender-os.test',
  role: 'ADMIN',
  agencyId: '00000000-0000-4000-8000-agency000e2',
  fullName: 'E2E Fixture Admin',
}

export const MODEL_ID = '00000000-0000-4000-8000-0000000000m1'
export const DATASET_ID = '00000000-0000-4000-8000-0000000000d1'
export const VERSION_ID = '00000000-0000-4000-8000-0000000000v1'
export const BID_PROJECT_ID = '00000000-0000-4000-8000-0000000000b1'
export const OTHER_AGENCY_BID_PROJECT_ID = '00000000-0000-4000-8000-0000000000b9'

export const FIXTURE_READINESS_INSUFFICIENT = {
  totalCandidateRecords: 4,
  verifiedLabelledRecords: 4,
  positiveCount: 2,
  negativeCount: 2,
  classBalance: 0.5,
  featureCompleteness: 0.9,
  temporalCoverageStart: '2026-06-01T00:00:00.000Z',
  temporalCoverageEnd: '2026-09-01T00:00:00.000Z',
  duplicateRate: 0,
  leakageCheckPassed: true,
  leakageFindings: [],
  eligibilityState: 'INSUFFICIENT_DATA',
  eligibilityReasons: ['Only 4 verified, labelled, decision-time-complete observation(s) exist; a minimum of 30 is required before any model training may be attempted (spec §3/§8).'],
}

export const FIXTURE_READINESS_READY = {
  ...FIXTURE_READINESS_INSUFFICIENT,
  totalCandidateRecords: 60,
  verifiedLabelledRecords: 60,
  positiveCount: 30,
  negativeCount: 30,
  eligibilityState: 'READY_FOR_TRAINING',
  eligibilityReasons: ['All dataset-eligibility checks passed: sufficient sample size, sufficient per-class sample size, acceptable class balance, acceptable duplicate rate, acceptable feature completeness, no leakage findings.'],
}

export const FIXTURE_READINESS_LEAKAGE = {
  ...FIXTURE_READINESS_READY,
  leakageCheckPassed: false,
  leakageFindings: ['Observation obs-1 has a decision timestamp in the future relative to the dataset generation time.'],
  eligibilityState: 'LEAKAGE_DETECTED',
  eligibilityReasons: ['Observation obs-1 has a decision timestamp in the future relative to the dataset generation time.'],
}

export const FIXTURE_DATASET = {
  id: DATASET_ID,
  dataset_version: 1,
  total_candidate_records: 60,
  verified_labelled_records: 60,
  positive_count: 30,
  negative_count: 30,
  eligibility_state: 'READY_FOR_TRAINING',
  is_test_fixture: true,
  generated_at: '2026-09-10T00:00:00.000Z',
}

export const FIXTURE_MODEL = { id: MODEL_ID, name: 'Win Likelihood Model', description: null, created_at: '2026-09-10T00:00:00.000Z' }

function versionFixture(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION_ID,
    version: 1,
    model_type: 'LOGISTIC_REGRESSION',
    status,
    dataset_id: DATASET_ID,
    training_sample_count: 36,
    positive_sample_count: 18,
    negative_sample_count: 18,
    training_period_start: '2026-06-01T00:00:00.000Z',
    training_period_end: '2026-08-01T00:00:00.000Z',
    test_period_start: '2026-08-15T00:00:00.000Z',
    test_period_end: '2026-09-01T00:00:00.000Z',
    retirement_reason: null,
    ...overrides,
  }
}

export const FIXTURE_VERSION_EXPERIMENTAL = versionFixture('EXPERIMENTAL', { training_sample_count: 0, positive_sample_count: 0, negative_sample_count: 0, training_period_start: null, training_period_end: null, test_period_start: null, test_period_end: null })
export const FIXTURE_VERSION_EVALUATED = versionFixture('EVALUATED')
export const FIXTURE_VERSION_CALIBRATED = versionFixture('CALIBRATED')
export const FIXTURE_VERSION_CANDIDATE = versionFixture('PRODUCTION_CANDIDATE')
export const FIXTURE_VERSION_PRODUCTION = versionFixture('PRODUCTION')
export const FIXTURE_VERSION_RETIRED = versionFixture('RETIRED', { retirement_reason: 'Superseded by a newer, better-calibrated version.' })
export const FIXTURE_VERSION_FAILED = versionFixture('FAILED')

export const FIXTURE_EVALUATIONS = [
  { id: 'eval-model', evaluation_type: 'MODEL', sample_size: 12, auc: 0.78, pr_auc: 0.65, precision_score: 0.7, recall_score: 0.6, f1_score: 0.65, brier_score: 0.18, log_loss_score: 0.55 },
  { id: 'eval-prevalence', evaluation_type: 'BASELINE_PREVALENCE', sample_size: 36, auc: 0.5, pr_auc: null, precision_score: null, recall_score: null, f1_score: null, brier_score: null, log_loss_score: null },
  { id: 'eval-score', evaluation_type: 'BASELINE_OPPORTUNITY_SCORE', sample_size: 36, auc: 0.6, pr_auc: null, precision_score: null, recall_score: null, f1_score: null, brier_score: null, log_loss_score: null },
]

export const FIXTURE_EVALUATIONS_POOR_MODEL = [
  { id: 'eval-model', evaluation_type: 'MODEL', sample_size: 12, auc: 0.52, pr_auc: 0.4, precision_score: 0.4, recall_score: 0.3, f1_score: 0.34, brier_score: 0.3, log_loss_score: 0.9 },
  { id: 'eval-prevalence', evaluation_type: 'BASELINE_PREVALENCE', sample_size: 36, auc: 0.5, pr_auc: null, precision_score: null, recall_score: null, f1_score: null, brier_score: null, log_loss_score: null },
  { id: 'eval-score', evaluation_type: 'BASELINE_OPPORTUNITY_SCORE', sample_size: 36, auc: 0.51, pr_auc: null, precision_score: null, recall_score: null, f1_score: null, brier_score: null, log_loss_score: null },
]

export const FIXTURE_CALIBRATIONS = [
  {
    id: 'cal-1',
    calibration_version: 1,
    method: 'NONE',
    calibration_error: 0.06,
    brier_score: 0.18,
    sample_size: 12,
    buckets: [{ bucketIndex: 5, predictedRangeLow: 0.5, predictedRangeHigh: 0.6, meanPredicted: 0.55, observedFrequency: 0.5, sampleSize: 6, insufficientSample: false }],
  },
]

export const FIXTURE_CARD = { id: 'card-1', model_version_id: VERSION_ID, content: { intendedUse: 'decision support only' }, approval_status: 'PENDING' }

export const FIXTURE_PREDICTION_SUCCESS = {
  data: { id: 'pred-1', predicted_probability: 0.68, abstained: false, model_version_label: 'v1', prediction_timestamp: '2026-09-12T09:00:00.000Z' },
  abstained: false,
  explanation: {
    explanation_text:
      'Predicted win likelihood: 68% (model version v1, based on 36 historical observations). Factors historically associated with a stronger outcome in this dataset: Opportunity Score, requirement coverage. This is decision support, not a procurement decision. The human remains responsible for Bid/No-Bid and submission decisions.',
    top_positive_features: [{ feature: 'opportunityScore', contribution: 0.4 }],
    top_negative_features: [],
    missing_features: [],
  },
}

export const FIXTURE_PREDICTION_ABSTAIN = {
  data: { id: 'pred-2', predicted_probability: null, abstained: true, model_version_label: null, prediction_timestamp: '2026-09-12T09:05:00.000Z' },
  abstained: true,
  reason: 'INSUFFICIENT_VERIFIED_OUTCOMES',
  explanation:
    'No numerical prediction was made (INSUFFICIENT_VERIFIED_OUTCOMES). Dataset eligibility state is INSUFFICIENT_DATA — not enough verified historical data exists to justify any prediction. This is an expected, correct system state when evidence is insufficient — not a system failure.',
}

export const FIXTURE_SCORE_CALIBRATION = [
  { band: '0-20', sampleSize: 5, verifiedOutcomeCount: 5, observedWinRate: 0.1, completeness: 1, caveat: null },
  { band: '20-40', sampleSize: 3, verifiedOutcomeCount: 3, observedWinRate: 0.33, completeness: 1, caveat: 'Based on only 3 recorded outcomes — too small a sample to draw a conclusion from.' },
  { band: '40-60', sampleSize: 6, verifiedOutcomeCount: 6, observedWinRate: 0.4, completeness: 1, caveat: null },
  { band: '60-80', sampleSize: 8, verifiedOutcomeCount: 8, observedWinRate: 0.6, completeness: 1, caveat: null },
  { band: '80-100', sampleSize: 10, verifiedOutcomeCount: 10, observedWinRate: 0.8, completeness: 1, caveat: null },
]

export const FIXTURE_SEGMENTS = [
  { segmentKey: 'IT_SERVICES', sampleSize: 20, verifiedOutcomes: 18, missingOutcomes: 2, observedWinRate: 0.5, caveat: null, insufficientSample: false },
  { segmentKey: 'RARE_CATEGORY', sampleSize: 2, verifiedOutcomes: 2, missingOutcomes: 0, observedWinRate: 1, caveat: 'Based on only 2 recorded outcomes — too small a sample to draw a conclusion from.', insufficientSample: true },
]
