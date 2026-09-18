import { describe, expect, it } from 'vitest'
import {
  buildTenderQueryParams,
  hasActiveFilters,
  closingWithinDaysToDate,
  type TenderFilters,
} from './tenderFilters.js'

describe('buildTenderQueryParams', () => {
  it('always includes page and pageSize', () => {
    const params = buildTenderQueryParams({}, { page: 2, pageSize: 25 })
    expect(params.get('page')).toBe('2')
    expect(params.get('pageSize')).toBe('25')
  })

  it('omits filter fields that are unset', () => {
    const params = buildTenderQueryParams({}, { page: 1, pageSize: 25 })
    expect(params.has('search')).toBe(false)
    expect(params.has('status')).toBe(false)
    expect(params.has('briefingRequired')).toBe(false)
  })

  it('serialises every provided filter, including a false boolean', () => {
    const filters: TenderFilters = {
      search: 'consumables',
      status: 'OPEN',
      service: 'svc-1',
      province: 'Gauteng',
      municipality: 'Joburg',
      entityType: 'Municipality',
      briefingRequired: false,
      closingBefore: '2026-10-01',
      closingAfter: '2026-09-01',
      scoreClass: 'BID',
      source: 'src-1',
      sort: 'closing_date',
      order: 'asc',
    }
    const params = buildTenderQueryParams(filters, { page: 1, pageSize: 25 })
    expect(params.get('search')).toBe('consumables')
    expect(params.get('status')).toBe('OPEN')
    // The critical case: `false` must serialise as the literal string
    // "false", not be dropped like an unset value would be.
    expect(params.get('briefingRequired')).toBe('false')
    expect(params.get('sort')).toBe('closing_date')
    expect(params.get('order')).toBe('asc')
  })
})

describe('hasActiveFilters', () => {
  it('is false for an empty filter set', () => {
    expect(hasActiveFilters({})).toBe(false)
  })

  it('is false when every value is undefined or empty string', () => {
    expect(hasActiveFilters({ search: undefined, status: '' })).toBe(false)
  })

  it('is true when any field has a real value, including false', () => {
    expect(hasActiveFilters({ status: 'OPEN' })).toBe(true)
    expect(hasActiveFilters({ briefingRequired: false })).toBe(true)
  })
})

describe('closingWithinDaysToDate', () => {
  it('returns an ISO date string in the future for a positive offset', () => {
    const today = new Date().toISOString().slice(0, 10)
    const in7Days = closingWithinDaysToDate(7)
    expect(in7Days >= today).toBe(true)
    expect(in7Days).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
