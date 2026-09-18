/**
 * The Tender Radar filter state (Phase 3 §6/§20). This is deliberately
 * the exact shape of GET /api/tenders's query parameters
 * (apps/api/src/routes/tenders.ts) — a saved filter (Phase 3 §16)
 * stores this object verbatim, and applying one is just replacing the
 * current filter state with it.
 */
export interface TenderFilters {
  search?: string
  status?: string
  service?: string
  province?: string
  municipality?: string
  entityType?: string
  briefingRequired?: boolean
  closingBefore?: string
  closingAfter?: string
  scoreClass?: string
  source?: string
  sort?: string
  order?: 'asc' | 'desc'
}

export const EMPTY_FILTERS: TenderFilters = {}

/** Closing-date quick filter presets (Phase 3 §6). */
export const CLOSING_DATE_PRESETS = [
  { label: 'Today', days: 0 },
  { label: '3 days', days: 3 },
  { label: '7 days', days: 7 },
  { label: '14 days', days: 14 },
  { label: '30 days', days: 30 },
] as const

export function closingWithinDaysToDate(days: number): string {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  return date.toISOString().slice(0, 10)
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Builds the /api/tenders query string from filter state + pagination. */
export function buildTenderQueryParams(
  filters: TenderFilters,
  pagination: { page: number; pageSize: number },
): URLSearchParams {
  const params = new URLSearchParams()
  params.set('page', String(pagination.page))
  params.set('pageSize', String(pagination.pageSize))

  if (filters.search) params.set('search', filters.search)
  if (filters.status) params.set('status', filters.status)
  if (filters.service) params.set('service', filters.service)
  if (filters.province) params.set('province', filters.province)
  if (filters.municipality) params.set('municipality', filters.municipality)
  if (filters.entityType) params.set('entityType', filters.entityType)
  if (filters.briefingRequired !== undefined) params.set('briefingRequired', String(filters.briefingRequired))
  if (filters.closingBefore) params.set('closingBefore', filters.closingBefore)
  if (filters.closingAfter) params.set('closingAfter', filters.closingAfter)
  if (filters.scoreClass) params.set('scoreClass', filters.scoreClass)
  if (filters.source) params.set('source', filters.source)
  if (filters.sort) params.set('sort', filters.sort)
  if (filters.order) params.set('order', filters.order)

  return params
}

export function hasActiveFilters(filters: TenderFilters): boolean {
  return Object.values(filters).some((value) => value !== undefined && value !== '')
}
