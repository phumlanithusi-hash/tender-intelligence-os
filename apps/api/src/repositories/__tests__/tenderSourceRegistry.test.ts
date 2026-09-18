import { describe, expect, it } from 'vitest'
import { fakeSupabaseClient } from './fakeSupabase.js'
import { listTenderSourceScans, countConsecutiveFailedScans } from '../tenderSourceScans.js'
import { listTenderSourceErrors } from '../tenderSourceErrors.js'
import { getTenderSourceSummary } from '../tenderSourceSummary.js'
import { updateTenderSourceState } from '../tenderSources.js'

const sourceId = '11111111-1111-1111-1111-111111111111'
const now = new Date().toISOString()

const validScan = {
  id: '22222222-2222-2222-2222-222222222222',
  source_id: sourceId,
  started_at: now,
  completed_at: now,
  status: 'SUCCESS',
  records_discovered: 5,
  records_processed: 5,
  records_failed: 0,
  documents_discovered: 2,
  records_duplicate: 0,
  retry_count: 0,
  error_count: 0,
  error_message: null,
  execution_id: null,
  adapter_version: null,
  created_at: now,
}

const validError = {
  id: '33333333-3333-3333-3333-333333333333',
  source_id: sourceId,
  scan_id: null,
  error_type: 'HTTP',
  severity: 'HIGH',
  message: 'Received HTTP 503',
  url: 'https://example.test/tenders',
  status_code: 503,
  retryable: true,
  occurred_at: now,
  resolved_at: null,
  metadata: null,
}

describe('tenderSourceScans repository (Phase 4 §9)', () => {
  it('parses a valid scan history list, most recent first', async () => {
    const { client, calls } = fakeSupabaseClient({ tender_source_scans: { data: [validScan], error: null } })
    const result = await listTenderSourceScans(client, sourceId, { limit: 25, offset: 0 })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]!.status).toBe('SUCCESS')
    expect(calls.some((c) => c.method === 'eq' && c.args[0] === 'source_id' && c.args[1] === sourceId)).toBe(true)
    expect(calls.some((c) => c.method === 'order' && c.args[0] === 'started_at')).toBe(true)
  })

  it('propagates a Supabase error rather than swallowing it', async () => {
    const { client } = fakeSupabaseClient({ tender_source_scans: { data: null, error: { message: 'db down' } } })
    await expect(listTenderSourceScans(client, sourceId, { limit: 25, offset: 0 })).rejects.toMatchObject({
      message: 'db down',
    })
  })

  it('counts consecutive FAILED scans from the most recent, stopping at the first non-FAILED', async () => {
    const { client } = fakeSupabaseClient({
      tender_source_scans: {
        data: [{ status: 'FAILED' }, { status: 'FAILED' }, { status: 'SUCCESS' }, { status: 'FAILED' }],
        error: null,
      },
    })
    const count = await countConsecutiveFailedScans(client, sourceId)
    expect(count).toBe(2)
  })

  it('counts zero when the most recent scan already succeeded', async () => {
    const { client } = fakeSupabaseClient({
      tender_source_scans: { data: [{ status: 'SUCCESS' }, { status: 'FAILED' }], error: null },
    })
    expect(await countConsecutiveFailedScans(client, sourceId)).toBe(0)
  })

  it('counts zero when there is no scan history at all', async () => {
    const { client } = fakeSupabaseClient({ tender_source_scans: { data: [], error: null } })
    expect(await countConsecutiveFailedScans(client, sourceId)).toBe(0)
  })
})

describe('tenderSourceErrors repository (Phase 4 §10)', () => {
  it('parses a valid error list', async () => {
    const { client } = fakeSupabaseClient({ tender_source_errors: { data: [validError], error: null } })
    const result = await listTenderSourceErrors(client, sourceId, { limit: 25, offset: 0 })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]!.error_type).toBe('HTTP')
  })

  it('never exposes a credential-shaped field — the schema has none to leak', async () => {
    const { client } = fakeSupabaseClient({ tender_source_errors: { data: [validError], error: null } })
    const result = await listTenderSourceErrors(client, sourceId, { limit: 25, offset: 0 })
    const keys = Object.keys(result.rows[0]!)
    expect(keys.some((k) => /password|secret|token|credential/i.test(k))).toBe(false)
  })

  it('propagates a Supabase error rather than swallowing it', async () => {
    const { client } = fakeSupabaseClient({ tender_source_errors: { data: null, error: { message: 'timeout' } } })
    await expect(listTenderSourceErrors(client, sourceId, { limit: 25, offset: 0 })).rejects.toMatchObject({
      message: 'timeout',
    })
  })
})

describe('getTenderSourceSummary (Phase 4 §14)', () => {
  it('computes real counts from the actual rows, never a fabricated number', async () => {
    const { client } = fakeSupabaseClient({
      tender_sources: {
        data: [
          { active: true, adapter_key: null, health_status: 'DISABLED' },
          { active: true, adapter_key: 'etenders', health_status: 'HEALTHY' },
          { active: true, adapter_key: 'etenders', health_status: 'WARNING' },
          { active: false, adapter_key: 'etenders', health_status: 'FAILED' },
        ],
        error: null,
      },
    })
    const summary = await getTenderSourceSummary(client)
    expect(summary).toEqual({
      totalSources: 4,
      active: 3,
      healthy: 1,
      warning: 1,
      failed: 1,
      notConnected: 1,
    })
  })

  it('reports every count as zero for an empty registry, not an error', async () => {
    const { client } = fakeSupabaseClient({ tender_sources: { data: [], error: null } })
    const summary = await getTenderSourceSummary(client)
    expect(summary.totalSources).toBe(0)
    expect(summary.notConnected).toBe(0)
  })
})

describe('updateTenderSourceState (Phase 4 §17 admin mutations)', () => {
  it('sends only the fields that were actually provided', async () => {
    const { client, calls } = fakeSupabaseClient({
      tender_sources: { data: { ...validSourceRow(), active: false, adapter_state: 'DISABLED' }, error: null },
    })
    await updateTenderSourceState(client, sourceId, { active: false, adapterState: 'DISABLED' })
    const updateCall = calls.find((c) => c.method === 'update')
    expect(updateCall).toBeDefined()
    expect(updateCall!.args[0]).toEqual({ active: false, adapter_state: 'DISABLED' })
  })

  it('returns null when the source id does not exist', async () => {
    const { client } = fakeSupabaseClient({ tender_sources: { data: null, error: null } })
    const result = await updateTenderSourceState(client, sourceId, { active: false })
    expect(result).toBeNull()
  })
})

function validSourceRow() {
  return {
    id: sourceId,
    name: 'eTenders',
    base_url: 'https://etenders.example',
    source_type: 'GOVERNMENT',
    authority_level: 'PRIMARY',
    jurisdiction: 'National',
    active: true,
    scan_frequency: '1 day',
    requires_login: false,
    supports_documents: true,
    requires_manual_ingestion: true,
    last_scan_at: null,
    last_success_at: null,
    last_failure_at: null,
    error_count: 0,
    health_status: 'DISABLED',
    adapter_key: null,
    adapter_state: 'NOT_IMPLEMENTED',
    paused_at: null,
    notes: null,
    created_at: now,
    updated_at: now,
  }
}
