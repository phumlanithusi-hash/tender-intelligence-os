import { createHash } from 'node:crypto'

/**
 * Phase 20 §4A — the continuous ingestion differential engine. Pure,
 * zero-I/O: compares a re-scanned source record's PREVIOUS known
 * facts against its INCOMING facts and classifies exactly which of
 * the five addendum dimensions changed (Phase 2 §9's own vocabulary:
 * deadline / briefing / requirement / evaluation / pricing), building
 * the impact assessment `tender_addenda.impact_assessment` records.
 *
 * A field is only ever reported changed when BOTH sides have a known
 * (non-null) value that differs — never when one side is simply
 * missing data (spec §2/§9: "do not assume a change until confirmed";
 * a previously-unknown field becoming known for the first time is an
 * enrichment, not an addendum).
 */

export interface TenderComparableFacts {
  title: string | null
  organisation: string | null
  tenderNumber: string | null
  closingDate: string | null
  /** Free-form raw metadata the source exposed for this listing (Phase 5 §6) — used only for the optional keys below, when a source happens to expose them; never invented when absent. */
  rawMetadata: {
    briefingDate?: string | null
    briefingRequired?: boolean | null
    scopeSummary?: string | null
    requirementsSummary?: string | null
    evaluationSummary?: string | null
    pricingSummary?: string | null
    mandatoryDocuments?: string[]
  } | null
}

export interface TenderFactDiff {
  deadlineChanged: boolean
  briefingChanged: boolean
  requirementChanged: boolean
  evaluationChanged: boolean
  pricingChanged: boolean
  scopeChanged: boolean
  isMaterial: boolean
  changedFields: string[]
  summary: string
}

export interface TenderAddendumImpactAssessment {
  changedFields: string[]
  affectedAreas: string[]
  requiresReacknowledgement: boolean
  summary: string
}

function fieldChanged<T>(previous: T | null | undefined, incoming: T | null | undefined): boolean {
  if (previous === null || previous === undefined) return false // enrichment, not a change
  if (incoming === null || incoming === undefined) return false // never assume a change from a value merely disappearing from this scan
  return JSON.stringify(previous) !== JSON.stringify(incoming)
}

function arrayChanged(previous: string[] | undefined, incoming: string[] | undefined): boolean {
  if (!previous || !incoming) return false
  if (previous.length !== incoming.length) return true
  const a = [...previous].sort()
  const b = [...incoming].sort()
  return a.some((v, i) => v !== b[i])
}

/**
 * The canonical structural hash for one tender's comparable facts
 * (spec §20 4A "structural hashes"). Field order is fixed, exactly
 * like `lib/ingestion/contentHash.ts`, so the hash is stable across
 * process restarts.
 */
export function computeStructuralHash(facts: TenderComparableFacts): string {
  const canonical = JSON.stringify({
    title: facts.title ?? '',
    organisation: facts.organisation ?? '',
    tenderNumber: facts.tenderNumber ?? '',
    closingDate: facts.closingDate ?? '',
    briefingDate: facts.rawMetadata?.briefingDate ?? '',
    briefingRequired: facts.rawMetadata?.briefingRequired ?? null,
    scopeSummary: facts.rawMetadata?.scopeSummary ?? '',
    requirementsSummary: facts.rawMetadata?.requirementsSummary ?? '',
    evaluationSummary: facts.rawMetadata?.evaluationSummary ?? '',
    pricingSummary: facts.rawMetadata?.pricingSummary ?? '',
    mandatoryDocuments: [...(facts.rawMetadata?.mandatoryDocuments ?? [])].sort(),
  })
  return createHash('sha256').update(canonical).digest('hex')
}

/** Compares two structural snapshots and classifies the change (spec §20 4A: "Detect changes in scope/specifications, submission deadlines, compulsory briefing dates, mandatory document requirements"). */
export function diffTenderFacts(previous: TenderComparableFacts, incoming: TenderComparableFacts): TenderFactDiff {
  const changedFields: string[] = []

  const deadlineChanged = fieldChanged(previous.closingDate, incoming.closingDate)
  if (deadlineChanged) changedFields.push('closingDate')

  const briefingChanged =
    fieldChanged(previous.rawMetadata?.briefingDate, incoming.rawMetadata?.briefingDate) ||
    fieldChanged(previous.rawMetadata?.briefingRequired, incoming.rawMetadata?.briefingRequired)
  if (briefingChanged) changedFields.push('briefing')

  const requirementChanged =
    fieldChanged(previous.rawMetadata?.requirementsSummary, incoming.rawMetadata?.requirementsSummary) ||
    arrayChanged(previous.rawMetadata?.mandatoryDocuments, incoming.rawMetadata?.mandatoryDocuments)
  if (requirementChanged) changedFields.push('requirements')

  const evaluationChanged = fieldChanged(previous.rawMetadata?.evaluationSummary, incoming.rawMetadata?.evaluationSummary)
  if (evaluationChanged) changedFields.push('evaluationCriteria')

  const pricingChanged = fieldChanged(previous.rawMetadata?.pricingSummary, incoming.rawMetadata?.pricingSummary)
  if (pricingChanged) changedFields.push('pricing')

  const scopeChanged = fieldChanged(previous.title, incoming.title) || fieldChanged(previous.rawMetadata?.scopeSummary, incoming.rawMetadata?.scopeSummary)
  if (scopeChanged) changedFields.push('scope')

  const isMaterial = deadlineChanged || briefingChanged || requirementChanged || evaluationChanged || pricingChanged || scopeChanged

  return {
    deadlineChanged,
    briefingChanged,
    requirementChanged,
    evaluationChanged,
    pricingChanged,
    scopeChanged,
    isMaterial,
    changedFields,
    summary: isMaterial ? `Detected changes: ${changedFields.join(', ')}.` : 'No material structural change detected.',
  }
}

/** Builds the `tender_addenda.impact_assessment` payload from a diff (spec §20 4B "impact analysis"). */
export function buildImpactAssessment(diff: TenderFactDiff): TenderAddendumImpactAssessment {
  const affectedAreas: string[] = []
  if (diff.deadlineChanged) affectedAreas.push('SUBMISSION_TIMELINE')
  if (diff.briefingChanged) affectedAreas.push('BRIEFING_ATTENDANCE')
  if (diff.requirementChanged) affectedAreas.push('COMPLIANCE_REQUIREMENTS')
  if (diff.evaluationChanged) affectedAreas.push('SCORING_STRATEGY')
  if (diff.pricingChanged) affectedAreas.push('PRICING_STRUCTURE')
  if (diff.scopeChanged) affectedAreas.push('SCOPE_AND_SPECIFICATIONS')

  return {
    changedFields: diff.changedFields,
    affectedAreas,
    // Any material change requires a human bid team to re-acknowledge
    // before submission can proceed — never auto-cleared (spec §20 4B
    // "Compliance Gate").
    requiresReacknowledgement: diff.isMaterial,
    summary: diff.summary,
  }
}
