/**
 * Port for the OpenAI transport boundary (Phase 7 "LIBRARY CHOICES" —
 * inject a client interface for tests, same pattern as
 * `DocumentStorage`/`DocumentPipelineStore` in lib/documents). Real
 * implementation wraps the official `openai` SDK in client.ts; tests
 * use a fully-scriptable fake instead of monkey-patching the SDK.
 */
export interface OpenAiChatRequest {
  model: string
  system: string
  user: string
  /** Hint only — the real client still validates with Zod regardless of what the provider claims to guarantee (Phase 7 §5). */
  responseFormatJson: boolean
}

export interface OpenAiChatResponse {
  content: string
  usage: { inputTokens: number | null; outputTokens: number | null }
}

export interface OpenAiClient {
  chat(request: OpenAiChatRequest): Promise<OpenAiChatResponse>
}
