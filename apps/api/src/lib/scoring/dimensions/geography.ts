import type { GeographyInput } from '../types.js'
import type { GeographyMatchStatus } from '@tender-os/constants'

/**
 * Geography match (Phase 10 §20) — carries forward the Phase 7/8
 * textual/FK-lite geography limitation unchanged (province/municipality
 * FK resolution on the TENDER side remains the pre-existing
 * architecture; this only compares whatever structured scope rows
 * already exist on both sides). NATIONAL agency coverage matches any
 * tender scope. No agency geography data recorded at all → UNKNOWN,
 * never assumed MATCH.
 */
export function matchGeography(input: GeographyInput): { status: GeographyMatchStatus; explanation: string } {
  if (input.tenderScope.length === 0) {
    return { status: 'UNKNOWN', explanation: 'Tender has no recorded geographic scope.' }
  }
  if (!input.agencyGeographyKnown || input.agencyScope.length === 0) {
    return { status: 'UNKNOWN', explanation: 'Agency geographic capability has not been recorded.' }
  }
  if (input.agencyScope.some((s) => s.scopeType === 'NATIONAL')) {
    return { status: 'MATCH', explanation: 'Agency operates nationally, covering all tender geographic scopes.' }
  }
  if (input.tenderScope.some((s) => s.scopeType === 'NATIONAL')) {
    // Tender is national but agency is not — cannot claim a match without inventing coverage.
    return { status: 'MISMATCH', explanation: 'Tender requires national coverage; agency geographic capability is limited to specific areas.' }
  }
  const agencyProvinces = new Set(input.agencyScope.map((s) => s.provinceId).filter(Boolean))
  const agencyMunicipalities = new Set(input.agencyScope.map((s) => s.municipalityId).filter(Boolean))
  const overlaps = input.tenderScope.some((s) => (s.provinceId && agencyProvinces.has(s.provinceId)) || (s.municipalityId && agencyMunicipalities.has(s.municipalityId)))
  return overlaps
    ? { status: 'MATCH', explanation: 'Tender geographic scope overlaps with a recorded agency operating area.' }
    : { status: 'MISMATCH', explanation: 'Tender geographic scope does not overlap with any recorded agency operating area.' }
}
