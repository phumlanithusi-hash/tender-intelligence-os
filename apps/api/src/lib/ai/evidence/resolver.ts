import type { AiStore, ResolvedChunk } from '../store.js'
import type { RawEvidenceRef } from '../agents/classification/schema.js'

export interface ResolvedEvidence {
  chunkId: string
  documentId: string
  documentVersionId: string
  sectionId: string | null
  pageNumber: number | null
  /** The CANONICAL stored text — never the model's echoed `quotedText` (Phase 7 §17). */
  evidenceText: string
}

export interface EvidenceResolutionResult {
  resolved: ResolvedEvidence[]
  /** True if every ref the model supplied for this claim failed to resolve, OR no ref was supplied at all for a claim that isn't UNKNOWN. */
  anyRequested: boolean
  rejectedReasons: string[]
}

/**
 * Server-side evidence resolution (Phase 7 §16/§17 — the single most
 * important correctness property of this phase). The model's claimed
 * `chunkId` is looked up against real stored chunks scoped to THIS
 * tender; a chunk belonging to a different tender, or a nonexistent
 * id, is rejected outright — never silently dropped, never trusted.
 * The model's own `quotedText` is discarded entirely; only the
 * canonical stored `text` is ever persisted as evidence.
 */
export async function resolveEvidenceRefs(
  store: Pick<AiStore, 'resolveChunkForTender'>,
  tenderId: string,
  refs: RawEvidenceRef[],
): Promise<EvidenceResolutionResult> {
  const resolved: ResolvedEvidence[] = []
  const rejectedReasons: string[] = []
  const anyRequested = refs.length > 0

  for (const ref of refs) {
    if (!ref.chunkId) {
      rejectedReasons.push('Evidence ref had no chunkId — page-only references cannot be resolved to canonical text in this phase.')
      continue
    }
    // Reject SQL-injection/path-traversal-shaped or otherwise non-UUID
    // ids outright (Phase 7 §36) rather than passing them to the store.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref.chunkId)) {
      rejectedReasons.push(`Evidence chunkId is not a valid identifier: ${JSON.stringify(ref.chunkId).slice(0, 80)}`)
      continue
    }

    let chunk: ResolvedChunk | null
    try {
      chunk = await store.resolveChunkForTender(tenderId, ref.chunkId)
    } catch {
      rejectedReasons.push(`Evidence chunkId ${ref.chunkId} could not be resolved (lookup failed).`)
      continue
    }

    if (!chunk) {
      rejectedReasons.push(`Evidence chunkId ${ref.chunkId} does not exist or does not belong to this tender.`)
      continue
    }

    resolved.push({
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      documentVersionId: chunk.documentVersionId,
      sectionId: chunk.sectionId,
      pageNumber: chunk.pageNumber,
      evidenceText: chunk.text,
    })
  }

  return { resolved, anyRequested, rejectedReasons }
}
