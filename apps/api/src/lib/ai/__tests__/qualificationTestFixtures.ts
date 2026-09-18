import { randomUUID } from 'node:crypto'
import type { ChunkForContext } from '../store.js'

export function makeQualificationChunk(overrides: Partial<ChunkForContext> = {}): ChunkForContext {
  return {
    id: randomUUID(),
    documentId: randomUUID(),
    documentVersionId: randomUUID(),
    sectionId: null,
    pageStart: 4,
    pageEnd: 4,
    text: 'Bidders must demonstrate at least five (5) years of relevant experience in providing similar services to organs of state.',
    charCount: 120,
    ...overrides,
  }
}

export function interpretationJson(chunk: ChunkForContext, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    interpretations: [
      {
        candidateIndex: 0,
        category: 'RELEVANT_EXPERIENCE',
        ruleType: 'EXPERIENCE',
        mandatoryStatus: 'UNKNOWN',
        suggestedRuleConfig: { minYear: 5 },
        truth: 'INFERENCE',
        confidence: 0.6,
        interpretation:
          'The text states bidders "must demonstrate at least five years of relevant experience" but does not clearly establish whether this is a mandatory eligibility requirement or an evaluation/scoring criterion.',
        requiresReview: true,
        evidence: [{ chunkId: chunk.id, pageNumber: chunk.pageStart, quotedText: chunk.text }],
        ...overrides,
      },
    ],
  })
}
