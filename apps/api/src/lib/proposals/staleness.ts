import { isSnapshotStale } from '../scoring/staleness.js'

/**
 * Phase 14 §38 — a proposal version becomes STALE when any of: the
 * tender requirement set changed, an evaluation criterion changed, the
 * approved bid strategy version changed, an approved evidence claim
 * changed/became stale/was superseded/rejected, or a tender addendum
 * changed a relevant requirement. Reuses the exact same
 * snapshot-comparison mechanism every prior phase uses (Phase 10 §46,
 * re-exported through scoring -> bidDecision -> bidStrategy ->
 * evidenceMatching -> here) rather than inventing a sixth staleness
 * algorithm. Marking STALE always requires human review — never a
 * silent regeneration (Phase 14 §38 binding constraint).
 */
export { isSnapshotStale }
