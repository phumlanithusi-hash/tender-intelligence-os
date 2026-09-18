import { assertUrlStructurallySafe, UnsafeUrlError } from '../security/urlSafety.js'

/**
 * Phase 16 §53 — SUBMISSION TARGET SECURITY. Treats every submission
 * target (portal URL, email address, physical address) as untrusted:
 * a PORTAL/API target must be HTTPS and on an allow-list when one is
 * configured; an EMAIL target must be structurally a valid address and
 * is flagged whenever it deviates from the tender's own verified
 * recipient; a manually-overridden target of any kind requires
 * explicit human confirmation rather than being silently accepted.
 */
export interface TargetSecurityInput {
  method: 'PORTAL' | 'EMAIL' | 'PHYSICAL_COURIER' | 'PHYSICAL_HAND_DELIVERY' | 'API' | 'OTHER' | 'UNKNOWN'
  target: string | null
  verifiedTenderTarget: string | null
  allowedHosts?: readonly string[]
  humanConfirmedDeviation: boolean
}

export interface TargetSecurityResult {
  valid: boolean
  deviatesFromVerifiedTarget: boolean
  requiresConfirmation: boolean
  reason: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function assertSubmissionTargetSafe(input: TargetSecurityInput): TargetSecurityResult {
  const deviates = Boolean(input.verifiedTenderTarget) && input.target !== input.verifiedTenderTarget

  if (input.method === 'PORTAL' || input.method === 'API') {
    if (!input.target) return { valid: false, deviatesFromVerifiedTarget: deviates, requiresConfirmation: false, reason: 'No submission target URL is set.' }
    try {
      assertUrlStructurallySafe(input.target, { allowedHosts: input.allowedHosts ?? [new URL(input.target).hostname] })
    } catch (err) {
      const reason = err instanceof UnsafeUrlError ? err.message : 'Target URL failed safety validation.'
      return { valid: false, deviatesFromVerifiedTarget: deviates, requiresConfirmation: false, reason }
    }
    if (new URL(input.target).protocol !== 'https:') {
      return { valid: false, deviatesFromVerifiedTarget: deviates, requiresConfirmation: false, reason: 'Portal/API submission targets must use HTTPS.' }
    }
  }

  if (input.method === 'EMAIL') {
    if (!input.target || !EMAIL_RE.test(input.target)) {
      return { valid: false, deviatesFromVerifiedTarget: deviates, requiresConfirmation: false, reason: 'Submission target is not a structurally valid email address.' }
    }
  }

  if (deviates && !input.humanConfirmedDeviation) {
    return { valid: false, deviatesFromVerifiedTarget: true, requiresConfirmation: true, reason: 'The submission target differs from the tender\'s verified recipient; explicit human confirmation is required before proceeding.' }
  }

  return { valid: true, deviatesFromVerifiedTarget: deviates, requiresConfirmation: false, reason: 'Target passed safety validation.' }
}
