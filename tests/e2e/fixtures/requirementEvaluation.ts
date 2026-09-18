// Phase 9 E2E fixtures — requirement & evaluation extraction. Extraction
// involves a real OpenAI call server-side, so it is mocked purely at the
// HTTP boundary here (never a live extraction), same convention as
// fixtures/aiClassification.ts and fixtures/qualification.ts.

const TENDER_ID = '00000000-0000-4000-8000-000000000001'

export const FIXTURE_EXTRACTION_RUN_ID = '00000000-0000-4000-8000-0000000000f1'
export const FIXTURE_REQUIREMENT_PARENT_ID = '00000000-0000-4000-8000-0000000000f2'
export const FIXTURE_REQUIREMENT_CHILD_ID = '00000000-0000-4000-8000-0000000000f3'
export const FIXTURE_CRITERION_ID = '00000000-0000-4000-8000-0000000000f4'

export const FIXTURE_EXTRACTED_REQUIREMENTS_LIST = [
  {
    id: FIXTURE_REQUIREMENT_PARENT_ID,
    tenderId: TENDER_ID,
    parentRequirementId: null,
    category: 'FUNCTIONALITY',
    title: '3. FUNCTIONALITY',
    description: 'Functionality section (fixture).',
    mandatoryStatus: 'UNKNOWN',
    requirementStatus: 'PROVISIONAL',
    ruleType: null,
    sourceTruth: 'INFERENCE',
    disqualificationRisk: false,
    confidence: null,
    version: 1,
    supersededBy: null,
    evidence: [],
    createdAt: '2026-09-11T09:00:00.000Z',
    updatedAt: '2026-09-11T09:00:00.000Z',
  },
  {
    id: FIXTURE_REQUIREMENT_CHILD_ID,
    tenderId: TENDER_ID,
    parentRequirementId: FIXTURE_REQUIREMENT_PARENT_ID,
    category: 'QUALIFICATION',
    title: 'Company Experience (fixture)',
    description: 'Bidders must demonstrate a minimum of 5 years relevant experience.',
    mandatoryStatus: 'MANDATORY',
    requirementStatus: 'VERIFIED',
    ruleType: 'EXPERIENCE',
    sourceTruth: 'FACT',
    disqualificationRisk: true,
    confidence: 0.9,
    version: 1,
    supersededBy: null,
    evidence: [
      {
        id: '00000000-0000-4000-8000-0000000000f5',
        documentId: '00000000-0000-4000-8000-0000000000d1',
        documentVersionId: null,
        pageId: null,
        sectionId: null,
        chunkId: '00000000-0000-4000-8000-0000000000c1',
        pageNumber: 6,
        evidenceText: 'Bidders must demonstrate a minimum of 5 years relevant experience. Failure to comply will result in disqualification.',
      },
    ],
    createdAt: '2026-09-11T09:00:00.000Z',
    updatedAt: '2026-09-11T09:00:00.000Z',
  },
]

export const FIXTURE_REQUIREMENT_CONFLICTS_LIST: unknown[] = []

export const FIXTURE_EVALUATION_CRITERIA_LIST = [
  {
    id: FIXTURE_CRITERION_ID,
    tenderId: TENDER_ID,
    parentCriterionId: null,
    name: 'Company Experience (fixture)',
    description: 'Relevant experience of the bidding company.',
    criterionType: 'FUNCTIONALITY',
    maximumPoints: 20,
    weight: null,
    minimumThreshold: null,
    scoringMethod: 'POINTS',
    scoringBands: [],
    gate: false,
    thresholdType: null,
    formulaText: null,
    formulaType: null,
    formulaVariables: {},
    localContentMinPercent: null,
    presentationMandatory: null,
    presentationDate: null,
    presentationAttendees: null,
    sourceTruth: 'FACT',
    status: 'VERIFIED',
    version: 1,
    supersededBy: null,
    evidence: [
      {
        id: '00000000-0000-4000-8000-0000000000f6',
        documentId: '00000000-0000-4000-8000-0000000000d1',
        documentVersionId: null,
        pageId: null,
        sectionId: null,
        chunkId: '00000000-0000-4000-8000-0000000000c1',
        pageNumber: 6,
        evidenceText: 'This criterion carries a maximum of 20 points.',
      },
    ],
    createdAt: '2026-09-11T09:00:00.000Z',
    updatedAt: '2026-09-11T09:00:00.000Z',
  },
]

export const FIXTURE_EVALUATION_GATES: unknown[] = []
export const FIXTURE_EVALUATION_CONFLICTS_LIST: unknown[] = []

export const FIXTURE_EXTRACTION_RUN = {
  id: FIXTURE_EXTRACTION_RUN_ID,
  tenderId: TENDER_ID,
  status: 'COMPLETED',
  agentName: 'RequirementExtractionAgent',
  model: 'gpt-fixture',
  promptVersion: 'REQUIREMENT_EXTRACTION_PROMPT_V1',
  contextTruncated: false,
  evidenceCoverage: 1,
  conflictCount: 0,
  unknownCount: 1,
  requiresReviewCount: 0,
  validationStatus: 'VALID',
  validationErrors: [],
  error: null,
  startedAt: '2026-09-11T09:00:01.000Z',
  completedAt: '2026-09-11T09:00:02.000Z',
  createdAt: '2026-09-11T09:00:00.000Z',
}
