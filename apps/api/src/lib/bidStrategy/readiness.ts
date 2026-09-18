/**
 * Phase 12 §22/§23 — PURE, zero-I/O readiness engine. Never a
 * percentage-only score: `status` always wins over `completeness`
 * (a project at high completeness with one outstanding mandatory item
 * always reports BLOCKED, never a green "95% ready" figure alone).
 */

export type BidReadinessStatus = 'READY' | 'BLOCKED' | 'REVIEW'

export interface BidReadinessIssue {
  code: string
  message: string
  sourceType: string
  sourceId: string | null
}

export interface BidReadinessResult {
  status: BidReadinessStatus
  blockers: BidReadinessIssue[]
  warnings: BidReadinessIssue[]
  completedItems: string[]
  outstandingItems: string[]
  completeness: {
    requirements: number
    evaluationCriteria: number
    evidenceNeeds: number
    tasks: number
    compliance: number
  }
}

export interface BidReadinessInput {
  nowIso: string
  tenderClosingDate: string | null // ISO date or null
  briefingRequired: boolean
  briefingStatusResolved: boolean
  submissionRequirementsResolved: boolean
  criticalHumanReviewOutstanding: boolean
  mandatoryRequirements: Array<{ id: string; qualificationStatus: string }>
  requirementPlans: Array<{ tenderRequirementId: string; evidenceRequired: boolean; evidenceStatus: string; responseStatus: string }>
  evaluationCriteria: Array<{ id: string; weight: number | null }>
  evaluationStrategies: Array<{ evaluationCriterionId: string; strategy: string | null }>
  evidenceNeeds: Array<{ id: string; status: string; severity: string }>
  tasks: Array<{ id: string; status: string }>
}

function ratio(done: number, total: number): number {
  if (total === 0) return 1
  return Math.round((done / total) * 1000) / 1000
}

/** calculateBidReadiness(input): BidReadiness — Phase 12 §22, deterministic and pure. */
export function calculateBidReadiness(input: BidReadinessInput): BidReadinessResult {
  const blockers: BidReadinessIssue[] = []
  const warnings: BidReadinessIssue[] = []
  const completedItems: string[] = []
  const outstandingItems: string[] = []

  // Hard block: tender closed (Phase 12 §23).
  if (input.tenderClosingDate !== null) {
    const closing = new Date(`${input.tenderClosingDate}T23:59:59Z`).getTime()
    const now = new Date(input.nowIso).getTime()
    if (!Number.isNaN(closing) && !Number.isNaN(now) && now > closing) {
      blockers.push({ code: 'TENDER_CLOSED', message: 'The tender closing date has already passed.', sourceType: 'CLOSING_DATE', sourceId: null })
      outstandingItems.push('TENDER_CLOSED')
    }
  }

  // Hard block: mandatory requirement unresolved (qualification != PASS).
  let mandatoryDone = 0
  for (const req of input.mandatoryRequirements) {
    if (req.qualificationStatus === 'PASS') {
      mandatoryDone += 1
      completedItems.push(`REQUIREMENT_${req.id}`)
    } else {
      blockers.push({ code: 'MANDATORY_REQUIREMENT_UNRESOLVED', message: `Mandatory requirement ${req.id} is not a confirmed PASS (status: ${req.qualificationStatus}).`, sourceType: 'TENDER_REQUIREMENT', sourceId: req.id })
      outstandingItems.push(`REQUIREMENT_${req.id}`)
    }
  }
  const requirementsCompleteness = ratio(mandatoryDone, input.mandatoryRequirements.length)

  // Hard block: mandatory compliance evidence missing.
  let compliancePlansDone = 0
  const compliancePlansTotal = input.requirementPlans.filter((p) => p.evidenceRequired).length
  for (const plan of input.requirementPlans) {
    if (!plan.evidenceRequired) continue
    if (plan.evidenceStatus === 'SUPPORTED') {
      compliancePlansDone += 1
    } else {
      blockers.push({ code: 'MANDATORY_EVIDENCE_MISSING', message: `Requirement ${plan.tenderRequirementId} still requires compliance evidence.`, sourceType: 'TENDER_REQUIREMENT', sourceId: plan.tenderRequirementId })
      outstandingItems.push(`REQUIREMENT_EVIDENCE_${plan.tenderRequirementId}`)
    }
  }
  const complianceCompleteness = ratio(compliancePlansDone, compliancePlansTotal)

  // Hard block: required evaluation criterion has no response strategy.
  let evaluationDone = 0
  for (const criterion of input.evaluationCriteria) {
    const strategyItem = input.evaluationStrategies.find((s) => s.evaluationCriterionId === criterion.id)
    if (strategyItem && strategyItem.strategy && strategyItem.strategy.trim().length > 0) {
      evaluationDone += 1
      completedItems.push(`EVALUATION_${criterion.id}`)
    } else {
      blockers.push({ code: 'EVALUATION_CRITERION_NO_STRATEGY', message: `Evaluation criterion ${criterion.id} has no response strategy defined.`, sourceType: 'EVALUATION_CRITERION', sourceId: criterion.id })
      outstandingItems.push(`EVALUATION_${criterion.id}`)
    }
  }
  const evaluationCompleteness = ratio(evaluationDone, input.evaluationCriteria.length)

  // Hard block: critical evidence gap unresolved.
  let evidenceDone = 0
  for (const need of input.evidenceNeeds) {
    if (need.status === 'SATISFIED' || need.status === 'WAIVED') {
      evidenceDone += 1
      completedItems.push(`EVIDENCE_NEED_${need.id}`)
      continue
    }
    outstandingItems.push(`EVIDENCE_NEED_${need.id}`)
    if (need.severity === 'CRITICAL' && (need.status === 'OPEN' || need.status === 'BLOCKED')) {
      blockers.push({ code: 'CRITICAL_EVIDENCE_GAP', message: `A critical evidence gap (${need.id}) remains ${need.status}.`, sourceType: 'EVALUATION_CRITERION', sourceId: need.id })
    } else {
      warnings.push({ code: 'EVIDENCE_GAP', message: `Evidence need ${need.id} is not yet satisfied (${need.status}).`, sourceType: 'EVALUATION_CRITERION', sourceId: need.id })
    }
  }
  const evidenceCompleteness = ratio(evidenceDone, input.evidenceNeeds.length)

  // Hard block: submission requirement unresolved.
  if (!input.submissionRequirementsResolved) {
    blockers.push({ code: 'SUBMISSION_REQUIREMENT_UNRESOLVED', message: 'One or more submission requirements are not yet resolved.', sourceType: 'TENDER_REQUIREMENT', sourceId: null })
    outstandingItems.push('SUBMISSION_REQUIREMENTS')
  }

  // Hard block: compulsory briefing status unresolved.
  if (input.briefingRequired && !input.briefingStatusResolved) {
    blockers.push({ code: 'BRIEFING_STATUS_UNRESOLVED', message: 'A compulsory briefing is required and its attendance status is not yet confirmed.', sourceType: 'BRIEFING', sourceId: null })
    outstandingItems.push('BRIEFING_STATUS')
  }

  // Hard block: critical human review outstanding.
  if (input.criticalHumanReviewOutstanding) {
    blockers.push({ code: 'CRITICAL_HUMAN_REVIEW_OUTSTANDING', message: 'A critical human review item is still outstanding.', sourceType: 'HUMAN_DEFINED', sourceId: null })
    outstandingItems.push('CRITICAL_HUMAN_REVIEW')
  }

  const tasksDone = input.tasks.filter((t) => t.status === 'DONE').length
  const tasksCompleteness = ratio(tasksDone, input.tasks.length)
  for (const t of input.tasks) {
    if (t.status === 'DONE') completedItems.push(`TASK_${t.id}`)
    else outstandingItems.push(`TASK_${t.id}`)
  }

  // Readiness blockers ALWAYS override completeness (Phase 12 §22 binding
  // constraint) — a project can be arbitrarily complete and still BLOCKED.
  let status: BidReadinessStatus
  if (blockers.length > 0) status = 'BLOCKED'
  else if (warnings.length > 0) status = 'REVIEW'
  else status = 'READY'

  return {
    status,
    blockers,
    warnings,
    completedItems,
    outstandingItems,
    completeness: {
      requirements: requirementsCompleteness,
      evaluationCriteria: evaluationCompleteness,
      evidenceNeeds: evidenceCompleteness,
      tasks: tasksCompleteness,
      compliance: complianceCompleteness,
    },
  }
}
