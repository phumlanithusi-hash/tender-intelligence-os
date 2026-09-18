import type { ConflictCandidate, ConflictDetectionResult } from './types.js'

/**
 * Phase 17 §17/§58 — outcome conflict detection. Two sources
 * disagreeing on the same field is ALWAYS routed to a conflict record,
 * never silently overwritten and never auto-merged, regardless of
 * relative authority level (authority level only informs which side a
 * human reviewer should weight more heavily — it never resolves the
 * conflict automatically).
 */
export function detectConflict(candidate: ConflictCandidate): ConflictDetectionResult {
  const { existingValue, incomingValue, fieldName } = candidate
  if (existingValue === null || existingValue === undefined) {
    return { hasConflict: false, status: null, reason: `No existing value for ${fieldName} — nothing to conflict with.` }
  }
  if (incomingValue === null || incomingValue === undefined) {
    return { hasConflict: false, status: null, reason: `Incoming value for ${fieldName} is empty — nothing to compare.` }
  }
  if (normalize(existingValue) === normalize(incomingValue)) {
    return { hasConflict: false, status: null, reason: `${fieldName} values agree.` }
  }
  return {
    hasConflict: true,
    status: 'OPEN',
    reason: `${fieldName} disagreement: existing="${existingValue}" vs incoming="${incomingValue}" — routed to human review, not auto-resolved (spec §17).`,
  }
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Deterministic identity for deduplicating the SAME award seen from
 * multiple sources (spec §58) — tender_number + organisation + winner
 * + award date. Two candidates with the same identity are the same
 * event and should be linked, not treated as independent outcomes;
 * candidates with the same tender/organisation but a DIFFERENT winner
 * or date are a conflict, never a silent merge.
 */
export function outcomeIdentityKey(input: { tenderNumber: string | null; organisation: string | null; winnerName: string | null; awardDate: string | null }): string {
  return [input.tenderNumber ?? '', input.organisation ?? '', normalize(input.winnerName ?? ''), input.awardDate ?? ''].join('|')
}
