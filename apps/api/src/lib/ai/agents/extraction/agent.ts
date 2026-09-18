import type { OpenAiClient } from '../../types.js'
import type { ChunkForContext } from '../../store.js'
import { REQUIREMENT_EXTRACTION_PROMPT_VERSION, REQUIREMENT_EXTRACTION_SYSTEM_PROMPT, buildRequirementExtractionUserPrompt } from './prompt.js'
import { parseAndValidateRawRequirementExtraction } from './validator.js'
import type { RawRequirementExtraction } from './schema.js'

export interface RunRequirementExtractionAgentInput {
  model: string
  chunks: ChunkForContext[]
  limits: { maxDocumentChunks: number; maxContextChars: number }
}

export interface RunRequirementExtractionAgentResult {
  raw: RawRequirementExtraction
  rawContent: string
  promptVersion: string
  usedChunkIds: string[]
  truncated: boolean
  usage: { inputTokens: number | null; outputTokens: number | null }
}

/**
 * RequirementExtractionAgent (Phase 9 §8/§32) — the third agent, reusing
 * the exact same client/context-bounding/schema-validation shape as
 * TenderClassificationAgent (Phase 7) and QualificationInterpretationAgent
 * (Phase 8). Pure orchestration: context -> prompt -> model -> schema
 * validation. Evidence resolution, normalisation, conflict detection and
 * persistence happen one layer up
 * (execution/runRequirementEvaluationExtraction.ts), so this and its unit
 * tests never need a real database.
 *
 * Context prioritisation (Phase 9 §32): section detection already ran in
 * Phase 6; this agent doesn't re-detect sections, it simply receives
 * whatever chunks the store selects (store.listChunksForTender), same
 * contract as the other two agents.
 */
export async function runRequirementExtractionAgent(client: OpenAiClient, input: RunRequirementExtractionAgentInput): Promise<RunRequirementExtractionAgentResult> {
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
    system: REQUIREMENT_EXTRACTION_SYSTEM_PROMPT,
    user: buildRequirementExtractionUserPrompt({ documentContextBlock, truncated }),
    responseFormatJson: true,
  })

  const raw = parseAndValidateRawRequirementExtraction(response.content)

  return {
    raw,
    rawContent: response.content,
    promptVersion: REQUIREMENT_EXTRACTION_PROMPT_VERSION,
    usedChunkIds: usedChunks.map((c) => c.id),
    truncated,
    usage: response.usage,
  }
}
