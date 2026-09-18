// Phase 11 E2E fixtures — a deterministic, mocked bid decision. The
// engine has no external network call, so this is mocked purely at
// the HTTP boundary like every other spec (never a live evaluation run).

export const FIXTURE_BID_DECISION_RUN_ID = '00000000-0000-4000-8000-0000000000e1'

export const FIXTURE_BID_DECISION_RUN = {
  id: FIXTURE_BID_DECISION_RUN_ID,
  tenderId: '00000000-0000-4000-8000-000000000001',
  agencyId: '00000000-0000-4000-8000-0000000000ag',
  status: 'COMPLETED',
  bidPolicyVersionId: '00000000-0000-0000-0000-000000000021',
  scoringRunId: '00000000-0000-4000-8000-0000000000d1',
  systemDecision: 'BID',
  humanDecision: null,
  finalDecision: 'BID',
  overrideReason: null,
  overriddenBy: null,
  overriddenAt: null,
  bidEffort: 'MEDIUM',
  bidEffortExplanation: 'Bid effort score 3/8 (mandatory documents: 6, evaluation criteria: 4, mandatory forms: 2, presentation required: false, compulsory briefing: false) -> MEDIUM.',
  decisionExplanation: 'BID / The opportunity satisfies the configured agency bid policy. / Opportunity score: 82, Requirement coverage: 90%, Evaluation fit: 80%, Evidence strength: 75% / No hard blockers detected. Eligible — no confirmed qualification blockers.',
  isCurrent: true,
  isStale: false,
  inputSnapshot: {},
  error: null,
  createdAt: '2026-09-11T09:05:00.000Z',
}

export const FIXTURE_BID_DECISION = {
  run: FIXTURE_BID_DECISION_RUN,
  ruleResults: [
    { id: 'rr1', ruleId: 'minimum-opportunity-score', precedenceStep: 'POSITIVE_BID_RULE', status: 'PASS', severity: 'NO_BID', actualValue: 82, expectedValue: 65, explanation: 'Opportunity score (82) meets the agency\'s configured minimum (65).' },
    { id: 'rr2', ruleId: 'qualification-not-eligible', precedenceStep: 'NOT_ELIGIBLE', status: 'PASS', severity: 'HARD_BLOCK', actualValue: 'ELIGIBLE', expectedValue: 'ELIGIBLE', explanation: 'Qualification overall status is ELIGIBLE.' },
    { id: 'rr3', ruleId: 'minimum-requirement-coverage', precedenceStep: 'DEFAULT_REVIEW', status: 'PASS', severity: 'REVIEW', actualValue: 90, expectedValue: 75, explanation: 'Requirement coverage (90) meets the configured minimum (75).' },
  ],
  blockers: [],
  warnings: [],
  unresolvedItems: [],
  positiveFactors: [],
  humanActionsRequired: [],
}

export const FIXTURE_BID_DECISION_BLOCKED = {
  run: {
    ...FIXTURE_BID_DECISION_RUN,
    systemDecision: 'NO_BID',
    finalDecision: 'NO_BID',
    bidEffort: 'HIGH',
    decisionExplanation: 'NO-BID / The opportunity cannot currently be pursued because qualification overall status is not_eligible — at least one mandatory qualification requirement failed. / Additional factors: Opportunity score: 95, Requirement coverage: 92, Evidence strength: 89, Commercial value: R500,000 / Primary blocker: qualification-not-eligible — FAIL',
  },
  ruleResults: [
    { id: 'rr1', ruleId: 'qualification-not-eligible', precedenceStep: 'NOT_ELIGIBLE', status: 'FAIL', severity: 'HARD_BLOCK', actualValue: 'NOT_ELIGIBLE', expectedValue: 'ELIGIBLE', explanation: 'Qualification overall status is NOT_ELIGIBLE — at least one mandatory qualification requirement failed.' },
  ],
  blockers: [{ id: 'rr1', ruleId: 'qualification-not-eligible', precedenceStep: 'NOT_ELIGIBLE', status: 'FAIL', severity: 'HARD_BLOCK', actualValue: 'NOT_ELIGIBLE', expectedValue: 'ELIGIBLE', explanation: 'Qualification overall status is NOT_ELIGIBLE — at least one mandatory qualification requirement failed.' }],
  warnings: [],
  unresolvedItems: [],
  positiveFactors: [],
  humanActionsRequired: [],
}

export const FIXTURE_BID_DECISION_REVIEW = {
  run: {
    ...FIXTURE_BID_DECISION_RUN,
    systemDecision: 'REVIEW',
    finalDecision: 'REVIEW',
    decisionExplanation: 'REVIEW / The opportunity is potentially attractive but cannot yet receive a BID recommendation. / Reasons: Opportunity score: 82, Data completeness: 54%, Commercial value: unknown / Human action required: Confirm commercial viability (estimated value).',
  },
  ruleResults: [
    { id: 'rr1', ruleId: 'commercial-value-known', precedenceStep: 'INSUFFICIENT_DATA', status: 'UNKNOWN', severity: 'REVIEW', actualValue: null, expectedValue: 'known', explanation: 'Tender estimated value is not available.' },
  ],
  blockers: [],
  warnings: [],
  unresolvedItems: [{ id: 'rr1', ruleId: 'commercial-value-known', precedenceStep: 'INSUFFICIENT_DATA', status: 'UNKNOWN', severity: 'REVIEW', actualValue: null, expectedValue: 'known', explanation: 'Tender estimated value is not available.' }],
  positiveFactors: [],
  humanActionsRequired: ['Confirm commercial viability (estimated value)'],
}
