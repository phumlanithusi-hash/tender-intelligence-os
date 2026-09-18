import type { SupabaseClient } from '@supabase/supabase-js'
import { BENCHMARK_MIN_GROUP_SIZE } from '@tender-os/constants'
import { industryBenchmarkSchema, type IndustryBenchmarkRow, type InsufficientBenchmark } from '@tender-os/schemas'
import { aggregateCycleTimes, aggregatePriceVariance, aggregateVolume, type CycleTimeFact, type PriceVarianceFact, type VolumeFact } from './aggregate.js'

/**
 * Phase 20 §4C — recomputes `industry_benchmarks_daily` from the real
 * `tender_outcomes`/`tenders` tables (never fabricated, never a
 * per-agency value) and materializes the result, upserting one row
 * per (metric_date, category, region, metric_type). Only ADMIN may
 * trigger this (routes/intelligence.ts benchmarks endpoints).
 */
export async function recomputeIndustryBenchmarks(supabase: SupabaseClient): Promise<IndustryBenchmarkRow[]> {
  const { data: outcomes, error: outcomesError } = await supabase
    .from('tender_outcomes')
    .select('tender_id, published_date, decision_date, award_value, winner_registration_number, winner_name, is_current')
    .eq('is_current', true)
  if (outcomesError) throw outcomesError

  const tenderIds = [...new Set((outcomes ?? []).map((o) => o.tender_id as string))]
  const { data: tenders, error: tendersError } =
    tenderIds.length > 0
      ? await supabase.from('tenders').select('id, category, province, discovered_at').in('id', tenderIds)
      : { data: [], error: null }
  if (tendersError) throw tendersError
  const tenderById = new Map((tenders ?? []).map((t) => [t.id as string, t]))

  const cycleFacts: CycleTimeFact[] = []
  const priceFacts: PriceVarianceFact[] = []
  for (const o of outcomes ?? []) {
    const tender = tenderById.get(o.tender_id as string)
    const category = (tender?.category as string | null) ?? null
    const region = (tender?.province as string | null) ?? null
    const distinctEntityKey = (o.winner_registration_number as string | null) ?? (o.winner_name as string | null) ?? null
    cycleFacts.push({
      tenderId: o.tender_id as string,
      category,
      region,
      publishedDate: o.published_date as string | null,
      decisionDate: o.decision_date as string | null,
      distinctEntityKey,
    })
    priceFacts.push({
      tenderId: o.tender_id as string,
      category,
      region,
      awardValue: (o.award_value as number | null) ?? null,
      distinctEntityKey,
    })
  }

  // Volume: EVERY tender (not just those with a recorded outcome) —
  // this metric answers "how many tenders came through this category/
  // region", independent of whether any outcome is known yet.
  const { data: allTenders, error: allTendersError } = await supabase.from('tenders').select('id, category, province, discovered_at')
  if (allTendersError) throw allTendersError
  const volumeFacts: VolumeFact[] = (allTenders ?? []).map((t) => ({
    tenderId: t.id as string,
    category: (t.category as string | null) ?? null,
    region: (t.province as string | null) ?? null,
    discoveredDate: (t.discovered_at as string | null) ?? null,
  }))

  const results = [
    ...aggregateCycleTimes(cycleFacts, BENCHMARK_MIN_GROUP_SIZE),
    ...aggregatePriceVariance(priceFacts, BENCHMARK_MIN_GROUP_SIZE),
    ...aggregateVolume(volumeFacts, BENCHMARK_MIN_GROUP_SIZE),
  ]

  const metricDate = new Date().toISOString().slice(0, 10)
  const written: IndustryBenchmarkRow[] = []
  for (const r of results) {
    const { data, error } = await supabase
      .from('industry_benchmarks_daily')
      .upsert(
        {
          metric_date: metricDate,
          category: r.category,
          region: r.region,
          metric_type: r.metricType,
          sample_size: r.sampleSize,
          p25: r.sufficientData ? r.p25 : null,
          p50: r.sufficientData ? r.p50 : null,
          p75: r.sufficientData ? r.p75 : null,
          mean: r.sufficientData ? r.mean : null,
          stddev: r.sufficientData ? r.stddev : null,
          computed_at: new Date().toISOString(),
        },
        { onConflict: 'metric_date,category,region,metric_type' },
      )
      .select('*')
      .single()
    if (error) throw error
    written.push(industryBenchmarkSchema.parse(data))
  }
  return written
}

export interface BenchmarkQueryFilter {
  category?: string
  region?: string
  metricType?: 'CYCLE_DAYS' | 'PRICE_VARIANCE' | 'VOLUME'
}

/**
 * Reads the most recently computed benchmark row per (category,
 * region, metric_type), converting any row below the k-anonymity
 * floor into the honest `INSUFFICIENT_BENCHMARK_DATA` shape rather
 * than ever returning a zero/null-filled row indistinguishable from
 * "no data was ever computed" (spec §4C).
 */
export async function listIndustryBenchmarks(
  supabase: SupabaseClient,
  filter: BenchmarkQueryFilter,
): Promise<Array<IndustryBenchmarkRow | InsufficientBenchmark>> {
  let query = supabase.from('industry_benchmarks_daily').select('*').order('metric_date', { ascending: false })
  if (filter.category) query = query.eq('category', filter.category)
  if (filter.region) query = query.eq('region', filter.region)
  if (filter.metricType) query = query.eq('metric_type', filter.metricType)
  const { data, error } = await query
  if (error) throw error

  // Keep only the most recent metric_date per (category, region,
  // metric_type) group.
  const latestByGroup = new Map<string, Record<string, unknown>>()
  for (const row of data ?? []) {
    const key = `${row.category ?? '∅'}::${row.region ?? '∅'}::${row.metric_type}`
    if (!latestByGroup.has(key)) latestByGroup.set(key, row)
  }

  return [...latestByGroup.values()].map((row) => {
    const parsed = industryBenchmarkSchema.parse(row)
    if (parsed.sample_size < BENCHMARK_MIN_GROUP_SIZE) {
      return {
        category: parsed.category,
        region: parsed.region,
        metric_type: parsed.metric_type,
        status: 'INSUFFICIENT_BENCHMARK_DATA' as const,
        sample_size: parsed.sample_size,
      }
    }
    return parsed
  })
}
