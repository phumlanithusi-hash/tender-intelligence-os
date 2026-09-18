import type { SubmissionAddendumInput } from '../submissionReadiness/types.js'

/**
 * Phase 19 §12 — addenda reconciliation. PURE, zero-I/O: replaces the
 * Phase 15 hard-coded stub (`isMaterial: true, acknowledgementRequired:
 * false, acknowledged: false, reconciled: false` for every addendum,
 * documented as a Known Limitation in `docs/DECISIONS.md` #1) with a
 * real, deterministic derivation from:
 *  - the addendum's own confirmed `*_changed` flags (never inferred —
 *    Phase 2 §9 binding constraint: "do not assume an addendum changes
 *    anything until the documents confirm it"), and
 *  - a real, agency-scoped `bid_addendum_acknowledgements` row (Phase
 *    19 migration) if a human has actually acknowledged it.
 */

export interface TenderAddendumFact {
  id: string
  addendumNumber: number
  deadlineChanged: boolean
  briefingChanged: boolean
  requirementChanged: boolean
  evaluationChanged: boolean
  pricingChanged: boolean
}

export interface AddendumAcknowledgementFact {
  addendumId: string
  reconciled: boolean
}

/**
 * An addendum is MATERIAL only when the source documents actually
 * confirmed a change (spec §12/§26 — never assumed from the addendum
 * merely existing). A material addendum is exactly the case that
 * requires acknowledgement before submission readiness can be READY —
 * a purely administrative addendum (no `*_changed` flag set) never
 * blocks anything.
 */
export function isAddendumMaterial(addendum: TenderAddendumFact): boolean {
  return (
    addendum.deadlineChanged ||
    addendum.briefingChanged ||
    addendum.requirementChanged ||
    addendum.evaluationChanged ||
    addendum.pricingChanged
  )
}

/**
 * Builds the exact `SubmissionAddendumInput` the Phase 15 engine reads,
 * from real addendum facts and a real (possibly absent) acknowledgement
 * record — never a hard-coded stub.
 */
export function buildAddendumReconciliationInput(
  addendum: TenderAddendumFact,
  acknowledgement: AddendumAcknowledgementFact | null,
): SubmissionAddendumInput {
  const isMaterial = isAddendumMaterial(addendum)
  return {
    id: addendum.id,
    addendumNumber: addendum.addendumNumber,
    isMaterial,
    // A material addendum requires explicit acknowledgement before the
    // package can be READY_TO_SUBMIT; a non-material one never does
    // (spec §12 — "the system should be able to answer: has the bid
    // team acknowledged every applicable addendum" — applicable means
    // material here, a deterministic and documented policy choice).
    acknowledgementRequired: isMaterial,
    acknowledged: acknowledgement !== null,
    reconciled: acknowledgement?.reconciled ?? false,
  }
}
