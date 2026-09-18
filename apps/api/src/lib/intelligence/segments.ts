import { MIN_SEGMENT_SAMPLE_SIZE } from '@tender-os/constants'
import { sampleSizeCaveat } from '../outcomes/provenance.js'

/**
 * Phase 18 §17 — segmented performance analysis. Every segment carries
 * its own sample size, verified-outcome count, missing-data count, and
 * a metric — never presented as a strategic conclusion when the
 * sample is small (spec §17 "small samples never presented as
 * strategic conclusions").
 */
export interface SegmentObservation {
  segmentKey: string
  won: boolean | null // null = outcome not yet verified
}
export interface SegmentPerformanceRow {
  segmentKey: string
  sampleSize: number
  verifiedOutcomes: number
  missingOutcomes: number
  observedWinRate: number | null
  caveat: string | null
  insufficientSample: boolean
}

export function buildSegmentedPerformance(observations: SegmentObservation[]): SegmentPerformanceRow[] {
  const groups = new Map<string, SegmentObservation[]>()
  for (const o of observations) {
    const list = groups.get(o.segmentKey) ?? []
    list.push(o)
    groups.set(o.segmentKey, list)
  }
  return [...groups.entries()].map(([segmentKey, rows]) => {
    const verified = rows.filter((r) => r.won !== null)
    const won = verified.filter((r) => r.won === true).length
    return {
      segmentKey,
      sampleSize: rows.length,
      verifiedOutcomes: verified.length,
      missingOutcomes: rows.length - verified.length,
      observedWinRate: verified.length > 0 ? won / verified.length : null,
      caveat: sampleSizeCaveat(verified.length),
      insufficientSample: verified.length < MIN_SEGMENT_SAMPLE_SIZE,
    }
  })
}
