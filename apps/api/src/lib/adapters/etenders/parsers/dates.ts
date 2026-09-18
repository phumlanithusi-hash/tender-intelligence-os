/**
 * Deterministic date/time parsing for eTenders' own text formats
 * (Phase 5 §7: "Normalisation must NOT infer missing facts"). Every
 * function here returns `null` for text it cannot confidently parse
 * rather than guessing — an unparsed date must surface as unknown,
 * never as a fabricated one (master spec's non-negotiable principle:
 * "never fabricate tender information").
 *
 * eTenders' listing/detail pages render dates like:
 *   "11 September 2026"
 *   "11 September 2026, 11:00"
 *   "11-Sep-2026"
 *   "2026/09/11"
 * This is a documented, best-effort set of formats — not a claim of
 * exhaustive coverage of every string the live site could ever emit.
 */

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function isValidDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m && date.getUTCDate() === d
}

/**
 * Parses a date-only string into an ISO `YYYY-MM-DD` string, or null
 * if the text doesn't match a recognised, unambiguous format. Never
 * throws.
 */
export function parseEtendersDateOnly(raw: string | null | undefined): string | null {
  if (!raw) return null
  const text = raw.trim()
  if (!text) return null

  // "11 September 2026" / "11 Sep 2026"
  const longForm = text.match(/^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})/)
  if (longForm) {
    const day = Number(longForm[1]!)
    const month = MONTHS[longForm[2]!.toLowerCase()]
    const year = Number(longForm[3]!)
    if (month !== undefined && isValidDate(year, month, day)) {
      return `${year}-${pad(month + 1)}-${pad(day)}`
    }
    return null
  }

  // "11-Sep-2026" / "11/Sep/2026"
  const dashForm = text.match(/^(\d{1,2})[-/]([A-Za-z]+)[-/](\d{4})/)
  if (dashForm) {
    const day = Number(dashForm[1]!)
    const month = MONTHS[dashForm[2]!.toLowerCase()]
    const year = Number(dashForm[3]!)
    if (month !== undefined && isValidDate(year, month, day)) {
      return `${year}-${pad(month + 1)}-${pad(day)}`
    }
    return null
  }

  // "2026/09/11" or "2026-09-11" (ISO-ish, year-first — unambiguous).
  const isoForm = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (isoForm) {
    const year = Number(isoForm[1]!)
    const month = Number(isoForm[2]!) - 1
    const day = Number(isoForm[3]!)
    if (isValidDate(year, month, day)) {
      return `${year}-${pad(month + 1)}-${pad(day)}`
    }
    return null
  }

  // "11/09/2026" (day-first, South African convention) — only accepted
  // when the first component cannot possibly be a month (>12), or when
  // both could be a day, in which case day-first is the documented SA
  // default rather than a guess (Phase 5 §7 requires a deterministic,
  // documented rule, not silent ambiguity resolution per-instance).
  const slashForm = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slashForm) {
    const day = Number(slashForm[1]!)
    const month = Number(slashForm[2]!) - 1
    const year = Number(slashForm[3]!)
    if (isValidDate(year, month, day)) {
      return `${year}-${pad(month + 1)}-${pad(day)}`
    }
    return null
  }

  return null
}

/**
 * Extracts a 24h `HH:MM` time from source text, when present
 * alongside or separate from a date (e.g. "11 September 2026, 11:00").
 * Returns null when no unambiguous time is present.
 */
export function parseEtendersTime(raw: string | null | undefined): string | null {
  if (!raw) return null
  const match = raw.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)
  if (!match) return null
  return `${pad(Number(match[1]))}:${match[2]}`
}
