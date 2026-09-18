import type { BidRuleResult, BidPolicyConfiguration, BidDecisionInput, BidRuleThreshold } from './types.js'
import type { BidDecisionPrecedenceStep } from '@tender-os/constants'
import type { OpportunityScoreDimension } from '@tender-os/constants'

/**
 * Phase 11 §29-§31 — every rule is a pure function returning a fully
 * populated `BidRuleResult`, always (even UNKNOWN). `evaluateAllRules`
 * runs every one of them, every time — never stops at the first
 * triggered rule.
 */

function componentScore(input: BidDecisionInput, dimension: OpportunityScoreDimension): { known: boolean; score: number | null } {
  const c = input.scoringResult.components.find((c) => c.dimension === dimension)
  if (!c || c.status !== 'KNOWN') return { known: false, score: null }
  return { known: true, score: c.score }
}

function daysBetween(fromIso: string, toDate: string): number | null {
  const from = new Date(fromIso)
  const to = new Date(`${toDate}T00:00:00Z`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null
  return Math.floor((to.getTime() - from.getTime()) / 86400000)
}

function ruleMinimumScore(
  ruleId: string,
  precedenceStepOnFail: BidDecisionPrecedenceStep,
  precedenceStepOnPass: BidDecisionPrecedenceStep,
  rule: BidRuleThreshold<number> | null,
  known: boolean,
  score: number | null,
  label: string,
): BidRuleResult {
  if (!rule || !rule.active) {
    return { ruleId, precedenceStep: precedenceStepOnPass, status: 'PASS', severity: 'WARNING', actualValue: score, expectedValue: null, explanation: `${label}: no policy threshold configured — rule not applied.` }
  }
  if (!known || score === null) {
    return { ruleId, precedenceStep: 'INSUFFICIENT_DATA', status: 'UNKNOWN', severity: 'REVIEW', actualValue: null, expectedValue: rule.value, explanation: `${label} is not yet known.` }
  }
  if (score < rule.value) {
    return { ruleId, precedenceStep: precedenceStepOnFail, status: 'FAIL', severity: rule.severity, actualValue: score, expectedValue: rule.value, explanation: `${label} (${score}) is below the configured minimum (${rule.value}).` }
  }
  return { ruleId, precedenceStep: precedenceStepOnPass, status: 'PASS', severity: rule.severity, actualValue: score, expectedValue: rule.value, explanation: `${label} (${score}) meets the configured minimum (${rule.value}).` }
}

// ---------------------------------------------------------------
// CONFIRMED_NO_BID_RULE — explicit agency exclusions only (Phase 11 §27).
// ---------------------------------------------------------------
function ruleExcludedSector(input: BidDecisionInput, policy: BidPolicyConfiguration): BidRuleResult {
  const rule = policy.excludedSectors
  const tenderSector = input.scoring.strategic.tenderCategory
  if (!rule || !rule.active || rule.value.length === 0) {
    return { ruleId: 'excluded-sector', precedenceStep: 'CONFIRMED_NO_BID_RULE', status: 'PASS', severity: 'WARNING', actualValue: tenderSector, expectedValue: null, explanation: 'No excluded-sector policy configured.' }
  }
  if (!tenderSector) {
    return { ruleId: 'excluded-sector', precedenceStep: 'INSUFFICIENT_DATA', status: 'UNKNOWN', severity: policy.unknownSeverity.STRATEGIC_FIT === 'REVIEW' ? 'REVIEW' : 'WARNING', actualValue: null, expectedValue: rule.value, explanation: 'Tender sector is unknown; cannot check against the excluded-sector policy.' }
  }
  const matched = rule.value.includes(tenderSector)
  return {
    ruleId: 'excluded-sector',
    precedenceStep: 'CONFIRMED_NO_BID_RULE',
    status: matched ? 'FAIL' : 'PASS',
    severity: rule.severity,
    actualValue: tenderSector,
    expectedValue: rule.value,
    explanation: matched ? `Tender sector "${tenderSector}" is on the agency's excluded-sector list.` : `Tender sector "${tenderSector}" is not excluded.`,
  }
}

function ruleExcludedOrganisationType(input: BidDecisionInput, policy: BidPolicyConfiguration): BidRuleResult {
  const rule = policy.excludedOrganisationTypes
  const orgType = input.scoring.strategic.tenderOrgType
  if (!rule || !rule.active || rule.value.length === 0) {
    return { ruleId: 'excluded-organisation-type', precedenceStep: 'CONFIRMED_NO_BID_RULE', status: 'PASS', severity: 'WARNING', actualValue: orgType, expectedValue: null, explanation: 'No excluded-organisation-type policy configured.' }
  }
  if (!orgType) {
    return { ruleId: 'excluded-organisation-type', precedenceStep: 'INSUFFICIENT_DATA', status: 'UNKNOWN', severity: 'WARNING', actualValue: null, expectedValue: rule.value, explanation: 'Tender organisation type is unknown; cannot check against the excluded-organisation-type policy.' }
  }
  const matched = rule.value.includes(orgType)
  return {
    ruleId: 'excluded-organisation-type',
    precedenceStep: 'CONFIRMED_NO_BID_RULE',
    status: matched ? 'FAIL' : 'PASS',
    severity: rule.severity,
    actualValue: orgType,
    expectedValue: rule.value,
    explanation: matched ? `Organisation type "${orgType}" is on the agency's excluded-organisation-type list.` : `Organisation type "${orgType}" is not excluded.`,
  }
}

// ---------------------------------------------------------------
// CLOSED_TENDER (Phase 11 §43) — reuses Phase 10's own deadline gate;
// never an AI-derived date.
// ---------------------------------------------------------------
function ruleTenderClosed(input: BidDecisionInput): BidRuleResult {
  const status = input.scoringResult.deadlineStatus
  if (status === 'CLOSED') {
    return { ruleId: 'tender-closed', precedenceStep: 'CLOSED_TENDER', status: 'FAIL', severity: 'HARD_BLOCK', actualValue: input.scoring.deadline.closingDate, expectedValue: 'OPEN', explanation: 'Tender closing date has passed.' }
  }
  if (status === 'UNKNOWN') {
    return { ruleId: 'tender-closed', precedenceStep: 'INSUFFICIENT_DATA', status: 'UNKNOWN', severity: 'REVIEW', actualValue: null, expectedValue: 'OPEN', explanation: 'Tender closing date is unknown.' }
  }
  return { ruleId: 'tender-closed', precedenceStep: 'CLOSED_TENDER', status: 'PASS', severity: 'HARD_BLOCK', actualValue: input.scoring.deadline.closingDate, expectedValue: 'OPEN', explanation: 'Tender is still open.' }
}

// ---------------------------------------------------------------
// NOT_ELIGIBLE / QUALIFICATION_BLOCKER (Phase 11 §8).
// ---------------------------------------------------------------
function ruleQualification(input: BidDecisionInput, policy: BidPolicyConfiguration): BidRuleResult {
  const status = input.scoring.qualification.overallStatus
  const override = policy.hardGateOverrides['qualification-not-eligible']
  if (status === 'NOT_ELIGIBLE') {
    return { ruleId: 'qualification-not-eligible', precedenceStep: 'NOT_ELIGIBLE', status: 'FAIL', severity: override === 'REVIEW' ? 'REVIEW' : 'HARD_BLOCK', actualValue: status, expectedValue: 'ELIGIBLE', explanation: 'Qualification overall status is NOT_ELIGIBLE — at least one mandatory qualification requirement failed.' }
  }
  if (status === 'ELIGIBLE') {
    return { ruleId: 'qualification-not-eligible', precedenceStep: 'NOT_ELIGIBLE', status: 'PASS', severity: 'HARD_BLOCK', actualValue: status, expectedValue: 'ELIGIBLE', explanation: 'Qualification overall status is ELIGIBLE.' }
  }
  // null (no run), REQUIRES_REVIEW, ACTION_REQUIRED, UNKNOWN all -> REVIEW (Phase 11 §8).
  return { ruleId: 'qualification-status-review', precedenceStep: 'QUALIFICATION_BLOCKER', status: 'UNKNOWN', severity: 'REVIEW', actualValue: status, expectedValue: 'ELIGIBLE', explanation: `Qualification overall status is ${status ?? 'not yet evaluated'} — human review required before this can be treated as eligible.` }
}

// ---------------------------------------------------------------
// CONFIRMED_MANDATORY_FAILURE (Phase 11 §5).
// ---------------------------------------------------------------
function ruleMandatoryRequirementFailure(input: BidDecisionInput, policy: BidPolicyConfiguration): BidRuleResult {
  const gate = input.scoringResult.gates.find((g) => g.gateType === 'MANDATORY_REQUIREMENT_FAILURE')
  const override = policy.hardGateOverrides['mandatory-requirement-failure']
  if (!gate || gate.status === 'UNKNOWN') {
    return { ruleId: 'mandatory-requirement-failure', precedenceStep: 'INSUFFICIENT_DATA', status: 'UNKNOWN', severity: 'REVIEW', actualValue: null, expectedValue: 'OK', explanation: 'Mandatory requirement compliance has not been fully evaluated yet.' }
  }
  if (gate.status === 'TRIGGERED') {
    return { ruleId: 'mandatory-requirement-failure', precedenceStep: 'CONFIRMED_MANDATORY_FAILURE', status: 'FAIL', severity: override === 'REVIEW' ? 'REVIEW' : 'HARD_BLOCK', actualValue: 'TRIGGERED', expectedValue: 'OK', explanation: gate.description }
  }
  return { ruleId: 'mandatory-requirement-failure', precedenceStep: 'CONFIRMED_MANDATORY_FAILURE', status: 'PASS', severity: 'HARD_BLOCK', actualValue: 'OK', expectedValue: 'OK', explanation: 'No confirmed mandatory requirement failure.' }
}

// ---------------------------------------------------------------
// CONFIRMED_SUBMISSION_IMPOSSIBILITY — compulsory briefing + deadline
// feasibility (Phase 11 §6/§22).
// ---------------------------------------------------------------
function ruleCompulsoryBriefing(input: BidDecisionInput, policy: BidPolicyConfiguration): BidRuleResult {
  const gate = input.scoringResult.gates.find((g) => g.gateType === 'COMPULSORY_BRIEFING_FAILURE')
  const override = policy.hardGateOverrides['compulsory-briefing-missed']
  if (!gate || gate.status === 'UNKNOWN') {
    const severity = policy.unknownSeverity.BRIEFING_ATTENDANCE === 'CONTINUE' ? 'WARNING' : 'REVIEW'
    return { ruleId: 'compulsory-briefing-missed', precedenceStep: severity === 'WARNING' ? 'DEFAULT_REVIEW' : 'INSUFFICIENT_DATA', status: 'UNKNOWN', severity, actualValue: null, expectedValue: 'ATTENDED', explanation: 'Compulsory briefing attendance is unknown (this is REVIEW, never an assumed miss, per Phase 11 §6).' }
  }
  if (gate.status === 'TRIGGERED') {
    return { ruleId: 'compulsory-briefing-missed', precedenceStep: 'CONFIRMED_SUBMISSION_IMPOSSIBILITY', status: 'FAIL', severity: override === 'REVIEW' ? 'REVIEW' : 'HARD_BLOCK', actualValue: 'NOT_ATTENDED', expectedValue: 'ATTENDED', explanation: 'Compulsory briefing attendance is confirmed as missed.' }
  }
  return { ruleId: 'compulsory-briefing-missed', precedenceStep: 'CONFIRMED_SUBMISSION_IMPOSSIBILITY', status: 'PASS', severity: 'HARD_BLOCK', actualValue: 'OK', expectedValue: 'ATTENDED', explanation: gate.description }
}

function ruleMinimumPreparationDays(input: BidDecisionInput, policy: BidPolicyConfiguration): BidRuleResult {
  const rule = policy.minimumPreparationDays
  if (!rule || !rule.active) {
    return { ruleId: 'minimum-preparation-days', precedenceStep: 'DEFAULT_REVIEW', status: 'PASS', severity: 'WARNING', actualValue: null, expectedValue: null, explanation: 'No minimum-preparation-days policy configured.' }
  }
  const closingDate = input.scoring.deadline.closingDate
  if (!closingDate || input.scoringResult.deadlineStatus === 'CLOSED') {
    if (input.scoringResult.deadlineStatus === 'CLOSED') {
      return { ruleId: 'minimum-preparation-days', precedenceStep: 'CLOSED_TENDER', status: 'FAIL', severity: rule.severity, actualValue: 0, expectedValue: rule.value, explanation: 'Tender is already closed — no preparation time remains.' }
    }
    return { ruleId: 'minimum-preparation-days', precedenceStep: 'INSUFFICIENT_DATA', status: 'UNKNOWN', severity: policy.unknownSeverity.DEADLINE === 'CONTINUE' ? 'WARNING' : 'REVIEW', actualValue: null, expectedValue: rule.value, explanation: 'Closing date is unknown; preparation time cannot be assessed.' }
  }
  const days = daysBetween(input.now, closingDate)
  if (days === null) {
    return { ruleId: 'minimum-preparation-days', precedenceStep: 'INSUFFICIENT_DATA', status: 'UNKNOWN', severity: 'REVIEW', actualValue: null, expectedValue: rule.value, explanation: 'Could not compute days remaining until closing.' }
  }
  const step: BidDecisionPrecedenceStep = rule.severity === 'HARD_BLOCK' || rule.severity === 'NO_BID' ? 'CONFIRMED_SUBMISSION_IMPOSSIBILITY' : 'MATERIAL_UNRESOLVED_RISK'
  if (days < rule.value) {
    return { ruleId: 'minimum-preparation-days', precedenceStep: step, status: 'FAIL', severity: rule.severity, actualValue: days, expectedValue: rule.value, explanation: `Only ${days} day(s) remain before closing; policy requires at least ${rule.value}.` }
  }
  return { ruleId: 'minimum-preparation-days', precedenceStep: 'DEFAULT_REVIEW', status: 'PASS', severity: rule.severity, actualValue: days, expectedValue: rule.value, explanation: `${days} day(s) remain before closing — sufficient preparation time is available.` }
}

function ruleMaximumPreparationDays(input: BidDecisionInput, policy: BidPolicyConfiguration): BidRuleResult {
  const rule = policy.maximumPreparationDays
  if (!rule || !rule.active) {
    return { ruleId: 'maximum-preparation-days', precedenceStep: 'DEFAULT_REVIEW', status: 'PASS', severity: 'WARNING', actualValue: null, expectedValue: null, explanation: 'No maximum-preparation-days policy configured.' }
  }
  const closingDate = input.scoring.deadline.closingDate
  if (!closingDate) {
    return { ruleId: 'maximum-preparation-days', precedenceStep: 'INSUFFICIENT_DATA', status: 'UNKNOWN', severity: 'WARNING', actualValue: null, expectedValue: rule.value, explanation: 'Closing date is unknown.' }
  }
  const days = daysBetween(input.now, closingDate)
  if (days === null) return { ruleId: 'maximum-preparation-days', precedenceStep: 'INSUFFICIENT_DATA', status: 'UNKNOWN', severity: 'WARNING', actualValue: null, expectedValue: rule.value, explanation: 'Could not compute days remaining until closing.' }
  if (days > rule.value) {
    return { ruleId: 'maximum-preparation-days', precedenceStep: 'MATERIAL_UNRESOLVED_RISK', status: 'FAIL', severity: rule.severity, actualValue: days, expectedValue: rule.value, explanation: `${days} day(s) remain before closing, above the configured maximum of ${rule.value}.` }
  }
  return { ruleId: 'maximum-preparation-days', precedenceStep: 'DEFAULT_REVIEW', status: 'PASS', severity: rule.severity, actualValue: days, expectedValue: rule.value, explanation: `${days} day(s) remain before closing, within the configured maximum.` }
}

// ---------------------------------------------------------------
// INSUFFICIENT_DATA — data completeness + commercial value (Phase 11 §15/§20).
// ---------------------------------------------------------------
function ruleDataCompleteness(input: BidDecisionInput, policy: BidPolicyConfiguration): BidRuleResult {
  const rule = policy.minimumDataCompleteness
  const completeness = input.scoringResult.dataCompleteness
  if (!rule || !rule.active) {
    return { ruleId: 'minimum-data-completeness', precedenceStep: 'DEFAULT_REVIEW', status: 'PASS', severity: 'WARNING', actualValue: completeness, expectedValue: null, explanation: 'No minimum-data-completeness policy configured.' }
  }
  if (completeness < rule.value) {
    return { ruleId: 'minimum-data-completeness', precedenceStep: 'INSUFFICIENT_DATA', status: 'FAIL', severity: rule.severity, actualValue: completeness, expectedValue: rule.value, explanation: `Data completeness (${Math.round(completeness * 100)}%) is below the configured minimum (${Math.round(rule.value * 100)}%). A high opportunity score must never be treated as BID when data completeness is this low.` }
  }
  return { ruleId: 'minimum-data-completeness', precedenceStep: 'DEFAULT_REVIEW', status: 'PASS', severity: rule.severity, actualValue: completeness, expectedValue: rule.value, explanation: `Data completeness (${Math.round(completeness * 100)}%) meets the configured minimum.` }
}

function ruleCommercialValueKnown(input: BidDecisionInput, policy: BidPolicyConfiguration): BidRuleResult {
  const value = input.scoring.commercial.estimatedValue
  if (value === null) {
    const severity = policy.unknownSeverity.COMMERCIAL_VALUE === 'CONTINUE' ? 'WARNING' : 'REVIEW'
    return { ruleId: 'commercial-value-known', precedenceStep: severity === 'WARNING' ? 'DEFAULT_REVIEW' : 'INSUFFICIENT_DATA', status: 'UNKNOWN', severity, actualValue: null, expectedValue: 'known', explanation: 'Tender estimated value is not available.' }
  }
  return { ruleId: 'commercial-value-known', precedenceStep: 'DEFAULT_REVIEW', status: 'PASS', severity: 'WARNING', actualValue: value, expectedValue: 'known', explanation: `Estimated tender value is known (R${value.toLocaleString('en-ZA')}).` }
}

function ruleMinimumContractValue(input: BidDecisionInput, policy: BidPolicyConfiguration): BidRuleResult {
  const rule = policy.minimumContractValue
  const value = input.scoring.commercial.estimatedValue
  if (!rule || !rule.active) {
    return { ruleId: 'minimum-contract-value', precedenceStep: 'DEFAULT_REVIEW', status: 'PASS', severity: 'WARNING', actualValue: value, expectedValue: null, explanation: 'No minimum-contract-value policy configured.' }
  }
  if (value === null) {
    return { ruleId: 'minimum-contract-value', precedenceStep: 'INSUFFICIENT_DATA', status: 'UNKNOWN', severity: 'REVIEW', actualValue: null, expectedValue: rule.value, explanation: 'Tender estimated value is unknown; cannot check against the minimum-contract-value policy.' }
  }
  if (value < rule.value) {
    return { ruleId: 'minimum-contract-value', precedenceStep: 'MATERIAL_UNRESOLVED_RISK', status: 'FAIL', severity: rule.severity, actualValue: value, expectedValue: rule.value, explanation: `Estimated value (R${value.toLocaleString('en-ZA')}) is below the agency's configured minimum contract value (R${rule.value.toLocaleString('en-ZA')}).` }
  }
  return { ruleId: 'minimum-contract-value', precedenceStep: 'DEFAULT_REVIEW', status: 'PASS', severity: rule.severity, actualValue: value, expectedValue: rule.value, explanation: `Estimated value meets the agency's configured minimum contract value.` }
}

// ---------------------------------------------------------------
// MATERIAL_UNRESOLVED_RISK — score-component thresholds, evidence,
// evaluation conflicts, bid effort (Phase 11 §17-§19/§25/§42).
// ---------------------------------------------------------------
function ruleRequirementCoverage(input: BidDecisionInput, policy: BidPolicyConfiguration): BidRuleResult {
  const { known, score } = componentScore(input, 'REQUIREMENT_COVERAGE')
  return ruleMinimumScore('minimum-requirement-coverage', 'MATERIAL_UNRESOLVED_RISK', 'DEFAULT_REVIEW', policy.minimumRequirementCoverage, known, score, 'Requirement coverage')
}
function ruleEvidenceStrength(input: BidDecisionInput, policy: BidPolicyConfiguration): BidRuleResult {
  const { known, score } = componentScore(input, 'EVIDENCE_STRENGTH')
  return ruleMinimumScore('minimum-evidence-strength', 'MATERIAL_UNRESOLVED_RISK', 'DEFAULT_REVIEW', policy.minimumEvidenceStrength, known, score, 'Evidence strength')
}
function ruleEvaluationFit(input: BidDecisionInput, policy: BidPolicyConfiguration): BidRuleResult {
  const { known, score } = componentScore(input, 'EVALUATION_FIT')
  return ruleMinimumScore('minimum-evaluation-fit', 'MATERIAL_UNRESOLVED_RISK', 'DEFAULT_REVIEW', policy.minimumEvaluationFit, known, score, 'Evaluation fit')
}
function ruleStrategicFit(input: BidDecisionInput, policy: BidPolicyConfiguration): BidRuleResult {
  if (!input.scoring.strategic.strategicProfileKnown) {
    return { ruleId: 'minimum-strategic-fit', precedenceStep: 'DEFAULT_REVIEW', status: 'UNKNOWN', severity: 'WARNING', actualValue: null, expectedValue: null, explanation: 'Agency strategic profile is not configured (strategicPolicy=NOT_CONFIGURED) — this is never penalised (Phase 11 §26).' }
  }
  const { known, score } = componentScore(input, 'STRATEGIC_FIT')
  return ruleMinimumScore('minimum-strategic-fit', 'MATERIAL_UNRESOLVED_RISK', 'DEFAULT_REVIEW', policy.minimumStrategicFit, known, score, 'Strategic fit')
}

function ruleUnresolvedEvaluationConflict(input: BidDecisionInput, policy: BidPolicyConfiguration): BidRuleResult {
  const rule = policy.unresolvedEvaluationConflict
  const count = input.evaluationConflict.unresolvedCount
  if (!rule || !rule.active) {
    return { ruleId: 'unresolved-evaluation-conflict', precedenceStep: 'DEFAULT_REVIEW', status: count > 0 ? 'UNKNOWN' : 'PASS', severity: 'WARNING', actualValue: count, expectedValue: null, explanation: count > 0 ? `${count} unresolved evaluation conflict(s) exist but no policy is configured for this.` : 'No unresolved evaluation conflicts.' }
  }
  if (count > 0) {
    return { ruleId: 'unresolved-evaluation-conflict', precedenceStep: 'MATERIAL_UNRESOLVED_RISK', status: 'FAIL', severity: rule.severity, actualValue: count, expectedValue: 0, explanation: `${count} unresolved evaluation conflict(s) (e.g. an unreconciled addendum) exist. Phase 11 does not resolve these itself.` }
  }
  return { ruleId: 'unresolved-evaluation-conflict', precedenceStep: 'DEFAULT_REVIEW', status: 'PASS', severity: rule.severity, actualValue: 0, expectedValue: 0, explanation: 'No unresolved evaluation conflicts.' }
}

function ruleBidEffort(bidEffortLevel: string, policy: BidPolicyConfiguration): BidRuleResult {
  const rule = policy.maximumBidEffort
  if (!rule || !rule.active) {
    return { ruleId: 'maximum-bid-effort', precedenceStep: 'DEFAULT_REVIEW', status: 'PASS', severity: 'WARNING', actualValue: bidEffortLevel, expectedValue: null, explanation: 'No maximum-bid-effort policy configured. Bid effort is informational only (Phase 11 §25) — it never becomes a score.' }
  }
  if (bidEffortLevel === 'UNKNOWN') {
    return { ruleId: 'maximum-bid-effort', precedenceStep: 'DEFAULT_REVIEW', status: 'UNKNOWN', severity: 'WARNING', actualValue: bidEffortLevel, expectedValue: rule.value, explanation: 'Bid effort could not be estimated from available structured data.' }
  }
  const order = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const
  const exceeds = order[bidEffortLevel as 'LOW' | 'MEDIUM' | 'HIGH'] > order[rule.value as 'LOW' | 'MEDIUM' | 'HIGH']
  if (exceeds) {
    return { ruleId: 'maximum-bid-effort', precedenceStep: 'MATERIAL_UNRESOLVED_RISK', status: 'FAIL', severity: rule.severity, actualValue: bidEffortLevel, expectedValue: rule.value, explanation: `Bid effort (${bidEffortLevel}) exceeds the agency's configured maximum (${rule.value}). Bid effort is not a score — this is a capacity/judgement flag only.` }
  }
  return { ruleId: 'maximum-bid-effort', precedenceStep: 'DEFAULT_REVIEW', status: 'PASS', severity: rule.severity, actualValue: bidEffortLevel, expectedValue: rule.value, explanation: `Bid effort (${bidEffortLevel}) is within the agency's configured maximum.` }
}

// ---------------------------------------------------------------
// POSITIVE_BID_RULE — the score threshold (Phase 11 §13).
// ---------------------------------------------------------------
function ruleMinimumOpportunityScore(input: BidDecisionInput, policy: BidPolicyConfiguration): BidRuleResult {
  const rule = policy.minimumOpportunityScore
  const score = input.scoringResult.overallScore
  if (!rule || !rule.active) {
    return { ruleId: 'minimum-opportunity-score', precedenceStep: 'DEFAULT_REVIEW', status: score === null ? 'UNKNOWN' : 'PASS', severity: 'WARNING', actualValue: score, expectedValue: null, explanation: 'No minimum-opportunity-score policy configured — score alone never determines the decision.' }
  }
  if (score === null) {
    return { ruleId: 'minimum-opportunity-score', precedenceStep: 'INSUFFICIENT_DATA', status: 'UNKNOWN', severity: 'REVIEW', actualValue: null, expectedValue: rule.value, explanation: 'Opportunity score is not yet available.' }
  }
  if (score < rule.value) {
    return { ruleId: 'minimum-opportunity-score', precedenceStep: 'MATERIAL_UNRESOLVED_RISK', status: 'FAIL', severity: rule.severity, actualValue: score, expectedValue: rule.value, explanation: `Opportunity score (${score}) is below the agency's configured minimum (${rule.value}).` }
  }
  return { ruleId: 'minimum-opportunity-score', precedenceStep: 'POSITIVE_BID_RULE', status: 'PASS', severity: rule.severity, actualValue: score, expectedValue: rule.value, explanation: `Opportunity score (${score}) meets the agency's configured minimum (${rule.value}).` }
}

// ---------------------------------------------------------------
// WARNING-only, never blocking — capacity (§23) and margin (§20)
// schema seams, and preferred-alignment informational rules (§26).
// ---------------------------------------------------------------
function ruleCapacity(input: BidDecisionInput): BidRuleResult {
  if (!input.capacity.known) {
    return { ruleId: 'capacity-known', precedenceStep: 'DEFAULT_REVIEW', status: 'UNKNOWN', severity: 'WARNING', actualValue: null, expectedValue: null, explanation: 'No agency capacity model exists yet — capacity is UNKNOWN, never fabricated (Phase 11 §23).' }
  }
  return { ruleId: 'capacity-known', precedenceStep: 'DEFAULT_REVIEW', status: 'PASS', severity: 'WARNING', actualValue: input.capacity.availableTeamCapacity, expectedValue: null, explanation: 'Agency capacity data is available.' }
}

function ruleExpectedMargin(policy: BidPolicyConfiguration): BidRuleResult {
  return { ruleId: 'minimum-expected-margin', precedenceStep: 'DEFAULT_REVIEW', status: 'UNKNOWN', severity: 'WARNING', actualValue: null, expectedValue: policy.minimumExpectedMargin?.value ?? null, explanation: 'No real cost/pricing data source exists in this phase — expected margin is always UNKNOWN and never estimated (Phase 11 §20, carried-forward limitation).' }
}

function preferredAlignment(ruleId: string, actual: string | null, preferred: string[], label: string): BidRuleResult {
  if (preferred.length === 0) return { ruleId, precedenceStep: 'DEFAULT_REVIEW', status: 'PASS', severity: 'WARNING', actualValue: actual, expectedValue: null, explanation: `No preferred-${label} policy configured.` }
  if (!actual) return { ruleId, precedenceStep: 'DEFAULT_REVIEW', status: 'UNKNOWN', severity: 'WARNING', actualValue: null, expectedValue: preferred, explanation: `Tender ${label} is unknown.` }
  const matched = preferred.includes(actual)
  return { ruleId, precedenceStep: 'DEFAULT_REVIEW', status: matched ? 'PASS' : 'UNKNOWN', severity: 'WARNING', actualValue: actual, expectedValue: preferred, explanation: matched ? `Tender ${label} ("${actual}") matches the agency's preferred list.` : `Tender ${label} ("${actual}") is not on the agency's preferred list — this is informational only, never a penalty.` }
}

export function evaluateAllRules(input: BidDecisionInput, policy: BidPolicyConfiguration, bidEffortLevel: string): BidRuleResult[] {
  return [
    ruleExcludedSector(input, policy),
    ruleExcludedOrganisationType(input, policy),
    ruleTenderClosed(input),
    ruleQualification(input, policy),
    ruleMandatoryRequirementFailure(input, policy),
    ruleCompulsoryBriefing(input, policy),
    ruleMinimumPreparationDays(input, policy),
    ruleMaximumPreparationDays(input, policy),
    ruleDataCompleteness(input, policy),
    ruleCommercialValueKnown(input, policy),
    ruleMinimumContractValue(input, policy),
    ruleRequirementCoverage(input, policy),
    ruleEvidenceStrength(input, policy),
    ruleEvaluationFit(input, policy),
    ruleStrategicFit(input, policy),
    ruleUnresolvedEvaluationConflict(input, policy),
    ruleBidEffort(bidEffortLevel, policy),
    ruleMinimumOpportunityScore(input, policy),
    ruleCapacity(input),
    ruleExpectedMargin(policy),
    preferredAlignment('preferred-service-alignment', input.scoring.serviceAlignment.requiredServiceIds[0] ?? null, policy.preferredServices, 'service'),
    preferredAlignment('preferred-sector-alignment', input.scoring.strategic.tenderCategory, policy.preferredSectors, 'sector'),
    preferredAlignment('preferred-organisation-alignment', input.scoring.strategic.tenderOrgType, policy.preferredOrganisationTypes, 'organisation type'),
  ]
}
