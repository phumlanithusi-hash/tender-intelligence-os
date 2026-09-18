import { proposalGenerationResultSchema, type ProposalGenerationResult } from '@tender-os/schemas'
import { AiMalformedOutputError, AiSchemaValidationError } from '../../errors.js'

/**
 * Phase 14 §14 — structured output only, Zod validation mandatory.
 * Invalid output is rejected here (never coerced into something
 * plausible-looking); the caller decides whether to retry or record a
 * REJECTED_INVALID_OUTPUT generation.
 */
export function parseAndValidateProposalGenerationResult(rawContent: string): ProposalGenerationResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawContent)
  } catch {
    throw new AiMalformedOutputError('Model output was not valid JSON.')
  }

  const result = proposalGenerationResultSchema.safeParse(parsed)
  if (!result.success) {
    throw new AiSchemaValidationError('Model output failed schema validation.', result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`))
  }
  return result.data
}
