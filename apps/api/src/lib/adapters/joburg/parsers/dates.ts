/**
 * Deterministic date parsing only — never an inferred/defaulted value
 * (same rule as every other adapter's parsers/dates.ts). The listing
 * only ever shows a plain "D Month YYYY" (or "DD Month YYYY") single
 * date for a normal closing date; some extended/rescheduled bids show
 * a range instead (e.g. "07 AUGUST 2026 TO 28 AUGUST 2026" — observed
 * live on the COJ-EISD001 row). Rather than guess which end of a
 * range is the real "closing" date, this only parses the single-date
 * case and leaves a range (or anything else unrecognised) unparsed —
 * the raw text is preserved untouched in rawMetadata either way.
 */
const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
}

export function parseJoburgClosingDate(text: string | null): string | undefined {
  if (!text) return undefined
  const match = text.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/)
  if (!match) return undefined
  const [, dayStr, monthName, yearStr] = match
  const month = MONTHS[monthName!.toLowerCase()]
  if (month === undefined) return undefined
  const day = Number(dayStr)
  const year = Number(yearStr)
  const date = new Date(Date.UTC(year, month, day))
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString()
}
