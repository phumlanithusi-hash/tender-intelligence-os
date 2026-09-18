import { rawQualificationInterpretationSchema, type RawQualificationInterpretation } from './schema.js'
import { AiMalformedOutputError, AiSchemaValidationError } from '../../errors.js'

/** Same two-failure-mode discipline as the classification agent (Phase 7 §5, reused verbatim for Phase 8 §26). */
export function parseAndValidateRawQualificationInterpretation(content: string): RawQualificationInterpretation {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (err) {
    throw new AiMalformedOutputError(`Model output was not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }

  const result = rawQualificationInterpretationSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    throw new AiSchemaValidationError('Model output failed schema validation.', issues)
  }
  return result.data
}
