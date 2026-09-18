import type { AgencyServiceOption, ChunkForContext, TenderForClassification } from './store.js'
import type { ClassificationPromptContext } from './agents/classification/prompt.js'

export interface BuildContextResult {
  prompt: ClassificationPromptContext
  usedChunkIds: string[]
  truncated: boolean
}

/**
 * Deterministic, bounded context selection (Phase 7 §25/§26).
 * Semantic retrieval is explicitly deferred to a later phase — this
 * phase selects: tender metadata, the agency's service taxonomy, and
 * as many chunks as fit within maxChunks/maxChars, in document order
 * (documents/chunks are already presented in a stable, deterministic
 * order by the store). If the corpus does not fit, it is truncated
 * and the truncation is RECORDED (`truncated: true`) — never silently
 * hidden from the run record (Phase 7 §26).
 */
export function buildClassificationContext(
  tender: TenderForClassification,
  services: AgencyServiceOption[],
  chunks: ChunkForContext[],
  limits: { maxDocumentChunks: number; maxContextChars: number },
): BuildContextResult {
  const tenderMetadataBlock = [
    `Title: ${tender.title}`,
    `Organisation: ${tender.organisation ?? 'UNKNOWN'}`,
    `Category: ${tender.category ?? 'UNKNOWN'}`,
    `Description: ${tender.description ?? 'UNKNOWN'}`,
    `Province (deterministic, unstructured label — do not treat as proof of geographic scope): ${tender.province ?? 'UNKNOWN'}`,
    `Municipality (deterministic, unstructured label — do not treat as proof of geographic scope): ${tender.municipality ?? 'UNKNOWN'}`,
    `Closing date (authoritative, from the database — do not change this; if a document appears to state a different date, report it as a CONFLICT instead): ${tender.closingDate ?? 'UNKNOWN'}`,
    `Closing time (authoritative): ${tender.closingTime ?? 'UNKNOWN'}`,
    `Estimated value (authoritative, if known): ${tender.estimatedValue ?? 'UNKNOWN'}`,
    `Contract duration (authoritative, if known): ${tender.contractDuration ?? 'UNKNOWN'}`,
    `Briefing required (authoritative, from the database): ${tender.briefingRequired}`,
    `Briefing date (authoritative, if known): ${tender.briefingDate ?? 'UNKNOWN'}`,
    `Briefing location (authoritative, if known): ${tender.briefingLocation ?? 'UNKNOWN'}`,
    `Briefing URL (authoritative, if known): ${tender.briefingUrl ?? 'UNKNOWN'}`,
  ].join('\n')

  const serviceTaxonomyBlock =
    services.length > 0
      ? services.map((s) => `- ${s.id}: ${s.name}`).join('\n')
      : '(no services configured for this agency)'

  const maxChunks = Math.max(0, limits.maxDocumentChunks)
  let usedChars = 0
  const usedChunks: ChunkForContext[] = []
  const truncatedByCount = chunks.length > maxChunks
  let truncatedByChars = false

  for (const chunk of chunks.slice(0, maxChunks)) {
    if (usedChars + chunk.text.length > limits.maxContextChars) {
      truncatedByChars = true
      break
    }
    usedChunks.push(chunk)
    usedChars += chunk.text.length
  }

  const documentContextBlock =
    usedChunks.length > 0
      ? usedChunks
          .map(
            (c) =>
              `[chunk: ${c.id}, document: ${c.documentId}, page: ${c.pageStart}${c.pageEnd !== c.pageStart ? `-${c.pageEnd}` : ''}]\n${c.text}`,
          )
          .join('\n\n---\n\n')
      : '(no extracted document content is available for this tender yet)'

  const truncated = truncatedByCount || truncatedByChars

  return {
    prompt: { tenderMetadataBlock, serviceTaxonomyBlock, documentContextBlock, truncated },
    usedChunkIds: usedChunks.map((c) => c.id),
    truncated,
  }
}
