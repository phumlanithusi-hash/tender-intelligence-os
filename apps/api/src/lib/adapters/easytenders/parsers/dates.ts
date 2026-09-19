/**
 * Deterministic date/time parsing for EasyTenders' own text format,
 * observed directly on the live site during this adapter's build:
 *   "Friday, 9 Oct 2026 11:00 AM"   (closing date, with time)
 *   "Friday, 18 Sep 2026"           (published date, no time)
 * Same non-negotiable rule as adapters/etenders/parsers/dates.ts:
 * returns null for anything that doesn't match, never guesses.
 */

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function isValidDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m && date.getUTCDate() === d
}

/** "Friday, 9 Oct 2026[, 11:00 AM]" -> "2026-10-09", or null. The leading weekday name is optional and ignored either way. */
export function parseEasyTendersDateOnly(raw: string | null | undefined): string | null {
  if (!raw) return null
  const text = raw.trim()
  if (!text) return null

  const match = text.match(/^(?:[A-Za-z]+,\s*)?(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/)
  if (!match) return null
  const day = Number(match[1]!)
  const month = MONTHS[match[2]!.slice(0, 3).toLowerCase()]
  const year = Number(match[3]!)
  if (month === undefined || !isValidDate(year, month, day)) return null
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

/** Extracts a 24h `HH:MM` time from "... 11:00 AM" / "... 4:00 PM" style text. Returns null when no unambiguous AM/PM time is present. */
export function parseEasyTendersTime(raw: string | null | undefined): string | null {
  if (!raw) return null
  const match = raw.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)\b/i)
  if (!match) return null
  let hour = Number(match[1])
  const minute = match[2]!
  const meridian = match[3]!.toUpperCase()
  if (hour < 1 || hour > 12) return null
  if (meridian === 'AM') hour = hour === 12 ? 0 : hour
  else hour = hour === 12 ? 12 : hour + 12
  return `${pad(hour)}:${minute}`
}
