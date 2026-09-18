/**
 * Score staleness comparison (Phase 10 §46). A scoring run is STALE
 * when the input snapshot it recorded at completion time no longer
 * matches what a fresh assembly of the same tender+agency would
 * produce — i.e. the qualification result, requirements, evaluation
 * criteria, agency evidence, or agency profile changed since. Pulled
 * out as its own pure function (rather than inlined at the call site in
 * repositories/tenderScoring.ts) purely so it is independently
 * unit-testable without a database.
 */
export function isSnapshotStale(storedSnapshot: Record<string, unknown>, currentSnapshot: Record<string, unknown>): boolean {
  return JSON.stringify(storedSnapshot) !== JSON.stringify(currentSnapshot)
}
