import type { SupabaseClient } from '@supabase/supabase-js'
import { tenderSchema, type TenderRow } from '@tender-os/schemas'
import { type ListQuery, type ListResult } from './pagination.js'

/**
 * A tender row as shown in the Tender Radar table (Phase 3 §7),
 * carrying the display-only fields the table needs beyond the
 * canonical `tenders` columns — the services it's classified under,
 * the sources it has appeared on, and (only when one exists for the
 * caller's own agency, per RLS) its current opportunity score. These
 * are resolved via embedded PostgREST joins on the same list query
 * rather than one request per row (Phase 3 §21/§27), and are kept out
 * of `tenderSchema` itself since they are not columns of `tenders` —
 * conflating the two would blur exactly the "raw source data vs.
 * derived" boundary Phase 2 §1 established.
 */
export interface TenderListRow extends TenderRow {
  serviceNames: string[]
  sourceNames: string[]
  currentScore: { scoreClass: string; totalScore: number } | null
}

interface RawTenderServiceEmbed {
  services: { name: string } | { name: string }[] | null
}
interface RawTenderSourceRecordEmbed {
  tender_sources: { name: string } | { name: string }[] | null
}
interface RawTenderScoreEmbed {
  score_class: string
  total_score: number
  calculated_at: string
}

function namesFrom(embeds: Array<{ name: string } | { name: string }[] | null> | undefined): string[] {
  const names = new Set<string>()
  for (const embed of embeds ?? []) {
    if (!embed) continue
    for (const item of Array.isArray(embed) ? embed : [embed]) {
      if (item?.name) names.add(item.name)
    }
  }
  return [...names]
}

function latestScore(scores: RawTenderScoreEmbed[] | undefined): { scoreClass: string; totalScore: number } | null {
  if (!scores || scores.length === 0) return null
  const latest = [...scores].sort((a, b) => b.calculated_at.localeCompare(a.calculated_at))[0]
  return latest ? { scoreClass: latest.score_class, totalScore: latest.total_score } : null
}

/**
 * Allow-listed sortable columns for GET /api/tenders (Phase 3 §20:
 * "Use safe allow-listed sorting. Do not construct unsafe SQL from
 * arbitrary client input."). The client-facing `sort` parameter is
 * validated against exactly these keys — anything else is a 400, not
 * silently ignored or passed through to the query builder.
 */
export const TENDER_SORT_COLUMNS = [
  'closing_date',
  'published_date',
  'discovered_at',
  'title',
  'estimated_value',
  'status',
] as const
export type TenderSortColumn = (typeof TENDER_SORT_COLUMNS)[number]

export interface TenderListFilters {
  search?: string
  status?: string
  province?: string
  municipality?: string
  entityType?: string
  briefingRequired?: boolean
  closingBefore?: string
  closingAfter?: string
  /** Filters to tenders classified under this service (tender_services). */
  serviceId?: string
  /** Filters to tenders with a current score of this class, for the caller's own agency. */
  scoreClass?: string
  /** Filters to tenders that have appeared on this source. */
  sourceId?: string
  sort?: TenderSortColumn
  order?: 'asc' | 'desc'
}

// Columns searched by the free-text `search` parameter (Phase 3 §5).
// Service/municipality/province-via-taxonomy search is covered by
// their own dedicated filters for Phase 3 — this list is the direct
// text columns on `tenders` itself, per "For Phase 3, implement the
// frontend interaction and API query architecture. Do not implement
// semantic/vector search yet."
const SEARCHABLE_COLUMNS = ['tender_number', 'title', 'organisation', 'description', 'category', 'province', 'municipality']

function escapeForIlike(value: string): string {
  // PostgREST's `or=` filter syntax uses commas and parentheses as
  // structural delimiters — strip them from user input rather than
  // trying to escape them, since a tender search term has no
  // legitimate need for either character.
  return value.replace(/[(),]/g, ' ').trim()
}

/**
 * Read-only, paginated, filtered, sorted repository over the
 * canonical `tenders` table (Phase 2 §5, Phase 3 §19-21). All
 * filtering, sorting, and pagination happens server-side via
 * PostgREST query parameters — the full table is never fetched into
 * the API process to be filtered in memory.
 */
export async function listTenders(
  supabase: SupabaseClient,
  query: ListQuery,
  filters: TenderListFilters = {},
): Promise<ListResult<TenderListRow>> {
  const needsServiceJoin = Boolean(filters.serviceId)
  const needsScoreJoin = Boolean(filters.scoreClass)
  const needsSourceJoin = Boolean(filters.sourceId)

  // The service/source embeds are always present (for table display —
  // see TenderListRow above); when the corresponding filter is also
  // active, the SAME embed gains `!inner` plus the filtered column,
  // rather than adding a second, differently-aliased embed of the
  // same relation (PostgREST does not allow embedding one relation
  // twice under the same alias in a single select).
  const selectParts = [
    '*',
    needsServiceJoin ? 'tender_services!inner(service_id, services(name))' : 'tender_services(services(name))',
    needsSourceJoin
      ? 'tender_source_records!inner(source_id, tender_sources(name))'
      : 'tender_source_records(tender_sources(name))',
    needsScoreJoin
      ? 'tender_scores!inner(score_class, total_score, calculated_at)'
      : 'tender_scores(score_class, total_score, calculated_at)',
  ]

  let builder = supabase.from('tenders').select(selectParts.join(','), { count: 'exact' })

  if (filters.status) builder = builder.eq('status', filters.status)
  if (filters.province) builder = builder.eq('province', filters.province)
  if (filters.municipality) builder = builder.eq('municipality', filters.municipality)
  if (filters.entityType) builder = builder.eq('entity_type', filters.entityType)
  if (filters.briefingRequired !== undefined) builder = builder.eq('briefing_required', filters.briefingRequired)
  if (filters.closingBefore) builder = builder.lte('closing_date', filters.closingBefore)
  if (filters.closingAfter) builder = builder.gte('closing_date', filters.closingAfter)
  if (needsServiceJoin) builder = builder.eq('tender_services.service_id', filters.serviceId as string)
  if (needsScoreJoin) builder = builder.eq('tender_scores.score_class', filters.scoreClass as string)
  if (needsSourceJoin) builder = builder.eq('tender_source_records.source_id', filters.sourceId as string)

  if (filters.search) {
    const term = escapeForIlike(filters.search)
    if (term) {
      const orExpression = SEARCHABLE_COLUMNS.map((column) => `${column}.ilike.%${term}%`).join(',')
      builder = builder.or(orExpression)
    }
  }

  const sortColumn = filters.sort ?? 'discovered_at'
  const ascending = filters.order === 'asc'
  builder = builder.order(sortColumn, { ascending })

  const { data, error, count } = await builder.range(query.offset, query.offset + query.limit - 1)

  if (error) throw error

  const rows: TenderListRow[] = (data ?? []).map((raw) => {
    const row = raw as unknown as Record<string, unknown>
    const tender = tenderSchema.parse(row)
    const serviceEmbeds = (row.tender_services as RawTenderServiceEmbed[] | undefined)?.map((e) => e.services)
    const sourceEmbeds = (row.tender_source_records as RawTenderSourceRecordEmbed[] | undefined)?.map(
      (e) => e.tender_sources,
    )
    return {
      ...tender,
      serviceNames: namesFrom(serviceEmbeds),
      sourceNames: namesFrom(sourceEmbeds),
      currentScore: latestScore(row.tender_scores as RawTenderScoreEmbed[] | undefined),
    }
  })

  return {
    rows,
    limit: query.limit,
    offset: query.offset,
    total: count ?? undefined,
  }
}

export async function getTenderById(supabase: SupabaseClient, id: string): Promise<TenderRow | null> {
  const { data, error } = await supabase.from('tenders').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data ? tenderSchema.parse(data) : null
}

/**
 * Canonical-tender write path (Phase 5 §10/§25). A brand-new tender
 * always starts life as `DISCOVERED` (Phase 5 §25) and with whatever
 * deterministic fields the source's listing/detail actually stated —
 * every field this adapter could not determine is left `null`,
 * matching the table's own "nullable is preferable to invented"
 * convention (Phase 2 §5) rather than the ingestion layer inventing a
 * substitute default.
 */
export interface CreateTenderInput {
  tenderNumber: string | null
  title: string
  organisation: string | null
  province: string | null
  category: string | null
  description: string | null
  publishedDate: string | null
  closingDate: string | null
  closingTime: string | null
  briefingRequired: boolean | null
  submissionMethod: string | null
  originalDocumentUrl: string | null
}

export async function createTender(supabase: SupabaseClient, input: CreateTenderInput): Promise<TenderRow> {
  const insert: Record<string, unknown> = {
    tender_number: input.tenderNumber,
    title: input.title,
    organisation: input.organisation,
    province: input.province,
    category: input.category,
    description: input.description,
    published_date: input.publishedDate,
    closing_date: input.closingDate,
    closing_time: input.closingTime,
    submission_method: input.submissionMethod,
    original_document_url: input.originalDocumentUrl,
    status: 'DISCOVERED',
  }
  // `briefing_required` has a NOT NULL column default of `false`
  // (Phase 2 schema) — an unknown briefing status is represented by
  // simply not stating the column at insert time (letting the
  // column's own honest default apply) rather than this repository
  // ever writing a fabricated `true`/`false` of its own invention.
  // Once the source states it explicitly, the caller passes a real
  // boolean and it IS written.
  if (input.briefingRequired !== null) insert.briefing_required = input.briefingRequired

  const { data, error } = await supabase.from('tenders').insert(insert).select('*').single()
  if (error) throw error
  return tenderSchema.parse(data)
}

/**
 * Fills in previously-unknown fields on an existing canonical tender
 * — NEVER overwrites a field that already has a non-null value (Phase
 * 5 §11: "Do not allow the ingestion pipeline to blindly overwrite
 * canonical tender information"). Field-level provenance beyond
 * "eTenders said X and it was accepted because the field was still
 * unknown" is deferred to the future multi-source reconciliation
 * engine (Phase 5 §11) — this phase only ever moves a field from
 * null to source-stated, never source-stated to a different value.
 */
export async function fillUnknownTenderFields(
  supabase: SupabaseClient,
  id: string,
  current: TenderRow,
  candidate: Partial<CreateTenderInput>,
): Promise<TenderRow> {
  const update: Record<string, unknown> = {}
  if (current.tender_number === null && candidate.tenderNumber) update.tender_number = candidate.tenderNumber
  if (current.organisation === null && candidate.organisation) update.organisation = candidate.organisation
  if (current.province === null && candidate.province) update.province = candidate.province
  if (current.category === null && candidate.category) update.category = candidate.category
  if (current.description === null && candidate.description) update.description = candidate.description
  if (current.published_date === null && candidate.publishedDate) update.published_date = candidate.publishedDate
  if (current.closing_date === null && candidate.closingDate) update.closing_date = candidate.closingDate
  if (current.closing_time === null && candidate.closingTime) update.closing_time = candidate.closingTime
  if (current.submission_method === null && candidate.submissionMethod) update.submission_method = candidate.submissionMethod
  if (current.original_document_url === null && candidate.originalDocumentUrl) {
    update.original_document_url = candidate.originalDocumentUrl
  }
  if (candidate.briefingRequired !== undefined && candidate.briefingRequired !== null && !current.briefing_required) {
    update.briefing_required = candidate.briefingRequired
  }

  if (Object.keys(update).length === 0) return current // Nothing new — confirms the existing record without a write (Phase 5 §10).

  const { data, error } = await supabase.from('tenders').update(update).eq('id', id).select('*').single()
  if (error) throw error
  return tenderSchema.parse(data)
}
