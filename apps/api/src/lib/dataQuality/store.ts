import type { DataQualityViolationRow } from '@tender-os/schemas'
import type { CompletenessBreakdown } from './completeness.js'

/**
 * Port interface (mirrors every other engine's store seam in this
 * codebase) so the scan/read logic is testable without a live
 * Supabase project.
 */
export interface DataQualityStore {
  /** Runs every deterministic rule against current data and persists any newly-detected OPEN violations (idempotent — re-running never duplicates an already-OPEN violation for the same rule+entity, spec §14). Returns every violation touched by this scan (newly created ones only — pre-existing OPEN violations are left as-is). */
  runScan(actorId: string | null): Promise<DataQualityViolationRow[]>
  listViolations(filter: { status?: string; severity?: string; agencyId?: string | null }): Promise<DataQualityViolationRow[]>
  resolveViolation(id: string, input: { status: 'RESOLVED' | 'DISMISSED'; resolution: string; resolvedBy: string }): Promise<DataQualityViolationRow>
  getCompletenessDashboard(agencyId: string): Promise<CompletenessBreakdown[]>
}
