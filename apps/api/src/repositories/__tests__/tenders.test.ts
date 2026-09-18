import { describe, expect, it } from 'vitest'
import { fakeSupabaseClient } from './fakeSupabase.js'
import { listTenders } from '../tenders.js'

const now = new Date().toISOString()

const baseTender = {
  id: '22222222-2222-2222-2222-222222222222',
  tender_number: 'RFQ-001',
  title: 'Supply of office furniture',
  organisation: 'Dept of Works',
  entity_type: null,
  province: 'Western Cape',
  municipality: null,
  category: null,
  description: null,
  published_date: null,
  closing_date: '2026-10-01',
  closing_time: null,
  briefing_required: false,
  briefing_date: null,
  briefing_location: null,
  briefing_url: null,
  estimated_value: null,
  contract_duration: null,
  submission_method: null,
  submission_url: null,
  submission_email: null,
  original_document_url: null,
  status: 'OPEN',
  confidence_score: null,
  discovered_at: now,
  verified_at: null,
  created_at: now,
  updated_at: now,
}

describe('listTenders (Phase 3 pagination/filter/sort/search)', () => {
  it('requests an exact count and the correct page range for pagination', async () => {
    const { client, calls } = fakeSupabaseClient({
      tenders: { data: [baseTender], error: null, count: 1 },
    })
    const result = await listTenders(client, { limit: 25, offset: 50 })

    expect(result.total).toBe(1)
    expect(result.limit).toBe(25)
    expect(result.offset).toBe(50)
    const selectCall = calls.find((c) => c.method === 'select')
    expect(selectCall?.args[1]).toMatchObject({ count: 'exact' })
    const rangeCall = calls.find((c) => c.method === 'range')
    expect(rangeCall?.args).toEqual([50, 74])
  })

  it('applies status, province, and briefingRequired as direct equality filters', async () => {
    const { client, calls } = fakeSupabaseClient({ tenders: { data: [], error: null, count: 0 } })
    await listTenders(
      client,
      { limit: 25, offset: 0 },
      { status: 'OPEN', province: 'Western Cape', briefingRequired: true },
    )

    const eqCalls = calls.filter((c) => c.method === 'eq')
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['status', 'OPEN'] })
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['province', 'Western Cape'] })
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['briefing_required', true] })
  })

  it('applies closingBefore/closingAfter as a date range', async () => {
    const { client, calls } = fakeSupabaseClient({ tenders: { data: [], error: null, count: 0 } })
    await listTenders(client, { limit: 25, offset: 0 }, { closingBefore: '2026-12-31', closingAfter: '2026-01-01' })

    expect(calls).toContainEqual({ method: 'lte', args: ['closing_date', '2026-12-31'] })
    expect(calls).toContainEqual({ method: 'gte', args: ['closing_date', '2026-01-01'] })
  })

  it('builds a case-insensitive OR search across the direct text columns', async () => {
    const { client, calls } = fakeSupabaseClient({ tenders: { data: [], error: null, count: 0 } })
    await listTenders(client, { limit: 25, offset: 0 }, { search: 'furniture' })

    const orCall = calls.find((c) => c.method === 'or')
    expect(orCall?.args[0]).toContain('title.ilike.%furniture%')
    expect(orCall?.args[0]).toContain('organisation.ilike.%furniture%')
    expect(orCall?.args[0]).toContain('tender_number.ilike.%furniture%')
  })

  it('strips structural characters from search terms rather than passing them through to the OR filter', async () => {
    const { client, calls } = fakeSupabaseClient({ tenders: { data: [], error: null, count: 0 } })
    await listTenders(client, { limit: 25, offset: 0 }, { search: 'foo(bar,baz)' })

    const orCall = calls.find((c) => c.method === 'or')
    expect(orCall?.args[0]).not.toContain('(')
    expect(orCall?.args[0]).not.toContain(')')
  })

  it('sorts on the requested allow-listed column and direction', async () => {
    const { client, calls } = fakeSupabaseClient({ tenders: { data: [], error: null, count: 0 } })
    await listTenders(client, { limit: 25, offset: 0 }, { sort: 'estimated_value', order: 'asc' })

    expect(calls).toContainEqual({ method: 'order', args: ['estimated_value', { ascending: true }] })
  })

  it('defaults to sorting by discovered_at descending when no sort is requested', async () => {
    const { client, calls } = fakeSupabaseClient({ tenders: { data: [], error: null, count: 0 } })
    await listTenders(client, { limit: 25, offset: 0 })

    expect(calls).toContainEqual({ method: 'order', args: ['discovered_at', { ascending: false }] })
  })

  it('joins tender_scores with !inner only when a scoreClass filter is actually requested', async () => {
    const { client, calls } = fakeSupabaseClient({ tenders: { data: [], error: null, count: 0 } })
    await listTenders(client, { limit: 25, offset: 0 }, { scoreClass: 'PRIORITY_BID' })

    const selectCall = calls.find((c) => c.method === 'select')
    expect(selectCall?.args[0]).toContain('tender_scores!inner(score_class')
    expect(calls).toContainEqual({ method: 'eq', args: ['tender_scores.score_class', 'PRIORITY_BID'] })
  })

  it('always embeds tender_scores/tender_services/tender_source_records (without !inner) for table display, even with no filters', async () => {
    const { client, calls } = fakeSupabaseClient({ tenders: { data: [], error: null, count: 0 } })
    await listTenders(client, { limit: 25, offset: 0 })

    const selectCall = calls.find((c) => c.method === 'select')
    expect(selectCall?.args[0]).toContain('tender_scores(score_class')
    expect(selectCall?.args[0]).not.toContain('tender_scores!inner')
    expect(selectCall?.args[0]).toContain('tender_services(services(name))')
    expect(selectCall?.args[0]).toContain('tender_source_records(tender_sources(name))')
  })

  it('resolves serviceNames, sourceNames, and the latest score from the embedded joins', async () => {
    const { client } = fakeSupabaseClient({
      tenders: {
        data: [
          {
            ...baseTender,
            tender_services: [{ services: { name: 'Web Development' } }, { services: { name: 'Branding' } }],
            tender_source_records: [{ tender_sources: { name: 'eTenders' } }],
            tender_scores: [
              { score_class: 'REVIEW', total_score: 55, calculated_at: '2026-01-01T00:00:00.000Z' },
              { score_class: 'BID', total_score: 70, calculated_at: '2026-06-01T00:00:00.000Z' },
            ],
          },
        ],
        error: null,
        count: 1,
      },
    })
    const result = await listTenders(client, { limit: 25, offset: 0 })
    const row = result.rows[0]
    expect(row?.serviceNames.sort()).toEqual(['Branding', 'Web Development'])
    expect(row?.sourceNames).toEqual(['eTenders'])
    expect(row?.currentScore).toEqual({ scoreClass: 'BID', totalScore: 70 })
  })

  it('reports currentScore as null when the tender has no score rows at all', async () => {
    const { client } = fakeSupabaseClient({
      tenders: {
        data: [{ ...baseTender, tender_services: [], tender_source_records: [], tender_scores: [] }],
        error: null,
        count: 1,
      },
    })
    const result = await listTenders(client, { limit: 25, offset: 0 })
    expect(result.rows[0]?.currentScore).toBeNull()
  })
})
