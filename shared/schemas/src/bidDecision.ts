import { z } from 'zod'
import { BID_RECOMMENDATION, BID_RULE_STATUS, BID_RULE_SEVERITY, BID_DECISION_PRECEDENCE_STEP, BID_EFFORT_LEVEL, BID_DECISION_RUN_STATUS, BID_DECISION_OUTCOME } from '@tender-os/constants'

export const bidRecommendationSchema = z.enum(BID_RECOMMENDATION)
export const bidRuleStatusSchema = z.enum(BID_RULE_STATUS)
export const bidRuleSeveritySchema = z.enum(BID_RULE_SEVERITY)
export const bidDecisionPrecedenceStepSchema = z.enum(BID_DECISION_PRECEDENCE_STEP)
export const bidEffortLevelSchema = z.enum(BID_EFFORT_LEVEL)
export const bidDecisionRunStatusSchema = z.enum(BID_DECISION_RUN_STATUS)
export const bidDecisionOutcomeSchema = z.enum(BID_DECISION_OUTCOME)

const ruleValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])

export const bidDecisionRuleResultSchema = z.object({
  id: z.string().uuid().optional(),
  ruleId: z.string(),
  precedenceStep: bidDecisionPrecedenceStepSchema,
  status: bidRuleStatusSchema,
  severity: bidRuleSeveritySchema,
  actualValue: ruleValueSchema.nullable(),
  expectedValue: ruleValueSchema.nullable(),
  explanation: z.string(),
})
export type BidDecisionRuleResultDto = z.infer<typeof bidDecisionRuleResultSchema>

export const bidDecisionRunSchema = z.object({
  id: z.string().uuid(),
  tenderId: z.string().uuid(),
  agencyId: z.string().uuid(),
  status: bidDecisionRunStatusSchema,
  bidPolicyVersionId: z.string().uuid(),
  scoringRunId: z.string().uuid().nullable(),
  systemDecision: bidRecommendationSchema.nullable(),
  humanDecision: bidRecommendationSchema.nullable(),
  finalDecision: bidRecommendationSchema.nullable(),
  overrideReason: z.string().nullable(),
  overriddenBy: z.string().uuid().nullable(),
  overriddenAt: z.string().nullable(),
  bidEffort: bidEffortLevelSchema,
  bidEffortExplanation: z.string().nullable(),
  decisionExplanation: z.string().nullable(),
  isCurrent: z.boolean(),
  isStale: z.boolean(),
  inputSnapshot: z.record(z.unknown()).default({}),
  error: z.string().nullable().optional(),
  createdAt: z.string(),
})
export type BidDecisionRunDto = z.infer<typeof bidDecisionRunSchema>

/** Phase 11 §46 — the full explainable response shape for GET/POST /api/tenders/:id/bid-decision. */
export const bidDecisionResponseSchema = z.object({
  run: bidDecisionRunSchema.nullable(),
  ruleResults: z.array(bidDecisionRuleResultSchema).default([]),
  blockers: z.array(bidDecisionRuleResultSchema).default([]),
  warnings: z.array(bidDecisionRuleResultSchema).default([]),
  unresolvedItems: z.array(bidDecisionRuleResultSchema).default([]),
  positiveFactors: z.array(z.string()).default([]),
  humanActionsRequired: z.array(z.string()).default([]),
})
export type BidDecisionResponseDto = z.infer<typeof bidDecisionResponseSchema>

const ruleThresholdSchema = <T extends z.ZodTypeAny>(value: T) =>
  z
    .object({
      active: z.boolean(),
      severity: bidRuleSeveritySchema,
      value,
    })
    .nullable()

export const bidPolicyVersionSchema = z.object({
  id: z.string().uuid(),
  policyId: z.string().uuid(),
  version: z.number().int(),
  precedence: z.array(bidDecisionPrecedenceStepSchema),
  hardGateOverrides: z.record(z.literal('REVIEW')).default({}),
  minimumOpportunityScore: ruleThresholdSchema(z.number().min(0).max(100)),
  minimumDataCompleteness: ruleThresholdSchema(z.number().min(0).max(1)),
  minimumRequirementCoverage: ruleThresholdSchema(z.number().min(0).max(100)),
  minimumEvidenceStrength: ruleThresholdSchema(z.number().min(0).max(100)),
  minimumEvaluationFit: ruleThresholdSchema(z.number().min(0).max(100)),
  minimumStrategicFit: ruleThresholdSchema(z.number().min(0).max(100)),
  minimumContractValue: ruleThresholdSchema(z.number().min(0)),
  preferredContractValue: z.number().min(0).nullable(),
  minimumPreparationDays: ruleThresholdSchema(z.number().min(0)),
  maximumPreparationDays: ruleThresholdSchema(z.number().min(0)),
  minimumExpectedMargin: ruleThresholdSchema(z.number()),
  maximumBidEffort: ruleThresholdSchema(bidEffortLevelSchema),
  preferredServices: z.array(z.string()).default([]),
  preferredSectors: z.array(z.string()).default([]),
  preferredOrganisationTypes: z.array(z.string()).default([]),
  preferredProvinces: z.array(z.string()).default([]),
  excludedOrganisationTypes: ruleThresholdSchema(z.array(z.string())),
  excludedSectors: ruleThresholdSchema(z.array(z.string())),
  unresolvedEvaluationConflict: ruleThresholdSchema(z.boolean()),
  unknownSeverity: z.record(z.enum(['REVIEW', 'CONTINUE'])),
  scoreBands: z.array(z.object({ min: z.number(), max: z.number(), label: z.string() })),
  isCurrent: z.boolean().optional(),
  createdAt: z.string().optional(),
})
export type BidPolicyVersionDto = z.infer<typeof bidPolicyVersionSchema>

export const bidDecisionOverrideRequestSchema = z.object({
  decision: bidRecommendationSchema,
  reason: z.string().trim().min(1, 'An override reason is required.'),
})
export type BidDecisionOverrideRequestDto = z.infer<typeof bidDecisionOverrideRequestSchema>
