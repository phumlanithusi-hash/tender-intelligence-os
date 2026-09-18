import { assertSubmissionTargetSafe } from '../targetSecurity.js'
import type { AdapterExecutionRequest, AdapterExecutionResult, SubmissionAdapter } from './types.js'

/**
 * Phase 16 §2/§13 — API SUBMISSION ADAPTER (a legitimate, officially
 * supported provider API/web service). No agency in this build has an
 * authorised procurement API configured, so `client` is null by
 * default and this always degrades to MANUAL_REQUIRED — the seam is
 * real and testable, but nothing is ever fabricated as
 * AUTOMATION_AVAILABLE against a live provider (§48/§49).
 */
export interface ApiSubmissionClientPort {
  submit(params: { endpoint: string; packId: string; packVersion: number; files: Array<{ fileName: string; sha256: string }> }): Promise<{ providerReference: string; externalSubmissionId: string }>
}

export function createApiAdapter(client: ApiSubmissionClientPort | null, allowedHosts: readonly string[] = []): SubmissionAdapter {
  return {
    method: 'API',
    canHandle: (request) => request.method === 'API' && Boolean(request.target),
    validate(request) {
      if (!request.target) return { valid: false, errorCode: 'TARGET_INVALID', errorMessage: 'No API endpoint is set.' }
      const targetCheck = assertSubmissionTargetSafe({ method: 'API', target: request.target, verifiedTenderTarget: request.target, allowedHosts, humanConfirmedDeviation: true })
      if (!targetCheck.valid) return { valid: false, errorCode: 'TARGET_INVALID', errorMessage: targetCheck.reason }
      return { valid: true, errorCode: null, errorMessage: null }
    },
    async execute(request: AdapterExecutionRequest): Promise<AdapterExecutionResult> {
      const validation = this.validate(request)
      if (!validation.valid) {
        return { outcome: 'FAILED', providerName: 'API', providerReference: null, externalSubmissionId: null, responseStatus: null, responseCode: null, errorCode: validation.errorCode, errorMessage: validation.errorMessage }
      }
      if (!client) {
        return {
          outcome: 'REQUIRES_MANUAL_ACTION',
          providerName: 'API',
          providerReference: null,
          externalSubmissionId: null,
          responseStatus: null,
          responseCode: null,
          errorCode: 'MANUAL_ACTION_REQUIRED',
          errorMessage: 'No authorised provider API is configured for this tender.',
        }
      }
      try {
        const result = await client.submit({ endpoint: request.target as string, packId: request.packId, packVersion: request.packVersion, files: request.files.map((f) => ({ fileName: f.fileName, sha256: f.sha256 })) })
        return { outcome: 'SUCCEEDED', providerName: 'API', providerReference: result.providerReference, externalSubmissionId: result.externalSubmissionId, responseStatus: 'SUCCESS', responseCode: null, errorCode: null, errorMessage: null }
      } catch (err) {
        return { outcome: 'UNKNOWN_OUTCOME', providerName: 'API', providerReference: null, externalSubmissionId: null, responseStatus: null, responseCode: null, errorCode: 'UNKNOWN_PROVIDER_RESULT', errorMessage: err instanceof Error ? err.message : 'API submission outcome unknown.' }
      }
    },
  }
}
