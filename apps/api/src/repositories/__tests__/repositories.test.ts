import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { fakeSupabaseClient } from './fakeSupabase.js'
import { listTenderSources, getTenderSourceById } from '../tenderSources.js'
import { listTenders, getTenderById } from '../tenders.js'
import { listServices } from '../services.js'
import { listTenderRequirements } from '../tenderRequirements.js'
import { listTenderEvaluationCriteria } from '../tenderEvaluationCriteria.js'

const now = new Date().toISOString()

const validTenderSource = {
  id: '11111111-1111-1111-1111-111111111111',
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

const validTender = {
  id: '22222222-2222-2222-2222-222222222222',
  tender_number: null,
  title: 'Supply of office furniture',
  organisation: null,
  entity_type: null,
  province: null,
  municipality: null,
  category: null,
  description: null,
  published_date: null,
  closing_date: null,
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
  status: 'DISCOVERED',
  confidence_score: null,
  discovered_at: now,
  verified_at: null,
  created_at: now,
  updated_at: now,
}

const validService = {
  id: '33333333-3333-3333-3333-333333333333',
  name: 'Web Development',
  slug: 'web-development',
  description: null,
  active: true,
  sort_order: 0,
  created_at: now,
  updated_at: now,
}

const validRequirement = {
  id: '44444444-4444-4444-4444-444444444444',
  tender_id: validTender.id,
  requirement_type: 'TAX',
  requirement_text: 'Valid SARS tax clearance certificate',
  mandatory: true,
  severity: 'HIGH',
  source_document_id: null,
  page_number: null,
  section_reference: null,
  evidence_text: null,
  confidence: null,
  extraction_status: 'EXTRACTED',
  qualification_status: 'UNKNOWN',
  qualification_evidence_id: null,
  qualification_notes: null,
  created_at: now,
  updated_at: now,
}

const validCriterion = {
  id: '55555555-5555-5555-5555-555555555555',
  tender_id: validTender.id,
  criterion: 'Technical proposal',
  description: null,
  weight: 60,
  scoring_method: 'POINTS',
  minimum_score: null,
  source_document_id: null,
  page_number: null,
  evidence_text: null,
  confidence: null,
  created_at: now,
  updated_at: now,
}

describe('tenderSources repository', () => {
  it('parses a valid row list', async () => {
    const { client: supabase } = fakeSupabaseClient({
      tender_sources: { data: [validTenderSource], error: null },
    })
    const result = await listTenderSources(supabase, { limit: 25, offset: 0 })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]!.name).toBe('eTenders')
  })

  it('propagates a Supabase error rather than swallowing it', async () => {
    const { client: supabase } = fakeSupabaseClient({
      tender_sources: { data: null, error: { message: 'connection refused' } },
    })
    await expect(listTenderSources(supabase, { limit: 25, offset: 0 })).rejects.toMatchObject({
      message: 'connection refused',
    })
  })

  it('rejects a row that does not match the schema instead of returning a malformed object', async () => {
    const { client: supabase } = fakeSupabaseClient({
      tender_sources: { data: [{ ...validTenderSource, source_type: 'NOT_A_REAL_TYPE' }], error: null },
    })
    await expect(listTenderSources(supabase, { limit: 25, offset: 0 })).rejects.toBeInstanceOf(ZodError)
  })

  it('returns null for getById when no row is found', async () => {
    const { client: supabase } = fakeSupabaseClient({ tender_sources: { data: null, error: null } })
    const row = await getTenderSourceById(supabase, validTenderSource.id)
    expect(row).toBeNull()
  })
})

describe('tenders repository', () => {
  it('parses a valid tender row list', async () => {
    const { client: supabase } = fakeSupabaseClient({ tenders: { data: [validTender], error: null } })
    const result = await listTenders(supabase, { limit: 25, offset: 0 })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]!.status).toBe('DISCOVERED')
  })

  it('does not fabricate any field the row does not actually have', async () => {
    const { client: supabase } = fakeSupabaseClient({ tenders: { data: [validTender], error: null } })
    const [row] = (await listTenders(supabase, { limit: 25, offset: 0 })).rows
    expect(row!.tender_number).toBeNull()
    expect(row!.estimated_value).toBeNull()
    expect(row!.confidence_score).toBeNull()
  })

  it('returns a single tender by id', async () => {
    const { client: supabase } = fakeSupabaseClient({ tenders: { data: validTender, error: null } })
    const row = await getTenderById(supabase, validTender.id)
    expect(row?.id).toBe(validTender.id)
  })
})

describe('services repository', () => {
  it('parses a valid service list', async () => {
    const { client: supabase } = fakeSupabaseClient({ services: { data: [validService], error: null } })
    const rows = await listServices(supabase)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.slug).toBe('web-development')
  })
})

describe('tenderRequirements repository', () => {
  it('never returns a PASS status the schema disallows silently defaulting to true', async () => {
    const { client: supabase } = fakeSupabaseClient({
      tender_requirements: { data: [validRequirement], error: null },
    })
    const rows = await listTenderRequirements(supabase, validTender.id)
    expect(rows[0]!.qualification_status).toBe('UNKNOWN')
  })
})

describe('tenderEvaluationCriteria repository', () => {
  it('parses evaluation criteria without assuming a generic 80/20 split', async () => {
    const { client: supabase } = fakeSupabaseClient({
      tender_evaluation_criteria: { data: [validCriterion], error: null },
    })
    const rows = await listTenderEvaluationCriteria(supabase, validTender.id)
    expect(rows[0]!.weight).toBe(60)
  })
})
