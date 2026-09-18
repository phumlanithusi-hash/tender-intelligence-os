import { verifyAttachmentsAgainstManifest, type ManifestFile } from '../attachmentIntegrity.js'
import type { AdapterExecutionRequest, AdapterExecutionResult, SubmissionAdapter } from './types.js'

/**
 * Phase 16 §15/§16 — EMAIL SUBMISSION. Distinguishes "an email address
 * was found" from "email automation is available": this adapter only
 * ever sends when a real, configured mail-sending capability is
 * injected; otherwise it degrades to MANUAL_REQUIRED and still
 * produces the full recipient/subject/body/attachment-manifest
 * preview a human needs. It NEVER invents a sender address, and NEVER
 * sends when the outgoing attachments fail integrity verification
 * against the approved manifest (§16 binding constraint).
 */
export interface EmailSenderPort {
  /** Real send capability. Absent in every environment this build ships (spec §15's honest default) — configuring one is a future, explicitly-opted-in step, never silently assumed. */
  send(params: { to: string; subject: string; body: string; attachments: ManifestFile[] }): Promise<{ messageId: string }>
}

export function createEmailAdapter(params: { manifestFiles: ManifestFile[]; outgoingFiles: ManifestFile[]; subject: string; body: string; sender: EmailSenderPort | null }): SubmissionAdapter {
  return {
    method: 'EMAIL',
    canHandle: (request) => request.method === 'EMAIL' && Boolean(request.target),
    validate(request) {
      if (!request.target) return { valid: false, errorCode: 'TARGET_INVALID', errorMessage: 'No recipient email address is set.' }
      const integrity = verifyAttachmentsAgainstManifest(params.manifestFiles, params.outgoingFiles)
      if (!integrity.valid) return { valid: false, errorCode: 'ATTACHMENT_INVALID', errorMessage: integrity.mismatches.join(' ') }
      return { valid: true, errorCode: null, errorMessage: null }
    },
    async execute(request: AdapterExecutionRequest): Promise<AdapterExecutionResult> {
      const validation = this.validate(request)
      if (!validation.valid) {
        return { outcome: 'FAILED', providerName: 'EMAIL', providerReference: null, externalSubmissionId: null, responseStatus: null, responseCode: null, errorCode: validation.errorCode, errorMessage: validation.errorMessage }
      }
      if (!params.sender) {
        return {
          outcome: 'REQUIRES_MANUAL_ACTION',
          providerName: 'EMAIL',
          providerReference: null,
          externalSubmissionId: null,
          responseStatus: null,
          responseCode: null,
          errorCode: 'MANUAL_ACTION_REQUIRED',
          errorMessage: `No email-sending capability is configured. Send manually to ${request.target} with subject "${params.subject}" and the exact approved attachments (pack v${request.packVersion}, hash ${request.packHash.slice(0, 12)}…), then record the message ID / delivery confirmation as a receipt.`,
        }
      }
      try {
        const result = await params.sender.send({ to: request.target as string, subject: params.subject, body: params.body, attachments: params.outgoingFiles })
        return { outcome: 'SUCCEEDED', providerName: 'EMAIL', providerReference: result.messageId, externalSubmissionId: result.messageId, responseStatus: 'SENT', responseCode: null, errorCode: null, errorMessage: null }
      } catch (err) {
        return { outcome: 'UNKNOWN_OUTCOME', providerName: 'EMAIL', providerReference: null, externalSubmissionId: null, responseStatus: null, responseCode: null, errorCode: 'UNKNOWN_PROVIDER_RESULT', errorMessage: err instanceof Error ? err.message : 'Email send outcome unknown.' }
      }
    },
  }
}
