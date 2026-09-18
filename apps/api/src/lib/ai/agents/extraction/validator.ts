import { rawRequirementExtractionSchema, type RawRequirementExtraction } from './schema.js'
import { AiMalformedOutputError, AiSchemaValidationError } from '../../errors.js'

/** Same two-failure-mode discipline as classification/qualification (Phase 7 §5, Phase 9 §33). */
export function parseAndValidateRawRequirementExtraction(content: string): RawRequirementExtraction {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (err) {
    throw new AiMalformedOutputError(`Model output was not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }

  const result = rawRequirementExtractionSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    throw new AiSchemaValidationError('Model output failed schema validation.', issues)
  }
  return result.data
}
