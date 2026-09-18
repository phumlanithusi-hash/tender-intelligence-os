import { z } from 'zod'
import {
  BID_PROJECT_STATUS,
  BID_PROJECT_PRIORITY,
  BID_STRATEGY_STATUS,
  BID_WIN_THEME_SOURCE_TYPE,
  BID_EVIDENCE_SUPPORT_STATUS,
  BID_PRIORITY_CLASS,
  BID_REQUIREMENT_RESPONSE_TYPE,
  BID_REQUIREMENT_RESPONSE_STATUS,
  BID_EVIDENCE_NEED_STATUS,
  BID_GAP_SEVERITY,
  BID_WORKSTREAM_CATEGORY,
  BID_TASK_TYPE,
  BID_TASK_STATUS,
  BID_MILESTONE_STATUS,
  BID_QUESTION_STATUS,
  BID_RISK_STATUS,
  BID_ASSUMPTION_STATUS,
  BID_READINESS_STATUS,
  BID_SOURCE_TYPE,
  BID_EFFORT_LEVEL,
} from '@tender-os/constants'

/** Phase 12 — mirrors shared/schemas/src/bidDecision.ts exactly. */

export const bidProjectStatusSchema = z.enum(BID_PROJECT_STATUS)
export const bidProjectPrioritySchema = z.enum(BID_PROJECT_PRIORITY)
export const bidStrategyStatusSchema = z.enum(BID_STRATEGY_STATUS)
export const bidEvidenceSupportStatusSchema = z.enum(BID_EVIDENCE_SUPPORT_STATUS)
export const bidSourceTypeSchema = z.enum(BID_SOURCE_TYPE)
export const bidGapSeveritySchema = z.enum(BID_GAP_SEVERITY)

export const bidProjectSchema = z.object({
  id: z.string().uuid(),
  tenderId: z.string().uuid(),
  agencyId: z.string().uuid(),
  projectName: z.string(),
  status: bidProjectStatusSchema,
  bidDecisionRunId: z.string().uuid().nullable(),
  currentStrategyVersion: z.number().int(),
  ownerUserId: z.string().uuid().nullable(),
  startDate: z.string().nullable(),
  targetSubmissionDate: z.string().nullable(),
  actualSubmissionDate: z.string().nullable(),
  priority: bidProjectPrioritySchema,
  bidEffort: z.enum(BID_EFFORT_LEVEL),
  overallScoreSnapshot: z.number().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  closedAt: z.string().nullable(),
})
export type BidProjectDto = z.infer<typeof bidProjectSchema>

export const bidStrategySchema = z.object({
  id: z.string().uuid(),
  bidProjectId: z.string().uuid(),
  agencyId: z.string().uuid(),
  version: z.number().int(),
  status: bidStrategyStatusSchema,
  objective: z.string().nullable(),
  strategySummary: z.string().nullable(),
  responseStrategySummary: z.string().nullable(),
  evidenceStrategySummary: z.string().nullable(),
  productionStrategySummary: z.string().nullable(),
  riskStrategySummary: z.string().nullable(),
  supersedesStrategyId: z.string().uuid().nullable(),
  isCurrent: z.boolean(),
  isStale: z.boolean(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  approvedBy: z.string().uuid().nullable(),
  approvedAt: z.string().nullable(),
})
export type BidStrategyDto = z.infer<typeof bidStrategySchema>

export const bidStrategyPrioritySchema = z.object({
  id: z.string().uuid().optional(),
  priorityClass: z.enum(BID_PRIORITY_CLASS),
  title: z.string(),
  description: z.string().nullable(),
  sourceType: bidSourceTypeSchema,
  sourceId: z.string().uuid().nullable(),
  weight: z.number().nullable(),
  rank: z.number().int().nullable(),
})

export const bidWinThemeSchema = z.object({
  id: z.string().uuid().optional(),
  bidProjectId: z.string().uuid(),
  strategyId: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  sourceType: z.enum(BID_WIN_THEME_SOURCE_TYPE),
  sourceId: z.string().uuid().nullable(),
  priority: bidGapSeveritySchema,
  evidenceStatus: bidEvidenceSupportStatusSchema,
  ownerUserId: z.string().uuid().nullable(),
})

export const bidDifferentiatorSchema = z.object({
  id: z.string().uuid().optional(),
  bidProjectId: z.string().uuid(),
  strategyId: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  evidenceStatus: bidEvidenceSupportStatusSchema,
  supportingEvidenceCount: z.number().int(),
  priority: bidGapSeveritySchema,
})

export const bidEvaluationStrategySchema = z.object({
  id: z.string().uuid().optional(),
  bidProjectId: z.string().uuid(),
  strategyId: z.string().uuid(),
  evaluationCriterionId: z.string().uuid(),
  strategy: z.string().nullable(),
  responseObjective: z.string().nullable(),
  priority: bidGapSeveritySchema,
  evidenceRequired: z.boolean(),
  evidenceStatus: bidEvidenceSupportStatusSchema,
  ownerUserId: z.string().uuid().nullable(),
})

export const bidRequirementPlanSchema = z.object({
  id: z.string().uuid().optional(),
  bidProjectId: z.string().uuid(),
  strategyId: z.string().uuid(),
  tenderRequirementId: z.string().uuid(),
  responseType: z.enum(BID_REQUIREMENT_RESPONSE_TYPE),
  responseStatus: z.enum(BID_REQUIREMENT_RESPONSE_STATUS),
  responseOwner: z.string().uuid().nullable(),
  evidenceRequired: z.boolean(),
  evidenceStatus: bidEvidenceSupportStatusSchema,
  notes: z.string().nullable(),
})

export const bidEvidenceNeedSchema = z.object({
  id: z.string().uuid().optional(),
  bidProjectId: z.string().uuid(),
  strategyId: z.string().uuid().nullable(),
  sourceType: bidSourceTypeSchema,
  sourceId: z.string().uuid().nullable(),
  requirementId: z.string().uuid().nullable(),
  evaluationCriterionId: z.string().uuid().nullable(),
  description: z.string(),
  minimumCount: z.number().int(),
  currentCount: z.number().int(),
  status: z.enum(BID_EVIDENCE_NEED_STATUS),
  severity: bidGapSeveritySchema,
  ownerUserId: z.string().uuid().nullable(),
  dueDate: z.string().nullable(),
})

export const bidWorkstreamSchema = z.object({
  id: z.string().uuid().optional(),
  bidProjectId: z.string().uuid(),
  category: z.enum(BID_WORKSTREAM_CATEGORY),
  name: z.string(),
  description: z.string().nullable(),
})

export const bidTaskSchema = z.object({
  id: z.string().uuid().optional(),
  bidProjectId: z.string().uuid(),
  workstreamId: z.string().uuid().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  taskType: z.enum(BID_TASK_TYPE),
  ownerUserId: z.string().uuid().nullable(),
  status: z.enum(BID_TASK_STATUS),
  priority: bidGapSeveritySchema,
  dueDate: z.string().nullable(),
  dependencyTaskId: z.string().uuid().nullable(),
  sourceType: bidSourceTypeSchema.nullable(),
  sourceId: z.string().uuid().nullable(),
  completedAt: z.string().nullable(),
})

export const createBidTaskRequestSchema = z.object({
  workstreamId: z.string().uuid().nullable().optional(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  taskType: z.enum(BID_TASK_TYPE),
  ownerUserId: z.string().uuid().nullable().optional(),
  priority: bidGapSeveritySchema.optional(),
  dueDate: z.string().nullable().optional(),
  dependencyTaskId: z.string().uuid().nullable().optional(),
})

export const bidMilestoneSchema = z.object({
  id: z.string().uuid().optional(),
  bidProjectId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  dueDate: z.string().nullable(),
  status: z.enum(BID_MILESTONE_STATUS),
  completedAt: z.string().nullable(),
})

export const bidQuestionSchema = z.object({
  id: z.string().uuid().optional(),
  bidProjectId: z.string().uuid(),
  question: z.string(),
  context: z.string().nullable(),
  sourceRequirementId: z.string().uuid().nullable(),
  sourceEvaluationCriterionId: z.string().uuid().nullable(),
  status: z.enum(BID_QUESTION_STATUS),
  assignedTo: z.string().uuid().nullable(),
  dueDate: z.string().nullable(),
  answer: z.string().nullable(),
  answerSource: z.string().nullable(),
})

export const createBidQuestionRequestSchema = z.object({
  question: z.string().min(1),
  context: z.string().nullable().optional(),
  sourceRequirementId: z.string().uuid().nullable().optional(),
  sourceEvaluationCriterionId: z.string().uuid().nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  dueDate: z.string().nullable().optional(),
})

export const bidRiskSchema = z.object({
  id: z.string().uuid().optional(),
  bidProjectId: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  severity: bidGapSeveritySchema,
  status: z.enum(BID_RISK_STATUS),
  sourceType: bidSourceTypeSchema,
  sourceId: z.string().uuid().nullable(),
  mitigation: z.string().nullable(),
  ownerUserId: z.string().uuid().nullable(),
  resolvedAt: z.string().nullable(),
})

export const bidAssumptionSchema = z.object({
  id: z.string().uuid().optional(),
  bidProjectId: z.string().uuid(),
  statement: z.string(),
  sourceType: bidSourceTypeSchema,
  sourceId: z.string().uuid().nullable(),
  status: z.enum(BID_ASSUMPTION_STATUS),
  createdBy: z.string().uuid().nullable(),
})

export const bidReadinessSchema = z.object({
  status: z.enum(BID_READINESS_STATUS),
  blockers: z.array(z.object({ code: z.string(), message: z.string(), sourceType: bidSourceTypeSchema, sourceId: z.string().nullable() })),
  warnings: z.array(z.object({ code: z.string(), message: z.string(), sourceType: bidSourceTypeSchema, sourceId: z.string().nullable() })),
  completedItems: z.array(z.string()),
  outstandingItems: z.array(z.string()),
  completeness: z.object({
    requirements: z.number(),
    evaluationCriteria: z.number(),
    evidenceNeeds: z.number(),
    tasks: z.number(),
    compliance: z.number(),
  }),
  calculatedAt: z.string(),
})
export type BidReadinessDto = z.infer<typeof bidReadinessSchema>

export const createBidProjectRequestSchema = z.object({
  projectName: z.string().min(1).optional(),
  authorizedFromReview: z.boolean().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  targetSubmissionDate: z.string().nullable().optional(),
  priority: bidProjectPrioritySchema.optional(),
})

export const updateBidProjectStatusRequestSchema = z.object({
  status: bidProjectStatusSchema,
})

export const approveStrategyRequestSchema = z.object({
  overrideBlockers: z.boolean().optional(),
  overrideReason: z.string().optional(),
})
