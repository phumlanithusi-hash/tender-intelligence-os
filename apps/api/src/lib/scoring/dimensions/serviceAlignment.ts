import type { ServiceAlignmentInput, ScoringEvidenceRef } from '../types.js'

export interface ServiceAlignmentResult {
  status: 'KNOWN' | 'UNKNOWN'
  requiredCount: number
  supportedCount: number
  missingServiceIds: string[]
  explanation: string
  evidence: ScoringEvidenceRef[]
}

/**
 * Deterministic service alignment (Phase 10 §19) — a plain set
 * comparison of tender-required service IDs (Phase 7 classification /
 * Phase 9 requirements, already resolved to the shared services
 * taxonomy) against the agency's own `agency_services` rows. No
 * semantic matching: two services are "the same" only if they share the
 * same `service_id`/`subcategory_id` row in the taxonomy.
 */
export function computeServiceAlignment(input: ServiceAlignmentInput): ServiceAlignmentResult {
  if (input.requiredServiceIds.length === 0) {
    return { status: 'UNKNOWN', requiredCount: 0, supportedCount: 0, missingServiceIds: [], explanation: 'No tender services have been classified yet — service alignment is unknown.', evidence: [] }
  }
  const agencySet = new Set(input.agencyServiceIds)
  const missing = input.requiredServiceIds.filter((id) => !agencySet.has(id))
  const supportedCount = input.requiredServiceIds.length - missing.length
  const label = (id: string) => input.serviceLabels[id] ?? id
  return {
    status: 'KNOWN',
    requiredCount: input.requiredServiceIds.length,
    supportedCount,
    missingServiceIds: missing,
    explanation:
      missing.length === 0
        ? `${supportedCount}/${input.requiredServiceIds.length} required services supported.`
        : `${supportedCount}/${input.requiredServiceIds.length} required services supported. Missing: ${missing.map(label).join(', ')}.`,
    evidence: [{ kind: 'RULE', rule: 'SERVICE_ALIGNMENT', description: `Tender services vs agency_services taxonomy match.` }],
  }
}
