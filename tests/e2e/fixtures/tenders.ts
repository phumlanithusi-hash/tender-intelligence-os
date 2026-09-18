/**
 * Controlled fixtures for the Tender Radar E2E flow (Phase 3 §25:
 * "Do not require live tender data for tests. Use controlled test
 * fixtures/mocks rather than fake production records."). These are
 * clearly-synthetic identifiers/values, never shaped to resemble a
 * real published tender, and are only ever served from a mocked
 * `/api/*` route in tests/e2e/tender-radar.spec.ts — they never reach
 * a real database or a real user.
 */

export const FIXTURE_TENDER_SCORED = {
  id: '00000000-0000-4000-8000-000000000001',
  tender_number: 'E2E-TEST-0001',
  title: 'E2E fixture — office consumables supply',
  organisation: 'E2E Fixture Municipality',
  entity_type: 'Municipality',
  province: 'Gauteng',
  municipality: 'E2E Fixture Municipality',
  category: 'Office supplies',
  description: 'Synthetic fixture tender used only by the Tender Radar E2E test.',
  published_date: '2026-08-01',
  closing_date: '2026-09-20',
  closing_time: '12:00:00',
  briefing_required: true,
  briefing_date: '2026-09-05',
  briefing_location: 'Fixture Building, Room 1',
  briefing_url: null,
  estimated_value: 500000,
  contract_duration: '12 months',
  submission_method: 'ONLINE',
  submission_url: null,
  submission_email: null,
  original_document_url: 'https://example-etenders.test/e2e-test-0001',
  status: 'OPEN',
  confidence_score: 0.92,
  discovered_at: '2026-08-01T09:00:00.000Z',
  verified_at: '2026-08-01T10:00:00.000Z',
  created_at: '2026-08-01T09:00:00.000Z',
  updated_at: '2026-08-01T10:00:00.000Z',
}

export const FIXTURE_TENDER_LIST_ROW = {
  ...FIXTURE_TENDER_SCORED,
  serviceNames: ['General Supplies'],
  sourceNames: ['eTenders (Fixture)'],
  currentScore: { scoreClass: 'BID', totalScore: 74 },
}

export const FIXTURE_SUMMARY = {
  openTenders: 1,
  relevant: 1,
  priorityBid: 0,
  closingWithin7Days: 0,
  briefingsRequired: 1,
  addendaRecent: 0,
  estimatedValueTotal: 500000,
}

export const FIXTURE_REQUIREMENTS = [
  {
    id: '00000000-0000-4000-8000-000000000010',
    tender_id: FIXTURE_TENDER_SCORED.id,
    requirement_type: 'TAX',
    requirement_text: 'Valid SARS tax clearance certificate (fixture requirement).',
    mandatory: true,
    severity: 'HIGH',
    source_document_id: null,
    page_number: 2,
    section_reference: 'Section B',
    evidence_text: null,
    confidence: 0.9,
    extraction_status: 'EXTRACTED',
    qualification_status: 'PASS',
    qualification_evidence_id: null,
    qualification_notes: null,
    created_at: '2026-08-01T09:00:00.000Z',
    updated_at: '2026-08-01T09:00:00.000Z',
  },
]

export const FIXTURE_EVALUATION = [
  {
    id: '00000000-0000-4000-8000-000000000020',
    tender_id: FIXTURE_TENDER_SCORED.id,
    criterion: 'Price',
    description: 'Fixture evaluation criterion.',
    weight: 80,
    scoring_method: 'POINTS',
    minimum_score: null,
    source_document_id: null,
    page_number: 5,
    evidence_text: null,
    confidence: 0.9,
    created_at: '2026-08-01T09:00:00.000Z',
    updated_at: '2026-08-01T09:00:00.000Z',
  },
]

/**
 * Phase 9 response shapes for GET /api/tenders/:id/requirements and
 * GET /api/tenders/:id/evaluation (superseding the Phase 2 baseline
 * `{ rows }` shape at these same paths — docs/DECISIONS.md, Phase 9
 * entry). FIXTURE_REQUIREMENTS/FIXTURE_EVALUATION above remain as raw
 * DB-row-shaped fixtures used elsewhere; these are the extracted DTOs.
 */
export const FIXTURE_EXTRACTED_REQUIREMENTS = [
  {
    id: '00000000-0000-4000-8000-000000000010',
    tenderId: FIXTURE_TENDER_SCORED.id,
    parentRequirementId: null,
    category: 'TAX',
    title: 'SARS tax clearance certificate',
    description: 'Valid SARS tax clearance certificate (fixture requirement).',
    mandatoryStatus: 'MANDATORY',
    requirementStatus: 'VERIFIED',
    ruleType: 'DOCUMENT',
    sourceTruth: 'FACT',
    disqualificationRisk: false,
    confidence: 0.9,
    version: 1,
    supersededBy: null,
    evidence: [{ id: '00000000-0000-4000-8000-0000000000e1', documentId: '00000000-0000-4000-8000-0000000000d1', documentVersionId: null, pageId: null, sectionId: null, chunkId: null, pageNumber: 2, evidenceText: 'Valid SARS tax clearance certificate (fixture requirement).' }],
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
  },
]

export const FIXTURE_EVALUATION_CRITERIA = [
  {
    id: '00000000-0000-4000-8000-000000000020',
    tenderId: FIXTURE_TENDER_SCORED.id,
    parentCriterionId: null,
    name: 'Price',
    description: 'Fixture evaluation criterion.',
    criterionType: 'PRICE',
    maximumPoints: 80,
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
    evidence: [{ id: '00000000-0000-4000-8000-0000000000e2', documentId: '00000000-0000-4000-8000-0000000000d1', documentVersionId: null, pageId: null, sectionId: null, chunkId: null, pageNumber: 5, evidenceText: 'Fixture evaluation criterion.' }],
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
  },
]

export const FIXTURE_SERVICES = [
  { id: '00000000-0000-4000-8000-0000000000a1', name: 'General Supplies', slug: 'general-supplies', description: null, active: true, sort_order: 1, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
]

export const FIXTURE_SOURCES = [
  {
    id: '00000000-0000-4000-8000-0000000000b1',
    name: 'eTenders (Fixture)',
    base_url: 'https://example-etenders.test',
    source_type: 'OFFICIAL',
    authority_level: 'PRIMARY',
    jurisdiction: 'National',
    active: true,
    requires_login: false,
    supports_documents: true,
    requires_manual_ingestion: true,
    last_scan_at: null,
    last_success_at: null,
    last_failure_at: null,
    error_count: 0,
    health_status: 'HEALTHY',
    notes: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
]
