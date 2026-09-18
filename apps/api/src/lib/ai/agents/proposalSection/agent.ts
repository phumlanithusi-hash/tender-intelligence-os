import type { OpenAiClient } from '../../types.js'
import type { ProposalGenerationResult } from '@tender-os/schemas'
import { PROPOSAL_SECTION_PROMPT_VERSION, PROPOSAL_SECTION_SYSTEM_PROMPT, buildProposalSectionUserPrompt, type ProposalSectionPromptContext } from './prompt.js'
import { parseAndValidateProposalGenerationResult } from './validator.js'

export interface RunProposalSectionAgentInput {
  model: string
  context: ProposalSectionPromptContext
}

export interface RunProposalSectionAgentResult {
  raw: ProposalGenerationResult
  rawContent: string
  promptVersion: string
  usage: { inputTokens: number | null; outputTokens: number | null }
}

/**
 * ProposalSectionAgent (Phase 14 §12/§14). Pure orchestration of
 * context -> prompt -> model -> schema validation, mirroring
 * agents/classification/agent.ts exactly. Independent re-verification
 * of any cited evidence claim id against the real store happens one
 * layer up (lib/proposals/runGeneration.ts), so this function (and its
 * unit tests) never need a real database.
 */
export async function runProposalSectionAgent(client: OpenAiClient, input: RunProposalSectionAgentInput): Promise<RunProposalSectionAgentResult> {
  const response = await client.chat({
    model: input.model,
    system: PROPOSAL_SECTION_SYSTEM_PROMPT,
    user: buildProposalSectionUserPrompt(input.context),
    responseFormatJson: true,
  })

  const raw = parseAndValidateProposalGenerationResult(response.content)

  return {
    raw,
    rawContent: response.content,
    promptVersion: PROPOSAL_SECTION_PROMPT_VERSION,
    usage: response.usage,
  }
}

export { PROPOSAL_SECTION_PROMPT_VERSION }
export type { ProposalSectionPromptContext }
