// Phase 8 E2E fixtures — a deterministic, mocked qualification result.
// The engine has no external network call, so this is mocked purely
// at the HTTP boundary like every other spec (never a live evaluation).

export const FIXTURE_QUAL_RUN_ID = '00000000-0000-4000-8000-0000000000b1'
export const FIXTURE_REQUIREMENT_MANDATORY_ID = '00000000-0000-4000-8000-0000000000b2'
export const FIXTURE_REQUIREMENT_OPTIONAL_ID = '00000000-0000-4000-8000-0000000000b3'
export const FIXTURE_RESULT_MANDATORY_ID = '00000000-0000-4000-8000-0000000000b4'
export const FIXTURE_RESULT_OPTIONAL_ID = '00000000-0000-4000-8000-0000000000b5'
export const FIXTURE_ACTION_ID = '00000000-0000-4000-8000-0000000000b6'

export const FIXTURE_QUAL_REQUIREMENTS = [
  {
    id: FIXTURE_REQUIREMENT_MANDATORY_ID,
    tenderId: '00000000-0000-4000-8000-000000000001',
    category: 'CSD',
    description: 'Bidders must be registered on the Central Supplier Database.',
    mandatoryStatus: 'MANDATORY',
    sourceTruth: 'FACT',
    requirementStatus: 'VERIFIED',
    ruleType: 'BOOLEAN',
    ruleConfig: {},
    version: 1,
    supersededBy: null,
    createdAt: '2026-09-11T09:00:00.000Z',
    updatedAt: '2026-09-11T09:00:00.000Z',
  },
  {
    id: FIXTURE_REQUIREMENT_OPTIONAL_ID,
    tenderId: '00000000-0000-4000-8000-000000000001',
    category: 'B_BBEE',
    description: 'A higher B-BBEE level will receive additional preference points.',
    mandatoryStatus: 'PREFERENTIAL',
    sourceTruth: 'FACT',
    requirementStatus: 'VERIFIED',
    ruleType: 'ENUM',
    ruleConfig: {},
    version: 1,
    supersededBy: null,
    createdAt: '2026-09-11T09:00:00.000Z',
    updatedAt: '2026-09-11T09:00:00.000Z',
  },
]

export const FIXTURE_QUAL_RUN = {
  id: FIXTURE_QUAL_RUN_ID,
  tenderId: '00000000-0000-4000-8000-000000000001',
  agencyId: '00000000-0000-4000-8000-0000000000ag',
  status: 'COMPLETED',
  overallStatus: 'ACTION_REQUIRED',
  mandatoryBlockerCount: 0,
  actionRequiredCount: 1,
  requiresReviewCount: 0,
  requirementCount: 2,
  error: null,
  startedAt: '2026-09-11T09:00:01.000Z',
  completedAt: '2026-09-11T09:00:02.000Z',
  createdAt: '2026-09-11T09:00:00.000Z',
}

export const FIXTURE_QUALIFICATION = {
  run: FIXTURE_QUAL_RUN,
  results: [
    {
      id: FIXTURE_RESULT_MANDATORY_ID,
      requirementId: FIXTURE_REQUIREMENT_MANDATORY_ID,
      status: 'REQUIRES_ACTION',
      mandatory: true,
      mandatoryStatus: 'MANDATORY',
      explanation: 'Agency is verified as NOT registered on the Central Supplier Database (CSD).',
      evaluatedBy: 'DETERMINISTIC_RULE',
      confidence: null,
      requiresHumanReview: false,
      evaluatedAt: '2026-09-11T09:00:02.000Z',
      tenderEvidence: [
        {
          id: '00000000-0000-4000-8000-0000000000c1',
          documentId: '00000000-0000-4000-8000-0000000000d1',
          documentVersionId: null,
          pageId: null,
          sectionId: null,
          chunkId: null,
          pageNumber: 3,
          evidenceText: 'Bidders must be registered on the Central Supplier Database (CSD) at the time of submission.',
        },
      ],
      agencyEvidence: [],
      actions: [
        {
          id: FIXTURE_ACTION_ID,
          requirementId: FIXTURE_REQUIREMENT_MANDATORY_ID,
          description: 'Register on the Central Supplier Database (CSD).',
          priority: 'CRITICAL',
          dueDate: '2026-10-01T12:00:00.000Z',
          status: 'OPEN',
          createdAt: '2026-09-11T09:00:02.000Z',
        },
      ],
    },
    {
      id: FIXTURE_RESULT_OPTIONAL_ID,
      requirementId: FIXTURE_REQUIREMENT_OPTIONAL_ID,
      status: 'UNKNOWN',
      mandatory: false,
      mandatoryStatus: 'PREFERENTIAL',
      explanation: 'Requires B-BBEE Level 4 or better (eligibility, not preference points); the agency has no verified value on record.',
      evaluatedBy: 'DETERMINISTIC_RULE',
      confidence: null,
      requiresHumanReview: false,
      evaluatedAt: '2026-09-11T09:00:02.000Z',
      tenderEvidence: [],
      agencyEvidence: [],
      actions: [],
    },
  ],
}

export const FIXTURE_QUAL_ACTIONS = FIXTURE_QUALIFICATION.results.flatMap((r) => r.actions)
