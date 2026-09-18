import type {
  BidStrategyBuildInput,
  BidStrategyDraft,
  PriorityDraft,
  WinThemeDraft,
  EvaluationStrategyDraft,
  RequirementPlanDraft,
  EvidenceNeedDraft,
  RiskDraft,
  AssumptionDraft,
  WorkstreamDraft,
} from './types.js'

/**
 * Phase 12 §27 — PURE, zero-I/O strategy generator. No OpenAI call, no
 * embeddings, no database read, no network call, anywhere in this
 * function or its call graph. Given identical input it always returns
 * an identical draft — verified by an explicit repeat-call test
 * (bidStrategy/__tests__/buildStrategy.test.ts).
 *
 * Every generated item traces to a concrete `sourceId` from the input
 * (a real tender_requirements.id or tender_evaluation_criteria.id) —
 * never a freeform claim invented "because it sounds good" (Phase 12
 * §28/§42). Differentiators are never auto-generated (see types.ts).
 */
export function buildBidStrategy(input: BidStrategyBuildInput): BidStrategyDraft {
  const threshold = input.evaluationWeightThreshold

  const evaluationStrategies: EvaluationStrategyDraft[] = []
  const evidenceNeeds: EvidenceNeedDraft[] = []
  const winThemes: WinThemeDraft[] = []
  const tenderPriorities: PriorityDraft[] = []
  const clientPriorities: PriorityDraft[] = []

  const sortedCriteria = [...input.evaluationCriteria].sort((a, b) => {
    const aw = a.weight ?? -1
    const bw = b.weight ?? -1
    if (aw !== bw) return bw - aw
    return a.id.localeCompare(b.id)
  })

  sortedCriteria.forEach((criterion, index) => {
    const weightKnown = criterion.weight !== null
    const isHighWeight = weightKnown && (criterion.weight as number) >= threshold
    const evidenceStatus = criterion.evidenceLinkCount >= 2 ? 'SUPPORTED' : criterion.evidenceLinkCount === 1 ? 'PARTIALLY_SUPPORTED' : 'EVIDENCE_REQUIRED'
    const priority: EvaluationStrategyDraft['priority'] = isHighWeight ? 'HIGH' : weightKnown ? 'MEDIUM' : 'LOW'

    evaluationStrategies.push({
      evaluationCriterionId: criterion.id,
      strategy: criterion.evidenceLinkCount > 0 ? `Respond directly to "${criterion.criterion}" using the ${criterion.evidenceLinkCount} linked agency evidence record(s).` : null,
      responseObjective: `Address the evaluator's scoring area: ${criterion.criterion}.`,
      priority,
      evidenceRequired: true,
      evidenceStatus,
    })

    const rank = index + 1
    tenderPriorities.push({
      priorityClass: 'TENDER',
      title: criterion.criterion,
      description: criterion.description,
      sourceType: 'EVALUATION_CRITERION',
      sourceId: criterion.id,
      weight: criterion.weight,
      rank,
    })
    clientPriorities.push({
      priorityClass: 'CLIENT',
      title: criterion.criterion,
      description: criterion.description,
      sourceType: 'EVALUATION_CRITERION',
      sourceId: criterion.id,
      weight: criterion.weight,
      rank,
    })

    if (criterion.evidenceLinkCount === 0) {
      evidenceNeeds.push({
        sourceType: 'EVALUATION_CRITERION',
        sourceId: criterion.id,
        requirementId: null,
        evaluationCriterionId: criterion.id,
        description: `No agency evidence is linked to the evaluation criterion "${criterion.criterion}".`,
        minimumCount: 1,
        severity: isHighWeight ? 'CRITICAL' : weightKnown ? 'HIGH' : 'MEDIUM',
      })
    } else if (isHighWeight) {
      // Only claim a win theme where there is real linked evidence AND the
      // criterion is significant enough to be worth a strategic theme.
      winThemes.push({
        title: `Demonstrated strength: ${criterion.criterion}`,
        description: `Evaluation criterion "${criterion.criterion}" (weight ${criterion.weight}) has ${criterion.evidenceLinkCount} linked agency evidence record(s).`,
        sourceType: 'EVALUATION_CRITERION',
        sourceId: criterion.id,
        priority: 'HIGH',
        evidenceStatus,
      })
    }
  })

  const requirementPlans: RequirementPlanDraft[] = []
  const risks: RiskDraft[] = []

  const sortedRequirements = [...input.requirements].sort((a, b) => a.id.localeCompare(b.id))
  for (const requirement of sortedRequirements) {
    if (!requirement.mandatory) continue // Phase 12 §13: one plan per MEANINGFUL requirement — mandatory ones are always meaningful.

    const hasEvidence = requirement.qualificationEvidenceId !== null
    const responseType: RequirementPlanDraft['responseType'] =
      requirement.qualificationStatus === 'PASS' ? 'COMPLY' : requirement.qualificationStatus === 'FAIL' ? 'REQUIRES_HUMAN_REVIEW' : 'REQUIRES_HUMAN_REVIEW'

    requirementPlans.push({
      tenderRequirementId: requirement.id,
      responseType,
      responseStatus: 'NOT_STARTED',
      evidenceRequired: true,
      evidenceStatus: hasEvidence ? 'SUPPORTED' : 'EVIDENCE_REQUIRED',
      notes: null,
    })

    if (requirement.qualificationStatus !== 'PASS') {
      evidenceNeeds.push({
        sourceType: 'TENDER_REQUIREMENT',
        sourceId: requirement.id,
        requirementId: requirement.id,
        evaluationCriterionId: null,
        description: `Mandatory requirement "${requirement.requirementText}" is not yet a confirmed PASS (qualification status: ${requirement.qualificationStatus}).`,
        minimumCount: 1,
        severity: 'CRITICAL',
      })
      risks.push({
        title: 'Mandatory requirement not yet satisfied',
        description: requirement.requirementText,
        severity: 'CRITICAL',
        sourceType: 'TENDER_REQUIREMENT',
        sourceId: requirement.id,
        mitigation: null,
      })
    }
  }

  if (input.tenderClosingDate === null) {
    risks.push({ title: 'Tender closing date is unknown', description: 'The canonical closing date has not been resolved for this tender.', severity: 'MEDIUM', sourceType: 'CLOSING_DATE', sourceId: null, mitigation: null })
  }
  if (input.bidDecisionFinal === 'REVIEW') {
    risks.push({
      title: 'Bid pursued under REVIEW authorization',
      description: 'This Bid Project was created from a REVIEW final decision under explicit human authorization, not a clear system BID recommendation.',
      severity: 'MEDIUM',
      sourceType: 'BID_DECISION',
      sourceId: null,
      mitigation: null,
    })
  }
  if (input.qualificationOverallStatus === null || input.qualificationOverallStatus === 'UNKNOWN') {
    risks.push({ title: 'Overall qualification status is unresolved', description: null, severity: 'HIGH', sourceType: 'QUALIFICATION_RESULT', sourceId: null, mitigation: null })
  }

  const assumptions: AssumptionDraft[] = []
  if (input.opportunityScore !== null) {
    assumptions.push({ statement: `The opportunity score (${input.opportunityScore}) used to inform this strategy is assumed current as of generation time and must be re-checked if it changes.`, sourceType: 'OPPORTUNITY_SCORE', sourceId: null })
  }

  // Phase 12 §17: only create workstreams that real tender data actually
  // supports for THIS tender — never a blanket set for every project.
  const workstreams: WorkstreamDraft[] = [{ category: 'STRATEGY', name: 'Strategy', description: 'Strategic direction, win themes, and positioning.' }]
  if (input.requirements.length > 0) workstreams.push({ category: 'CONTENT', name: 'Content', description: 'Drafting responses to tender requirements.' })
  if (sortedRequirements.some((r) => r.mandatory)) workstreams.push({ category: 'COMPLIANCE', name: 'Compliance', description: 'Mandatory requirement compliance and documentation.' })
  if (evidenceNeeds.length > 0) workstreams.push({ category: 'CASE_STUDIES', name: 'Case Studies & Evidence', description: 'Sourcing agency evidence to close identified evidence needs.' })
  workstreams.push({ category: 'APPROVAL', name: 'Approval', description: 'Internal review and sign-off before submission.' })
  workstreams.push({ category: 'SUBMISSION', name: 'Submission', description: 'Final packaging and submission logistics.' })

  const mandatoryUnresolvedCount = sortedRequirements.filter((r) => r.mandatory && r.qualificationStatus !== 'PASS').length
  const evidenceGapCount = evidenceNeeds.length

  const objective = input.bidDecisionFinal === 'REVIEW' ? 'Pursue this bid under explicit REVIEW authorization while resolving outstanding review items.' : 'Win this tender by directly addressing the client\'s stated evaluation criteria with evidence-backed responses.'

  const strategySummary = `Generated from ${input.evaluationCriteria.length} evaluation criteria and ${sortedRequirements.filter((r) => r.mandatory).length} mandatory requirement(s). ${mandatoryUnresolvedCount} mandatory requirement(s) remain unresolved; ${evidenceGapCount} evidence need(s) identified.`

  return {
    objective,
    strategySummary,
    responseStrategySummary: `${requirementPlans.length} requirement response plan(s) created for mandatory requirements; response type defaults to REQUIRES_HUMAN_REVIEW unless qualification has already confirmed PASS.`,
    evidenceStrategySummary: `${evidenceNeeds.length} evidence need(s) identified from unlinked evaluation criteria and unresolved mandatory requirements. No evidence is auto-selected (Phase 13 scope).`,
    productionStrategySummary: `${workstreams.length} workstream(s) created based on the tender's actual requirement/evaluation profile.`,
    riskStrategySummary: `${risks.length} risk(s) identified deterministically from unresolved mandatory requirements, unknown closing date, unresolved qualification, and REVIEW-authorized pursuit.`,
    clientPriorities,
    tenderPriorities,
    winThemes,
    differentiators: [],
    evaluationStrategies,
    requirementPlans,
    evidenceNeeds,
    risks,
    assumptions,
    workstreams,
  }
}
