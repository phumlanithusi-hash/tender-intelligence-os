import { describe, expect, it } from 'vitest'
import { fakeSupabaseClient } from './fakeSupabase.js'
import { listTenderDocuments } from '../tenderDocuments.js'
import { listTenderAddenda } from '../tenderAddenda.js'
import { listTenderBriefings } from '../tenderBriefings.js'
import { getCurrentTenderScore } from '../tenderScores.js'
import { listTenderRisks } from '../tenderRisks.js'
import { listTenderActivity } from '../tenderActivity.js'

const now = new Date().toISOString()
const tenderId = '22222222-2222-2222-2222-222222222222'

describe('listTenderDocuments', () => {
  it('parses a valid document row', async () => {
    const { client } = fakeSupabaseClient({
      tender_documents: {
        data: [
          {
            id: '33333333-3333-3333-3333-333333333333',
            tender_id: tenderId,
            source_id: null,
            document_type: 'RFP',
            filename: 'rfp.pdf',
            file_url: null,
            storage_path: null,
            mime_type: 'application/pdf',
            file_size: 1024,
            file_hash: 'abc',
            version: 1,
            published_at: null,
            downloaded_at: null,
            is_original: true,
            is_addendum: false,
            extraction_status: 'PENDING',
            ocr_required: false,
            created_at: now,
            updated_at: now,
          },
        ],
        error: null,
      },
    })
    const rows = await listTenderDocuments(client, tenderId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.filename).toBe('rfp.pdf')
  })
})

describe('listTenderAddenda', () => {
  it('never returns a *_changed flag as true unless the row itself says so', async () => {
    const { client } = fakeSupabaseClient({
      tender_addenda: {
        data: [
          {
            id: '44444444-4444-4444-4444-444444444444',
            tender_id: tenderId,
            document_id: '33333333-3333-3333-3333-333333333333',
            addendum_number: 1,
            published_at: null,
            summary: null,
            deadline_changed: false,
            briefing_changed: false,
            requirement_changed: false,
            evaluation_changed: false,
            pricing_changed: false,
            other_changes: null,
            content_hash: null,
            impact_assessment: {},
            detected_via: 'DOCUMENT',
            created_at: now,
          },
        ],
        error: null,
      },
    })
    const rows = await listTenderAddenda(client, tenderId)
    expect(rows[0]?.deadline_changed).toBe(false)
    expect(rows[0]?.pricing_changed).toBe(false)
  })
})

describe('listTenderBriefings', () => {
  it('parses a valid briefing row', async () => {
    const { client } = fakeSupabaseClient({
      tender_briefings: {
        data: [
          {
            id: '55555555-5555-5555-5555-555555555555',
            tender_id: tenderId,
            mandatory: true,
            date: '2026-10-15',
            start_time: '10:00:00',
            end_time: null,
            location: 'Head office',
            online_url: null,
            registration_required: true,
            registration_deadline: null,
            attendance_recorded: false,
            notes: null,
            source_document_id: null,
            created_at: now,
            updated_at: now,
          },
        ],
        error: null,
      },
    })
    const rows = await listTenderBriefings(client, tenderId)
    expect(rows[0]?.mandatory).toBe(true)
  })
})

describe('getCurrentTenderScore', () => {
  it('returns null when the caller (under RLS) has no score row for this tender', async () => {
    const { client } = fakeSupabaseClient({ tender_scores: { data: null, error: null } })
    const score = await getCurrentTenderScore(client, tenderId)
    expect(score).toBeNull()
  })

  it('parses a valid score row and never re-derives the total itself', async () => {
    const { client } = fakeSupabaseClient({
      tender_scores: {
        data: {
          id: '66666666-6666-6666-6666-666666666666',
          tender_id: tenderId,
          agency_id: '77777777-7777-7777-7777-777777777777',
          service_fit: 18,
          qualification_likelihood: 16,
          relevant_experience: 13,
          functionality_potential: 13,
          commercial_value: 8,
          competition: 4,
          time_available: 4,
          compliance_risk: 3,
          strategic_value: 4,
          total_score: 83,
          score_class: 'BID',
          mandatory_failure: false,
          mandatory_failure_reason: null,
          scoring_version: 'v1',
          calculated_at: now,
        },
        error: null,
      },
    })
    const score = await getCurrentTenderScore(client, tenderId)
    expect(score?.total_score).toBe(83)
    expect(score?.score_class).toBe('BID')
  })
})

describe('listTenderRisks', () => {
  it('parses both tender-general (agency_id null) and agency-specific risk rows', async () => {
    const { client } = fakeSupabaseClient({
      tender_risks: {
        data: [
          {
            id: '88888888-8888-8888-8888-888888888888',
            tender_id: tenderId,
            agency_id: null,
            risk_type: 'DEADLINE',
            severity: 'HIGH',
            description: 'Very tight submission window',
            evidence: null,
            source_document_id: null,
            mitigation: null,
            status: 'OPEN',
            confidence: null,
            created_at: now,
            updated_at: now,
          },
        ],
        error: null,
      },
    })
    const rows = await listTenderRisks(client, tenderId)
    expect(rows[0]?.agency_id).toBeNull()
  })
})

describe('listTenderActivity', () => {
  it('parses a valid audit log row', async () => {
    const { client } = fakeSupabaseClient({
      audit_logs: {
        data: [
          {
            id: '99999999-9999-9999-9999-999999999999',
            agency_id: null,
            actor_id: null,
            actor_type: 'SYSTEM',
            agent_name: null,
            action: 'status_changed',
            entity_type: 'tender',
            entity_id: tenderId,
            old_value: null,
            new_value: { status: 'OPEN' },
            created_at: now,
          },
        ],
        error: null,
      },
    })
    const rows = await listTenderActivity(client, tenderId)
    expect(rows[0]?.action).toBe('status_changed')
  })

  it('returns an empty list rather than an error when RLS hides everything from a non-admin caller', async () => {
    const { client } = fakeSupabaseClient({ audit_logs: { data: [], error: null } })
    const rows = await listTenderActivity(client, tenderId)
    expect(rows).toEqual([])
  })
})
