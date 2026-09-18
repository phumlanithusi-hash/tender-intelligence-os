// Phase 10 E2E fixtures — a deterministic, mocked opportunity score.
// The engine has no external network call, so this is mocked purely at
// the HTTP boundary like every other spec (never a live scoring run).

export const FIXTURE_SCORE_RUN_ID = '00000000-0000-4000-8000-0000000000d1'

export const FIXTURE_OPPORTUNITY_SCORE_RUN = {
  id: FIXTURE_SCORE_RUN_ID,
  tenderId: '00000000-0000-4000-8000-000000000001',
  agencyId: '00000000-0000-4000-8000-0000000000ag',
  status: 'COMPLETED',
  scoringConfigurationVersionId: '00000000-0000-0000-0000-000000000011',
  overallScore: 82,
  dataCompleteness: 0.9,
  decisionSignal: 'HIGH_PRIORITY',
  deadlineStatus: 'OPEN',
  timezoneUnknown: true,
  isCurrent: true,
  isStale: false,
  inputSnapshot: {},
  error: null,
  startedAt: '2026-09-11T09:00:01.000Z',
  completedAt: '2026-09-11T09:00:02.000Z',
  createdAt: '2026-09-11T09:00:00.000Z',
}

export const FIXTURE_OPPORTUNITY_SCORE = {
  run: FIXTURE_OPPORTUNITY_SCORE_RUN,
  components: [
    { id: 'c1', dimension: 'QUALIFICATION', status: 'KNOWN', score: 100, weight: 0.2, explanation: 'Qualification status is ELIGIBLE.', metadata: {} },
    { id: 'c2', dimension: 'REQUIREMENT_COVERAGE', status: 'KNOWN', score: 90, weight: 0.2, explanation: '9 of 10 requirements supported.', metadata: {} },
    { id: 'c3', dimension: 'EVALUATION_FIT', status: 'KNOWN', score: 80, weight: 0.2, explanation: '2 of 2 evaluation criteria assessed.', metadata: {} },
    { id: 'c4', dimension: 'EVIDENCE_STRENGTH', status: 'KNOWN', score: 75, weight: 0.15, explanation: '3 verified, 1 unverified evidence records.', metadata: {} },
    { id: 'c5', dimension: 'COMMERCIAL_FIT', status: 'KNOWN', score: 100, weight: 0.15, explanation: 'Estimated value meets the agency minimum project value threshold.', metadata: {} },
    { id: 'c6', dimension: 'STRATEGIC_FIT', status: 'UNKNOWN', score: null, weight: 0.1, explanation: 'Agency has not recorded a strategic profile.', metadata: {} },
  ],
  drivers: [{ id: 'd1', dimension: 'QUALIFICATION', description: 'All mandatory qualification requirements currently satisfied.', evidence: [] }],
  risks: [{ id: 'r1', dimension: 'STRATEGIC_FIT', description: 'Agency strategic profile is not recorded.', evidence: [] }],
  gates: [
    { id: 'g1', gateType: 'MANDATORY_QUALIFICATION_FAILURE', status: 'OK', description: 'No mandatory qualification failure recorded.', evidence: [] },
    { id: 'g2', gateType: 'MANDATORY_REQUIREMENT_FAILURE', status: 'OK', description: 'No mandatory requirement failure recorded.', evidence: [] },
    { id: 'g3', gateType: 'SUBMISSION_DEADLINE_PASSED', status: 'OK', description: 'Tender closes 2026-12-01.', evidence: [] },
    { id: 'g4', gateType: 'COMPULSORY_BRIEFING_FAILURE', status: 'OK', description: 'No compulsory briefing applies to this tender.', evidence: [] },
    { id: 'g5', gateType: 'CRITICAL_COMPLIANCE_FAILURE', status: 'OK', description: 'No additional critical-compliance signal is modelled.', evidence: [] },
  ],
  unknowns: ['Agency strategic profile is not recorded.'],
}

export const FIXTURE_OPPORTUNITY_SCORE_BLOCKED = {
  run: { ...FIXTURE_OPPORTUNITY_SCORE_RUN, overallScore: 65, decisionSignal: 'BLOCKED' },
  components: FIXTURE_OPPORTUNITY_SCORE.components,
  drivers: [],
  risks: [{ id: 'r2', dimension: 'QUALIFICATION', description: 'Mandatory qualification requirement failed: CSD registration not found.', evidence: [] }],
  gates: [
    { id: 'g1', gateType: 'MANDATORY_QUALIFICATION_FAILURE', status: 'TRIGGERED', description: 'Overall qualification status is NOT_ELIGIBLE.', evidence: [] },
    { id: 'g2', gateType: 'MANDATORY_REQUIREMENT_FAILURE', status: 'OK', description: 'No mandatory requirement failure recorded.', evidence: [] },
    { id: 'g3', gateType: 'SUBMISSION_DEADLINE_PASSED', status: 'OK', description: 'Tender closes 2026-12-01.', evidence: [] },
    { id: 'g4', gateType: 'COMPULSORY_BRIEFING_FAILURE', status: 'OK', description: 'No compulsory briefing applies to this tender.', evidence: [] },
    { id: 'g5', gateType: 'CRITICAL_COMPLIANCE_FAILURE', status: 'OK', description: 'No additional critical-compliance signal is modelled.', evidence: [] },
  ],
  unknowns: [],
}
