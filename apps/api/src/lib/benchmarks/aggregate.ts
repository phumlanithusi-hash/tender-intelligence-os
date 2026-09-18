import { BENCHMARK_MIN_GROUP_SIZE, type BenchmarkMetricType } from '@tender-os/constants'

/**
 * Phase 20 §5/§20 4C — anonymized industry benchmark aggregation.
 * Pure, zero-I/O: every function here takes plain rows already
 * fetched by a caller (the Supabase-backed store) and returns
 * deterministic, anonymized statistics. Nothing here ever returns a
 * per-agency or per-bid value — only group-level distribution
 * statistics, and only once the group clears the k-anonymity floor
 * (spec §3 binding constraint: "k-anonymity >= 5").
 */

export interface CycleTimeFact {
  tenderId: string
  category: string | null
  region: string | null
  publishedDate: string | null
  decisionDate: string | null
  /** The distinct entity this data point is attributed to for k-anonymity purposes — the WINNING entity's registration number/name, never a bidding agency's identity. */
  distinctEntityKey: string | null
}

export interface PriceVarianceFact {
  tenderId: string
  category: string | null
  region: string | null
  awardValue: number | null
  distinctEntityKey: string | null
}

export interface VolumeFact {
  tenderId: string
  category: string | null
  region: string | null
  discoveredDate: string | null
}

export interface BenchmarkGroupKey {
  category: string | null
  region: string | null
  metricType: BenchmarkMetricType
}

export interface BenchmarkStatResult extends BenchmarkGroupKey {
  sampleSize: number
  p25: number | null
  p50: number | null
  p75: number | null
  mean: number | null
  stddev: number | null
  /** Whether this group cleared the k-anonymity floor and therefore has real statistics — false means every numeric field above is null/masked. */
  sufficientData: boolean
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0]!
  const idx = (sorted.length - 1) * p
  const lower = Math.floor(idx)
  const upper = Math.ceil(idx)
  if (lower === upper) return sorted[lower]!
  const weight = idx - lower
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight
}

function summarize(values: number[], distinctEntityCount: number, key: BenchmarkGroupKey, minGroupSize: number): BenchmarkStatResult {
  if (distinctEntityCount < minGroupSize || values.length === 0) {
    return { ...key, sampleSize: distinctEntityCount, p25: null, p50: null, p75: null, mean: null, stddev: null, sufficientData: false }
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  return {
    ...key,
    sampleSize: distinctEntityCount,
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    mean,
    stddev: Math.sqrt(variance),
    sufficientData: true,
  }
}

function groupKey(category: string | null, region: string | null): string {
  return `${category ?? '∅'}::${region ?? '∅'}`
}

/**
 * Public sector procurement cycle time (days from publication to
 * award), grouped by category+region. A fact with no publishedDate or
 * no decisionDate, or a negative span (bad data), is excluded rather
 * than fabricated.
 */
export function aggregateCycleTimes(facts: CycleTimeFact[], minGroupSize: number = BENCHMARK_MIN_GROUP_SIZE): BenchmarkStatResult[] {
  const groups = new Map<string, { key: BenchmarkGroupKey; days: number[]; entities: Set<string> }>()
  for (const fact of facts) {
    if (!fact.publishedDate || !fact.decisionDate) continue
    const days = (new Date(fact.decisionDate).getTime() - new Date(fact.publishedDate).getTime()) / 86_400_000
    if (!Number.isFinite(days) || days < 0) continue
    const gk = groupKey(fact.category, fact.region)
    if (!groups.has(gk)) groups.set(gk, { key: { category: fact.category, region: fact.region, metricType: 'CYCLE_DAYS' }, days: [], entities: new Set() })
    const g = groups.get(gk)!
    g.days.push(days)
    if (fact.distinctEntityKey) g.entities.add(fact.distinctEntityKey)
  }
  return [...groups.values()].map((g) => summarize(g.days, g.entities.size, g.key, minGroupSize))
}

/** Category-level award-value distribution ("price variance") — never exposes an individual bid's price, only the group's statistics once k-anonymity clears. */
export function aggregatePriceVariance(facts: PriceVarianceFact[], minGroupSize: number = BENCHMARK_MIN_GROUP_SIZE): BenchmarkStatResult[] {
  const groups = new Map<string, { key: BenchmarkGroupKey; values: number[]; entities: Set<string> }>()
  for (const fact of facts) {
    if (fact.awardValue === null || fact.awardValue < 0) continue
    const gk = groupKey(fact.category, fact.region)
    if (!groups.has(gk)) groups.set(gk, { key: { category: fact.category, region: fact.region, metricType: 'PRICE_VARIANCE' }, values: [], entities: new Set() })
    const g = groups.get(gk)!
    g.values.push(fact.awardValue)
    if (fact.distinctEntityKey) g.entities.add(fact.distinctEntityKey)
  }
  return [...groups.values()].map((g) => summarize(g.values, g.entities.size, g.key, minGroupSize))
}

/** Regional/category tender volume trend — the distinct entity here is the tender itself (one tender is one data point; k-anonymity protects against a region/category combination with too few distinct tenders being individually identifiable). */
export function aggregateVolume(facts: VolumeFact[], minGroupSize: number = BENCHMARK_MIN_GROUP_SIZE): BenchmarkStatResult[] {
  const groups = new Map<string, { key: BenchmarkGroupKey; tenderIds: Set<string> }>()
  for (const fact of facts) {
    const gk = groupKey(fact.category, fact.region)
    if (!groups.has(gk)) groups.set(gk, { key: { category: fact.category, region: fact.region, metricType: 'VOLUME' }, tenderIds: new Set() })
    groups.get(gk)!.tenderIds.add(fact.tenderId)
  }
  return [...groups.values()].map((g) => {
    const count = g.tenderIds.size
    if (count < minGroupSize) return { ...g.key, sampleSize: count, p25: null, p50: null, p75: null, mean: null, stddev: null, sufficientData: false }
    return { ...g.key, sampleSize: count, p25: count, p50: count, p75: count, mean: count, stddev: 0, sufficientData: true }
  })
}
