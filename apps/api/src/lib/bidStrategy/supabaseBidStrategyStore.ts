import type { SupabaseClient } from '@supabase/supabase-js'
import { buildBidStrategy } from './buildStrategy.js'
import { calculateBidReadiness, type BidReadinessInput } from './readiness.js'
import { isSnapshotStale } from './staleness.js'
import type { BidStrategyBuildInput } from './types.js'

const EVALUATION_WEIGHT_THRESHOLD = 20 // Phase 12 §27 — configurable seam; a single agency-wide constant for now (documented limitation).

/**
 * Service-role store for the Phase 12 Bid Strategy engine, mirroring
 * lib/bidDecision/supabaseBidDecisionStore.ts exactly. Every write
 * here goes through the privileged client and is only ever reached
 * after routes/bidStrategy.ts has already checked role + business
 * rules (project-creation gate, approval blockers, immutability).
 */
export function createSupabaseBidStrategyStore(supabase: SupabaseClient) {
  async function fetchBidDecisionRun(tenderId: string, agencyId: string) {
    const { data, error } = await supabase.from('bid_decision_runs').select('*').eq('tender_id', tenderId).eq('agency_id', agencyId).eq('is_current', true).maybeSingle()
    if (error) throw error
    return data
  }

  async function fetchTender(tenderId: string) {
    const { data, error } = await supabase.from('tenders').select('id, closing_date, briefing_required').eq('id', tenderId).maybeSingle()
    if (error) throw error
    return data
  }

  async function fetchQualification(tenderId: string, agencyId: string) {
    const { data, error } = await supabase.from('tender_qualification_runs').select('overall_status').eq('tender_id', tenderId).eq('agency_id', agencyId).eq('is_current', true).maybeSingle()
    if (error) throw error
    return data
  }

  async function fetchOpportunityScore(tenderId: string, agencyId: string) {
    const { data, error } = await supabase.from('tender_scoring_runs').select('id, total_score').eq('tender_id', tenderId).eq('agency_id', agencyId).eq('is_current', true).maybeSingle()
    if (error) throw error
    return data
  }

  async function fetchRequirements(tenderId: string) {
    const { data, error } = await supabase.from('tender_requirements').select('id, requirement_type, requirement_text, mandatory, qualification_status, qualification_evidence_id').eq('tender_id', tenderId)
    if (error) throw error
    return data ?? []
  }

  async function fetchEvaluationCriteria(tenderId: string, agencyId: string) {
    const { data: criteria, error } = await supabase.from('tender_evaluation_criteria').select('id, criterion, description, weight').eq('tender_id', tenderId)
    if (error) throw error
    const criterionIds = (criteria ?? []).map((c) => c.id)
    let linkCounts = new Map<string, number>()
    if (criterionIds.length > 0) {
      const { data: links, error: linkErr } = await supabase.from('tender_evaluation_criterion_agency_evidence').select('criterion_id').eq('agency_id', agencyId).in('criterion_id', criterionIds)
      if (linkErr) throw linkErr
      linkCounts = (links ?? []).reduce((map, row) => map.set(row.criterion_id, (map.get(row.criterion_id) ?? 0) + 1), new Map<string, number>())
    }
    return (criteria ?? []).map((c) => ({ ...c, evidenceLinkCount: linkCounts.get(c.id) ?? 0 }))
  }

  /** Phase 12 §21 staleness snapshot — everything the strategy was generated from. */
  async function assembleBuildInput(bidProjectId: string, tenderId: string, agencyId: string, version: number): Promise<{ input: BidStrategyBuildInput; snapshot: Record<string, unknown> }> {
    const [tender, qualification, opportunityScore, requirements, evaluationCriteria, decisionRun] = await Promise.all([
      fetchTender(tenderId),
      fetchQualification(tenderId, agencyId),
      fetchOpportunityScore(tenderId, agencyId),
      fetchRequirements(tenderId),
      fetchEvaluationCriteria(tenderId, agencyId),
      fetchBidDecisionRun(tenderId, agencyId),
    ])

    const input: BidStrategyBuildInput = {
      tenderId,
      agencyId,
      bidProjectId,
      version,
      evaluationWeightThreshold: EVALUATION_WEIGHT_THRESHOLD,
      tenderClosingDate: tender?.closing_date ?? null,
      briefingRequired: Boolean(tender?.briefing_required),
      qualificationOverallStatus: qualification?.overall_status ?? null,
      requirements: requirements.map((r) => ({
        id: r.id,
        requirementType: r.requirement_type,
        requirementText: r.requirement_text,
        mandatory: r.mandatory,
        qualificationStatus: r.qualification_status,
        qualificationEvidenceId: r.qualification_evidence_id,
      })),
      evaluationCriteria: evaluationCriteria.map((c) => ({ id: c.id, criterion: c.criterion, description: c.description, weight: c.weight, evidenceLinkCount: c.evidenceLinkCount })),
      opportunityScore: opportunityScore?.total_score ?? null,
      bidDecisionFinal: (decisionRun?.final_decision as BidStrategyBuildInput['bidDecisionFinal']) ?? null,
      bidEffort: (decisionRun?.bid_effort as BidStrategyBuildInput['bidEffort']) ?? 'UNKNOWN',
    }

    const snapshot = {
      tenderClosingDate: input.tenderClosingDate,
      briefingRequired: input.briefingRequired,
      qualificationOverallStatus: input.qualificationOverallStatus,
      requirements: input.requirements,
      evaluationCriteria: input.evaluationCriteria,
      opportunityScore: input.opportunityScore,
      bidDecisionRunId: decisionRun?.id ?? null,
      bidDecisionFinal: input.bidDecisionFinal,
      bidEffort: input.bidEffort,
    }

    return { input, snapshot }
  }

  async function writeAuditEvent(event: { eventType: string; agencyId: string; actorId: string | null; entityId: string; oldValue: unknown; newValue: unknown }) {
    const { error } = await supabase.from('audit_logs').insert({
      agency_id: event.agencyId,
      actor_id: event.actorId,
      actor_type: 'USER',
      event_type: event.eventType,
      entity_type: 'bid_strategy',
      entity_id: event.entityId,
      old_value: event.oldValue as never,
      new_value: event.newValue as never,
    })
    if (error) throw error
  }

  return {
    fetchBidDecisionRun,
    assembleBuildInput,
    writeAuditEvent,

    async createBidProject(input: { tenderId: string; agencyId: string; decisionRunId: string; projectName: string; ownerUserId: string | null; targetSubmissionDate: string | null; priority: string; createdBy: string | null }) {
      const { data, error } = await supabase
        .from('bid_strategy_projects')
        .insert({
          tender_id: input.tenderId,
          agency_id: input.agencyId,
          bid_decision_run_id: input.decisionRunId,
          project_name: input.projectName,
          owner_user_id: input.ownerUserId,
          target_submission_date: input.targetSubmissionDate,
          priority: input.priority,
          created_by: input.createdBy,
        })
        .select('*')
        .single()
      if (error) throw error
      await writeAuditEvent({ eventType: 'BID_PROJECT_CREATED', agencyId: input.agencyId, actorId: input.createdBy, entityId: data.id, oldValue: null, newValue: { tenderId: input.tenderId, decisionRunId: input.decisionRunId } })
      return data
    },

    async transitionProjectStatus(projectId: string, agencyId: string, fromStatus: string, toStatus: string, actorId: string | null) {
      const { data, error } = await supabase.from('bid_strategy_projects').update({ status: toStatus, closed_at: toStatus === 'CLOSED' ? new Date().toISOString() : undefined }).eq('id', projectId).select('*').single()
      if (error) throw error
      await supabase.from('bid_strategy_project_status_history').insert({ bid_project_id: projectId, from_status: fromStatus, to_status: toStatus, changed_by: actorId })
      await writeAuditEvent({ eventType: 'BID_PROJECT_STATUS_CHANGED', agencyId, actorId, entityId: projectId, oldValue: { status: fromStatus }, newValue: { status: toStatus } })
      return data
    },

    /**
     * Phase 12 §27/§7 — generates a brand-new strategy version from a
     * pure, zero-I/O build (buildBidStrategy), then persists it plus
     * every relational child row. Never mutates a prior version;
     * always inserts new rows and flips is_current.
     */
    async generateStrategy(projectId: string, tenderId: string, agencyId: string, actorId: string | null) {
      const { data: previous } = await supabase.from('bid_strategies').select('id, version').eq('bid_project_id', projectId).eq('is_current', true).maybeSingle()
      const nextVersion = (previous?.version ?? 0) + 1

      const { input, snapshot } = await assembleBuildInput(projectId, tenderId, agencyId, nextVersion)
      const draft = buildBidStrategy(input)

      if (previous) {
        await supabase.from('bid_strategies').update({ is_current: false }).eq('id', previous.id)
      }

      const { data: strategy, error: stratErr } = await supabase
        .from('bid_strategies')
        .insert({
          bid_project_id: projectId,
          agency_id: agencyId,
          version: nextVersion,
          objective: draft.objective,
          strategy_summary: draft.strategySummary,
          response_strategy_summary: draft.responseStrategySummary,
          evidence_strategy_summary: draft.evidenceStrategySummary,
          production_strategy_summary: draft.productionStrategySummary,
          risk_strategy_summary: draft.riskStrategySummary,
          supersedes_strategy_id: previous?.id ?? null,
          input_snapshot: snapshot,
          created_by: actorId,
        })
        .select('*')
        .single()
      if (stratErr) throw stratErr

      const strategyId = strategy.id

      await Promise.all([
        supabase.from('bid_strategy_priorities').insert(
          [...draft.clientPriorities, ...draft.tenderPriorities].map((p) => ({
            bid_project_id: projectId,
            strategy_id: strategyId,
            priority_class: p.priorityClass,
            title: p.title,
            description: p.description,
            source_type: p.sourceType,
            source_id: p.sourceId,
            weight: p.weight,
            rank: p.rank,
          })),
        ),
        draft.winThemes.length
          ? supabase.from('bid_win_themes').insert(
              draft.winThemes.map((w) => ({ bid_project_id: projectId, strategy_id: strategyId, title: w.title, description: w.description, source_type: w.sourceType, source_id: w.sourceId, priority: w.priority, evidence_status: w.evidenceStatus })),
            )
          : Promise.resolve(),
        draft.evaluationStrategies.length
          ? supabase.from('bid_evaluation_strategies').insert(
              draft.evaluationStrategies.map((e) => ({
                bid_project_id: projectId,
                strategy_id: strategyId,
                evaluation_criterion_id: e.evaluationCriterionId,
                strategy: e.strategy,
                response_objective: e.responseObjective,
                priority: e.priority,
                evidence_required: e.evidenceRequired,
                evidence_status: e.evidenceStatus,
              })),
            )
          : Promise.resolve(),
        draft.requirementPlans.length
          ? supabase.from('bid_requirement_plans').insert(
              draft.requirementPlans.map((r) => ({
                bid_project_id: projectId,
                strategy_id: strategyId,
                tender_requirement_id: r.tenderRequirementId,
                response_type: r.responseType,
                response_status: r.responseStatus,
                evidence_required: r.evidenceRequired,
                evidence_status: r.evidenceStatus,
                notes: r.notes,
              })),
            )
          : Promise.resolve(),
        draft.evidenceNeeds.length
          ? supabase.from('bid_evidence_needs').insert(
              draft.evidenceNeeds.map((n) => ({
                bid_project_id: projectId,
                strategy_id: strategyId,
                source_type: n.sourceType,
                source_id: n.sourceId,
                requirement_id: n.requirementId,
                evaluation_criterion_id: n.evaluationCriterionId,
                description: n.description,
                minimum_count: n.minimumCount,
                severity: n.severity,
              })),
            )
          : Promise.resolve(),
        draft.risks.length
          ? supabase.from('bid_risks').insert(draft.risks.map((r) => ({ bid_project_id: projectId, title: r.title, description: r.description, severity: r.severity, source_type: r.sourceType, source_id: r.sourceId, mitigation: r.mitigation })))
          : Promise.resolve(),
        draft.assumptions.length
          ? supabase.from('bid_assumptions').insert(draft.assumptions.map((a) => ({ bid_project_id: projectId, statement: a.statement, source_type: a.sourceType, source_id: a.sourceId, created_by: actorId })))
          : Promise.resolve(),
        ...draft.workstreams.map((w) => supabase.from('bid_workstreams').upsert({ bid_project_id: projectId, category: w.category, name: w.name, description: w.description }, { onConflict: 'bid_project_id,category' })),
      ])

      await supabase.from('bid_strategy_projects').update({ current_strategy_version: nextVersion }).eq('id', projectId)

      await writeAuditEvent({ eventType: previous ? 'BID_STRATEGY_REGENERATED' : 'BID_STRATEGY_CREATED', agencyId, actorId, entityId: strategyId, oldValue: previous ? { previousStrategyId: previous.id } : null, newValue: { version: nextVersion } })
      if (previous) {
        await writeAuditEvent({ eventType: 'BID_STRATEGY_SUPERSEDED', agencyId, actorId, entityId: previous.id, oldValue: null, newValue: { supersededBy: strategyId } })
      }

      return { strategyId, version: nextVersion }
    },

    async approveStrategy(strategyId: string, agencyId: string, actorId: string) {
      const { data, error } = await supabase.from('bid_strategies').update({ status: 'APPROVED', approved_by: actorId, approved_at: new Date().toISOString() }).eq('id', strategyId).select('*').single()
      if (error) throw error
      await writeAuditEvent({ eventType: 'BID_STRATEGY_APPROVED', agencyId, actorId, entityId: strategyId, oldValue: null, newValue: { approvedBy: actorId } })
      return data
    },

    async computeAndSaveReadiness(projectId: string, agencyId: string, readinessInput: BidReadinessInput, actorId: string | null) {
      const result = calculateBidReadiness(readinessInput)
      const { error } = await supabase.from('bid_readiness_snapshots').insert({
        bid_project_id: projectId,
        status: result.status,
        blockers: result.blockers,
        warnings: result.warnings,
        completed_items: result.completedItems,
        outstanding_items: result.outstandingItems,
        completeness: result.completeness,
      })
      if (error) throw error
      await writeAuditEvent({ eventType: 'BID_READINESS_RECALCULATED', agencyId, actorId, entityId: projectId, oldValue: null, newValue: { status: result.status, blockerCount: result.blockers.length } })
      return result
    },

    async createTask(projectId: string, agencyId: string, task: Record<string, unknown>, actorId: string | null) {
      const { data, error } = await supabase.from('bid_tasks').insert({ bid_project_id: projectId, ...task }).select('*').single()
      if (error) throw error
      await writeAuditEvent({ eventType: 'BID_TASK_CREATED', agencyId, actorId, entityId: data.id, oldValue: null, newValue: task })
      return data
    },

    async createQuestion(projectId: string, agencyId: string, question: Record<string, unknown>, actorId: string | null) {
      const { data, error } = await supabase.from('bid_questions').insert({ bid_project_id: projectId, created_by: actorId, ...question }).select('*').single()
      if (error) throw error
      await writeAuditEvent({ eventType: 'BID_QUESTION_CREATED', agencyId, actorId, entityId: data.id, oldValue: null, newValue: question })
      return data
    },

    isStrategyStale(storedSnapshot: Record<string, unknown>, currentSnapshot: Record<string, unknown>) {
      return isSnapshotStale(storedSnapshot, currentSnapshot)
    },
  }
}

export type SupabaseBidStrategyStore = ReturnType<typeof createSupabaseBidStrategyStore>
