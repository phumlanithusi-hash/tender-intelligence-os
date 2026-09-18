import type { DeadlineUrgencyResult } from './types.js'

/**
 * Phase 16 §11 — deadline urgency thresholds distinct from Phase 15's
 * readiness-engine warnings (which use 72h/24h bands for
 * READY_TO_SUBMIT informational notices). This is the
 * submission-execution-facing scale, exactly as specified: >24h
 * NORMAL, ≤24h CLOSING_SOON, ≤2h URGENT, ≤30min CRITICAL, deadline
 * passed BLOCKED. PURE, zero-I/O — `nowIso` is always the server's
 * authoritative clock, passed in by the caller, never browser time
 * (§10/§53 binding constraint).
 */
export function classifySubmissionDeadlineUrgency(nowIso: string, closingDate: string | null, closingTime: string | null): DeadlineUrgencyResult {
  if (!closingDate) return { urgency: 'NORMAL', hoursRemaining: null }

  const timePart = closingTime && closingTime.length > 0 ? closingTime : '23:59:59'
  const closingIso = `${closingDate}T${timePart.length === 5 ? `${timePart}:00` : timePart}Z`
  const closingMs = new Date(closingIso).getTime()
  const nowMs = new Date(nowIso).getTime()
  if (Number.isNaN(closingMs) || Number.isNaN(nowMs)) return { urgency: 'NORMAL', hoursRemaining: null }

  const hoursRemaining = (closingMs - nowMs) / (1000 * 60 * 60)
  if (hoursRemaining <= 0) return { urgency: 'BLOCKED', hoursRemaining }
  if (hoursRemaining <= 0.5) return { urgency: 'CRITICAL', hoursRemaining }
  if (hoursRemaining <= 2) return { urgency: 'URGENT', hoursRemaining }
  if (hoursRemaining <= 24) return { urgency: 'CLOSING_SOON', hoursRemaining }
  return { urgency: 'NORMAL', hoursRemaining }
}

/** True only once the deadline has actually passed — a warning is never itself a guarantee of anything (§11 binding constraint). */
export function isDeadlinePassed(nowIso: string, closingDate: string | null, closingTime: string | null): boolean {
  return classifySubmissionDeadlineUrgency(nowIso, closingDate, closingTime).urgency === 'BLOCKED'
}
