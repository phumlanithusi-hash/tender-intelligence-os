import { MIN_MEANINGFUL_SAMPLE_SIZE } from '@tender-os/constants'
import type { DataConfidence } from '@tender-os/constants'

/**
 * Phase 17 §3/§29/§31/§86 — small pure helpers that keep FACT / HUMAN
 * REASON / SYSTEM INFERENCE visually and textually distinct, and that
 * refuse to let a tiny sample read as a strategic conclusion.
 */
export type OutputLayer = 'FACT' | 'HUMAN_REASON' | 'INFERENCE'

export function layerLabel(confidence: DataConfidence): OutputLayer {
  if (confidence === 'VERIFIED') return 'FACT'
  if (confidence === 'INFERRED') return 'INFERENCE'
  return 'FACT' // UNVERIFIED/UNKNOWN are still presented as (unverified) fact-shaped fields, never as inference
}

/** Confidence is never a substitute for evidence (spec §29) — this exists purely to make that check explicit and testable. */
export function confidenceImpliesVerification(confidence: DataConfidence): boolean {
  return confidence === 'VERIFIED'
}

/**
 * Sample-size guard (spec §31) — a caller MUST NOT present a metric
 * with sampleSize < MIN_MEANINGFUL_SAMPLE_SIZE as a headline/strongest-
 * category claim; this returns the caveat text to attach instead.
 */
export function sampleSizeCaveat(sampleSize: number): string | null {
  if (sampleSize >= MIN_MEANINGFUL_SAMPLE_SIZE) return null
  if (sampleSize === 0) return 'No recorded outcomes — insufficient data.'
  return `Based on only ${sampleSize} recorded outcome${sampleSize === 1 ? '' : 's'} — too small a sample to draw a conclusion from.`
}

/** Never phrase an observation as causation (spec §86). */
const CAUSAL_WORDS = /\b(caused|causes|guarantees|proves|will win|will lose)\b/i
export function assertNoCausalLanguage(text: string): void {
  if (CAUSAL_WORDS.test(text)) {
    throw new Error(`Phase 17 §86 violation: observation text uses causal language: "${text}"`)
  }
}
