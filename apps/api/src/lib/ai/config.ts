import { env } from '../env.js'

/**
 * AI layer configuration (Phase 7 §3/§26). Every knob comes from
 * validated server environment — nothing here is a hard-coded model
 * name or limit buried inside agent code.
 */
export interface AiConfig {
  apiKey: string | undefined
  model: string
  embeddingModel: string
  maxDocumentChunks: number
  maxContextChars: number
  maxTokensEstimate: number
  maxRetries: number
}

export function loadAiConfig(): AiConfig {
  return {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    embeddingModel: env.OPENAI_EMBEDDING_MODEL,
    maxDocumentChunks: env.AI_MAX_DOCUMENT_CHUNKS,
    maxContextChars: env.AI_MAX_CONTEXT_CHARS,
    maxTokensEstimate: env.AI_MAX_TOKENS_ESTIMATE,
    maxRetries: env.AI_MAX_RETRIES,
  }
}

/** True only when a real OpenAI call can be attempted — callers must degrade (SKIP), never fake success, when this is false (Phase 7 binding constraint). */
export function isAiConfigured(config: AiConfig): boolean {
  return Boolean(config.apiKey && config.apiKey.length > 0)
}
