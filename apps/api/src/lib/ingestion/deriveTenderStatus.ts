import type { TenderStatus } from '@tender-os/constants'

/**
 * The window (Phase 5/Phase 3 KPI convention — see
 * repositories/tenderSummary.ts's own `in7Days` "closing soon" query)
 * used to decide OPEN vs. CLOSING_SOON. Kept as one named constant so
 * the ingestion-time status derivation below and any future reader
 * agree on what "soon" means.
 */
const CLOSING_SOON_WINDOW_DAYS = 7

/**
 * The lifecycle states this function is allowed to assign or move a
 * tender between. `CANCELLED`, `AWARDED`, `WITHDRAWN`, and `UNKNOWN`
 * are never touched here — those represent something a human or a
 * future dedicated process determined, not something derivable from
 * `closing_date` alone, and this function must never overwrite that
 * determination.
 */
const AUTO_DERIVABLE_STATUSES: readonly TenderStatus[] = ['DISCOVERED', 'VERIFYING', 'VERIFIED', 'OPEN', 'CLOSING_SOON', 'CLOSED']

export function isAutoDerivableStatus(status: TenderStatus): boolean {
  return AUTO_DERIVABLE_STATUSES.includes(status)
}

/**
 * Derives a tender's lifecycle status purely from its own
 * `closing_date` (Phase 5/Phase 10 decision, 2026-09-20 — see
 * docs/DECISIONS.md): a newly discovered tender used to sit at
 * `DISCOVERED` forever, since nothing in the codebase ever promoted
 * it — meaning `OPEN`/`CLOSING_SOON`, the statuses the Tender Radar
 * KPIs, source-registry filters, and the Opportunities scan all key
 * on, were unreachable in practice. There is no verification step to
 * wait for in this codebase, so a tender's own stated closing date is
 * the only real signal available, and this is a pure, deterministic
 * function of it — never a guess, never AI-derived.
 *
 * `closingDate` with no time component is treated as a plain
 * calendar date (matching the rest of this codebase's documented
 * timezone-ambiguity convention, e.g. lib/scoring/gates.ts) — a
 * tender closing "today" is not yet CLOSED.
 */
export function deriveTenderStatus(closingDate: string | null, now: Date = new Date()): TenderStatus {
  if (!closingDate) return 'OPEN'

  const closing = new Date(`${closingDate}T00:00:00Z`)
  if (Number.isNaN(closing.getTime())) return 'OPEN'

  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const diffDays = Math.floor((closing.getTime() - todayUtc) / (24 * 60 * 60 * 1000))

  if (diffDays < 0) return 'CLOSED'
  if (diffDays <= CLOSING_SOON_WINDOW_DAYS) return 'CLOSING_SOON'
  return 'OPEN'
}
