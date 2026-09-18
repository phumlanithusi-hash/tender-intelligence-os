import { describe, expect, it } from 'vitest'
import {
  checkTendersMissingClosingDate,
  checkTendersMissingSourceUrl,
  checkDuplicateTenderNumbers,
  checkDuplicateSourceRecords,
  checkDocumentsMissingHash,
  checkMandatoryRequirementsWithoutAssessment,
  checkOutcomesWithoutProvenance,
  checkWinnersWithoutEvidence,
  checkSubmittedBidsWithoutVerifiedEvidence,
} from '../rules.js'

describe('checkTendersMissingClosingDate', () => {
  it('flags a live tender with no closing date', () => {
    const result = checkTendersMissingClosingDate([{ id: 't1', tenderNumber: 'T1', status: 'OPEN', closingDate: null }])
    expect(result).toHaveLength(1)
    expect(result[0]!.rule).toBe('TENDER_MISSING_CLOSING_DATE')
    expect(result[0]!.severity).toBe('HIGH')
  })

  it('does not flag a tender that has a closing date', () => {
    expect(checkTendersMissingClosingDate([{ id: 't1', tenderNumber: 'T1', status: 'OPEN', closingDate: '2026-01-01' }])).toHaveLength(0)
  })

  it('does not flag a CANCELLED tender with no closing date', () => {
    expect(checkTendersMissingClosingDate([{ id: 't1', tenderNumber: 'T1', status: 'CANCELLED', closingDate: null }])).toHaveLength(0)
  })
})

describe('checkTendersMissingSourceUrl', () => {
  it('flags a tender with no source-url-bearing source record', () => {
    const result = checkTendersMissingSourceUrl(['t1', 't2'], new Set(['t2']))
    expect(result).toHaveLength(1)
    expect(result[0]!.entityId).toBe('t1')
  })
})

describe('checkDuplicateTenderNumbers', () => {
  it('flags every id in a group of 2+', () => {
    const result = checkDuplicateTenderNumbers([{ tenderNumber: 'TN-1', ids: ['a', 'b'] }])
    expect(result).toHaveLength(2)
    expect(result.every((r) => r.severity === 'CRITICAL')).toBe(true)
  })

  it('does not flag a group of exactly 1', () => {
    expect(checkDuplicateTenderNumbers([{ tenderNumber: 'TN-1', ids: ['a'] }])).toHaveLength(0)
  })
})

describe('checkDuplicateSourceRecords', () => {
  it('flags duplicates keyed by (source, external id)', () => {
    const result = checkDuplicateSourceRecords([{ sourceId: 's1', externalId: 'e1', ids: ['r1', 'r2'] }])
    expect(result).toHaveLength(2)
  })
})

describe('checkDocumentsMissingHash', () => {
  it('flags a downloaded document with no hash', () => {
    const result = checkDocumentsMissingHash([{ id: 'd1', downloadedAt: '2026-01-01T00:00:00Z', fileHash: null }])
    expect(result).toHaveLength(1)
  })

  it('does not flag a document never downloaded', () => {
    expect(checkDocumentsMissingHash([{ id: 'd1', downloadedAt: null, fileHash: null }])).toHaveLength(0)
  })
})

describe('checkMandatoryRequirementsWithoutAssessment', () => {
  it('flags a mandatory requirement still UNKNOWN, never a non-mandatory one', () => {
    const result = checkMandatoryRequirementsWithoutAssessment([
      { id: 'r1', mandatory: true, qualificationStatus: 'UNKNOWN' },
      { id: 'r2', mandatory: false, qualificationStatus: 'UNKNOWN' },
      { id: 'r3', mandatory: true, qualificationStatus: 'PASS' },
    ])
    expect(result).toHaveLength(1)
    expect(result[0]!.entityId).toBe('r1')
    expect(result[0]!.severity).toBe('LOW')
  })
})

describe('checkOutcomesWithoutProvenance', () => {
  it('flags an AWARDED outcome with OTHER provenance', () => {
    const result = checkOutcomesWithoutProvenance([{ id: 'o1', outcomeStatus: 'AWARDED', winnerName: null, provenance: 'OTHER', sourceDocumentId: null, sourceEvidenceRef: null }])
    expect(result).toHaveLength(1)
    expect(result[0]!.severity).toBe('HIGH')
  })

  it('does not flag an outcome with real provenance', () => {
    expect(checkOutcomesWithoutProvenance([{ id: 'o1', outcomeStatus: 'AWARDED', winnerName: null, provenance: 'TENDER_DOCUMENT', sourceDocumentId: null, sourceEvidenceRef: null }])).toHaveLength(0)
  })
})

describe('checkWinnersWithoutEvidence', () => {
  it('flags a recorded winner with no document AND no evidence ref', () => {
    const result = checkWinnersWithoutEvidence([{ id: 'o1', outcomeStatus: 'AWARDED', winnerName: 'Acme', provenance: 'HUMAN_REPORTED', sourceDocumentId: null, sourceEvidenceRef: null }])
    expect(result).toHaveLength(1)
    expect(result[0]!.severity).toBe('CRITICAL')
  })

  it('does not flag a winner backed by a source document', () => {
    expect(checkWinnersWithoutEvidence([{ id: 'o1', outcomeStatus: 'AWARDED', winnerName: 'Acme', provenance: 'HUMAN_REPORTED', sourceDocumentId: 'doc1', sourceEvidenceRef: null }])).toHaveLength(0)
  })
})

describe('checkSubmittedBidsWithoutVerifiedEvidence', () => {
  it('flags SUBMITTED with no verified receipt, never NOT_READY', () => {
    const result = checkSubmittedBidsWithoutVerifiedEvidence([
      { id: 'e1', agencyId: 'ag1', status: 'SUBMITTED', hasVerifiedReceipt: false },
      { id: 'e2', agencyId: 'ag1', status: 'NOT_READY', hasVerifiedReceipt: false },
      { id: 'e3', agencyId: 'ag1', status: 'SUBMITTED', hasVerifiedReceipt: true },
    ])
    expect(result).toHaveLength(1)
    expect(result[0]!.entityId).toBe('e1')
    expect(result[0]!.agencyId).toBe('ag1')
  })
})
