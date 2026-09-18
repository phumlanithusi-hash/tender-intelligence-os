import type { SubmissionExecutionMethod } from '@tender-os/constants'
import type { SubmissionAdapter } from './adapters/types.js'
import { createManualAdapter } from './adapters/manual.js'
import { createEmailAdapter } from './adapters/email.js'
import { createPortalAdapter } from './adapters/portal.js'
import { createApiAdapter } from './adapters/api.js'
import { createPhysicalAdapter } from './adapters/physical.js'
import type { EmailSenderPort } from './adapters/email.js'
import type { PortalAutomationPort } from './adapters/portal.js'
import type { ApiSubmissionClientPort } from './adapters/api.js'
import type { ManifestFile } from './attachmentIntegrity.js'

/**
 * Phase 16 §13/§48/§49 — the adapter registry. Every method this
 * deployment recognises is registered; the real adapters all degrade
 * honestly to MANUAL_REQUIRED when no live provider capability is
 * injected (none is, in this build — §48/§49's explicit "default
 * dev/test mode = MOCK or MANUAL, never send a real tender
 * accidentally").
 */
export interface AdapterRegistry {
  supportedMethods: readonly SubmissionExecutionMethod[]
  get(method: SubmissionExecutionMethod): SubmissionAdapter | null
}

export function buildDefaultAdapterRegistry(params: {
  emailManifestFiles: ManifestFile[]
  emailOutgoingFiles: ManifestFile[]
  emailSubject: string
  emailBody: string
  emailSender: EmailSenderPort | null
  portalAutomation: PortalAutomationPort | null
  portalAllowedHosts: readonly string[]
  apiClient: ApiSubmissionClientPort | null
  apiAllowedHosts: readonly string[]
  physicalDeliveryAddress: string | null
}): AdapterRegistry {
  const adapters = new Map<SubmissionExecutionMethod, SubmissionAdapter>([
    ['EMAIL', createEmailAdapter({ manifestFiles: params.emailManifestFiles, outgoingFiles: params.emailOutgoingFiles, subject: params.emailSubject, body: params.emailBody, sender: params.emailSender })],
    ['PORTAL', createPortalAdapter(params.portalAutomation, params.portalAllowedHosts)],
    ['API', createApiAdapter(params.apiClient, params.apiAllowedHosts)],
    ['PHYSICAL_COURIER', createPhysicalAdapter('PHYSICAL_COURIER', params.physicalDeliveryAddress)],
    ['PHYSICAL_HAND_DELIVERY', createPhysicalAdapter('PHYSICAL_HAND_DELIVERY', params.physicalDeliveryAddress)],
    ['OTHER', createManualAdapter(['This submission method requires a fully manual workflow.'])],
  ])
  return {
    supportedMethods: [...adapters.keys()],
    get: (method) => adapters.get(method) ?? null,
  }
}
