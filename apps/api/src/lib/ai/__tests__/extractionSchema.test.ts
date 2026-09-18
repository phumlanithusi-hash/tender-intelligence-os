import { describe, it, expect } from 'vitest'
import { parseAndValidateRawRequirementExtraction } from '../agents/extraction/validator.js'
import { AiMalformedOutputError, AiSchemaValidationError } from '../errors.js'
import { makeExtractionChunk, extractionJson } from './extractionTestFixtures.js'
import { runRequirementExtractionAgent } from '../agents/extraction/agent.js'
import { createFakeOpenAiClient } from '../testing.js'

describe('rawRequirementExtractionSchema validation (Phase 9 §33)', () => {
  it('accepts a well-formed minimal (empty) response', () => {
    const result = parseAndValidateRawRequirementExtraction(JSON.stringify({ requirements: [], evaluationFramework: { criteria: [], gates: [] }, conflicts: [] }))
    expect(result.requirements).toEqual([])
    expect(result.evaluationFramework.criteria).toEqual([])
  })

  it('accepts a fully-populated requirement + criterion', () => {
    const chunk = makeExtractionChunk()
    const result = parseAndValidateRawRequirementExtraction(extractionJson(chunk))
    expect(result.requirements).toHaveLength(1)
    expect(result.evaluationFramework.criteria[0]!.maximumPoints).toBe(20)
  })

  it('defaults maximumPoints/weight/minimumThreshold to null rather than inventing a number when omitted', () => {
    const raw = JSON.parse(extractionJson(makeExtractionChunk()))
    delete raw.evaluationFramework.criteria[0].maximumPoints
    delete raw.evaluationFramework.criteria[0].weight
    const result = parseAndValidateRawRequirementExtraction(JSON.stringify(raw))
    expect(result.evaluationFramework.criteria[0]!.maximumPoints).toBeNull()
    expect(result.evaluationFramework.criteria[0]!.weight).toBeNull()
  })

  it('throws AiMalformedOutputError for non-JSON content', () => {
    expect(() => parseAndValidateRawRequirementExtraction('not json at all')).toThrow(AiMalformedOutputError)
  })

  it('throws AiSchemaValidationError for an invalid category enum', () => {
    const raw = JSON.parse(extractionJson(makeExtractionChunk()))
    raw.requirements[0].category = 'NOT_REAL'
    expect(() => parseAndValidateRawRequirementExtraction(JSON.stringify(raw))).toThrow(AiSchemaValidationError)
  })

  it('rejects a confidence value outside [0, 1]', () => {
    const raw = JSON.parse(extractionJson(makeExtractionChunk()))
    raw.requirements[0].confidence = 2
    expect(() => parseAndValidateRawRequirementExtraction(JSON.stringify(raw))).toThrow(AiSchemaValidationError)
  })

  it('defaults scoringMethod/criterionType to UNKNOWN when omitted, never guessing a specific method', () => {
    const raw = JSON.parse(extractionJson(makeExtractionChunk()))
    delete raw.evaluationFramework.criteria[0].scoringMethod
    delete raw.evaluationFramework.criteria[0].criterionType
    const result = parseAndValidateRawRequirementExtraction(JSON.stringify(raw))
    expect(result.evaluationFramework.criteria[0]!.scoringMethod).toBe('UNKNOWN')
    expect(result.evaluationFramework.criteria[0]!.criterionType).toBe('UNKNOWN')
  })
})

describe('runRequirementExtractionAgent — context bounding (Phase 9 §32)', () => {
  it('truncates when the chunk count exceeds maxDocumentChunks and reports contextTruncated', async () => {
    const chunks = Array.from({ length: 5 }, () => makeExtractionChunk())
    const client = createFakeOpenAiClient([{ kind: 'content', content: JSON.stringify({ requirements: [], evaluationFramework: { criteria: [], gates: [] }, conflicts: [] }) }])

    const result = await runRequirementExtractionAgent(client, { model: 'gpt-test', chunks, limits: { maxDocumentChunks: 2, maxContextChars: 60_000 } })

    expect(result.truncated).toBe(true)
    expect(result.usedChunkIds).toHaveLength(2)
  })

  it('does not report truncation when everything fits', async () => {
    const chunks = [makeExtractionChunk()]
    const client = createFakeOpenAiClient([{ kind: 'content', content: JSON.stringify({ requirements: [], evaluationFramework: { criteria: [], gates: [] }, conflicts: [] }) }])

    const result = await runRequirementExtractionAgent(client, { model: 'gpt-test', chunks, limits: { maxDocumentChunks: 40, maxContextChars: 60_000 } })

    expect(result.truncated).toBe(false)
  })
})
