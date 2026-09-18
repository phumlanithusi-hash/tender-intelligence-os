/**
 * Deterministic normalisation only (Phase 5 §7): every function here
 * is a pure string/date transform of what the source literally said.
 * None of them infer a missing fact — a field the source didn't
 * provide stays `null` all the way through, never defaulted to a
 * "reasonable" guess (Phase 5 §7's briefing_required example is the
 * general rule, not a special case).
 */
import { parseEtendersDateOnly, parseEtendersTime } from './parsers/dates.js'
import type { RawDetailPage, RawListingRow } from './types.js'

export function normaliseWhitespace(text: string | null | undefined): string | null {
  if (!text) return null
  const trimmed = text.replace(/\s+/g, ' ').trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Titles come from the "Tender Description" column, which can be very long free text — kept verbatim (raw) elsewhere; this only collapses whitespace, never truncates or rewrites content (never fabricate/alter source text). */
export function normaliseTitle(rawDescription: string | null | undefined): string | null {
  return normaliseWhitespace(rawDescription)
}

export function normaliseOrganisation(raw: string | null | undefined): string | null {
  return normaliseWhitespace(raw)
}

export function normaliseTenderNumber(raw: string | null | undefined): string | null {
  const value = normaliseWhitespace(raw)
  return value
}

/**
 * eSubmission column → boolean, or `null` when the source's own text
 * doesn't clearly say yes/no (Phase 5 §7 — blank/unrecognised text is
 * UNKNOWN, never defaulted to false).
 */
export function normaliseEsubmission(raw: string | null | undefined): boolean | null {
  const value = normaliseWhitespace(raw)?.toLowerCase()
  if (!value) return null
  if (['yes', 'y', 'true'].includes(value)) return true
  if (['no', 'n', 'false'].includes(value)) return false
  return null
}

/** Canonical `tenders` fields this adapter can populate deterministically from a listing row alone (before a detail fetch). Every field not mentioned by the source is left `undefined`/absent, never defaulted. */
export interface NormalisedTenderFields {
  title: string | null
  organisation: string | null
  tenderNumber: string | null
  province: string | null
  category: string | null
  publishedDate: string | null
  closingDate: string | null
  closingTime: string | null
  /** null = UNKNOWN, never defaulted to false (Phase 5 §7/§8). */
  briefingRequired: null
  submissionMethod: 'ONLINE' | null
}

export function normaliseListingRow(row: RawListingRow): NormalisedTenderFields {
  return {
    title: normaliseTitle(row.description),
    organisation: normaliseOrganisation(row.organisation),
    tenderNumber: normaliseTenderNumber(row.tenderNumber),
    province: normaliseWhitespace(row.province),
    category: normaliseWhitespace(row.category),
    publishedDate: parseEtendersDateOnly(row.advertisedText),
    closingDate: parseEtendersDateOnly(row.closingDateText),
    closingTime: parseEtendersTime(row.closingDateText),
    // eTenders' listing never states "no briefing is required" — the
    // absence of a briefing column value is unknown, not "no
    // briefing" (Phase 5 §7's worked example, applied literally).
    briefingRequired: null,
    submissionMethod: normaliseEsubmission(row.eSubmission) === true ? 'ONLINE' : null,
  }
}

/**
 * Determines briefing_required ONLY when the source's own detail text
 * explicitly says so either way — anything else (absent, ambiguous)
 * stays `null`/UNKNOWN (Phase 5 §7's worked example, applied here
 * literally rather than defaulted to false).
 */
export function normaliseBriefingRequired(briefingText: string | null | undefined): boolean | null {
  const value = normaliseWhitespace(briefingText)?.toLowerCase()
  if (!value) return null
  if (/no briefing|briefing is not required|no compulsory briefing/.test(value)) return false
  if (/compulsory brief|briefing session|briefing meeting|site visit/.test(value)) return true
  return null
}

export function normaliseDetailPage(
  detail: RawDetailPage,
): Omit<NormalisedTenderFields, 'briefingRequired'> & { description: string | null; briefingRequired: boolean | null } {
  return {
    title: normaliseTitle(detail.title),
    organisation: normaliseOrganisation(detail.organisation),
    tenderNumber: normaliseTenderNumber(detail.tenderNumber),
    province: normaliseWhitespace(detail.province),
    category: null,
    description: normaliseWhitespace(detail.description),
    publishedDate: parseEtendersDateOnly(detail.advertisedText),
    closingDate: parseEtendersDateOnly(detail.closingDateText),
    closingTime: parseEtendersTime(detail.closingTimeText) ?? parseEtendersTime(detail.closingDateText),
    briefingRequired: normaliseBriefingRequired(detail.briefingText),
    submissionMethod: null,
  }
}
