import type { OpenAiClient } from '../../types.js'
import type { ChunkForContext } from '../../store.js'
import {
  QUALIFICATION_INTERPRETATION_PROMPT_VERSION,
  QUALIFICATION_INTERPRETATION_SYSTEM_PROMPT,
  buildQualificationInterpretationUserPrompt,
  type QualificationCandidate,
} from './prompt.js'
import { parseAndValidateRawQualificationInterpretation } from './validator.js'
import type { RawQualificationInterpretation } from './schema.js'

export interface RunQualificationInterpretationAgentInput {
  model: string
  candidates: QualificationCandidate[]
  chunks: ChunkForContext[]
  limits: { maxDocumentChunks: number; maxContextChars: number }
}

export interface RunQualificationInterpretationAgentResult {
  raw: RawQualificationInterpretation
  rawContent: string
  promptVersion: string
  usedChunkIds: string[]
  truncated: boolean
  usage: { inputTokens: number | null; outputTokens: number | null }
}

/**
 * QualificationInterpretationAgent (Phase 8 §26) — the second agent
 * registered alongside TenderClassificationAgent, reusing the exact
 * same client/context-bounding/schema-validation shape rather than a
 * parallel reimplementation. This function is pure orchestration:
 * context -> prompt -> model -> schema validation. Evidence
 * resolution and persistence happen one layer up
 * (execution/runQualificationInterpretation.ts), so this and its unit
 * tests never need a real database.
 */
export async function runQualificationInterpretationAgent(
  client: OpenAiClient,
  input: RunQualificationInterpretationAgentInput,
): Promise<RunQualificationInterpretationAgentResult> {
  const maxChunks = Math.max(0, input.limits.maxDocumentChunks)
  let usedChars = 0
  const usedChunks: ChunkForContext[] = []
  let truncated = input.chunks.length > maxChunks
  for (const chunk of input.chunks.slice(0, maxChunks)) {
    if (usedChars + chunk.text.length > input.limits.maxContextChars) {
      truncated = true
      break
    }
    usedChunks.push(chunk)
    usedChars += chunk.text.length
  }

  const documentContextBlock =
    usedChunks.length > 0
      ? usedChunks.map((c) => `[chunk: ${c.id}, document: ${c.documentId}, page: ${c.pageStart}${c.pageEnd !== c.pageStart ? `-${c.pageEnd}` : ''}]\n${c.text}`).join('\n\n---\n\n')
      : '(no extracted document content is available for this tender yet)'

  const response = await client.chat({
    model: input.model,
    system: QUALIFICATION_INTERPRETATION_SYSTEM_PROMPT,
    user: buildQualificationInterpretationUserPrompt({ candidates: input.candidates, documentContextBlock, truncated }),
    responseFormatJson: true,
  })

  const raw = parseAndValidateRawQualificationInterpretation(response.content)

  return {
    raw,
    rawContent: response.content,
    promptVersion: QUALIFICATION_INTERPRETATION_PROMPT_VERSION,
    usedChunkIds: usedChunks.map((c) => c.id),
    truncated,
    usage: response.usage,
  }
}
