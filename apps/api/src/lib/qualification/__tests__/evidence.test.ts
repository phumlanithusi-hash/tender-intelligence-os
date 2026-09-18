import { describe, it, expect } from 'vitest'
import { isWellFormedEvidenceRef, dedupeTenderEvidence, dedupeAgencyEvidence, passRequiresAgencyEvidence } from '../evidence.js'
import { tenderEvidence } from './fixtures.js'

describe('isWellFormedEvidenceRef', () => {
  it('accepts a well-formed tender evidence ref', () => {
    expect(isWellFormedEvidenceRef(tenderEvidence())).toBe(true)
  })
  it('accepts a well-formed agency evidence ref', () => {
    expect(isWellFormedEvidenceRef({ kind: 'AGENCY', agencyEvidenceId: '11111111-1111-1111-1111-111111111111', description: null })).toBe(true)
  })
  it('rejects a non-UUID agency evidence id (malicious/malformed reference)', () => {
    expect(isWellFormedEvidenceRef({ kind: 'AGENCY', agencyEvidenceId: "1; drop table agency_evidence;--", description: null })).toBe(false)
  })
  it('rejects a non-UUID chunkId on a tender evidence ref', () => {
    expect(isWellFormedEvidenceRef(tenderEvidence({ chunkId: '../../etc/passwd' }))).toBe(false)
  })
})

describe('dedupeTenderEvidence / dedupeAgencyEvidence', () => {
  it('removes exact duplicate chunk references', () => {
    const refs = [tenderEvidence(), tenderEvidence()]
    expect(dedupeTenderEvidence(refs)).toHaveLength(1)
  })
  it('removes exact duplicate agency evidence references', () => {
    const refs = [
      { kind: 'AGENCY' as const, agencyEvidenceId: 'a', description: null },
      { kind: 'AGENCY' as const, agencyEvidenceId: 'a', description: 'dup' },
    ]
    expect(dedupeAgencyEvidence(refs)).toHaveLength(1)
  })
})

describe('passRequiresAgencyEvidence', () => {
  it('rejects a PASS result with no agency evidence', () => {
    expect(passRequiresAgencyEvidence('PASS', [])).toBe(false)
  })
  it('allows a PASS result backed by agency evidence', () => {
    expect(passRequiresAgencyEvidence('PASS', [{ kind: 'AGENCY', agencyEvidenceId: 'a', description: null }])).toBe(true)
  })
  it('does not require evidence for non-PASS statuses', () => {
    expect(passRequiresAgencyEvidence('UNKNOWN', [])).toBe(true)
  })
})
