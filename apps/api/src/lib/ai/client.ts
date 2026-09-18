import OpenAI from 'openai'
import type { OpenAiChatRequest, OpenAiChatResponse, OpenAiClient } from './types.js'
import { AiProviderError } from './errors.js'

/**
 * Real OpenAI transport implementation (Phase 7 §3/§5). Thin wrapper
 * only — all structured-output trust decisions happen server-side in
 * agents/classification/validator.ts and evidence/validator.ts, never
 * here, regardless of what `response_format: json_object` /
 * JSON-schema mode claims to guarantee.
 */
export function createOpenAiClient(apiKey: string): OpenAiClient {
  const client = new OpenAI({ apiKey })

  return {
    async chat(request: OpenAiChatRequest): Promise<OpenAiChatResponse> {
      try {
        const response = await client.chat.completions.create({
          model: request.model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          ...(request.responseFormatJson ? { response_format: { type: 'json_object' as const } } : {}),
        })
        const content = response.choices[0]?.message?.content ?? ''
        return {
          content,
          usage: {
            inputTokens: response.usage?.prompt_tokens ?? null,
            outputTokens: response.usage?.completion_tokens ?? null,
          },
        }
      } catch (err) {
        throw classifyProviderError(err)
      }
    },
  }
}

/** Maps SDK/HTTP failure shapes to our retry taxonomy (Phase 7 §27). */
function classifyProviderError(err: unknown): AiProviderError {
  const status = (err as { status?: number })?.status
  const message = err instanceof Error ? err.message : String(err)

  if (status === 429) return new AiProviderError(message, 'RATE_LIMIT', true)
  if (status !== undefined && status >= 500) return new AiProviderError(message, 'SERVER_ERROR', true)
  if (/timeout|ETIMEDOUT|ECONNRESET/i.test(message)) return new AiProviderError(message, 'TIMEOUT', true)
  return new AiProviderError(message, 'UNKNOWN', false)
}
