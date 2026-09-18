import { describe, expect, it } from 'vitest'
import { createManualAdapter } from '../adapters/manual.js'
import { createEmailAdapter } from '../adapters/email.js'
import { createPortalAdapter } from '../adapters/portal.js'
import { createApiAdapter } from '../adapters/api.js'
import { createPhysicalAdapter } from '../adapters/physical.js'
import { MockPortalSuccessAdapter, MockPortalTimeoutAdapter, MockPortalCaptchaAdapter, MockPortalRejectedAdapter, MockEmailAdapter, MockPhysicalAdapter } from '../adapters/mock/mockAdapters.js'
import type { AdapterExecutionRequest } from '../adapters/types.js'

const baseRequest: AdapterExecutionRequest = {
  method: 'PORTAL',
  target: 'https://etenders.gov.za/x',
  packId: 'pack-1',
  packVersion: 1,
  packHash: 'hash-1',
  manifestHash: 'manifest-1',
  files: [{ fileName: 'proposal.pdf', sizeBytes: 100, sha256: 'abc', mimeType: 'application/pdf' }],
  confirmationId: 'confirm-1',
  idempotencyKey: 'idem-key-12345678',
}

describe('manual adapter (Phase 16 §18)', () => {
  it('always resolves to REQUIRES_MANUAL_ACTION, never contacting anything', async () => {
    const adapter = createManualAdapter(['Do X.', 'Do Y.'])
    const result = await adapter.execute(baseRequest)
    expect(result.outcome).toBe('REQUIRES_MANUAL_ACTION')
    expect(result.errorCode).toBe('MANUAL_ACTION_REQUIRED')
  })
})

describe('email adapter (Phase 16 §15/§16)', () => {
  const manifestFiles = [{ fileName: 'proposal.pdf', sizeBytes: 100, sha256: 'abc', mimeType: 'application/pdf' }]

  it('degrades to MANUAL_REQUIRED when no sender is configured, but still describes the exact steps', async () => {
    const adapter = createEmailAdapter({ manifestFiles, outgoingFiles: manifestFiles, subject: 'Bid submission', body: 'See attached.', sender: null })
    const result = await adapter.execute({ ...baseRequest, method: 'EMAIL', target: 'tenders@agency.gov.za' })
    expect(result.outcome).toBe('REQUIRES_MANUAL_ACTION')
  })

  it('blocks when the outgoing attachment does not match the approved manifest', async () => {
    const adapter = createEmailAdapter({ manifestFiles, outgoingFiles: [{ ...manifestFiles[0]!, sha256: 'tampered' }], subject: 'x', body: 'x', sender: null })
    const result = await adapter.execute({ ...baseRequest, method: 'EMAIL', target: 'tenders@agency.gov.za' })
    expect(result.outcome).toBe('FAILED')
    expect(result.errorCode).toBe('ATTACHMENT_INVALID')
  })

  it('sends and returns a provider reference when a sender is configured', async () => {
    const adapter = createEmailAdapter({ manifestFiles, outgoingFiles: manifestFiles, subject: 'x', body: 'x', sender: { send: async () => ({ messageId: 'msg-123' }) } })
    const result = await adapter.execute({ ...baseRequest, method: 'EMAIL', target: 'tenders@agency.gov.za' })
    expect(result.outcome).toBe('SUCCEEDED')
    expect(result.providerReference).toBe('msg-123')
  })

  it('rejects a missing recipient', async () => {
    const adapter = createEmailAdapter({ manifestFiles, outgoingFiles: manifestFiles, subject: 'x', body: 'x', sender: null })
    const result = await adapter.execute({ ...baseRequest, method: 'EMAIL', target: null })
    expect(result.outcome).toBe('FAILED')
    expect(result.errorCode).toBe('TARGET_INVALID')
  })
})

describe('portal adapter (Phase 16 §4/§14)', () => {
  it('degrades to MANUAL_REQUIRED when no automation is configured', async () => {
    const adapter = createPortalAdapter(null, ['etenders.gov.za'])
    const result = await adapter.execute(baseRequest)
    expect(result.outcome).toBe('REQUIRES_MANUAL_ACTION')
  })

  it('never bypasses a CAPTCHA — resolves to REQUIRES_MANUAL_ACTION with CAPTCHA_REQUIRED', async () => {
    const adapter = createPortalAdapter({ upload: async () => ({ kind: 'CAPTCHA' }) }, ['etenders.gov.za'])
    const result = await adapter.execute(baseRequest)
    expect(result.outcome).toBe('REQUIRES_MANUAL_ACTION')
    expect(result.errorCode).toBe('CAPTCHA_REQUIRED')
  })

  it('never bypasses MFA', async () => {
    const adapter = createPortalAdapter({ upload: async () => ({ kind: 'MFA' }) }, ['etenders.gov.za'])
    const result = await adapter.execute(baseRequest)
    expect(result.errorCode).toBe('MFA_REQUIRED')
  })

  it('a timeout is UNKNOWN_OUTCOME, never auto-retried as FAILED', async () => {
    const adapter = createPortalAdapter({ upload: async () => ({ kind: 'TIMEOUT' }) }, ['etenders.gov.za'])
    const result = await adapter.execute(baseRequest)
    expect(result.outcome).toBe('UNKNOWN_OUTCOME')
    expect(result.errorCode).toBe('TIMEOUT')
  })

  it('rejects a target not on the allow-list', async () => {
    const adapter = createPortalAdapter({ upload: async () => ({ kind: 'SUCCESS', providerReference: 'ref', externalSubmissionId: null }) }, ['other-host.gov.za'])
    const result = await adapter.execute(baseRequest)
    expect(result.outcome).toBe('FAILED')
    expect(result.errorCode).toBe('TARGET_INVALID')
  })

  it('succeeds and captures a provider reference when automation genuinely succeeds', async () => {
    const adapter = createPortalAdapter({ upload: async () => ({ kind: 'SUCCESS', providerReference: 'REF-1', externalSubmissionId: 'ext-1' }) }, ['etenders.gov.za'])
    const result = await adapter.execute(baseRequest)
    expect(result.outcome).toBe('SUCCEEDED')
    expect(result.providerReference).toBe('REF-1')
  })
})

describe('api adapter', () => {
  it('degrades to MANUAL_REQUIRED with no client configured', async () => {
    const adapter = createApiAdapter(null, ['api.agency.gov.za'])
    const result = await adapter.execute({ ...baseRequest, method: 'API', target: 'https://api.agency.gov.za/submit' })
    expect(result.outcome).toBe('REQUIRES_MANUAL_ACTION')
  })
})

describe('physical adapter (Phase 16 §17)', () => {
  it('always REQUIRES_MANUAL_ACTION and never claims a delivery happened', async () => {
    const adapter = createPhysicalAdapter('PHYSICAL_COURIER', '123 Main Street')
    const result = await adapter.execute({ ...baseRequest, method: 'PHYSICAL_COURIER', target: null })
    expect(result.outcome).toBe('REQUIRES_MANUAL_ACTION')
  })
})

describe('mock adapters (Phase 16 §48/§49, TEST-ONLY)', () => {
  it('MockPortalSuccessAdapter succeeds deterministically', async () => {
    const result = await MockPortalSuccessAdapter.execute(baseRequest)
    expect(result.outcome).toBe('SUCCEEDED')
    expect(result.providerReference).toBeTruthy()
  })
  it('MockPortalTimeoutAdapter -> UNKNOWN_OUTCOME', async () => {
    expect((await MockPortalTimeoutAdapter.execute(baseRequest)).outcome).toBe('UNKNOWN_OUTCOME')
  })
  it('MockPortalCaptchaAdapter -> REQUIRES_MANUAL_ACTION/CAPTCHA_REQUIRED', async () => {
    const result = await MockPortalCaptchaAdapter.execute(baseRequest)
    expect(result.outcome).toBe('REQUIRES_MANUAL_ACTION')
    expect(result.errorCode).toBe('CAPTCHA_REQUIRED')
  })
  it('MockPortalRejectedAdapter -> FAILED/PROVIDER_REJECTED', async () => {
    const result = await MockPortalRejectedAdapter.execute(baseRequest)
    expect(result.outcome).toBe('FAILED')
    expect(result.errorCode).toBe('PROVIDER_REJECTED')
  })
  it('MockEmailAdapter succeeds deterministically', async () => {
    expect((await MockEmailAdapter.execute(baseRequest)).outcome).toBe('SUCCEEDED')
  })
  it('MockPhysicalAdapter always requires manual action', async () => {
    expect((await MockPhysicalAdapter.execute(baseRequest)).outcome).toBe('REQUIRES_MANUAL_ACTION')
  })
})
