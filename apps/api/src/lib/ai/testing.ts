import type { OpenAiChatRequest, OpenAiChatResponse, OpenAiClient } from './types.js'
import { AiProviderError } from './errors.js'

/**
 * Fully-scriptable fake OpenAI client for tests (Phase 7 §35 —
 * "mock the OpenAI client at the transport boundary for all
 * non-smoke tests"). Not a partial mock of the SDK — a complete
 * alternate implementation of the `OpenAiClient` port.
 */
export type FakeOpenAiScript =
  | { kind: 'content'; content: string }
  | { kind: 'error'; error: Error }

export function createFakeOpenAiClient(script: FakeOpenAiScript[]): OpenAiClient & { calls: OpenAiChatRequest[] } {
  const calls: OpenAiChatRequest[] = []
  let index = 0

  return {
    calls,
    async chat(request: OpenAiChatRequest): Promise<OpenAiChatResponse> {
      calls.push(request)
      const step = script[Math.min(index, script.length - 1)]
      index += 1
      if (!step) throw new Error('FakeOpenAiClient: script exhausted')
      if (step.kind === 'error') throw step.error
      return { content: step.content, usage: { inputTokens: 100, outputTokens: 100 } }
    },
  }
}

export function fakeTimeoutError(): Error {
  return new AiProviderError('Request timed out', 'TIMEOUT', true)
}
export function fakeRateLimitError(): Error {
  return new AiProviderError('Rate limited', 'RATE_LIMIT', true)
}
export function fakeServerError(): Error {
  return new AiProviderError('Internal server error', 'SERVER_ERROR', true)
}
