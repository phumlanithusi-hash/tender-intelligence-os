import { randomUUID } from 'node:crypto'
import type { ChunkForContext } from '../store.js'

export function makeChunk(overrides: Partial<ChunkForContext> = {}): ChunkForContext {
  const documentId = overrides.documentId ?? randomUUID()
  const documentVersionId = overrides.documentVersionId ?? randomUUID()
  return {
    id: randomUUID(),
    documentId,
    documentVersionId,
    sectionId: null,
    pageStart: 1,
    pageEnd: 1,
    text: 'The successful bidder will be required to provide graphic design, printing and related communication material for a period of three years.',
    charCount: 130,
    ...overrides,
  }
}

/** A minimal, schema-valid raw classification with no evidence claimed anywhere (everything UNKNOWN). */
export function unknownClassificationJson(): string {
  return JSON.stringify({
    relevance: { value: 'UNKNOWN', truth: 'UNKNOWN', confidence: null, evidence: [] },
    tenderType: { value: 'UNKNOWN', truth: 'UNKNOWN', confidence: null, evidence: [] },
    intent: { text: '', truth: 'UNKNOWN', confidence: null, evidence: [] },
    services: [],
    deliverables: [],
    geography: { scope: 'UNKNOWN', provinceId: null, municipalityId: null, truth: 'UNKNOWN', confidence: null, evidence: [] },
    contract: {
      durationText: null,
      estimatedValue: null,
      procurementMethod: null,
      isFrameworkOrPanel: null,
      numberOfSuppliers: null,
      appointmentPeriod: null,
      truth: 'UNKNOWN',
      confidence: null,
      evidence: [],
    },
    briefing: {
      status: 'UNKNOWN',
      date: null,
      time: null,
      location: null,
      url: null,
      isOnline: null,
      registrationRequired: null,
      truth: 'UNKNOWN',
      confidence: null,
      evidence: [],
    },
    apparentRequirements: [],
    conflicts: [],
    summary: { text: 'Not enough information was available to summarise this tender.', truth: 'UNKNOWN' },
  })
}

/** A valid classification that cites `chunk` as evidence for relevance and one deliverable. */
export function validClassificationJson(chunk: ChunkForContext, serviceId: string): string {
  return JSON.stringify({
    relevance: {
      value: 'RELEVANT',
      truth: 'INFERENCE',
      confidence: 0.8,
      evidence: [{ chunkId: chunk.id, pageNumber: chunk.pageStart, quotedText: chunk.text.slice(0, 40) }],
    },
    tenderType: { value: 'RFP', truth: 'INFERENCE', confidence: 0.6, evidence: [{ chunkId: chunk.id, pageNumber: chunk.pageStart, quotedText: 'RFP' }] },
    intent: {
      text: 'The appointment of a service provider to provide graphic design and printing services for three years.',
      truth: 'INFERENCE',
      confidence: 0.7,
      evidence: [{ chunkId: chunk.id, pageNumber: chunk.pageStart, quotedText: chunk.text.slice(0, 40) }],
    },
    services: [{ serviceId, confidence: 0.9 }],
    deliverables: [
      {
        text: 'Graphic design and print materials',
        truth: 'INFERENCE',
        confidence: 0.7,
        evidence: [{ chunkId: chunk.id, pageNumber: chunk.pageStart, quotedText: chunk.text.slice(0, 40) }],
      },
    ],
    geography: { scope: 'UNKNOWN', provinceId: null, municipalityId: null, truth: 'UNKNOWN', confidence: null, evidence: [] },
    contract: {
      durationText: 'three years',
      estimatedValue: null,
      procurementMethod: null,
      isFrameworkOrPanel: null,
      numberOfSuppliers: null,
      appointmentPeriod: null,
      truth: 'INFERENCE',
      confidence: 0.6,
      evidence: [{ chunkId: chunk.id, pageNumber: chunk.pageStart, quotedText: 'three years' }],
    },
    briefing: {
      status: 'UNKNOWN',
      date: null,
      time: null,
      location: null,
      url: null,
      isOnline: null,
      registrationRequired: null,
      truth: 'UNKNOWN',
      confidence: null,
      evidence: [],
    },
    apparentRequirements: [],
    conflicts: [],
    summary: { text: 'This tender appears to seek a graphic design and print service provider for three years.', truth: 'INFERENCE' },
  })
}
