import { describe, it, expect } from 'vitest'
import { resolveEvidenceRefs } from '../evidence/resolver.js'
import { gateTruthByEvidence } from '../evidence/validator.js'
import { createFakeAiStore, baseTender } from './fakeAiStore.js'
import { makeChunk } from './testFixtures.js'

describe('evidence/resolver.ts (Phase 7 §16/§17)', () => {
  it('resolves a real chunk id belonging to the tender and returns the canonical text', async () => {
    const tender = baseTender()
    const chunk = makeChunk({ text: 'Canonical stored text.' })
    const { store } = createFakeAiStore({ tender, services: [], chunks: [chunk] })

    const result = await resolveEvidenceRefs(store, tender.id, [{ chunkId: chunk.id, pageNumber: 1, quotedText: 'whatever the model said' }])

    expect(result.resolved).toHaveLength(1)
    expect(result.resolved[0]!.evidenceText).toBe('Canonical stored text.')
  })

  it('rejects a chunk id that does not exist', async () => {
    const tender = baseTender()
    const { store } = createFakeAiStore({ tender, services: [], chunks: [] })
    const result = await resolveEvidenceRefs(store, tender.id, [{ chunkId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', pageNumber: 1, quotedText: 'x' }])
    expect(result.resolved).toHaveLength(0)
    expect(result.rejectedReasons[0]).toMatch(/does not exist/)
  })

  it('rejects a chunk id belonging to a different tender', async () => {
    const tender = baseTender()
    const foreign = makeChunk()
    const { store } = createFakeAiStore({ tender, services: [], chunks: [], foreignChunks: [foreign] })
    const result = await resolveEvidenceRefs(store, tender.id, [{ chunkId: foreign.id, pageNumber: 1, quotedText: 'x' }])
    expect(result.resolved).toHaveLength(0)
  })

  it('rejects a non-UUID-shaped chunkId without calling the store', async () => {
    const tender = baseTender()
    const { store } = createFakeAiStore({ tender, services: [], chunks: [] })
    const result = await resolveEvidenceRefs(store, tender.id, [{ chunkId: 'DROP TABLE x;', pageNumber: 1, quotedText: 'x' }])
    expect(result.resolved).toHaveLength(0)
    expect(result.rejectedReasons[0]).toMatch(/not a valid identifier/)
  })

  it('treats a null chunkId as unresolved rather than throwing', async () => {
    const tender = baseTender()
    const { store } = createFakeAiStore({ tender, services: [], chunks: [] })
    const result = await resolveEvidenceRefs(store, tender.id, [{ chunkId: null, pageNumber: 3, quotedText: 'x' }])
    expect(result.resolved).toHaveLength(0)
  })
})

describe('evidence/validator.ts gateTruthByEvidence (Phase 7 §16/§18)', () => {
  it('UNKNOWN never requires evidence', () => {
    const gate = gateTruthByEvidence('UNKNOWN', { resolved: [], anyRequested: false, rejectedReasons: [] })
    expect(gate.truth).toBe('UNKNOWN')
    expect(gate.requiresReview).toBe(false)
  })

  it('FACT with resolved evidence is kept as FACT', () => {
    const gate = gateTruthByEvidence('FACT', {
      resolved: [{ chunkId: 'c', documentId: 'd', documentVersionId: 'v', sectionId: null, pageNumber: 1, evidenceText: 'x' }],
      anyRequested: true,
      rejectedReasons: [],
    })
    expect(gate.truth).toBe('FACT')
    expect(gate.evidenceResolved).toBe(true)
  })

  it('a high-confidence FACT with zero resolved evidence is downgraded to UNVERIFIED, never trusted on confidence alone', () => {
    const gate = gateTruthByEvidence('FACT', { resolved: [], anyRequested: false, rejectedReasons: [] })
    expect(gate.truth).toBe('UNVERIFIED')
    expect(gate.requiresReview).toBe(true)
  })

  it('INFERENCE with no evidence is downgraded and flagged for review, never silently accepted', () => {
    const gate = gateTruthByEvidence('INFERENCE', { resolved: [], anyRequested: true, rejectedReasons: ['not found'] })
    expect(gate.truth).toBe('UNVERIFIED')
    expect(gate.requiresReview).toBe(true)
    expect(gate.note).toMatch(/not found/)
  })
})
