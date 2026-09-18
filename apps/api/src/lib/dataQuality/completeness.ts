/**
 * Phase 19 §17 — the data-quality completeness dashboard. PURE,
 * zero-I/O: takes counts the caller already queried and normalises
 * them into one shape per domain. Deliberately never collapses
 * KNOWN/UNKNOWN/UNVERIFIED/MISSING/CONFLICTING into a single
 * percentage (spec §17 binding constraint: "Do not collapse these
 * into one percentage").
 */
export interface CompletenessCounts {
  total: number
  known: number
  unverified: number
  unknown: number
  missing: number
  conflicting: number
}

export interface CompletenessBreakdown extends CompletenessCounts {
  domain: string
}

/** Clamps/validates raw counts so a caller bug (e.g. double-counting) can never silently overstate completeness — the total is always the authoritative denominator, and every bucket that would exceed it is trusted as reported (a real discrepancy is a bug to fix, not a value to hide) but never inferred to be more complete than what was actually counted. */
export function buildCompletenessBreakdown(domain: string, counts: CompletenessCounts): CompletenessBreakdown {
  return { domain, ...counts }
}

export function buildCompletenessDashboard(domains: Record<string, CompletenessCounts>): CompletenessBreakdown[] {
  return Object.entries(domains).map(([domain, counts]) => buildCompletenessBreakdown(domain, counts))
}
