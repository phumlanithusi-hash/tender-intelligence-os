import { z } from 'zod'
import {
  QUALIFICATION_CHECK_STATUS,
  QUALIFICATION_MANDATORY_STATUS,
  QUALIFICATION_OVERALL_STATUS,
  QUALIFICATION_CATEGORY,
  QUALIFICATION_RULE_TYPE,
  QUALIFICATION_REQUIREMENT_STATUS,
  QUALIFICATION_EVALUATED_BY,
  QUALIFICATION_ACTION_PRIORITY,
  QUALIFICATION_ACTION_STATUS,
  QUALIFICATION_RUN_STATUS,
  AI_TRUTH_STATE,
} from '@tender-os/constants'

export const qualificationCheckStatusSchema = z.enum(QUALIFICATION_CHECK_STATUS)
export const qualificationMandatoryStatusSchema = z.enum(QUALIFICATION_MANDATORY_STATUS)
export const qualificationOverallStatusSchema = z.enum(QUALIFICATION_OVERALL_STATUS)
export const qualificationCategorySchema = z.enum(QUALIFICATION_CATEGORY)
export const qualificationRuleTypeSchema = z.enum(QUALIFICATION_RULE_TYPE)
export const qualificationRequirementStatusSchema = z.enum(QUALIFICATION_REQUIREMENT_STATUS)
export const qualificationEvaluatedBySchema = z.enum(QUALIFICATION_EVALUATED_BY)
export const qualificationActionPrioritySchema = z.enum(QUALIFICATION_ACTION_PRIORITY)
export const qualificationActionStatusSchema = z.enum(QUALIFICATION_ACTION_STATUS)
export const qualificationRunStatusSchema = z.enum(QUALIFICATION_RUN_STATUS)
export const qualificationSourceTruthSchema = z.enum(AI_TRUTH_STATE)

export const qualificationTenderEvidenceSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  documentVersionId: z.string().uuid().nullable(),
  pageId: z.string().uuid().nullable(),
  sectionId: z.string().uuid().nullable(),
  chunkId: z.string().uuid().nullable(),
  pageNumber: z.number().int().nullable(),
  evidenceText: z.string(),
})

export const qualificationAgencyEvidenceSchema = z.object({
  id: z.string().uuid(),
  agencyEvidenceId: z.string().uuid(),
  description: z.string().nullable(),
})

export const qualificationRequirementSchema = z.object({
  id: z.string().uuid(),
  tenderId: z.string().uuid(),
  category: qualificationCategorySchema,
  description: z.string(),
  mandatoryStatus: qualificationMandatoryStatusSchema,
  sourceTruth: qualificationSourceTruthSchema,
  requirementStatus: qualificationRequirementStatusSchema,
  ruleType: qualificationRuleTypeSchema.nullable(),
  ruleConfig: z.record(z.unknown()),
  version: z.number().int(),
  supersededBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type QualificationRequirementDto = z.infer<typeof qualificationRequirementSchema>

export const qualificationActionSchema = z.object({
  id: z.string().uuid(),
  requirementId: z.string().uuid(),
  description: z.string(),
  priority: qualificationActionPrioritySchema,
  dueDate: z.string().nullable(),
  status: qualificationActionStatusSchema,
  createdAt: z.string(),
})
export type QualificationActionDto = z.infer<typeof qualificationActionSchema>

export const qualificationResultSchema = z.object({
  id: z.string().uuid(),
  requirementId: z.string().uuid(),
  status: qualificationCheckStatusSchema,
  mandatory: z.boolean(),
  mandatoryStatus: qualificationMandatoryStatusSchema,
  explanation: z.string(),
  evaluatedBy: qualificationEvaluatedBySchema,
  confidence: z.number().min(0).max(1).nullable(),
  requiresHumanReview: z.boolean(),
  evaluatedAt: z.string(),
  tenderEvidence: z.array(qualificationTenderEvidenceSchema).default([]),
  agencyEvidence: z.array(qualificationAgencyEvidenceSchema).default([]),
  actions: z.array(qualificationActionSchema).default([]),
})
export type QualificationResultDto = z.infer<typeof qualificationResultSchema>

export const qualificationRunSchema = z.object({
  id: z.string().uuid(),
  tenderId: z.string().uuid(),
  agencyId: z.string().uuid(),
  status: qualificationRunStatusSchema,
  overallStatus: qualificationOverallStatusSchema.nullable(),
  mandatoryBlockerCount: z.number().int(),
  actionRequiredCount: z.number().int(),
  requiresReviewCount: z.number().int(),
  requirementCount: z.number().int(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type QualificationRunDto = z.infer<typeof qualificationRunSchema>

export const qualificationSchema = z.object({
  run: qualificationRunSchema.nullable(),
  results: z.array(qualificationResultSchema).default([]),
})
export type QualificationDto = z.infer<typeof qualificationSchema>

export const qualificationReviewSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  requirementId: z.string().uuid().nullable(),
  reviewerId: z.string().uuid(),
  decision: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
})
export type QualificationReviewDto = z.infer<typeof qualificationReviewSchema>

export const submitQualificationReviewSchema = z.object({
  requirementId: z.string().uuid().nullable().optional(),
  decision: z.string().min(1).max(200),
  note: z.string().max(4000).nullable().optional(),
})
