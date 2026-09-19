/**
 * Deterministic date parsing only — never an inferred/defaulted value
 * (same rule as every other adapter's parsers/dates.ts). Cape Town's
 * own format is "YYYY-MM-DD hh:mm AM/PM" (e.g. "2026-10-21 10:00 AM").
 */
export function parseCapeTownDateTime(text: string | null): string | undefined {
  if (!text) return undefined
  const match = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!match) return undefined
  const [, yearStr, monthStr, dayStr, hourStr, minStr, meridiem] = match
  let hour = Number(hourStr)
  if (meridiem!.toUpperCase() === 'PM' && hour !== 12) hour += 12
  if (meridiem!.toUpperCase() === 'AM' && hour === 12) hour = 0
  const date = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr), hour, Number(minStr)))
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString()
}
