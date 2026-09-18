import { describe, it, expect } from 'vitest'
import { buildClassificationContext } from '../contextBuilder.js'
import { baseTender } from './fakeAiStore.js'
import { makeChunk } from './testFixtures.js'

describe('buildClassificationContext (Phase 7 §25/§26)', () => {
  it('includes tender metadata, taxonomy, and chunk content with evidence-citable ids', () => {
    const tender = baseTender()
    const chunk = makeChunk({ text: 'Some extracted passage.' })
    const result = buildClassificationContext(tender, [{ id: 'svc-1', name: 'Graphic Design' }], [chunk], {
      maxDocumentChunks: 10,
      maxContextChars: 10_000,
    })

    expect(result.prompt.tenderMetadataBlock).toContain(tender.title)
    expect(result.prompt.serviceTaxonomyBlock).toContain('Graphic Design')
    expect(result.prompt.documentContextBlock).toContain(chunk.id)
    expect(result.prompt.documentContextBlock).toContain('Some extracted passage.')
    expect(result.truncated).toBe(false)
    expect(result.usedChunkIds).toEqual([chunk.id])
  })

  it('truncates deterministically by chunk count and records it', () => {
    const tender = baseTender()
    const chunks = Array.from({ length: 5 }, (_, i) => makeChunk({ pageStart: i + 1, pageEnd: i + 1 }))
    const result = buildClassificationContext(tender, [], chunks, { maxDocumentChunks: 2, maxContextChars: 100_000 })

    expect(result.usedChunkIds).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })

  it('truncates deterministically by character budget and records it', () => {
    const tender = baseTender()
    const chunks = [makeChunk({ text: 'a'.repeat(50) }), makeChunk({ text: 'b'.repeat(50) })]
    const result = buildClassificationContext(tender, [], chunks, { maxDocumentChunks: 10, maxContextChars: 60 })

    expect(result.usedChunkIds).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })

  it('never invents a service outside the supplied taxonomy list', () => {
    const tender = baseTender()
    const result = buildClassificationContext(tender, [], [], { maxDocumentChunks: 10, maxContextChars: 1000 })
    expect(result.prompt.serviceTaxonomyBlock).toContain('no services configured')
  })

  it('renders UNKNOWN for missing deterministic tender fields rather than blank/omitted', () => {
    const tender = baseTender({ organisation: null, estimatedValue: null })
    const result = buildClassificationContext(tender, [], [], { maxDocumentChunks: 10, maxContextChars: 1000 })
    expect(result.prompt.tenderMetadataBlock).toContain('Organisation: UNKNOWN')
    expect(result.prompt.tenderMetadataBlock).toContain('Estimated value (authoritative, if known): UNKNOWN')
  })
})
