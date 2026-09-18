/**
 * Controlled fixtures for the Phase 5 eTenders ingestion E2E flow
 * (Phase 5 §29: "controlled ingestion E2E test not dependent on the
 * live website"). Shapes a DISCOVERED (not VERIFIED) tender as the
 * ingestion pipeline would actually leave it — no opportunity score,
 * no relevance — and a PARTIAL scan with one recorded error, exactly
 * as a real eTenders scan with one malformed record would look
 * (scanRunner.test.ts / ingestion.integration.test.ts exercise the
 * pipeline itself; this fixture only shapes what the UI is asked to
 * render). Clearly-synthetic ids only — never a real tender or a real
 * scrape.
 */

export const FIXTURE_ETENDERS_SOURCE = {
  id: '00000000-0000-4000-8000-0000000000f1',
  name: 'eTenders (National Treasury)',
  base_url: 'https://www.etenders.gov.za',
  source_type: 'OFFICIAL',
  authority_level: 'PRIMARY',
  jurisdiction: 'National',
  active: true,
  scan_frequency: '1 day',
  requires_login: false,
  supports_documents: true,
  requires_manual_ingestion: false,
  last_scan_at: '2026-09-11T08:00:00.000Z',
  last_success_at: null,
  last_failure_at: null,
  error_count: 1,
  health_status: 'WARNING',
  adapter_key: 'etenders',
  adapter_state: 'CONFIGURED',
  paused_at: null,
  notes: 'Adapter implemented (Phase 5) — not yet validated against the live site from this build environment.',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-09-11T08:05:00.000Z',
  nextScheduledScanAt: null,
}

export const FIXTURE_ETENDERS_SOURCE_SUMMARY = {
  totalSources: 1,
  active: 1,
  healthy: 0,
  warning: 1,
  failed: 0,
  notConnected: 0,
}

export const FIXTURE_ETENDERS_SCAN = {
  id: '00000000-0000-4000-8000-0000000000f2',
  source_id: FIXTURE_ETENDERS_SOURCE.id,
  started_at: '2026-09-11T08:00:00.000Z',
  completed_at: '2026-09-11T08:01:30.000Z',
  status: 'PARTIAL',
  records_discovered: 10,
  records_processed: 9,
  records_failed: 1,
  documents_discovered: 3,
  error_count: 1,
  error_message: null,
  execution_id: 'e2e-fixture-scan-1',
  adapter_version: '1.0.0',
  created_at: '2026-09-11T08:00:00.000Z',
}

export const FIXTURE_ETENDERS_ERRORS = [
  {
    id: '00000000-0000-4000-8000-0000000000f3',
    source_id: FIXTURE_ETENDERS_SOURCE.id,
    scan_id: FIXTURE_ETENDERS_SCAN.id,
    error_type: 'VALIDATION',
    severity: 'MEDIUM',
    message: 'Cannot create a canonical tender with no discoverable title.',
    url: 'https://www.etenders.gov.za/Home/opportunity?id=100004',
    status_code: null,
    retryable: false,
    occurred_at: '2026-09-11T08:00:45.000Z',
    resolved_at: null,
    metadata: { externalId: 'ET-100004' },
  },
]

/** A tender exactly as the ingestion pipeline leaves it: DISCOVERED, no score, no relevance — the UI must not imply otherwise (Phase 5 §8/§26). */
export const FIXTURE_DISCOVERED_TENDER = {
  id: '00000000-0000-4000-8000-0000000000f4',
  tender_number: 'DPWI/2026/0091',
  title: 'Appointment of a service provider for the refurbishment of office buildings in Pretoria',
  organisation: 'Department of Public Works and Infrastructure',
  entity_type: null,
  province: 'Gauteng',
  municipality: null,
  category: 'Construction',
  description: null,
  published_date: '2026-09-01',
  closing_date: '2026-09-30',
  closing_time: '11:00:00',
  briefing_required: false,
  briefing_date: null,
  briefing_location: null,
  briefing_url: null,
  estimated_value: null,
  contract_duration: null,
  submission_method: 'ONLINE',
  submission_url: null,
  submission_email: null,
  original_document_url: 'https://www.etenders.gov.za/Home/opportunity?id=100001',
  status: 'DISCOVERED',
  confidence_score: null,
  discovered_at: '2026-09-11T08:00:10.000Z',
  verified_at: null,
  created_at: '2026-09-11T08:00:10.000Z',
  updated_at: '2026-09-11T08:00:10.000Z',
}

export const FIXTURE_DISCOVERED_TENDER_LIST_ROW = {
  ...FIXTURE_DISCOVERED_TENDER,
  serviceNames: [],
  sourceNames: [FIXTURE_ETENDERS_SOURCE.name],
  currentScore: null, // No AI classification has run — Phase 5 §26/§27 forbid implying a score exists.
}

export const FIXTURE_DISCOVERED_TENDER_SUMMARY = {
  openTenders: 0,
  relevant: null,
  priorityBid: null,
  closingWithin7Days: 0,
  briefingsRequired: 0,
  addendaRecent: 0,
  estimatedValueTotal: null,
}

export const FIXTURE_DISCOVERED_TENDER_DOCUMENTS = [
  {
    id: '00000000-0000-4000-8000-0000000000f5',
    tender_id: FIXTURE_DISCOVERED_TENDER.id,
    source_id: FIXTURE_ETENDERS_SOURCE.id,
    document_type: 'OTHER',
    filename: 'DPWI-2026-0091 Bid Document.pdf',
    file_url: 'https://www.etenders.gov.za/Home/documents/download?id=100001-1',
    storage_path: null,
    mime_type: 'application/pdf',
    file_size: null,
    file_hash: null,
    version: 1,
    published_at: null,
    downloaded_at: null,
    is_original: true,
    is_addendum: false,
    extraction_status: 'NOT_APPLICABLE',
    ocr_required: false,
    created_at: '2026-09-11T08:00:10.000Z',
    updated_at: '2026-09-11T08:00:10.000Z',
  },
]

export const FIXTURE_ME = {
  id: '00000000-0000-4000-8000-0000000000e2',
  email: 'e2e-fixture@tender-os.test',
  role: 'ADMIN',
  agencyId: null,
  fullName: 'E2E Fixture Admin',
}
