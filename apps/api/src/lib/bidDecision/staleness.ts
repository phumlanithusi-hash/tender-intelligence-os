import { isSnapshotStale } from '../scoring/staleness.js'

/**
 * Phase 11 §41 — a bid decision becomes STALE when any of: the tender
 * changes, an addendum changes requirements, qualification status
 * changes, evaluation criteria change, the opportunity score changes,
 * agency bid policy changes, agency evidence materially changes,
 * closing date changes, or briefing status changes. Reuses Phase 10's
 * exact staleness mechanism (§41 binding instruction) — the
 * `input_snapshot` recorded at decision time is compared against a
 * freshly-built snapshot; any difference (including a new scoring run
 * id, a new policy version id, or a changed Phase 10 snapshot) marks
 * the decision STALE. Never silently reused as current.
 */
export { isSnapshotStale }
