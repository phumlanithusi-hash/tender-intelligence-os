import { describe, it, expect } from 'vitest'
import { parseAndValidateRawClassification } from '../agents/classification/validator.js'
import { AiMalformedOutputError, AiSchemaValidationError } from '../errors.js'
import { unknownClassificationJson } from './testFixtures.js'

describe('rawClassificationSchema validation', () => {
  it('accepts a well-formed minimal (all-UNKNOWN) response', () => {
    const result = parseAndValidateRawClassification(unknownClassificationJson())
    expect(result.relevance.value).toBe('UNKNOWN')
    expect(result.deliverables).toEqual([])
  })

  it('throws AiMalformedOutputError for non-JSON content', () => {
    expect(() => parseAndValidateRawClassification('not json at all')).toThrow(AiMalformedOutputError)
  })

  it('throws AiSchemaValidationError for an invalid relevance enum', () => {
    const bad = JSON.parse(unknownClassificationJson())
    bad.relevance.value = 'MAYBE'
    expect(() => parseAndValidateRawClassification(JSON.stringify(bad))).toThrow(AiSchemaValidationError)
  })

  it('throws AiSchemaValidationError when a required object is missing entirely', () => {
    const bad = JSON.parse(unknownClassificationJson())
    delete bad.summary
    expect(() => parseAndValidateRawClassification(JSON.stringify(bad))).toThrow(AiSchemaValidationError)
  })

  it('defaults confidence to null when omitted rather than inventing a number', () => {
    const bad = JSON.parse(unknownClassificationJson())
    delete bad.relevance.confidence
    const result = parseAndValidateRawClassification(JSON.stringify(bad))
    expect(result.relevance.confidence).toBeNull()
  })

  it('rejects a confidence value outside [0, 1]', () => {
    const bad = JSON.parse(unknownClassificationJson())
    bad.relevance.confidence = 1.5
    expect(() => parseAndValidateRawClassification(JSON.stringify(bad))).toThrow(AiSchemaValidationError)
  })
})
