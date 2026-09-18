import OpenAI from 'openai'
import { AiProviderError } from './errors.js'

/**
 * Phase 13 — the embeddings-endpoint counterpart to client.ts's chat
 * completion transport. A new, additive file (client.ts itself is
 * untouched, per the binding "do not rewrite a prior phase's code"
 * constraint) since embeddings and chat completions are genuinely
 * different OpenAI endpoints with different request/response shapes.
 * Thin transport wrapper only — no trust decisions happen here.
 */
export interface EmbeddingClient {
  embed(text: string, model: string): Promise<number[]>
}

export function createOpenAiEmbeddingClient(apiKey: string): EmbeddingClient {
  const client = new OpenAI({ apiKey })
  return {
    async embed(text: string, model: string): Promise<number[]> {
      try {
        const response = await client.embeddings.create({ model, input: text })
        const vector = response.data[0]?.embedding
        if (!vector || vector.length === 0) {
          throw new AiProviderError('OpenAI embeddings API returned no vector.', 'UNKNOWN', false)
        }
        return vector
      } catch (err) {
        if (err instanceof AiProviderError) throw err
        throw classifyEmbeddingError(err)
      }
    },
  }
}

function classifyEmbeddingError(err: unknown): AiProviderError {
  const status = (err as { status?: number })?.status
  const message = err instanceof Error ? err.message : String(err)
  if (status === 429) return new AiProviderError(message, 'RATE_LIMIT', true)
  if (status !== undefined && status >= 500) return new AiProviderError(message, 'SERVER_ERROR', true)
  if (/timeout|ETIMEDOUT|ECONNRESET/i.test(message)) return new AiProviderError(message, 'TIMEOUT', true)
  return new AiProviderError(message, 'UNKNOWN', false)
}
