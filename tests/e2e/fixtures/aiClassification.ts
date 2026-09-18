// Phase 7 E2E fixtures — a deterministic, mocked AI classification
// result. No real OpenAI call is ever involved in this spec (Phase 7
// §37): the AI routes are mocked at the network level exactly like
// tender-radar.spec.ts and source-registry.spec.ts mock their APIs.

export const FIXTURE_RUN_ID = '00000000-0000-4000-8000-0000000000a1'
export const FIXTURE_CLASSIFICATION_ID = '00000000-0000-4000-8000-0000000000a2'
export const FIXTURE_EVIDENCE_ID = '00000000-0000-4000-8000-0000000000a3'

export const FIXTURE_QUEUED_RUN = {
  id: FIXTURE_RUN_ID,
  tenderId: '00000000-0000-4000-8000-000000000001',
  agencyId: '00000000-0000-4000-8000-0000000000ag',
  status: 'QUEUED',
  agentName: 'TenderClassificationAgent',
  model: 'gpt-4o-mini',
  promptVersion: 'TENDER_CLASSIFICATION_PROMPT_V1',
  validationStatus: null,
  validationErrors: [],
  contextTruncated: false,
  error: null,
  errorStage: null,
  retryCount: 0,
  inputTokensEstimate: null,
  outputTokensEstimate: null,
  durationMs: null,
  startedAt: null,
  completedAt: null,
  createdAt: '2026-09-11T09:00:00.000Z',
}

export const FIXTURE_COMPLETED_RUN = {
  ...FIXTURE_QUEUED_RUN,
  status: 'COMPLETED',
  startedAt: '2026-09-11T09:00:01.000Z',
  completedAt: '2026-09-11T09:00:05.000Z',
  durationMs: 4000,
  inputTokensEstimate: 1200,
  outputTokensEstimate: 400,
}

export const FIXTURE_CLASSIFICATION = {
  id: FIXTURE_CLASSIFICATION_ID,
  runId: FIXTURE_RUN_ID,
  tenderId: FIXTURE_QUEUED_RUN.tenderId,
  agencyId: FIXTURE_QUEUED_RUN.agencyId,
  isCurrent: true,
  createdAt: '2026-09-11T09:00:05.000Z',

  relevance: 'RELEVANT',
  relevanceTruth: 'INFERENCE',
  relevanceConfidence: 0.82,

  tenderType: 'RFP',
  tenderTypeTruth: 'INFERENCE',
  tenderTypeConfidence: 0.6,

  intentText:
    'The appointment of a service provider to provide graphic design, printing and related communication material for a period of three years.',
  intentTruth: 'INFERENCE',
  intentConfidence: 0.75,

  services: [{ serviceId: '00000000-0000-4000-8000-0000000000s1', serviceName: 'Graphic Design', confidence: 0.88 }],
  deliverables: [
    {
      id: '00000000-0000-4000-8000-0000000000d1',
      text: 'Corporate brochures and annual reports',
      truth: 'INFERENCE',
      confidence: 0.7,
      evidence: [
        {
          id: FIXTURE_EVIDENCE_ID,
          documentId: '00000000-0000-4000-8000-0000000000d0',
          documentVersionId: '00000000-0000-4000-8000-0000000000v0',
          pageId: null,
          pageNumber: 14,
          sectionId: '00000000-0000-4000-8000-0000000000se',
          chunkId: '00000000-0000-4000-8000-0000000000c1',
          evidenceText: 'The service provider shall design and print corporate brochures and annual reports as required.',
        },
      ],
    },
  ],

  geographicScope: 'PROVINCIAL',
  geographyProvinceId: null,
  geographyMunicipalityId: null,
  geographyTruth: 'INFERENCE',
  geographyConfidence: 0.5,

  contract: {
    durationText: 'three years',
    estimatedValue: null,
    procurementMethod: null,
    isFrameworkOrPanel: true,
    numberOfSuppliers: null,
    appointmentPeriod: 'three years',
  },
  contractTruth: 'INFERENCE',
  contractConfidence: 0.65,

  briefing: {
    status: 'REQUIRED',
    date: '2026-09-05',
    time: '10:00',
    location: 'Fixture Building, Room 1',
    url: null,
    isOnline: false,
    registrationRequired: null,
  },
  briefingTruth: 'FACT',
  briefingConfidence: 0.9,

  apparentRequirements: [
    {
      id: '00000000-0000-4000-8000-0000000000r1',
      kind: 'CSD_REGISTRATION',
      text: 'Bidders must be registered on the Central Supplier Database.',
      truth: 'FACT',
      confidence: 0.9,
      evidence: [],
    },
  ],
  conflicts: [],

  summary:
    'This appears to be a request for proposals seeking a graphic design and print service provider for a three-year appointment.',
  summaryTruth: 'INFERENCE',

  claims: [
    {
      id: '00000000-0000-4000-8000-0000000000cl',
      claimType: 'DELIVERABLE',
      claimKey: 'deliverable:00000000-0000-4000-8000-0000000000d1',
      claimText: 'Corporate brochures and annual reports',
      truth: 'INFERENCE',
      confidence: 0.7,
      evidenceResolved: true,
      evidence: [
        {
          id: FIXTURE_EVIDENCE_ID,
          documentId: '00000000-0000-4000-8000-0000000000d0',
          documentVersionId: '00000000-0000-4000-8000-0000000000v0',
          pageId: null,
          pageNumber: 14,
          sectionId: '00000000-0000-4000-8000-0000000000se',
          chunkId: '00000000-0000-4000-8000-0000000000c1',
          evidenceText: 'The service provider shall design and print corporate brochures and annual reports as required.',
        },
      ],
    },
  ],
}
