/**
 * Explicit parser for Transnet's own date format, confirmed live:
 * `M/D/YYYY h:mm:ss AM/PM` (e.g. "9/29/2026 10:00:00 AM",
 * "12/7/2026 4:00:00 PM"). Never falls back to `Date.parse` (locale-
 * dependent guessing) — returns undefined for anything that doesn't
 * match this exact shape, same discipline as every other adapter's
 * date parser. Treats the source's local time as the timestamp value
 * (via Date.UTC), same convention as every other adapter here (e.g.
 * Eskom's parsers/dates.ts) — none of these adapters have a confirmed
 * source timezone to convert from, so none invents one.
 */
const TRANSNET_DATETIME_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/i

export function parseTransnetDateTime(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  const match = TRANSNET_DATETIME_PATTERN.exec(trimmed)
  if (!match) return undefined
  const [, monthStr, dayStr, yearStr, hourStr, minuteStr, secondStr, meridiem] = match
  const month = Number(monthStr)
  const day = Number(dayStr)
  const year = Number(yearStr)
  const minute = Number(minuteStr)
  const second = Number(secondStr)
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined
  let hour = Number(hourStr) % 12
  if ((meridiem ?? '').toUpperCase() === 'PM') hour += 12
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString()
}
