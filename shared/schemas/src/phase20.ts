import { z } from 'zod'

/** Phase 20 — audit_trail_events row shape (spec §20 4D/5). Append-only unified system audit records, correlated across the whole lineage of one entity chain (a bid project, a tender) by `correlation_id`. */
export const auditTrailEventSchema = z.object({
  id: z.string().uuid(),
  correlation_id: z.string().uuid(),
  agency_id: z.string().uuid().nullable(),
  stage: z.enum([
    'SOURCE_SCAN',
    'TENDER_IMPORT',
    'REQUIREMENT_EXTRACTION',
    'STRATEGY_GENERATION',
    'EVIDENCE_MATCH',
    'HUMAN_SIGNOFF',
    'SUBMISSION',
    'ADDENDUM_DETECTED',
    'ADDENDUM_ACKNOWLEDGED',
    'OUTCOME_RECORDED',
  ]),
  entity_type: z.string(),
  entity_id: z.string().uuid().nullable(),
  actor_type: z.enum(['USER', 'SYSTEM', 'AGENT']),
  actor_id: z.string().uuid().nullable(),
  agent_name: z.string().nullable(),
  summary: z.string(),
  detail: z.record(z.unknown()),
  created_at: z.string(),
})
export type AuditTrailEventRow = z.infer<typeof auditTrailEventSchema>

/** Phase 20 — industry_benchmarks_daily row shape (spec §20 4C/5). Fully anonymized: never carries an agency_id or any per-bid value; enforced server-side and by a DB check constraint that `sample_size >= 5`. */
export const industryBenchmarkSchema = z.object({
  id: z.string().uuid(),
  metric_date: z.string(),
  category: z.string().nullable(),
  region: z.string().nullable(),
  metric_type: z.enum(['CYCLE_DAYS', 'PRICE_VARIANCE', 'VOLUME']),
  sample_size: z.number().int(),
  p25: z.number().nullable(),
  p50: z.number().nullable(),
  p75: z.number().nullable(),
  mean: z.number().nullable(),
  stddev: z.number().nullable(),
  computed_at: z.string(),
})
export type IndustryBenchmarkRow = z.infer<typeof industryBenchmarkSchema>

/** A benchmark "slot" the UI asked for that did not clear the k-anonymity floor — the honest alternative to a fabricated/omitted value (spec §20 4C: "display INSUFFICIENT_BENCHMARK_DATA"). */
export const insufficientBenchmarkSchema = z.object({
  category: z.string().nullable(),
  region: z.string().nullable(),
  metric_type: z.enum(['CYCLE_DAYS', 'PRICE_VARIANCE', 'VOLUME']),
  status: z.literal('INSUFFICIENT_BENCHMARK_DATA'),
  sample_size: z.number().int(),
})
export type InsufficientBenchmark = z.infer<typeof insufficientBenchmarkSchema>

export const benchmarkQuerySchema = z.object({
  category: z.string().optional(),
  region: z.string().optional(),
  metricType: z.enum(['CYCLE_DAYS', 'PRICE_VARIANCE', 'VOLUME']).optional(),
})
