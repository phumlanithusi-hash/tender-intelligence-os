import type { EvidenceEmbeddingEntityType } from '@tender-os/constants'
import type { EmbeddingClient } from '../ai/embeddingClient.js'
import { computeContentHash } from './contentHash.js'

/**
 * Phase 13 §A/§8 — the embedding job's I/O SEAM. This is deliberately
 * NOT wired into a queue: no BullMQ is present in this codebase (Phase
 * 13 binding constraint). It is a composable, idempotent pure-shaped
 * stage function invoked fire-and-forget today from
 * routes/evidenceMatching.ts (or a small backfill script) — and it is
 * EXACTLY the function a future BullMQ worker's job processor would
 * call unchanged: `worker.process(job => embedAgencyEvidence(job.data.ref, deps))`.
 *
 * Idempotent: calling it twice for the same, unchanged entity is a
 * no-op (returns { status: 'READY', skipped: true }) rather than
 * re-embedding or double-charging the OpenAI API. Never fabricates an
 * embedding on failure — a provider error always transitions the
 * record to FAILED with the real error message, never a fake vector.
 */

export interface EmbeddableEntityRef {
  agencyId: string
  entityType: EvidenceEmbeddingEntityType
  entityId: string
}

export interface EmbeddableEntityContent {
  /** Canonical, deterministic text built from the entity's real stored fields only — never invented. */
  content: string
}

export interface EmbeddingRecordSnapshot {
  id: string
  status: 'NOT_EMBEDDED' | 'QUEUED' | 'PROCESSING' | 'READY' | 'STALE' | 'FAILED'
  contentHash: string | null
}

export interface EmbedAgencyEvidenceDeps {
  loadEntityContent(ref: EmbeddableEntityRef): Promise<EmbeddableEntityContent | null>
  getExistingEmbeddingRecord(ref: EmbeddableEntityRef): Promise<EmbeddingRecordSnapshot | null>
  markQueued(ref: EmbeddableEntityRef, contentHash: string): Promise<void>
  markProcessing(ref: EmbeddableEntityRef): Promise<void>
  markReady(ref: EmbeddableEntityRef, patch: { embedding: number[]; contentHash: string; embeddedContent: string; model: string; embeddedAt: string }): Promise<void>
  markFailed(ref: EmbeddableEntityRef, patch: { error: string }): Promise<void>
  embeddingClient: EmbeddingClient
  embeddingModel: string
  nowIso(): string
}

export type EmbedAgencyEvidenceOutcome = { status: 'READY' | 'PROCESSING'; skipped: true } | { status: 'READY'; skipped: false } | { status: 'FAILED'; skipped: false; error: string } | { status: 'NOT_EMBEDDED'; skipped: false; error: string }

export async function embedAgencyEvidence(ref: EmbeddableEntityRef, deps: EmbedAgencyEvidenceDeps): Promise<EmbedAgencyEvidenceOutcome> {
  const entity = await deps.loadEntityContent(ref)
  if (!entity) {
    await deps.markFailed(ref, { error: 'Underlying evidence entity no longer exists or does not belong to this agency.' })
    return { status: 'NOT_EMBEDDED', skipped: false, error: 'Entity not found' }
  }

  const contentHash = computeContentHash([ref.agencyId, ref.entityType, ref.entityId, entity.content])
  const existing = await deps.getExistingEmbeddingRecord(ref)

  // Idempotency (Phase 13 §8 binding constraint): a READY embedding
  // whose content has not changed is never re-embedded.
  if (existing && existing.status === 'READY' && existing.contentHash === contentHash) {
    return { status: 'READY', skipped: true }
  }
  // A concurrent call already has this in flight — never double-submit
  // to the provider for the same entity.
  if (existing && existing.status === 'PROCESSING') {
    return { status: 'PROCESSING', skipped: true }
  }

  await deps.markQueued(ref, contentHash)
  await deps.markProcessing(ref)

  try {
    const vector = await deps.embeddingClient.embed(entity.content, deps.embeddingModel)
    await deps.markReady(ref, { embedding: vector, contentHash, embeddedContent: entity.content, model: deps.embeddingModel, embeddedAt: deps.nowIso() })
    return { status: 'READY', skipped: false }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await deps.markFailed(ref, { error: message })
    return { status: 'FAILED', skipped: false, error: message }
  }
}
