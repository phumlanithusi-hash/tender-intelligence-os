/**
 * Controlled fixtures for the Source Registry E2E flow (Phase 4 §26:
 * "Use controlled fixtures. No real scraping."). Synthetic ids and
 * values only, served exclusively from mocked `/api/*` routes in
 * tests/e2e/source-registry.spec.ts.
 */

export const FIXTURE_SOURCE = {
  id: '00000000-0000-4000-8000-0000000000c1',
  name: 'E2E Fixture Source',
  base_url: 'https://example-source.test',
  source_type: 'OFFICIAL',
  authority_level: 'PRIMARY',
  jurisdiction: 'National',
  active: true,
  scan_frequency: '1 day',
  requires_login: false,
  supports_documents: true,
  requires_manual_ingestion: true,
  last_scan_at: '2026-09-01T08:00:00.000Z',
  last_success_at: '2026-09-01T08:00:00.000Z',
  last_failure_at: null,
  error_count: 0,
  health_status: 'DISABLED',
  adapter_key: null,
  adapter_state: 'NOT_IMPLEMENTED',
  paused_at: null,
  notes: 'E2E fixture source — not a real procurement portal.',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-09-01T08:00:00.000Z',
  nextScheduledScanAt: null,
}

export const FIXTURE_SOURCE_SUMMARY = {
  totalSources: 1,
  active: 1,
  healthy: 0,
  warning: 0,
  failed: 0,
  notConnected: 1,
}

export const FIXTURE_SOURCE_SCANS = [
  {
    id: '00000000-0000-4000-8000-0000000000d1',
    source_id: FIXTURE_SOURCE.id,
    started_at: '2026-09-01T08:00:00.000Z',
    completed_at: '2026-09-01T08:05:00.000Z',
    status: 'SUCCESS',
    records_discovered: 12,
    records_processed: 12,
    records_failed: 0,
    documents_discovered: 3,
    error_count: 0,
    error_message: null,
    execution_id: null,
    adapter_version: null,
    created_at: '2026-09-01T08:00:00.000Z',
  },
]

export const FIXTURE_SOURCE_ERRORS: unknown[] = []

export const FIXTURE_ME = {
  id: '00000000-0000-4000-8000-0000000000e2',
  email: 'e2e-fixture@tender-os.test',
  role: 'ADMIN',
  agencyId: null,
  fullName: 'E2E Fixture Admin',
}
