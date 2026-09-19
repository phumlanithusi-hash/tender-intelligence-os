/**
 * Deterministic normalisation only — same rule as
 * adapters/etenders/normalise.ts: pure string/date transforms of what
 * the source literally said, never an inferred/defaulted value.
 */
import { parseEasyTendersDateOnly, parseEasyTendersTime } from './parsers/dates.js'
import type { RawDetailPage, RawListingRow } from './types.js'

export function normaliseWhitespace(text: string | null | undefined): string | null {
  if (!text) return null
  const trimmed = text.replace(/\s+/g, ' ').trim()
  return trimmed.length > 0 ? trimmed : null
}

export interface NormalisedTenderFields {
  title: string | null
  organisation: string | null
  tenderNumber: string | null
  province: string | null
  category: string | null
  publishedDate: string | null
  closingDate: string | null
  closingTime: string | null
}

/** Fields derivable from the listing row alone, before a detail fetch — the description is the best title stand-in until the detail page (which may have a fuller one) is fetched. */
export function normaliseListingRow(row: RawListingRow): Pick<NormalisedTenderFields, 'title' | 'organisation' | 'closingDate' | 'closingTime'> {
  return {
    title: normaliseWhitespace(row.description),
    organisation: normaliseWhitespace(row.organisation),
    closingDate: parseEasyTendersDateOnly(row.closingDateText),
    closingTime: parseEasyTendersTime(row.closingDateText),
  }
}

export function normaliseDetailPage(detail: RawDetailPage): NormalisedTenderFields & { description: string | null } {
  return {
    title: normaliseWhitespace(detail.title) ?? normaliseWhitespace(detail.description),
    organisation: normaliseWhitespace(detail.organisation),
    tenderNumber: normaliseWhitespace(detail.tenderNumber),
    province: normaliseWhitespace(detail.province),
    category: normaliseWhitespace(detail.category),
    description: normaliseWhitespace(detail.description),
    publishedDate: parseEasyTendersDateOnly(detail.advertisedText),
    closingDate: parseEasyTendersDateOnly(detail.closingDateText),
    closingTime: parseEasyTendersTime(detail.closingDateText),
  }
}
