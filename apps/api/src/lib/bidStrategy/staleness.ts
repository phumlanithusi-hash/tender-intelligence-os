import { isSnapshotStale } from '../scoring/staleness.js'

/**
 * Phase 12 §21 — a bid strategy becomes STALE when any of: tender
 * requirement changes, evaluation criteria changes, tender addendum,
 * qualification changes, bid decision changes, opportunity score
 * changes, agency evidence changes, agency capability changes,
 * closing date changes, or compulsory briefing status changes. Reuses
 * Phase 10/11's exact staleness mechanism (binding instruction): the
 * `input_snapshot` recorded at strategy-generation time is compared
 * against a freshly-built snapshot; any difference marks the strategy
 * STALE. Never silently presented as current.
 */
export { isSnapshotStale }
