import type { BidPolicyConfiguration } from './types.js'

/**
 * Fallback used only when no database is configured (unit tests, local
 * dev) — mirrors the seed rows in
 * database/migrations/20260911240000_bid_decision_engine.sql exactly,
 * same convention as lib/scoring/defaultConfig.ts. The production path
 * always reads the persisted per-agency policy via
 * supabaseBidDecisionStore.ts.
 */
export const DEFAULT_BID_POLICY: BidPolicyConfiguration = {
  id: '00000000-0000-0000-0000-000000000021',
  policyId: '00000000-0000-0000-0000-000000000020',
  version: 1,
  precedence: [
    'CONFIRMED_NO_BID_RULE',
    'CLOSED_TENDER',
    'NOT_ELIGIBLE',
    'CONFIRMED_MANDATORY_FAILURE',
    'CONFIRMED_SUBMISSION_IMPOSSIBILITY',
    'QUALIFICATION_BLOCKER',
    'MATERIAL_UNRESOLVED_RISK',
    'INSUFFICIENT_DATA',
    'POSITIVE_BID_RULE',
    'DEFAULT_REVIEW',
  ],
  hardGateOverrides: {},
  minimumOpportunityScore: { active: true, severity: 'NO_BID', value: 65 },
  minimumDataCompleteness: { active: true, severity: 'REVIEW', value: 0.7 },
  minimumRequirementCoverage: { active: true, severity: 'REVIEW', value: 75 },
  minimumEvidenceStrength: { active: true, severity: 'REVIEW', value: 60 },
  minimumEvaluationFit: { active: true, severity: 'REVIEW', value: 50 },
  minimumStrategicFit: null,
  minimumContractValue: null,
  preferredContractValue: null,
  minimumPreparationDays: { active: true, severity: 'REVIEW', value: 7 },
  maximumPreparationDays: null,
  minimumExpectedMargin: null,
  maximumBidEffort: null,
  preferredServices: [],
  preferredSectors: [],
  preferredOrganisationTypes: [],
  preferredProvinces: [],
  excludedOrganisationTypes: null,
  excludedSectors: null,
  unresolvedEvaluationConflict: { active: true, severity: 'REVIEW', value: true },
  unknownSeverity: {
    COMMERCIAL_VALUE: 'REVIEW',
    STRATEGIC_FIT: 'CONTINUE',
    BRIEFING_ATTENDANCE: 'REVIEW',
    EVALUATION_CONFLICT: 'REVIEW',
    DEADLINE: 'REVIEW',
  },
  scoreBands: [
    { min: 80, max: 100, label: 'Strong bid candidate' },
    { min: 65, max: 79, label: 'Potentially bid' },
    { min: 50, max: 64, label: 'Review' },
    { min: 0, max: 49, label: 'Normally no-bid' },
  ],
}

const VALID_SEVERITIES = new Set(['HARD_BLOCK', 'NO_BID', 'REVIEW', 'WARNING'])
const VALID_PRECEDENCE = new Set([
  'CONFIRMED_NO_BID_RULE',
  'CLOSED_TENDER',
  'NOT_ELIGIBLE',
  'CONFIRMED_MANDATORY_FAILURE',
  'CONFIRMED_SUBMISSION_IMPOSSIBILITY',
  'QUALIFICATION_BLOCKER',
  'MATERIAL_UNRESOLVED_RISK',
  'INSUFFICIENT_DATA',
  'POSITIVE_BID_RULE',
  'DEFAULT_REVIEW',
])

/** Phase 11 §59 — reject impossible configs before they are ever persisted or evaluated. */
export function assertValidBidPolicy(policy: BidPolicyConfiguration): void {
  if (policy.precedence.length !== VALID_PRECEDENCE.size || new Set(policy.precedence).size !== VALID_PRECEDENCE.size) {
    throw new Error('Bid policy precedence must contain each precedence step exactly once.')
  }
  for (const step of policy.precedence) {
    if (!VALID_PRECEDENCE.has(step)) throw new Error(`Invalid precedence step: ${step}`)
  }
  const scorePairs: Array<[string, { active: boolean; severity: string; value: number } | null]> = [
    ['minimumOpportunityScore', policy.minimumOpportunityScore],
    ['minimumRequirementCoverage', policy.minimumRequirementCoverage],
    ['minimumEvidenceStrength', policy.minimumEvidenceStrength],
    ['minimumEvaluationFit', policy.minimumEvaluationFit],
    ['minimumStrategicFit', policy.minimumStrategicFit],
  ]
  for (const [name, rule] of scorePairs) {
    if (!rule) continue
    if (!VALID_SEVERITIES.has(rule.severity)) throw new Error(`Invalid severity for ${name}: ${rule.severity}`)
    if (rule.value < 0 || rule.value > 100) throw new Error(`${name} must be between 0 and 100 (got ${rule.value}).`)
  }
  if (policy.minimumDataCompleteness) {
    if (policy.minimumDataCompleteness.value < 0 || policy.minimumDataCompleteness.value > 1) {
      throw new Error(`minimumDataCompleteness must be between 0 and 1 (got ${policy.minimumDataCompleteness.value}).`)
    }
  }
  if (policy.minimumPreparationDays && policy.minimumPreparationDays.value < 0) {
    throw new Error('minimumPreparationDays must not be negative.')
  }
  if (policy.maximumPreparationDays && policy.maximumPreparationDays.value < 0) {
    throw new Error('maximumPreparationDays must not be negative.')
  }
  if (policy.minimumContractValue && policy.minimumContractValue.value < 0) {
    throw new Error('minimumContractValue must not be negative.')
  }
  for (const band of policy.scoreBands) {
    if (band.min < 0 || band.max > 100 || band.min > band.max) throw new Error(`Invalid score band: ${JSON.stringify(band)}`)
  }
  const ruleIds = new Set<string>()
  for (const id of ['minimumOpportunityScore', 'minimumRequirementCoverage', 'minimumEvidenceStrength', 'minimumEvaluationFit']) {
    if (ruleIds.has(id)) throw new Error(`Duplicate rule id: ${id}`)
    ruleIds.add(id)
  }
}
