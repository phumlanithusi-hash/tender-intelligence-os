import { assertNoCausalLanguage } from '../outcomes/provenance.js'
import { MIN_SEGMENT_SAMPLE_SIZE } from '@tender-os/constants'

/**
 * Phase 18 §14/§25 — deterministic, templated prediction explanations.
 * Mirrors apps/api/src/lib/bidDecision/explanations.ts's pattern
 * exactly: no LLM call, no free-form generation — every sentence is
 * built from structured numbers and passes through
 * assertNoCausalLanguage before being returned. Per spec §25 this
 * phase skips LLM-based explanation generation entirely (consistent
 * with the sandbox's api.openai.com restriction).
 */

export interface FeatureContribution {
  feature: string
  contribution: number
}

function labelFeature(feature: string): string {
  const labels: Record<string, string> = {
    opportunityScore: 'Opportunity Score',
    requirementCoverage: 'requirement coverage',
    evidenceStrength: 'evidence strength',
    commercialFit: 'commercial fit',
    strategicFit: 'strategic fit',
  }
  return labels[feature] ?? feature
}

/**
 * Builds a templated explanation for one prediction. Uses only
 * associative language ("historically associated with") — never
 * causal ("will win because of") per spec §14/§25.
 */
export function buildPredictionExplanation(
  predictedProbability: number,
  sampleSize: number,
  positiveFeatures: FeatureContribution[],
  negativeFeatures: FeatureContribution[],
  missingFeatures: string[],
  modelVersionLabel: string,
): string {
  const pct = Math.round(predictedProbability * 100)
  const sentences: string[] = [
    `Predicted win likelihood: ${pct}% (model version ${modelVersionLabel}, based on ${sampleSize} historical observation${sampleSize === 1 ? '' : 's'}).`,
  ]

  if (positiveFeatures.length > 0) {
    const top = positiveFeatures
      .slice(0, 3)
      .map((f) => labelFeature(f.feature))
      .join(', ')
    sentences.push(`Factors historically associated with a stronger outcome in this dataset: ${top}.`)
  }
  if (negativeFeatures.length > 0) {
    const top = negativeFeatures
      .slice(0, 3)
      .map((f) => labelFeature(f.feature))
      .join(', ')
    sentences.push(`Factors historically associated with a weaker outcome in this dataset: ${top}.`)
  }
  if (missingFeatures.length > 0) {
    sentences.push(`Missing decision-time feature(s) for this bid: ${missingFeatures.join(', ')} — the prediction may be less reliable as a result.`)
  }
  if (sampleSize < MIN_SEGMENT_SAMPLE_SIZE) {
    sentences.push(`This is based on a small sample (${sampleSize}) and should be treated as illustrative, not a strong statistical conclusion.`)
  }
  sentences.push('This is decision support, not a procurement decision. The human remains responsible for Bid/No-Bid and submission decisions.')

  const text = sentences.join(' ')
  assertNoCausalLanguage(text)
  return text
}

export function buildAbstentionExplanation(reason: string, detail: string): string {
  const text = `No numerical prediction was made (${reason}). ${detail} This is an expected, correct system state when evidence is insufficient — not a system failure.`
  assertNoCausalLanguage(text)
  return text
}
