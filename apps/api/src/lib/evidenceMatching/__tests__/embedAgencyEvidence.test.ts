import { describe, expect, it, vi } from 'vitest'
import { embedAgencyEvidence, type EmbedAgencyEvidenceDeps, type EmbeddableEntityRef, type EmbeddingRecordSnapshot } from '../embedAgencyEvidence.js'

const REF: EmbeddableEntityRef = { agencyId: 'agency-1', entityType: 'AGENCY_DOCUMENT', entityId: 'doc-1' }

function makeDeps(overrides: Partial<EmbedAgencyEvidenceDeps> = {}): EmbedAgencyEvidenceDeps & { calls: { markQueued: number; markProcessing: number; markReady: number; markFailed: number } } {
  const calls = { markQueued: 0, markProcessing: 0, markReady: 0, markFailed: 0 }
  let record: EmbeddingRecordSnapshot | null = null

  const deps: EmbedAgencyEvidenceDeps = {
    async loadEntityContent() {
      return { content: 'Document type: CSD_CERTIFICATE' }
    },
    async getExistingEmbeddingRecord() {
      return record
    },
    async markQueued() {
      calls.markQueued += 1
      record = { id: 'emb-1', status: 'QUEUED', contentHash: null }
    },
    async markProcessing() {
      calls.markProcessing += 1
      record = { id: 'emb-1', status: 'PROCESSING', contentHash: null }
    },
    async markReady(_ref, patch) {
      calls.markReady += 1
      record = { id: 'emb-1', status: 'READY', contentHash: patch.contentHash }
    },
    async markFailed() {
      calls.markFailed += 1
      record = { id: 'emb-1', status: 'FAILED', contentHash: null }
    },
    embeddingClient: { embed: vi.fn(async () => [0.1, 0.2, 0.3]) },
    embeddingModel: 'text-embedding-3-small',
    nowIso: () => '2026-09-11T00:00:00.000Z',
    ...overrides,
  }
  return { ...deps, calls }
}

describe('embedAgencyEvidence (Phase 13 §A/§8 — the idempotent embedding job seam)', () => {
  it('embeds a never-seen entity and marks it READY', async () => {
    const deps = makeDeps()
    const result = await embedAgencyEvidence(REF, deps)
    expect(result).toEqual({ status: 'READY', skipped: false })
    expect(deps.calls.markProcessing).toBe(1)
    expect(deps.calls.markReady).toBe(1)
  })

  it('is idempotent: calling it again with unchanged content is a no-op (never re-embeds, never double-charges the provider)', async () => {
    const embed = vi.fn(async () => [0.1, 0.2, 0.3])
    const deps = makeDeps({ embeddingClient: { embed } })
    await embedAgencyEvidence(REF, deps)
    const second = await embedAgencyEvidence(REF, deps)
    expect(second).toEqual({ status: 'READY', skipped: true })
    expect(embed).toHaveBeenCalledTimes(1)
  })

  it('re-embeds when the underlying content has changed since the last READY embedding (content hash drift)', async () => {
    const embed = vi.fn(async () => [0.1, 0.2, 0.3])
    let content = 'Document type: CSD_CERTIFICATE'
    const deps = makeDeps({ embeddingClient: { embed }, loadEntityContent: async () => ({ content }) })
    await embedAgencyEvidence(REF, deps)
    content = 'Document type: TAX_CLEARANCE (changed)'
    const second = await embedAgencyEvidence(REF, deps)
    expect(second).toEqual({ status: 'READY', skipped: false })
    expect(embed).toHaveBeenCalledTimes(2)
  })

  it('never fabricates a vector on provider failure — marks FAILED with the real error, and the outcome reports it honestly', async () => {
    const deps = makeDeps({ embeddingClient: { embed: vi.fn(async () => { throw new Error('rate limited') }) } })
    const result = await embedAgencyEvidence(REF, deps)
    expect(result).toEqual({ status: 'FAILED', skipped: false, error: 'rate limited' })
    expect(deps.calls.markFailed).toBe(1)
    expect(deps.calls.markReady).toBe(0)
  })

  it('marks FAILED (never fabricating anything) when the underlying entity no longer resolves', async () => {
    const deps = makeDeps({ loadEntityContent: async () => null })
    const result = await embedAgencyEvidence(REF, deps)
    expect(result.status).toBe('NOT_EMBEDDED')
    expect(deps.calls.markFailed).toBe(1)
  })

  it('treats a concurrently-PROCESSING record as in-flight and never double-submits to the provider', async () => {
    const embed = vi.fn(async () => [0.1, 0.2, 0.3])
    const deps = makeDeps({ embeddingClient: { embed }, getExistingEmbeddingRecord: async () => ({ id: 'emb-1', status: 'PROCESSING', contentHash: null }) })
    const result = await embedAgencyEvidence(REF, deps)
    expect(result).toEqual({ status: 'PROCESSING', skipped: true })
    expect(embed).not.toHaveBeenCalled()
  })
})
