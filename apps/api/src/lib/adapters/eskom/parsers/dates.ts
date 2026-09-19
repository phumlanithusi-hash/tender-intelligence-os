/**
 * Deterministic date parsing only — never an inferred/defaulted value
 * (same rule as every other adapter's parsers/dates.ts). Eskom's own
 * format is "YYYY-Mon-DD HH:mm:ss" (e.g. "2027-Feb-22 13:33:00"), a
 * 3-letter month abbreviation that isn't reliably parsed by
 * `Date.parse` across runtimes, so this parses it explicitly rather
 * than trusting the built-in parser to guess right.
 */
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

export function parseEskomDateTime(text: string | null): string | undefined {
  if (!text) return undefined
  const match = text.trim().match(/^(\d{4})-([A-Za-z]{3})-(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})$/)
  if (!match) return undefined
  const [, yearStr, monthAbbr, dayStr, hourStr, minStr, secStr] = match
  const month = MONTHS[monthAbbr!.toLowerCase()]
  if (month === undefined) return undefined
  const date = new Date(Date.UTC(Number(yearStr), month, Number(dayStr), Number(hourStr), Number(minStr), Number(secStr)))
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString()
}
