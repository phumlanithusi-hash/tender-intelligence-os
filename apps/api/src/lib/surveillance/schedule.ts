/**
 * Phase 20 §4A — the polling scheduler's pure selection logic. This
 * codebase has no BullMQ/Redis wiring anywhere (re-verified for this
 * phase, same finding as every prior phase) — rather than introduce a
 * new infrastructure dependency just to satisfy the spec's literal
 * "building on BullMQ/Redis" wording, this is the exact same
 * "seam a future queue would call" pattern already established by
 * `lib/notifications/check.ts` and `lib/dataQuality/supabaseDataQualityStore.ts`
 * (`runScan`): a pure decision function plus an on-demand HTTP
 * endpoint (`POST /api/surveillance/scan/:sourceId`,
 * routes/surveillance.ts) that a real scheduler would call on the
 * same cadence this function computes.
 */
export interface PollableSource {
  id: string
  scanFrequencyMinutes: number | null
  lastScanAt: string | null
  adapterState: string
}

export interface PollDueResult {
  sourceId: string
  due: boolean
  reason: string
  nextPollAt: string | null
}

/**
 * Parses a Postgres `interval` value as supabase-js/postgrest returns
 * it (a string like "1 day", "01:00:00", "2 days 03:04:05", or
 * occasionally a plain number of seconds) into whole minutes. Returns
 * null for anything it cannot confidently parse — never guesses a
 * default cadence for a value it does not understand.
 */
export function parsePostgresIntervalToMinutes(value: string | number | null): number | null {
  if (value === null) return null
  if (typeof value === 'number') return Math.round(value / 60)

  let totalSeconds = 0
  const daysMatch = value.match(/(-?\d+)\s+days?/)
  if (daysMatch) totalSeconds += Number(daysMatch[1]) * 86_400

  const hmsMatch = value.match(/(-?\d{1,3}):(\d{2}):(\d{2}(?:\.\d+)?)/)
  if (hmsMatch) {
    totalSeconds += Number(hmsMatch[1]) * 3600 + Number(hmsMatch[2]) * 60 + Number(hmsMatch[3])
  }

  if (!daysMatch && !hmsMatch) return null
  return Math.round(totalSeconds / 60)
}

/**
 * A source is due for a poll when it has never been scanned, or when
 * its last scan plus its configured frequency has elapsed. A source
 * with no configured frequency, or one not in an ACTIVE adapter
 * state, is never due — never guessed at a default cadence for a
 * source no adapter is actually connected to.
 */
export function selectSourcesDueForPoll(sources: PollableSource[], nowIso: string): PollDueResult[] {
  const now = new Date(nowIso).getTime()
  return sources.map((source) => {
    if (source.adapterState !== 'ACTIVE') {
      return { sourceId: source.id, due: false, reason: `Source is ${source.adapterState}, not ACTIVE.`, nextPollAt: null }
    }
    if (!source.scanFrequencyMinutes || source.scanFrequencyMinutes <= 0) {
      return { sourceId: source.id, due: false, reason: 'No scan frequency configured.', nextPollAt: null }
    }
    if (!source.lastScanAt) {
      return { sourceId: source.id, due: true, reason: 'Never scanned.', nextPollAt: nowIso }
    }
    const nextPollAtMs = new Date(source.lastScanAt).getTime() + source.scanFrequencyMinutes * 60_000
    const nextPollAt = new Date(nextPollAtMs).toISOString()
    if (nextPollAtMs <= now) {
      return { sourceId: source.id, due: true, reason: `Scan frequency (${source.scanFrequencyMinutes}m) elapsed since last scan.`, nextPollAt }
    }
    return { sourceId: source.id, due: false, reason: 'Scan frequency has not yet elapsed.', nextPollAt }
  })
}
