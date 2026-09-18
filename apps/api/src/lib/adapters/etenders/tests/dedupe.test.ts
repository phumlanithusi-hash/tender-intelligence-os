import { describe, expect, it } from 'vitest'
import { matchExistingTender, type DedupeCandidate } from '../dedupe.js'

describe('matchExistingTender (Phase 5 §9)', () => {
  it('matches on tender number + organisation', () => {
    const candidates: DedupeCandidate[] = [
      { id: 't1', tenderNumber: 'ABC/1', organisation: 'Dept X', title: 'Foo', closingDate: '2026-10-01' },
    ]
    const decision = matchExistingTender(candidates, {
      tenderNumber: 'abc/1',
      organisation: 'dept x',
      title: 'Different title text',
      closingDate: '2026-10-01',
    })
    expect(decision).toEqual({ outcome: 'MATCH', tenderId: 't1', reason: 'tender_number_and_organisation' })
  })

  it('matches on tender number alone when only one candidate has it and organisation is unstated', () => {
    const candidates: DedupeCandidate[] = [
      { id: 't1', tenderNumber: 'ABC/1', organisation: null, title: 'Foo', closingDate: null },
    ]
    const decision = matchExistingTender(candidates, {
      tenderNumber: 'ABC/1',
      organisation: null,
      title: 'Foo',
      closingDate: null,
    })
    expect(decision).toEqual({ outcome: 'MATCH', tenderId: 't1', reason: 'tender_number' })
  })

  it('is AMBIGUOUS when the same tender number appears under different organisations that cannot be disambiguated', () => {
    const candidates: DedupeCandidate[] = [
      { id: 't1', tenderNumber: 'ABC/1', organisation: 'Dept X', title: 'Foo', closingDate: null },
      { id: 't2', tenderNumber: 'ABC/1', organisation: 'Dept Y', title: 'Bar', closingDate: null },
    ]
    const decision = matchExistingTender(candidates, {
      tenderNumber: 'ABC/1',
      organisation: null,
      title: 'Baz',
      closingDate: null,
    })
    expect(decision.outcome).toBe('AMBIGUOUS')
  })

  it('resolves an ambiguous tender-number collision once organisation disambiguates it', () => {
    const candidates: DedupeCandidate[] = [
      { id: 't1', tenderNumber: 'ABC/1', organisation: 'Dept X', title: 'Foo', closingDate: null },
      { id: 't2', tenderNumber: 'ABC/1', organisation: 'Dept Y', title: 'Bar', closingDate: null },
    ]
    const decision = matchExistingTender(candidates, {
      tenderNumber: 'ABC/1',
      organisation: 'Dept Y',
      title: 'Bar',
      closingDate: null,
    })
    expect(decision).toEqual({ outcome: 'MATCH', tenderId: 't2', reason: 'tender_number_and_organisation' })
  })

  it('matches on organisation + exact normalised title when no tender number is present on either side', () => {
    const candidates: DedupeCandidate[] = [
      { id: 't1', tenderNumber: null, organisation: 'City of Cape Town', title: 'Refuse removal services', closingDate: null },
    ]
    const decision = matchExistingTender(candidates, {
      tenderNumber: null,
      organisation: 'City of Cape Town',
      title: 'refuse removal services',
      closingDate: null,
    })
    expect(decision).toEqual({ outcome: 'MATCH', tenderId: 't1', reason: 'organisation_and_title' })
  })

  it('never merges on title similarity alone — flags a weak organisation+date+similar-title match as AMBIGUOUS, not MATCH', () => {
    const candidates: DedupeCandidate[] = [
      {
        id: 't1',
        tenderNumber: null,
        organisation: 'Dept X',
        title: 'Supply and delivery of office furniture for regional offices',
        closingDate: '2026-10-01',
      },
    ]
    const decision = matchExistingTender(candidates, {
      tenderNumber: null,
      organisation: 'Dept X',
      title: 'Supply and delivery of office furniture regional branches',
      closingDate: '2026-10-01',
    })
    expect(decision.outcome).toBe('AMBIGUOUS')
  })

  it('is NEW when nothing lines up', () => {
    const candidates: DedupeCandidate[] = [
      { id: 't1', tenderNumber: 'ABC/1', organisation: 'Dept X', title: 'Foo', closingDate: '2026-10-01' },
    ]
    const decision = matchExistingTender(candidates, {
      tenderNumber: 'XYZ/9',
      organisation: 'Dept Z',
      title: 'Totally unrelated',
      closingDate: '2026-11-15',
    })
    expect(decision).toEqual({ outcome: 'NEW' })
  })

  it('is NEW for an empty candidate list', () => {
    expect(matchExistingTender([], { tenderNumber: 'X', organisation: 'Y', title: 'Z', closingDate: null })).toEqual({
      outcome: 'NEW',
    })
  })
})
