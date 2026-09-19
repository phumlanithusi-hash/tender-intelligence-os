/**
 * Tolerant, multi-format date parsing — copied from
 * adapters/etenders/parsers/dates.ts since this source's real closing-
 * date text format hasn't been confirmed from raw HTML yet (only from
 * a text-summarised fetch); a broadly-tolerant parser maximises the
 * chance of matching whatever format the live DOM actually uses,
 * while keeping the same non-negotiable rule: null for anything that
 * doesn't match, never a guess.
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

export function parseTenderBulletinsDateOnly(raw: string | null | undefined): string | null {
  if (!raw) return null
  const text = raw.trim()
  if (!text) return null

  const longForm = text.match(/^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})/)
  if (longForm) {
    const day = Number(longForm[1]!)
    const month = MONTHS[longForm[2]!.toLowerCase()]
    const year = Number(longForm[3]!)
    if (month !== undefined && isValidDate(year, month, day)) return `${year}-${pad(month + 1)}-${pad(day)}`
    return null
  }

  const dashForm = text.match(/^(\d{1,2})[-/]([A-Za-z]+)[-/](\d{4})/)
  if (dashForm) {
    const day = Number(dashForm[1]!)
    const month = MONTHS[dashForm[2]!.toLowerCase()]
    const year = Number(dashForm[3]!)
    if (month !== undefined && isValidDate(year, month, day)) return `${year}-${pad(month + 1)}-${pad(day)}`
    return null
  }

  const isoForm = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (isoForm) {
    const year = Number(isoForm[1]!)
    const month = Number(isoForm[2]!) - 1
    const day = Number(isoForm[3]!)
    if (isValidDate(year, month, day)) return `${year}-${pad(month + 1)}-${pad(day)}`
    return null
  }

  const slashForm = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slashForm) {
    const day = Number(slashForm[1]!)
    const month = Number(slashForm[2]!) - 1
    const year = Number(slashForm[3]!)
    if (isValidDate(year, month, day)) return `${year}-${pad(month + 1)}-${pad(day)}`
    return null
  }

  return null
}
