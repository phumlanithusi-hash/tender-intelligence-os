import { describe, expect, it } from 'vitest'
import { resolveSubmissionMethod } from '../resolver.js'
import type { MethodResolutionInput } from '../types.js'

const base: MethodResolutionInput = {
  tenderSubmissionMethod: null,
  tenderSubmissionUrl: null,
  tenderSubmissionEmail: null,
  documentEvidenceMethod: null,
  manuallyConfirmedMethod: null,
  supportedMethods: ['PORTAL', 'EMAIL', 'PHYSICAL_COURIER', 'PHYSICAL_HAND_DELIVERY', 'API', 'OTHER'],
}

describe('resolveSubmissionMethod (Phase 16 §12)', () => {
  it('resolves PORTAL from the verified tender record with HIGH confidence', () => {
    const result = resolveSubmissionMethod({ ...base, tenderSubmissionMethod: 'Online eTenders Portal', tenderSubmissionUrl: 'https://etenders.gov.za/x' })
    expect(result.method).toBe('PORTAL')
    expect(result.confidence).toBe('HIGH')
    expect(result.automationStatus).toBe('MANUAL_REQUIRED')
    expect(result.target).toBe('https://etenders.gov.za/x')
  })

  it('resolves EMAIL from the tender record', () => {
    const result = resolveSubmissionMethod({ ...base, tenderSubmissionMethod: 'Email submission', tenderSubmissionEmail: 'tenders@agency.gov.za' })
    expect(result.method).toBe('EMAIL')
    expect(result.target).toBe('tenders@agency.gov.za')
  })

  it('resolves PHYSICAL_COURIER and PHYSICAL_HAND_DELIVERY distinctly', () => {
    expect(resolveSubmissionMethod({ ...base, tenderSubmissionMethod: 'Courier only' }).method).toBe('PHYSICAL_COURIER')
    expect(resolveSubmissionMethod({ ...base, tenderSubmissionMethod: 'Hand deliver to the tender box' }).method).toBe('PHYSICAL_HAND_DELIVERY')
  })

  it('falls back to document evidence with MEDIUM confidence when the tender record itself is silent', () => {
    const result = resolveSubmissionMethod({ ...base, documentEvidenceMethod: 'Submit via the online portal' })
    expect(result.method).toBe('PORTAL')
    expect(result.confidence).toBe('MEDIUM')
    expect(result.reason).toMatch(/inferred/i)
  })

  it('a conflicting tender record vs document evidence -> UNKNOWN + requiresReview, never silently picks one', () => {
    const result = resolveSubmissionMethod({ ...base, tenderSubmissionMethod: 'Email', documentEvidenceMethod: 'Online portal' })
    expect(result.method).toBe('UNKNOWN')
    expect(result.requiresReview).toBe(true)
  })

  it('nothing known at all -> UNKNOWN, never guessed', () => {
    const result = resolveSubmissionMethod(base)
    expect(result.method).toBe('UNKNOWN')
    expect(result.automationStatus).toBe('UNKNOWN')
  })

  it('a human-confirmed method always wins, even over conflicting evidence', () => {
    const result = resolveSubmissionMethod({ ...base, tenderSubmissionMethod: 'Email', documentEvidenceMethod: 'Portal', manuallyConfirmedMethod: 'PORTAL' })
    expect(result.method).toBe('PORTAL')
    expect(result.confidence).toBe('CONFIRMED')
    expect(result.requiresReview).toBe(false)
  })

  it('a method the adapter registry has never heard of is UNSUPPORTED, not MANUAL_REQUIRED', () => {
    const result = resolveSubmissionMethod({ ...base, tenderSubmissionMethod: 'Fax only', supportedMethods: ['PORTAL', 'EMAIL'] })
    expect(result.method).toBe('OTHER')
    expect(result.automationStatus).toBe('UNSUPPORTED')
  })
})
