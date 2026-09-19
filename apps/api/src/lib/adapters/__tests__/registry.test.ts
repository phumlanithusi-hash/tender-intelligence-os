import { afterEach, describe, expect, it } from 'vitest'
import {
  registerAdapter,
  getAdapter,
  isAdapterRegistered,
  listRegisteredAdapterKeys,
  __resetAdapterRegistryForTests,
} from '../registry.js'
import type { TenderSourceAdapter } from '../types.js'

function fakeAdapter(key: string): TenderSourceAdapter {
  return {
    key,
    version: '0.0.1-test',
    discover: async () => [],
    fetchDetails: async () => {
      throw new Error('not implemented in test fixture')
    },
    fetchDocuments: async () => [],
    healthCheck: async () => ({ status: 'HEALTHY', message: 'ok', checkedAt: new Date().toISOString() }),
  }
}

describe('adapter registry (Phase 4 §6)', () => {
  afterEach(() => {
    __resetAdapterRegistryForTests()
  })

  it('registers an adapter and finds it by key', () => {
    const adapter = fakeAdapter('demo')
    registerAdapter(adapter)
    expect(getAdapter('demo')).toBe(adapter)
    expect(isAdapterRegistered('demo')).toBe(true)
  })

  it('returns null for a key with no registered adapter, rather than throwing', () => {
    expect(getAdapter('does-not-exist')).toBeNull()
    expect(isAdapterRegistered('does-not-exist')).toBe(false)
  })

  it('returns null for a null or undefined key (a source with no adapter configured)', () => {
    expect(getAdapter(null)).toBeNull()
    expect(getAdapter(undefined)).toBeNull()
  })

  it('lists every registered adapter key', () => {
    registerAdapter(fakeAdapter('one'))
    registerAdapter(fakeAdapter('two'))
    expect(listRegisteredAdapterKeys().sort()).toEqual(['one', 'two'])
  })

  it('refuses to register two adapters under the same key', () => {
    registerAdapter(fakeAdapter('dup'))
    expect(() => registerAdapter(fakeAdapter('dup'))).toThrow()
  })

  it('the production entry point registers exactly eTenders, EasyTenders, TenderBulletins, City of Johannesburg, Eskom, and City of Cape Town (the six live sources built so far) — no other adapter yet', async () => {
    __resetAdapterRegistryForTests()
    // ES module caches are per-process, not per-test — a second
    // `import('../index.js')` from elsewhere in this file's module
    // graph would be a no-op rather than re-running its top-level
    // `registerAdapter(...)` side effect. Nothing else in this test
    // file imports '../index.js', so a single plain import here is
    // its first (and only) evaluation in this process.
    await import('../index.js')
    expect(listRegisteredAdapterKeys().sort()).toEqual(['capetown', 'easytenders', 'eskom', 'etenders', 'joburg', 'tenderbulletins'])
  })
})
