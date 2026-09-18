import { describe, expect, it } from 'vitest'
import {
  normaliseBriefingRequired,
  normaliseEsubmission,
  normaliseListingRow,
  normaliseOrganisation,
  normaliseTenderNumber,
  normaliseTitle,
  normaliseWhitespace,
} from '../normalise.js'
import type { RawListingRow } from '../types.js'

describe('normaliseWhitespace / title / organisation / tender number', () => {
  it('collapses internal whitespace and trims', () => {
    expect(normaliseWhitespace('  Foo   Bar  \n Baz ')).toBe('Foo Bar Baz')
  })

  it('returns null for empty/null/undefined rather than an empty string', () => {
    expect(normaliseWhitespace('')).toBeNull()
    expect(normaliseWhitespace('   ')).toBeNull()
    expect(normaliseWhitespace(null)).toBeNull()
    expect(normaliseWhitespace(undefined)).toBeNull()
  })

  it('title/organisation/tender number all defer to the same whitespace rule, never rewriting content', () => {
    expect(normaliseTitle(' Supply of  X ')).toBe('Supply of X')
    expect(normaliseOrganisation(' City of  Cape Town ')).toBe('City of Cape Town')
    expect(normaliseTenderNumber(' ABC/2026/01 ')).toBe('ABC/2026/01')
  })
})

describe('normaliseEsubmission', () => {
  it('recognises yes/no case-insensitively', () => {
    expect(normaliseEsubmission('Yes')).toBe(true)
    expect(normaliseEsubmission('no')).toBe(false)
  })

  it('returns null (UNKNOWN) for blank or unrecognised text — never defaults to false', () => {
    expect(normaliseEsubmission(null)).toBeNull()
    expect(normaliseEsubmission('')).toBeNull()
    expect(normaliseEsubmission('Maybe')).toBeNull()
  })
})

describe('normaliseBriefingRequired', () => {
  it('is null/UNKNOWN when the source says nothing about briefings (Phase 5 §7 worked example)', () => {
    expect(normaliseBriefingRequired(null)).toBeNull()
    expect(normaliseBriefingRequired('')).toBeNull()
  })

  it('is true only when the source text explicitly describes a briefing', () => {
    expect(normaliseBriefingRequired('A compulsory briefing session will be held on 1 Oct.')).toBe(true)
  })

  it('is false only when the source text explicitly says no briefing is required', () => {
    expect(normaliseBriefingRequired('No briefing session will be held for this tender.')).toBe(false)
  })

  it('stays null for ambiguous text rather than guessing', () => {
    expect(normaliseBriefingRequired('Contact the department for more information.')).toBeNull()
  })
})

describe('normaliseListingRow', () => {
  const baseRow: RawListingRow = {
    externalId: 'ET-1',
    detailUrl: 'https://www.etenders.gov.za/Home/opportunity?id=1',
    category: 'ICT',
    description: '  Supply of laptops  ',
    eSubmission: 'Yes',
    advertisedText: '1 September 2026',
    closingDateText: '30 September 2026, 12:00',
    organisation: 'Department of Health',
    tenderNumber: 'DOH/1',
    province: 'Gauteng',
    tenderType: 'RFB',
  }

  it('maps every deterministic field', () => {
    const result = normaliseListingRow(baseRow)
    expect(result).toEqual({
      title: 'Supply of laptops',
      organisation: 'Department of Health',
      tenderNumber: 'DOH/1',
      province: 'Gauteng',
      category: 'ICT',
      publishedDate: '2026-09-01',
      closingDate: '2026-09-30',
      closingTime: '12:00',
      briefingRequired: null,
      submissionMethod: 'ONLINE',
    })
  })

  it('never fabricates briefing_required — always null from a listing row alone', () => {
    expect(normaliseListingRow(baseRow).briefingRequired).toBeNull()
  })

  it('leaves every field null when the source provided nothing', () => {
    const empty: RawListingRow = {
      externalId: null,
      detailUrl: null,
      category: null,
      description: null,
      eSubmission: null,
      advertisedText: null,
      closingDateText: null,
      organisation: null,
      tenderNumber: null,
      province: null,
      tenderType: null,
    }
    const result = normaliseListingRow(empty)
    expect(result.title).toBeNull()
    expect(result.organisation).toBeNull()
    expect(result.publishedDate).toBeNull()
    expect(result.closingDate).toBeNull()
    expect(result.submissionMethod).toBeNull()
  })
})
