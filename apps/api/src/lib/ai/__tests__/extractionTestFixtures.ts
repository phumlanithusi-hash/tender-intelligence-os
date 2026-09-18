import { randomUUID } from 'node:crypto'
import type { ChunkForContext } from '../store.js'

export function makeExtractionChunk(overrides: Partial<ChunkForContext> = {}): ChunkForContext {
  return {
    id: randomUUID(),
    documentId: randomUUID(),
    documentVersionId: randomUUID(),
    sectionId: null,
    pageStart: 6,
    pageEnd: 6,
    text: '3.1 Company Experience: Bidders must demonstrate a minimum of 5 years relevant experience. This criterion carries a maximum of 20 points.',
    charCount: 140,
    ...overrides,
  }
}

export function extractionJson(chunk: ChunkForContext, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    requirements: [
      {
        index: 0,
        parentIndex: null,
        title: 'Company Experience',
        description: 'Bidders must demonstrate a minimum of 5 years relevant experience.',
        category: 'QUALIFICATION',
        mandatoryStatus: 'MANDATORY',
        ruleType: 'EXPERIENCE',
        disqualificationLanguage: false,
        truth: 'FACT',
        confidence: 0.9,
        evidence: [{ chunkId: chunk.id, pageNumber: chunk.pageStart, quotedText: chunk.text }],
      },
    ],
    evaluationFramework: {
      criteria: [
        {
          index: 0,
          parentIndex: null,
          name: 'Company Experience',
          description: 'Relevant experience of the bidding company.',
          criterionType: 'FUNCTIONALITY',
          maximumPoints: 20,
          weight: null,
          minimumThreshold: null,
          scoringMethod: 'POINTS',
          scoringBands: [],
          gate: false,
          thresholdType: null,
          formulaText: null,
          formulaType: null,
          formulaVariables: {},
          localContentMinPercent: null,
          presentationMandatory: null,
          presentationDate: null,
          presentationAttendees: null,
          truth: 'FACT',
          confidence: 0.9,
          evidence: [{ chunkId: chunk.id, pageNumber: chunk.pageStart, quotedText: chunk.text }],
        },
      ],
      gates: [],
    },
    conflicts: [],
    ...overrides,
  })
}
