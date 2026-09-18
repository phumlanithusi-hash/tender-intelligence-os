import type { AdapterState, SourceHealth } from '@tender-os/constants'

/**
 * Deterministic health calculation (Phase 4 §8: "Do not make health
 * purely cosmetic. Create a deterministic health calculation where
 * practical."). Pure function of observable state — no hidden clock
 * reads beyond what's passed in, so it's fully unit-testable and the
 * exact same result for the exact same inputs, every time.
 *
 * Health considers: whether an adapter is actually implemented and
 * enabled, the source's own active/adapter_state configuration, and
 * consecutive scan failures (Phase 4 §8's "last successful scan" +
 * "consecutive failures"). It never fabricates a HEALTHY status for a
 * source with no adapter — that is DISABLED (Phase 4 §7: not active
 * just because a row exists).
 */
export interface SourceHealthInput {
  hasAdapter: boolean
  active: boolean
  adapterState: AdapterState
  /** Consecutive FAILED scans since the last SUCCESS (or since the beginning of history) — see repositories/tenderSourceScans.ts's countConsecutiveFailures. */
  consecutiveFailedScans: number
}

export function computeSourceHealth(input: SourceHealthInput): SourceHealth {
  const { hasAdapter, active, adapterState, consecutiveFailedScans } = input

  // No adapter implemented, the source is inactive, or an admin has
  // explicitly disabled it: DISABLED is the only honest answer — a
  // source that cannot run is not "healthy" or "failed", it simply
  // isn't operating (Phase 4 §7/§20).
  if (!hasAdapter || !active || adapterState === 'NOT_IMPLEMENTED' || adapterState === 'DISABLED') {
    return 'DISABLED'
  }

  // A paused source is intentionally not scanning right now, which is
  // an operator decision, not a reliability problem — treat it the
  // same as DISABLED for health-reporting purposes rather than
  // implying either healthy or failed.
  if (adapterState === 'PAUSED') {
    return 'DISABLED'
  }

  if (consecutiveFailedScans >= 3) return 'FAILED'
  if (consecutiveFailedScans >= 1) return 'WARNING'
  return 'HEALTHY'
}

/**
 * Next-scheduled-scan time is always derived, never stored (Phase 4
 * §12 — see the migration's comment on why `next_scheduled_scan_at`
 * is not a column). Returns null when scanning isn't actually
 * scheduled to happen (no adapter, inactive, paused/disabled) rather
 * than a misleading date.
 */
export function computeNextScheduledScanAt(input: {
  hasAdapter: boolean
  active: boolean
  adapterState: AdapterState
  lastScanAt: string | null
  /** Postgres `interval` text, e.g. "1 day", "12:00:00" — parsed defensively; unparseable values fall back to 24h. */
  scanFrequency: string
}): string | null {
  const { hasAdapter, active, adapterState, lastScanAt, scanFrequency } = input
  if (!hasAdapter || !active || adapterState === 'PAUSED' || adapterState === 'DISABLED' || adapterState === 'NOT_IMPLEMENTED') {
    return null
  }

  const frequencyMs = parsePostgresIntervalToMs(scanFrequency) ?? 24 * 60 * 60 * 1000
  const base = lastScanAt ? new Date(lastScanAt).getTime() : Date.now()
  return new Date(base + frequencyMs).toISOString()
}

/** Parses the common Postgres `interval` text output shapes this app actually produces ("N day(s)", "HH:MM:SS", or a combination). Returns null rather than throwing on an unrecognised shape. */
function parsePostgresIntervalToMs(value: string): number | null {
  let totalMs = 0
  let matched = false

  const dayMatch = value.match(/(-?\d+)\s+day/)
  if (dayMatch) {
    totalMs += Number(dayMatch[1]) * 24 * 60 * 60 * 1000
    matched = true
  }

  const timeMatch = value.match(/(\d{1,3}):(\d{2}):(\d{2})/)
  if (timeMatch) {
    const [, hours, minutes, seconds] = timeMatch
    totalMs += Number(hours) * 60 * 60 * 1000 + Number(minutes) * 60 * 1000 + Number(seconds) * 1000
    matched = true
  }

  return matched ? totalMs : null
}
