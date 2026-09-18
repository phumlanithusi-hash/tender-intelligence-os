import { rawClassificationSchema, type RawClassification } from './schema.js'
import { AiMalformedOutputError, AiSchemaValidationError } from '../../errors.js'

/**
 * Never trust raw model output (Phase 7 §5). Two independent failure
 * modes are distinguished so callers/tests can assert on each:
 * malformed JSON vs. valid JSON that fails the Zod schema.
 */
export function parseAndValidateRawClassification(content: string): RawClassification {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (err) {
    throw new AiMalformedOutputError(`Model output was not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }

  const result = rawClassificationSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    throw new AiSchemaValidationError('Model output failed schema validation.', issues)
  }
  return result.data
}
