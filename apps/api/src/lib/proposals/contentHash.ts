import { createHash } from 'node:crypto'

/**
 * Phase 14 §18 — deterministic input_context_hash: the exact set of
 * requirement/evaluation/evidence ids and objective text a generation
 * run was built from, so an identical re-run (same inputs, same
 * prompt version) is detectable and every generation is reproducible
 * as far as practical. Pure (node:crypto is in-process hashing, no
 * I/O), mirrors lib/evidenceMatching/contentHash.ts exactly.
 */
export function computeGenerationInputContextHash(parts: {
  promptVersion: string
  sectionType: string
  requirementIds: string[]
  evaluationCriterionIds: string[]
  evidenceClaimIds: string[]
  userInstructions: string | null
  strategyVersion: number | null
}): string {
  const canonical = JSON.stringify({
    promptVersion: parts.promptVersion,
    sectionType: parts.sectionType,
    requirementIds: [...parts.requirementIds].sort(),
    evaluationCriterionIds: [...parts.evaluationCriterionIds].sort(),
    evidenceClaimIds: [...parts.evidenceClaimIds].sort(),
    userInstructions: parts.userInstructions ?? '',
    strategyVersion: parts.strategyVersion,
  })
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}
