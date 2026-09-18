import type { DocumentClassification } from '@tender-os/constants'
import type { ExtractedPage } from './extractors/types.js'

interface ClassificationRule {
  label: DocumentClassification
  patterns: RegExp[]
}

/**
 * Deterministic document classification (Phase 6 §23) — filename and
 * early-page-text keyword matching only, no AI. Rules are ordered
 * most-specific first; the first match wins. Returns 'UNKNOWN' rather
 * than guessing when nothing matches (Phase 6 §23: "UNKNOWN if
 * uncertain").
 */
const RULES: ClassificationRule[] = [
  { label: 'ADDENDUM', patterns: [/\baddendum\b/i, /\bamendment\b/i] },
  { label: 'SBD_FORM', patterns: [/\bsbd\s?\d/i, /standard bidding document/i] },
  { label: 'PRICING_SCHEDULE', patterns: [/pricing[\s_-]?schedule/i, /\bbill of quantities\b/i, /\bboq\b/i, /price[\s_-]?schedule/i] },
  { label: 'BRIEFING', patterns: [/briefing session/i, /compulsory briefing/i, /site meeting/i] },
  { label: 'SPECIFICATION', patterns: [/\bspecification[s]?\b/i, /\bscope of work\b/i] },
  { label: 'ANNEXURE', patterns: [/^annexure\b/i, /^appendix\b/i] },
  { label: 'TOR', patterns: [/terms of reference/i, /\btor\b/i] },
  { label: 'RFP', patterns: [/request for proposal/i, /\brfp\b/i] },
  { label: 'RFQ', patterns: [/request for quotation/i, /\brfq\b/i] },
]

export function classifyDocument(filename: string, pages: ExtractedPage[]): {
  classification: DocumentClassification
  confidence: number
} {
  const filenameLower = filename.toLowerCase()
  const earlyText = pages
    .slice(0, 2)
    .map((p) => p.text)
    .join('\n')
    .slice(0, 4000)

  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(filenameLower))) {
      return { classification: rule.label, confidence: 0.75 }
    }
  }
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(earlyText))) {
      return { classification: rule.label, confidence: 0.6 }
    }
  }
  return { classification: 'UNKNOWN', confidence: 0 }
}
