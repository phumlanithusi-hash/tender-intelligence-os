import type { OpenAiClient } from '../../types.js'
import type { AgencyServiceOption, ChunkForContext, TenderForClassification } from '../../store.js'
import { buildClassificationContext } from '../../contextBuilder.js'
import { TENDER_CLASSIFICATION_PROMPT_VERSION, TENDER_CLASSIFICATION_SYSTEM_PROMPT, buildClassificationUserPrompt } from './prompt.js'
import { parseAndValidateRawClassification } from './validator.js'
import type { RawClassification } from './schema.js'

export interface RunClassificationAgentInput {
  model: string
  tender: TenderForClassification
  services: AgencyServiceOption[]
  chunks: ChunkForContext[]
  limits: { maxDocumentChunks: number; maxContextChars: number }
}

export interface RunClassificationAgentResult {
  raw: RawClassification
  rawContent: string
  promptVersion: string
  usedChunkIds: string[]
  truncated: boolean
  usage: { inputTokens: number | null; outputTokens: number | null }
}

/**
 * TenderClassificationAgent (Phase 7 §6). Pure orchestration of
 * context -> prompt -> model -> schema validation. Evidence
 * resolution and persistence happen one layer up in
 * execution/runAgent.ts, so this function (and its unit tests) never
 * need a real database.
 */
export async function runClassificationAgent(
  client: OpenAiClient,
  input: RunClassificationAgentInput,
): Promise<RunClassificationAgentResult> {
  const built = buildClassificationContext(input.tender, input.services, input.chunks, input.limits)

  const response = await client.chat({
    model: input.model,
    system: TENDER_CLASSIFICATION_SYSTEM_PROMPT,
    user: buildClassificationUserPrompt(built.prompt),
    responseFormatJson: true,
  })

  const raw = parseAndValidateRawClassification(response.content)

  return {
    raw,
    rawContent: response.content,
    promptVersion: TENDER_CLASSIFICATION_PROMPT_VERSION,
    usedChunkIds: built.usedChunkIds,
    truncated: built.truncated,
    usage: response.usage,
  }
}
