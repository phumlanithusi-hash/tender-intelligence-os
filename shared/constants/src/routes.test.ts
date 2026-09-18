import { describe, expect, it } from 'vitest'
import { ROUTES, ROUTE_PATTERNS } from './routes.js'

describe('routes', () => {
  it('covers every static route named in spec §9', () => {
    const expectedKeys = [
      'home',
      'tenders',
      'opportunities',
      'watchlist',
      'bids',
      'agency',
      'agencyCapabilities',
      'agencyPortfolio',
      'agencyTeam',
      'agencyDocuments',
      'analytics',
      'competitors',
      'sources',
      'settings',
    ]
    for (const key of expectedKeys) {
      expect(Object.keys(ROUTES)).toContain(key)
    }
  })

  it('dynamic route helpers interpolate the id', () => {
    expect(ROUTES.tenderDetail('abc-123')).toBe('/tenders/abc-123')
    expect(ROUTES.bidStrategy('bid-1')).toBe('/bids/bid-1/strategy')
    expect(ROUTES.sourceDetail('src-1')).toBe('/sources/src-1')
  })

  it('route patterns use the :id placeholder matching react-router syntax', () => {
    expect(ROUTE_PATTERNS.tenderDetail).toBe('/tenders/:id')
    expect(ROUTE_PATTERNS.bidCompliance).toBe('/bids/:id/compliance')
    expect(ROUTE_PATTERNS.sourceDetail).toBe('/sources/:id')
  })
})
