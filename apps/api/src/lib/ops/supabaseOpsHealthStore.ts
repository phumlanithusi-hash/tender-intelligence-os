import type { SupabaseClient } from '@supabase/supabase-js'
import { buildOpsHealthDashboard, type OpsHealthDashboard } from './health.js'

/**
 * Real, live-computed aggregation over the tables every prior phase
 * already built (tender_sources/tender_source_scans — Phase 4;
 * tender_documents — Phase 6; tender_ai_runs — Phase 7;
 * agency_evidence_embeddings — Phase 13; tender_outcomes/
 * outcome_conflicts — Phase 17). Never a fabricated number — every
 * field is a real count of real rows at the moment of the call (same
 * discipline as getTenderSourceSummary, Phase 4 §14).
 */
export async function getOpsHealthDashboard(supabase: SupabaseClient, agencyId: string | null): Promise<OpsHealthDashboard> {
  const [
    { data: sources },
    { data: latestScan },
    { data: documents },
    { data: aiRuns },
    { count: embeddingFailures },
    { data: outcomes },
    { count: openConflicts },
    { count: scansQueued },
    { count: scansRunning },
    { count: scansFailed },
    { count: docsWithPath },
    { count: docsWithoutPath },
  ] = await Promise.all([
    supabase.from('tender_sources').select('active, adapter_key, health_status'),
    supabase.from('tender_source_scans').select('started_at').order('started_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('tender_documents').select('extraction_status'),
    supabase.from('tender_ai_runs').select('status'),
    supabase.from('agency_evidence_embeddings').select('id', { count: 'exact', head: true }).eq('status', 'FAILED'),
    supabase.from('tender_outcomes').select('truth_status').eq('is_current', true),
    supabase.from('outcome_conflicts').select('id', { count: 'exact', head: true }).eq('status', 'OPEN'),
    supabase.from('tender_source_scans').select('id', { count: 'exact', head: true }).eq('status', 'QUEUED'),
    supabase.from('tender_source_scans').select('id', { count: 'exact', head: true }).eq('status', 'RUNNING'),
    supabase.from('tender_source_scans').select('id', { count: 'exact', head: true }).eq('status', 'FAILED'),
    supabase.from('tender_documents').select('id', { count: 'exact', head: true }).not('storage_path', 'is', null),
    supabase.from('tender_documents').select('id', { count: 'exact', head: true }).is('storage_path', null),
  ])
  void agencyId // reserved: sources/documents/ai/outcomes summaries here are shared/catalogue-wide by design (mirrors the Source Registry summary, which is not agency-scoped either); agency-specific breakdowns are covered by the data-quality completeness dashboard instead.

  const sourceRows = (sources ?? []) as Array<{ active: boolean; adapter_key: string | null; health_status: string }>
  const documentRows = (documents ?? []) as Array<{ extraction_status: string }>
  const aiRunRows = (aiRuns ?? []) as Array<{ status: string }>
  const outcomeRows = (outcomes ?? []) as Array<{ truth_status: string }>

  const dashboard = buildOpsHealthDashboard(
    {
      sources: {
        totalSources: sourceRows.length,
        activeSources: sourceRows.filter((s) => s.active).length,
        healthySources: sourceRows.filter((s) => s.health_status === 'HEALTHY').length,
        warningSources: sourceRows.filter((s) => s.health_status === 'WARNING').length,
        failedSources: sourceRows.filter((s) => s.health_status === 'FAILED').length,
        notConnectedSources: sourceRows.filter((s) => s.adapter_key === null).length,
        lastScanAt: (latestScan?.started_at as string | undefined) ?? null,
      },
      documents: {
        queued: documentRows.filter((d) => d.extraction_status === 'PENDING').length,
        processing: 0, // no distinct "processing" extraction_status value exists (Phase 6 enum) — the pipeline runs synchronously in-request today (Known Limitation, no BullMQ), so nothing is ever observed mid-flight by a separate reader.
        completed: documentRows.filter((d) => d.extraction_status === 'EXTRACTED').length,
        failed: documentRows.filter((d) => d.extraction_status === 'FAILED').length,
        requiresReview: documentRows.filter((d) => d.extraction_status === 'NEEDS_REVIEW').length,
      },
      ai: {
        totalRuns: aiRunRows.length,
        failedRuns: aiRunRows.filter((r) => r.status === 'FAILED').length,
        requiresReviewRuns: aiRunRows.filter((r) => r.status === 'REQUIRES_REVIEW').length,
        embeddingFailures: embeddingFailures ?? 0,
      },
      outcomes: {
        verified: outcomeRows.filter((o) => o.truth_status === 'VERIFIED').length,
        unknown: outcomeRows.filter((o) => o.truth_status === 'UNKNOWN').length,
        conflicting: openConflicts ?? 0,
        requiresFollowUp: outcomeRows.filter((o) => o.truth_status === 'UNVERIFIED').length,
      },
      jobs: {
        queuedScans: scansQueued ?? 0,
        runningScans: scansRunning ?? 0,
        failedScans: scansFailed ?? 0,
      },
      storage: {
        documentsWithStoragePath: docsWithPath ?? 0,
        documentsMissingStoragePath: docsWithoutPath ?? 0,
      },
    },
    new Date().toISOString(),
  )

  return dashboard
}
