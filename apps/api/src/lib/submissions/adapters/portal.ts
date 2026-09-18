import { assertSubmissionTargetSafe } from '../targetSecurity.js'
import type { AdapterExecutionRequest, AdapterExecutionResult, SubmissionAdapter } from './types.js'

/**
 * Phase 16 §4/§13/§14 — PORTAL SUBMISSION ADAPTER. Allowed automation
 * surface only: an official API, an officially-supported integration,
 * or legitimate authenticated browser automation the agency has
 * explicitly authorised (a `PortalAutomationPort` injected by the
 * caller — absent in every environment this build ships, per §48/§49's
 * mock-only default). This adapter NEVER attempts to bypass CAPTCHA,
 * MFA, or any anti-bot control: encountering one is always
 * REQUIRES_MANUAL_ACTION, never an error to route around (§4/§14
 * binding constraint).
 */
export interface PortalAutomationPort {
  upload(params: { url: string; packId: string; packVersion: number; files: Array<{ fileName: string; sha256: string }> }): Promise<
    | { kind: 'SUCCESS'; providerReference: string; externalSubmissionId: string | null }
    | { kind: 'CAPTCHA' }
    | { kind: 'MFA' }
    | { kind: 'AUTH_REQUIRED' }
    | { kind: 'UNAVAILABLE' }
    | { kind: 'TIMEOUT' }
    | { kind: 'REJECTED'; reason: string }
  >
}

export function createPortalAdapter(automation: PortalAutomationPort | null, allowedHosts: readonly string[] = []): SubmissionAdapter {
  return {
    method: 'PORTAL',
    canHandle: (request) => request.method === 'PORTAL' && Boolean(request.target),
    validate(request) {
      if (!request.target) return { valid: false, errorCode: 'TARGET_INVALID', errorMessage: 'No portal URL is set.' }
      const targetCheck = assertSubmissionTargetSafe({ method: 'PORTAL', target: request.target, verifiedTenderTarget: request.target, allowedHosts, humanConfirmedDeviation: true })
      if (!targetCheck.valid) return { valid: false, errorCode: 'TARGET_INVALID', errorMessage: targetCheck.reason }
      return { valid: true, errorCode: null, errorMessage: null }
    },
    async execute(request: AdapterExecutionRequest): Promise<AdapterExecutionResult> {
      const validation = this.validate(request)
      if (!validation.valid) {
        return { outcome: 'FAILED', providerName: 'PORTAL', providerReference: null, externalSubmissionId: null, responseStatus: null, responseCode: null, errorCode: validation.errorCode, errorMessage: validation.errorMessage }
      }
      if (!automation) {
        return {
          outcome: 'REQUIRES_MANUAL_ACTION',
          providerName: 'PORTAL',
          providerReference: null,
          externalSubmissionId: null,
          responseStatus: null,
          responseCode: null,
          errorCode: 'MANUAL_ACTION_REQUIRED',
          errorMessage: `No authorised portal automation is configured for ${request.target}. Open the portal, log in, upload submission pack v${request.packVersion} (hash ${request.packHash.slice(0, 12)}…), confirm submission, then record the reference number/receipt.`,
        }
      }
      try {
        const result = await automation.upload({ url: request.target as string, packId: request.packId, packVersion: request.packVersion, files: request.files.map((f) => ({ fileName: f.fileName, sha256: f.sha256 })) })
        switch (result.kind) {
          case 'SUCCESS':
            return { outcome: 'SUCCEEDED', providerName: 'PORTAL', providerReference: result.providerReference, externalSubmissionId: result.externalSubmissionId, responseStatus: 'SUCCESS', responseCode: null, errorCode: null, errorMessage: null }
          case 'CAPTCHA':
            return { outcome: 'REQUIRES_MANUAL_ACTION', providerName: 'PORTAL', providerReference: null, externalSubmissionId: null, responseStatus: null, responseCode: null, errorCode: 'CAPTCHA_REQUIRED', errorMessage: 'The portal presented a CAPTCHA; this system never attempts to bypass one — complete the submission manually.' }
          case 'MFA':
            return { outcome: 'REQUIRES_MANUAL_ACTION', providerName: 'PORTAL', providerReference: null, externalSubmissionId: null, responseStatus: null, responseCode: null, errorCode: 'MFA_REQUIRED', errorMessage: 'The portal requires multi-factor authentication; complete the submission manually.' }
          case 'AUTH_REQUIRED':
            return { outcome: 'REQUIRES_MANUAL_ACTION', providerName: 'PORTAL', providerReference: null, externalSubmissionId: null, responseStatus: null, responseCode: null, errorCode: 'AUTHENTICATION_REQUIRED', errorMessage: 'The portal requires authentication that could not be completed automatically.' }
          case 'UNAVAILABLE':
            return { outcome: 'FAILED', providerName: 'PORTAL', providerReference: null, externalSubmissionId: null, responseStatus: null, responseCode: null, errorCode: 'PORTAL_UNAVAILABLE', errorMessage: 'The portal was unavailable.' }
          case 'TIMEOUT':
            // Phase 16 §23: a timeout is never auto-retried — the
            // provider may have received the submission despite the
            // local timeout. Outcome is UNKNOWN, not FAILED.
            return { outcome: 'UNKNOWN_OUTCOME', providerName: 'PORTAL', providerReference: null, externalSubmissionId: null, responseStatus: null, responseCode: null, errorCode: 'TIMEOUT', errorMessage: 'The portal request timed out; the provider may or may not have received it. Verify portal status manually before retrying.' }
          case 'REJECTED':
            return { outcome: 'FAILED', providerName: 'PORTAL', providerReference: null, externalSubmissionId: null, responseStatus: 'REJECTED', responseCode: null, errorCode: 'PROVIDER_REJECTED', errorMessage: result.reason }
        }
      } catch (err) {
        return { outcome: 'UNKNOWN_OUTCOME', providerName: 'PORTAL', providerReference: null, externalSubmissionId: null, responseStatus: null, responseCode: null, errorCode: 'UNKNOWN_PROVIDER_RESULT', errorMessage: err instanceof Error ? err.message : 'Portal submission outcome unknown.' }
      }
    },
  }
}
