import { describe, expect, it } from 'vitest'
import { computeSourceHealth, computeNextScheduledScanAt } from '../sourceHealth.js'

describe('computeSourceHealth (Phase 4 §8: deterministic health)', () => {
  it('is DISABLED when no adapter is implemented, regardless of other fields', () => {
    expect(
      computeSourceHealth({ hasAdapter: false, active: true, adapterState: 'ACTIVE', consecutiveFailedScans: 0 }),
    ).toBe('DISABLED')
  })

  it('is DISABLED when the source is inactive', () => {
    expect(
      computeSourceHealth({ hasAdapter: true, active: false, adapterState: 'ACTIVE', consecutiveFailedScans: 0 }),
    ).toBe('DISABLED')
  })

  it('is DISABLED when the adapter state is DISABLED', () => {
    expect(
      computeSourceHealth({ hasAdapter: true, active: true, adapterState: 'DISABLED', consecutiveFailedScans: 0 }),
    ).toBe('DISABLED')
  })

  it('is DISABLED when the adapter is paused (an operator decision, not a failure)', () => {
    expect(
      computeSourceHealth({ hasAdapter: true, active: true, adapterState: 'PAUSED', consecutiveFailedScans: 0 }),
    ).toBe('DISABLED')
  })

  it('is HEALTHY for an active, adapter-backed source with no recent failures', () => {
    expect(
      computeSourceHealth({ hasAdapter: true, active: true, adapterState: 'ACTIVE', consecutiveFailedScans: 0 }),
    ).toBe('HEALTHY')
  })

  it('is WARNING after 1-2 consecutive failed scans', () => {
    expect(
      computeSourceHealth({ hasAdapter: true, active: true, adapterState: 'ACTIVE', consecutiveFailedScans: 1 }),
    ).toBe('WARNING')
    expect(
      computeSourceHealth({ hasAdapter: true, active: true, adapterState: 'ACTIVE', consecutiveFailedScans: 2 }),
    ).toBe('WARNING')
  })

  it('is FAILED after 3 or more consecutive failed scans', () => {
    expect(
      computeSourceHealth({ hasAdapter: true, active: true, adapterState: 'ACTIVE', consecutiveFailedScans: 3 }),
    ).toBe('FAILED')
    expect(
      computeSourceHealth({ hasAdapter: true, active: true, adapterState: 'ACTIVE', consecutiveFailedScans: 10 }),
    ).toBe('FAILED')
  })

  it('is deterministic — the same input always produces the same output', () => {
    const input = { hasAdapter: true, active: true, adapterState: 'ACTIVE' as const, consecutiveFailedScans: 2 }
    const results = new Set(Array.from({ length: 5 }, () => computeSourceHealth(input)))
    expect(results.size).toBe(1)
  })
})

describe('computeNextScheduledScanAt (Phase 4 §12)', () => {
  it('is null when there is no adapter (nothing is actually scheduled)', () => {
    expect(
      computeNextScheduledScanAt({
        hasAdapter: false,
        active: true,
        adapterState: 'ACTIVE',
        lastScanAt: null,
        scanFrequency: '1 day',
      }),
    ).toBeNull()
  })

  it('is null when the source is paused', () => {
    expect(
      computeNextScheduledScanAt({
        hasAdapter: true,
        active: true,
        adapterState: 'PAUSED',
        lastScanAt: null,
        scanFrequency: '1 day',
      }),
    ).toBeNull()
  })

  it('is null when the source is inactive', () => {
    expect(
      computeNextScheduledScanAt({
        hasAdapter: true,
        active: false,
        adapterState: 'ACTIVE',
        lastScanAt: null,
        scanFrequency: '1 day',
      }),
    ).toBeNull()
  })

  it('adds the scan frequency to the last scan time for an active adapter', () => {
    const lastScanAt = '2026-09-01T00:00:00.000Z'
    const result = computeNextScheduledScanAt({
      hasAdapter: true,
      active: true,
      adapterState: 'ACTIVE',
      lastScanAt,
      scanFrequency: '1 day',
    })
    expect(result).toBe('2026-09-02T00:00:00.000Z')
  })

  it('parses an HH:MM:SS interval', () => {
    const lastScanAt = '2026-09-01T00:00:00.000Z'
    const result = computeNextScheduledScanAt({
      hasAdapter: true,
      active: true,
      adapterState: 'ACTIVE',
      lastScanAt,
      scanFrequency: '12:00:00',
    })
    expect(result).toBe('2026-09-01T12:00:00.000Z')
  })

  it('falls back to now() when the source has never been scanned', () => {
    const before = Date.now()
    const result = computeNextScheduledScanAt({
      hasAdapter: true,
      active: true,
      adapterState: 'ACTIVE',
      lastScanAt: null,
      scanFrequency: '1 day',
    })
    expect(result).not.toBeNull()
    const resultMs = new Date(result as string).getTime()
    expect(resultMs).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000 - 1000)
  })
})
