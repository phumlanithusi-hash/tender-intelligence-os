import { BID_MILESTONE_AT_RISK_WINDOW_DAYS } from '@tender-os/constants'

/**
 * Phase 12 §19 (binding constraint) — the exact deterministic AT_RISK
 * rule, documented and pure: a milestone still UPCOMING or
 * IN_PROGRESS becomes AT_RISK once its due date is within
 * `BID_MILESTONE_AT_RISK_WINDOW_DAYS` days of `nowIso` (inclusive of
 * already-passed-but-not-yet-marked-MISSED dates). COMPLETED/MISSED
 * are left untouched by this function — completion/miss transitions
 * are explicit human/system actions, not computed here.
 */
export function evaluateMilestoneAtRisk(status: string, dueDate: string | null, nowIso: string): string {
  if (status !== 'UPCOMING' && status !== 'IN_PROGRESS') return status
  if (!dueDate) return status
  const due = new Date(`${dueDate}T23:59:59Z`).getTime()
  const now = new Date(nowIso).getTime()
  if (Number.isNaN(due) || Number.isNaN(now)) return status
  const daysUntilDue = (due - now) / 86_400_000
  if (daysUntilDue < 0) return 'MISSED'
  if (daysUntilDue <= BID_MILESTONE_AT_RISK_WINDOW_DAYS) return 'AT_RISK'
  return status
}
