/**
 * Explicit parser for TenderAlerts' own date format, confirmed live:
 * `YYYY-MM-DD HH:mm` (e.g. "2026-09-29 11:00"). The source uses the
 * literal text "n/a" for an unset briefing date/time — this returns
 * undefined for that and for anything else that doesn't match the
 * exact pattern, never a guessed/defaulted value. Treats the
 * source's local time as the timestamp value (via Date.UTC), same
 * convention as every other adapter here.
 */
const TENDERALERTS_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2})$/

export function parseTenderAlertsDateTime(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  const match = TENDERALERTS_DATETIME_PATTERN.exec(trimmed)
  if (!match) return undefined
  const [, yearStr, monthStr, dayStr, hourStr, minuteStr] = match
  const date = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr), Number(hourStr), Number(minuteStr), 0))
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString()
}
