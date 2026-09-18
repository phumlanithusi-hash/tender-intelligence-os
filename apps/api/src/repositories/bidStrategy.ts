import type { SupabaseClient } from '@supabase/supabase-js'
import { calculateBidReadiness, type BidReadinessInput } from '../lib/bidStrategy/readiness.js'
import { evaluateMilestoneAtRisk } from '../lib/bidStrategy/milestones.js'
import { isSnapshotStale } from '../lib/bidStrategy/staleness.js'

/**
 * Read-only repository over the Phase 12 bid-strategy tables, via the
 * caller's own RLS-scoped client — same split as
 * repositories/tenderBidDecision.ts vs
 * lib/bidDecision/supabaseBidDecisionStore.ts. All writes go through
 * lib/bidStrategy/supabaseBidStrategyStore.ts with the privileged
 * service-role client, only after routes/bidStrategy.ts has already
 * checked role + business rules.
 */

export async function listBidProjects(supabase: SupabaseClient, agencyId: string) {
  const { data, error } = await supabase.from('bid_strategy_projects').select('*').eq('agency_id', agencyId).order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function getBidProject(supabase: SupabaseClient, projectId: string) {
  const { data, error } = await supabase.from('bid_strategy_projects').select('*').eq('id', projectId).maybeSingle()
  if (error) throw error
  return data
}

export async function getCurrentStrategy(supabase: SupabaseClient, projectId: string) {
  const { data: strategy, error } = await supabase.from('bid_strategies').select('*').eq('bid_project_id', projectId).eq('is_current', true).maybeSingle()
  if (error) throw error
  if (!strategy) return null

  const [{ data: priorities }, { data: winThemes }, { data: differentiators }] = await Promise.all([
    supabase.from('bid_strategy_priorities').select('*').eq('strategy_id', strategy.id),
    supabase.from('bid_win_themes').select('*').eq('strategy_id', strategy.id),
    supabase.from('bid_differentiators').select('*').eq('strategy_id', strategy.id),
  ])

  return { strategy, priorities: priorities ?? [], winThemes: winThemes ?? [], differentiators: differentiators ?? [] }
}

export async function listStrategyHistory(supabase: SupabaseClient, projectId: string) {
  const { data, error } = await supabase.from('bid_strategies').select('*').eq('bid_project_id', projectId).order('version', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function getEvaluationStrategies(supabase: SupabaseClient, projectId: string) {
  const { data: items, error } = await supabase.from('bid_evaluation_strategies').select('*').eq('bid_project_id', projectId)
  if (error) throw error
  return items ?? []
}

export async function getRequirementPlans(supabase: SupabaseClient, projectId: string) {
  const { data, error } = await supabase.from('bid_requirement_plans').select('*').eq('bid_project_id', projectId)
  if (error) throw error
  return data ?? []
}

export async function getEvidenceNeeds(supabase: SupabaseClient, projectId: string) {
  const { data, error } = await supabase.from('bid_evidence_needs').select('*').eq('bid_project_id', projectId)
  if (error) throw error
  return data ?? []
}

export async function listTasks(supabase: SupabaseClient, projectId: string) {
  const { data, error } = await supabase.from('bid_tasks').select('*').eq('bid_project_id', projectId).order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function listMilestones(supabase: SupabaseClient, projectId: string) {
  const { data, error } = await supabase.from('bid_milestones').select('*').eq('bid_project_id', projectId).order('due_date', { ascending: true })
  if (error) throw error
  const now = new Date().toISOString()
  // Phase 12 §19 — AT_RISK/MISSED are computed live at read time, not
  // silently mutated on every read; a caller wanting the persisted
  // status updated should PATCH it explicitly (not implemented in this
  // phase — documented limitation).
  return (data ?? []).map((m) => ({ ...m, computed_status: evaluateMilestoneAtRisk(m.status, m.due_date, now) }))
}

export async function listQuestions(supabase: SupabaseClient, projectId: string) {
  const { data, error } = await supabase.from('bid_questions').select('*').eq('bid_project_id', projectId).order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function listRisks(supabase: SupabaseClient, projectId: string) {
  const { data, error } = await supabase.from('bid_risks').select('*').eq('bid_project_id', projectId).order('severity', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function listAssumptions(supabase: SupabaseClient, projectId: string) {
  const { data, error } = await supabase.from('bid_assumptions').select('*').eq('bid_project_id', projectId)
  if (error) throw error
  return data ?? []
}

export async function listWorkstreams(supabase: SupabaseClient, projectId: string) {
  const { data, error } = await supabase.from('bid_workstreams').select('*').eq('bid_project_id', projectId)
  if (error) throw error
  return data ?? []
}

/**
 * Phase 12 §22 — computed live (pure function) from the caller's own
 * RLS-scoped read of every input table, never persisted as a
 * percentage-only figure. `bid_readiness_snapshots` exists for future
 * audit-trail history but this phase computes fresh on every GET
 * (documented limitation — see docs/BID-STRATEGY-ENGINE.md).
 */
export async function computeReadiness(supabase: SupabaseClient, projectId: string) {
  const project = await getBidProject(supabase, projectId)
  if (!project) return null

  const [{ data: tender }, requirements, requirementPlans, { data: criteria }, evaluationStrategies, evidenceNeeds, tasks] = await Promise.all([
    supabase.from('tenders').select('closing_date, briefing_required').eq('id', project.tender_id).maybeSingle(),
    supabase.from('tender_requirements').select('id, mandatory, qualification_status').eq('tender_id', project.tender_id).eq('mandatory', true),
    getRequirementPlans(supabase, projectId),
    supabase.from('tender_evaluation_criteria').select('id, weight').eq('tender_id', project.tender_id),
    getEvaluationStrategies(supabase, projectId),
    getEvidenceNeeds(supabase, projectId),
    listTasks(supabase, projectId),
  ])

  const readinessInput: BidReadinessInput = {
    nowIso: new Date().toISOString(),
    tenderClosingDate: tender?.closing_date ?? null,
    briefingRequired: Boolean(tender?.briefing_required),
    // Phase 12 documented limitation: no dedicated briefing-attendance
    // tracking table exists yet (carried from Phase 11) — treated as
    // resolved only when briefing is not required, otherwise flagged
    // for human confirmation exactly like Phase 11's bid-effort inputs.
    briefingStatusResolved: !tender?.briefing_required,
    submissionRequirementsResolved: true,
    criticalHumanReviewOutstanding: false,
    mandatoryRequirements: (requirements.data ?? []).map((r) => ({ id: r.id, qualificationStatus: r.qualification_status })),
    requirementPlans: requirementPlans.map((p) => ({ tenderRequirementId: p.tender_requirement_id, evidenceRequired: p.evidence_required, evidenceStatus: p.evidence_status, responseStatus: p.response_status })),
    evaluationCriteria: (criteria ?? []).map((c) => ({ id: c.id, weight: c.weight })),
    evaluationStrategies: evaluationStrategies.map((e) => ({ evaluationCriterionId: e.evaluation_criterion_id, strategy: e.strategy })),
    evidenceNeeds: evidenceNeeds.map((n) => ({ id: n.id, status: n.status, severity: n.severity })),
    tasks: tasks.map((t) => ({ id: t.id, status: t.status })),
  }

  return calculateBidReadiness(readinessInput)
}

/** Phase 12 §21 — strategy staleness, same mechanism as Phase 10/11. */
export async function isCurrentStrategyStale(supabase: SupabaseClient, projectId: string, assembleFn: (projectId: string, tenderId: string, agencyId: string, version: number) => Promise<{ snapshot: Record<string, unknown> }>) {
  const project = await getBidProject(supabase, projectId)
  if (!project) return false
  const { data: strategy } = await supabase.from('bid_strategies').select('id, version, input_snapshot').eq('bid_project_id', projectId).eq('is_current', true).maybeSingle()
  if (!strategy) return false
  const { snapshot: currentSnapshot } = await assembleFn(projectId, project.tender_id, project.agency_id, strategy.version)
  return isSnapshotStale(strategy.input_snapshot ?? {}, currentSnapshot)
}
