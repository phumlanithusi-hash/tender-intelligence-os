import { isSnapshotStale } from '../scoring/staleness.js'

/**
 * Phase 13 §F — a bid evidence match becomes STALE when any of: the
 * underlying agency evidence content hash changes, the evidence
 * need's own definition changes, or the embedding used to produce the
 * match is no longer READY (i.e. it was flagged STALE/FAILED and
 * re-embedded). Reuses the exact same snapshot-comparison mechanism
 * every prior phase uses (Phase 10 §46, re-exported through
 * scoring -> bidDecision -> bidStrategy -> here) rather than inventing
 * a fifth staleness algorithm.
 */
export { isSnapshotStale }
