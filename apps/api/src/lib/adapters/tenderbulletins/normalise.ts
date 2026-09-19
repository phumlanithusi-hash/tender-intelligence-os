import { parseTenderBulletinsDateOnly } from './parsers/dates.js'
import type { RawListingRow } from './types.js'

export function normaliseWhitespace(text: string | null | undefined): string | null {
  if (!text) return null
  const trimmed = text.replace(/\s+/g, ' ').trim()
  return trimmed.length > 0 ? trimmed : null
}

export interface NormalisedTenderFields {
  title: string | null
  organisation: string | null
  closingDate: string | null
}

export function normaliseListingRow(row: RawListingRow): NormalisedTenderFields {
  return {
    title: normaliseWhitespace(row.description),
    organisation: normaliseWhitespace(row.organisation),
    closingDate: parseTenderBulletinsDateOnly(row.closingDateText),
  }
}
