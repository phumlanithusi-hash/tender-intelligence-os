import type { SubmissionDeadlineResult } from './types.js'

/**
 * Phase 15 §27/§28 — PURE, zero-I/O deadline engine. Always fed
 * `nowIso` explicitly by the caller (the server's authoritative clock
 * — never `new Date()` inside this file, and never a browser-supplied
 * time) so the function stays deterministic and testable. Only a
 * PASSED deadline is ever a blocker (§28 binding constraint) — an
 * approaching deadline is informational only.
 */
export function calculateDeadlineState(nowIso: string, closingDate: string | null, closingTime: string | null): SubmissionDeadlineResult {
  if (!closingDate) {
    return { state: 'UNKNOWN', warning: 'NONE' }
  }
  const timePart = closingTime && closingTime.length > 0 ? closingTime : '23:59:59'
  const closingIso = `${closingDate}T${timePart.length === 5 ? `${timePart}:00` : timePart}Z`
  const closingMs = new Date(closingIso).getTime()
  const nowMs = new Date(nowIso).getTime()
  if (Number.isNaN(closingMs) || Number.isNaN(nowMs)) {
    return { state: 'UNKNOWN', warning: 'NONE' }
  }
  if (nowMs > closingMs) {
    return { state: 'CLOSED', warning: 'NONE' }
  }
  const msRemaining = closingMs - nowMs
  const hoursRemaining = msRemaining / (1000 * 60 * 60)
  if (hoursRemaining <= 24) {
    return { state: 'CLOSING_SOON', warning: hoursRemaining <= 0 ? 'CLOSING_TODAY' : sameCalendarDay(nowIso, closingIso) ? 'CLOSING_TODAY' : 'CLOSING_WITHIN_24_HOURS' }
  }
  if (hoursRemaining <= 72) {
    return { state: 'CLOSING_SOON', warning: 'CLOSING_WITHIN_72_HOURS' }
  }
  return { state: 'OPEN', warning: 'NONE' }
}

function sameCalendarDay(aIso: string, bIso: string): boolean {
  const a = new Date(aIso)
  const b = new Date(bIso)
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate()
}
