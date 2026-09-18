import { describe, expect, it } from 'vitest'
import { createEtendersAdapter, ETENDERS_ADAPTER_KEY } from '../adapter.js'
import { createFixtureTransport, DETAILS_FIXTURE } from '../transport/fixtureTransport.js'

describe('createEtendersAdapter (fixture transport — Phase 5 §29)', () => {
  it('exposes the registry key and a version', () => {
    const adapter = createEtendersAdapter({ transport: createFixtureTransport() })
    expect(adapter.key).toBe(ETENDERS_ADAPTER_KEY)
    expect(adapter.version).toBeTruthy()
  })

  it('discover() returns every fixture record mapped to the generic contract', async () => {
    const adapter = createEtendersAdapter({ transport: createFixtureTransport() })
    const results = await adapter.discover()
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => typeof r.externalId === 'string' && r.externalId.length > 0)).toBe(true)
  })

  it('fetchDetails() returns full detail for a record with captured detail fixture data', async () => {
    const adapter = createEtendersAdapter({ transport: createFixtureTransport() })
    await adapter.discover()
    const details = await adapter.fetchDetails('ET-100001')
    expect(details.title).toBe(DETAILS_FIXTURE['ET-100001']!.title)
    expect(details.documents.length).toBe(2)
  })

  it('fetchDetails() degrades gracefully (nulls, not a throw) for a record with no captured detail fixture', async () => {
    const adapter = createEtendersAdapter({ transport: createFixtureTransport() })
    await adapter.discover()
    const details = await adapter.fetchDetails('ET-100005')
    expect(details.title).toBe('(no title provided by source)')
    expect(details.documents).toEqual([])
  })

  it('fetchDocuments() only ever returns eTenders-domain documents', async () => {
    const adapter = createEtendersAdapter({ transport: createFixtureTransport() })
    await adapter.discover()
    const docs = await adapter.fetchDocuments('ET-100001')
    expect(docs.every((d) => d.url.startsWith('https://www.etenders.gov.za/'))).toBe(true)
  })

  it('healthCheck() reports HEALTHY for a reachable fixture transport', async () => {
    const adapter = createEtendersAdapter({ transport: createFixtureTransport() })
    const result = await adapter.healthCheck()
    expect(result.status).toBe('HEALTHY')
  })

  it('healthCheck() reports FAILED, never HEALTHY, when the transport says it is unreachable', async () => {
    const transport = createFixtureTransport()
    const adapter = createEtendersAdapter({
      transport: { ...transport, checkReachable: async () => ({ reachable: false, message: 'simulated outage' }) },
    })
    const result = await adapter.healthCheck()
    expect(result.status).toBe('FAILED')
    expect(result.message).toBe('simulated outage')
  })

  it('healthCheck() never calls discover() (Phase 4 §20 carried into Phase 5)', async () => {
    let discoverCalled = false
    const transport = createFixtureTransport()
    const adapter = createEtendersAdapter({
      transport: {
        ...transport,
        fetchListingPage: async (params) => {
          discoverCalled = true
          return transport.fetchListingPage(params)
        },
      },
    })
    await adapter.healthCheck()
    expect(discoverCalled).toBe(false)
  })
})
