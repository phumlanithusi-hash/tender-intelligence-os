import type { SupabaseClient } from '@supabase/supabase-js'
import type { ScoringStore, ScoringConfigurationRecord, ScoringRunRecord } from './store.js'
import type { ScoringInput, ScoringConfiguration, ScoredComponent, ScoredGate, ScoringEvidenceRef, AgencyEvidenceStateInput, EvidenceLinkInput } from './types.js'
import type { EvidenceStrengthState } from '@tender-os/constants'
import { DEFAULT_SCORING_CONFIGURATION } from './defaultConfig.js'

function evidenceStateFromEvidenceStatus(status: string | null | undefined): EvidenceStrengthState {
  switch (status) {
    case 'VERIFIED':
      return 'VERIFIED'
    case 'INFERRED':
    case 'UNVERIFIED':
      return 'UNVERIFIED'
    default:
      return 'UNKNOWN'
  }
}

function evidenceStateFromLifecycleStatus(status: string | null | undefined): EvidenceStrengthState {
  switch (status) {
    case 'VALID':
      return 'VERIFIED'
    case 'EXPIRED':
      return 'EXPIRED'
    case 'MISSING':
    case 'REJECTED':
      return 'MISSING'
    case 'PENDING_VERIFICATION':
      return 'UNVERIFIED'
    default:
      return 'UNKNOWN'
  }
}

/**
 * Production `ScoringStore` over the privileged service-role Supabase
 * client, same convention as `createSupabaseQualificationStore`. All
 * writes bypass RLS — never called with a browser-scoped client.
 *
 * KNOWN LIMITATIONS carried into this store (documented in
 * docs/SCORING-ENGINE.md, not silently fixed here):
 *  - Briefing attendance has no dedicated tracking table yet (same gap
 *    Phase 8's own store has) — always reported UNKNOWN.
 *  - Geographic FK resolution on the tender side remains textual/lite
 *    (Phase 7/8 §21/§42 carried forward unchanged).
 */
export function createSupabaseScoringStore(supabase: SupabaseClient): ScoringStore {
  async function getCurrentConfiguration(name = 'default'): Promise<ScoringConfigurationRecord> {
    const { data: cfg, error: cfgErr } = await supabase.from('scoring_configurations').select('id').eq('name', name).maybeSingle()
    if (cfgErr) throw cfgErr
    if (!cfg) return { versionId: DEFAULT_SCORING_CONFIGURATION.id, config: DEFAULT_SCORING_CONFIGURATION }

    const { data: version, error: verErr } = await supabase.from('scoring_configuration_versions').select('*').eq('configuration_id', cfg.id).eq('is_current', true).maybeSingle()
    if (verErr) throw verErr
    if (!version) return { versionId: DEFAULT_SCORING_CONFIGURATION.id, config: DEFAULT_SCORING_CONFIGURATION }

    const config: ScoringConfiguration = {
      id: version.id,
      version: version.version,
      dimensionWeights: version.dimension_weights,
      qualificationStatusScoreMap: version.qualification_status_score_map,
      requirementCoverageValueMap: version.requirement_coverage_value_map,
      evaluationFitValueMap: version.evaluation_fit_value_map,
      evidenceStateValueMap: version.evidence_state_value_map,
      decisionBands: version.decision_bands,
      dataCompletenessInsufficientThreshold: version.data_completeness_insufficient_threshold,
      criticalDimensions: version.critical_dimensions,
    }
    return { versionId: version.id, config }
  }

  async function fetchTenderAndRequirementData(tenderId: string, agencyId: string) {
    const [
      { data: tender, error: tenderErr },
      { data: qualRun, error: qualRunErr },
      { data: requirements, error: reqErr },
      { data: criteria, error: critErr },
      { data: gates, error: gatesErr },
      { data: tenderServices, error: tsErr },
      { data: agencyServices, error: asErr },
      { data: services, error: svcErr },
      { data: tenderGeo, error: tgErr },
      { data: agencyGeo, error: agErr },
      { data: agency, error: agencyErr },
    ] = await Promise.all([
      supabase.from('tenders').select('id, closing_date, closing_time, estimated_value, contract_duration, entity_type, category, briefing_required, briefing_date, updated_at').eq('id', tenderId).maybeSingle(),
      supabase.from('tender_qualification_runs').select('id, overall_status, updated_at').eq('tender_id', tenderId).eq('agency_id', agencyId).eq('is_current', true).maybeSingle(),
      supabase.from('tender_requirements').select('id, mandatory_status, requirement_type, requirement_text, version, updated_at').eq('tender_id', tenderId).is('superseded_by', null),
      supabase.from('tender_evaluation_criteria').select('id, criterion, criterion_type, weight, gate, minimum_score, version, updated_at').eq('tender_id', tenderId).is('superseded_by', null),
      supabase.from('tender_evaluation_gates').select('id, name, threshold, status').eq('tender_id', tenderId).is('superseded_by', null),
      supabase.from('tender_services').select('service_id, subcategory_id').eq('tender_id', tenderId),
      supabase.from('agency_services').select('service_id, subcategory_id').eq('agency_id', agencyId).eq('active', true),
      supabase.from('services').select('id, name'),
      supabase.from('tender_geographic_scope').select('scope_type, province_id, municipality_id').eq('tender_id', tenderId),
      supabase.from('agency_geographic_scope').select('scope_type, province_id, municipality_id').eq('agency_id', agencyId),
      supabase.from('agencies').select('id, min_project_value, target_sectors, preferred_org_types, strategic_capabilities, strategic_profile_status, updated_at').eq('id', agencyId).maybeSingle(),
    ])
    for (const e of [tenderErr, qualRunErr, reqErr, critErr, gatesErr, tsErr, asErr, svcErr, tgErr, agErr, agencyErr]) if (e) throw e

    return { tender, qualRun, requirements: requirements ?? [], criteria: criteria ?? [], gates: gates ?? [], tenderServices: tenderServices ?? [], agencyServices: agencyServices ?? [], services: services ?? [], tenderGeo: tenderGeo ?? [], agencyGeo: agencyGeo ?? [], agency }
  }

  async function fetchQualificationResults(qualRunId: string | undefined) {
    if (!qualRunId) return []
    const { data, error } = await supabase
      .from('tender_qualification_results')
      .select('requirement_id, status, mandatory, explanation, tender_qualification_result_tender_evidence(*), tender_qualification_result_agency_evidence(*)')
      .eq('run_id', qualRunId)
    if (error) throw error
    return (data ?? []) as Array<Record<string, unknown>>
  }

  async function fetchAgencyEvidence(agencyId: string): Promise<AgencyEvidenceStateInput[]> {
    const [{ data: certs, error: certErr }, { data: caseStudies, error: csErr }, { data: refs, error: refErr }, { data: docs, error: docErr }, { data: fins, error: finErr }] = await Promise.all([
      supabase.from('agency_certificates').select('id, lifecycle_status, updated_at').eq('agency_id', agencyId),
      supabase.from('agency_case_studies').select('id, evidence_status, updated_at').eq('agency_id', agencyId),
      supabase.from('agency_references').select('id, reference_period_end, updated_at').eq('agency_id', agencyId),
      supabase.from('agency_documents').select('id, lifecycle_status, updated_at').eq('agency_id', agencyId),
      supabase.from('agency_financial_records').select('id, evidence_status, updated_at').eq('agency_id', agencyId),
    ])
    for (const e of [certErr, csErr, refErr, docErr, finErr]) if (e) throw e

    const ref = (id: string): ScoringEvidenceRef => ({ kind: 'AGENCY', agencyEvidenceId: id, description: null })
    const out: AgencyEvidenceStateInput[] = []
    for (const c of certs ?? []) out.push({ id: c.id, kind: 'CERTIFICATE', state: evidenceStateFromLifecycleStatus(c.lifecycle_status), evidenceRef: ref(c.id), updatedAt: c.updated_at })
    for (const cs of caseStudies ?? []) out.push({ id: cs.id, kind: 'CASE_STUDY', state: evidenceStateFromEvidenceStatus(cs.evidence_status), evidenceRef: ref(cs.id), updatedAt: cs.updated_at })
    for (const r of refs ?? []) out.push({ id: r.id, kind: 'REFERENCE', state: r.reference_period_end ? 'VERIFIED' : 'UNKNOWN', evidenceRef: ref(r.id), updatedAt: r.updated_at })
    for (const d of docs ?? []) out.push({ id: d.id, kind: 'DOCUMENT', state: evidenceStateFromLifecycleStatus(d.lifecycle_status), evidenceRef: ref(d.id), updatedAt: d.updated_at })
    for (const f of fins ?? []) out.push({ id: f.id, kind: 'FINANCIAL_RECORD', state: evidenceStateFromEvidenceStatus(f.evidence_status), evidenceRef: ref(f.id), updatedAt: f.updated_at })
    return out
  }

  async function fetchCriterionEvidenceLinks(agencyId: string, criterionIds: string[], agencyEvidence: AgencyEvidenceStateInput[]): Promise<Map<string, EvidenceLinkInput[]>> {
    const map = new Map<string, EvidenceLinkInput[]>()
    if (criterionIds.length === 0) return map
    const { data, error } = await supabase.from('tender_evaluation_criterion_agency_evidence').select('criterion_id, evidence_type, evidence_id').eq('agency_id', agencyId).in('criterion_id', criterionIds)
    if (error) throw error
    const stateById = new Map(agencyEvidence.map((e) => [e.id, e.state]))
    for (const row of data ?? []) {
      const state = stateById.get(row.evidence_id) ?? 'UNKNOWN'
      const entry: EvidenceLinkInput = { criterionId: row.criterion_id, evidenceType: row.evidence_type, evidenceState: state, evidenceRef: { kind: 'AGENCY', agencyEvidenceId: row.evidence_id, description: row.evidence_type } }
      const list = map.get(row.criterion_id) ?? []
      list.push(entry)
      map.set(row.criterion_id, list)
    }
    return map
  }

  async function assembleInput(tenderId: string, agencyId: string, now: string) {
    const base = await fetchTenderAndRequirementData(tenderId, agencyId)
    const [qualResultsRaw, agencyEvidence] = await Promise.all([fetchQualificationResults(base.qualRun?.id), fetchAgencyEvidence(agencyId)])
    const criterionEvidence = await fetchCriterionEvidenceLinks(agencyId, base.criteria.map((c) => c.id), agencyEvidence)

    const toEvidenceRef = (row: Record<string, unknown>): ScoringEvidenceRef => ({
      kind: 'TENDER',
      documentId: row.document_id as string,
      documentVersionId: (row.document_version_id as string) ?? null,
      sectionId: (row.section_id as string) ?? null,
      chunkId: (row.chunk_id as string) ?? null,
      pageId: (row.page_id as string) ?? null,
      pageNumber: (row.page_number as number) ?? null,
      evidenceText: row.evidence_text as string,
    })

    const qualificationResults = qualResultsRaw.map((r) => ({
      requirementId: r.requirement_id as string,
      status: r.status as 'PASS' | 'FAIL' | 'UNKNOWN' | 'REQUIRES_ACTION',
      mandatory: Boolean(r.mandatory),
      explanation: r.explanation as string,
      tenderEvidence: ((r.tender_qualification_result_tender_evidence as Array<Record<string, unknown>>) ?? []).map(toEvidenceRef),
      agencyEvidence: ((r.tender_qualification_result_agency_evidence as Array<Record<string, unknown>>) ?? []).map((e) => ({ kind: 'AGENCY' as const, agencyEvidenceId: e.agency_evidence_id as string, description: (e.description as string) ?? null })),
    }))

    const serviceLabels = Object.fromEntries((base.services ?? []).map((s: Record<string, unknown>) => [s.id as string, s.name as string]))

    const input: ScoringInput = {
      tenderId,
      agencyId,
      now,
      qualification: { runId: base.qualRun?.id ?? null, overallStatus: base.qualRun?.overall_status ?? null, runUpdatedAt: base.qualRun?.updated_at ?? null, results: qualificationResults },
      requirements: base.requirements.map((r: Record<string, unknown>) => ({ id: r.id as string, mandatoryStatus: r.mandatory_status as string as never, requirementType: r.requirement_type as string, description: r.requirement_text as string, version: r.version as number, updatedAt: r.updated_at as string })),
      evaluationCriteria: base.criteria.map((c: Record<string, unknown>) => ({
        id: c.id as string,
        criterion: c.criterion as string,
        criterionType: c.criterion_type as string,
        weight: (c.weight as number) ?? null,
        gate: Boolean(c.gate),
        minimumScore: (c.minimum_score as number) ?? null,
        version: c.version as number,
        updatedAt: c.updated_at as string,
        linkedEvidence: criterionEvidence.get(c.id as string) ?? [],
      })),
      evaluationGates: base.gates.map((g: Record<string, unknown>) => ({ id: g.id as string, name: g.name as string, threshold: (g.threshold as number) ?? null, status: g.status as string as never })),
      agencyEvidence,
      commercial: { estimatedValue: base.tender?.estimated_value ?? null, contractDuration: base.tender?.contract_duration ?? null, agencyMinProjectValue: base.agency?.min_project_value ?? null },
      strategic: {
        strategicProfileKnown: base.agency?.strategic_profile_status === 'VERIFIED',
        targetSectors: base.agency?.target_sectors ?? [],
        preferredOrgTypes: base.agency?.preferred_org_types ?? [],
        strategicCapabilities: base.agency?.strategic_capabilities ?? [],
        tenderOrgType: base.tender?.entity_type ?? null,
        tenderCategory: base.tender?.category ?? null,
      },
      serviceAlignment: {
        requiredServiceIds: [...new Set((base.tenderServices ?? []).map((s: Record<string, unknown>) => s.service_id as string))],
        agencyServiceIds: [...new Set((base.agencyServices ?? []).map((s: Record<string, unknown>) => s.service_id as string))],
        serviceLabels,
      },
      geography: {
        tenderScope: (base.tenderGeo ?? []).map((g: Record<string, unknown>) => ({ scopeType: g.scope_type as string, provinceId: (g.province_id as string) ?? null, municipalityId: (g.municipality_id as string) ?? null })),
        agencyScope: (base.agencyGeo ?? []).map((g: Record<string, unknown>) => ({ scopeType: g.scope_type as string, provinceId: (g.province_id as string) ?? null, municipalityId: (g.municipality_id as string) ?? null })),
        agencyGeographyKnown: (base.agencyGeo ?? []).length > 0,
      },
      // No dedicated briefing-attendance tracking table exists yet (same
      // carried-forward gap as Phase 8's own supabaseQualificationStore) —
      // always UNKNOWN in production until that table exists.
      briefing: { required: base.tender?.briefing_required ?? null, attendance: 'UNKNOWN', evidence: [] },
      deadline: { closingDate: base.tender?.closing_date ?? null, closingTime: base.tender?.closing_time ?? null },
    }

    const snapshot = {
      tenderUpdatedAt: base.tender?.updated_at ?? null,
      qualificationRunId: base.qualRun?.id ?? null,
      qualificationRunUpdatedAt: base.qualRun?.updated_at ?? null,
      requirementVersions: Object.fromEntries(base.requirements.map((r: Record<string, unknown>) => [r.id as string, r.version])),
      evaluationCriteriaVersions: Object.fromEntries(base.criteria.map((c: Record<string, unknown>) => [c.id as string, c.version])),
      evaluationGateCount: (base.gates ?? []).length,
      agencyUpdatedAt: base.agency?.updated_at ?? null,
      agencyEvidenceMaxUpdatedAt: agencyEvidence.reduce((max, e) => (e.updatedAt > max ? e.updatedAt : max), ''),
      criterionEvidenceLinkCount: [...criterionEvidence.values()].reduce((n, l) => n + l.length, 0),
    }

    return { input, snapshot }
  }

  async function buildSnapshot(tenderId: string, agencyId: string) {
    // Reuses the same aggregation as assembleInput — the queries are not
    // expensive enough in this schema to warrant a second, narrower query
    // set; kept as one code path so the two can never drift apart.
    const { snapshot } = await assembleInput(tenderId, agencyId, new Date().toISOString())
    return snapshot
  }

  function toRunRecord(row: Record<string, unknown>): ScoringRunRecord {
    return {
      id: row.id as string,
      tenderId: row.tender_id as string,
      agencyId: row.agency_id as string,
      status: row.status as ScoringRunRecord['status'],
      scoringConfigurationVersionId: row.scoring_configuration_version_id as string,
      overallScore: (row.overall_score as number) ?? null,
      dataCompleteness: (row.data_completeness as number) ?? null,
      decisionSignal: (row.decision_signal as ScoringRunRecord['decisionSignal']) ?? null,
      deadlineStatus: row.deadline_status as ScoringRunRecord['deadlineStatus'],
      timezoneUnknown: Boolean(row.timezone_unknown),
      isCurrent: Boolean(row.is_current),
      inputSnapshot: (row.input_snapshot as Record<string, unknown>) ?? {},
      createdAt: row.created_at as string,
    }
  }

  return {
    getCurrentConfiguration,
    assembleInput,
    buildSnapshot,

    async findActiveRun(tenderId, agencyId) {
      const { data, error } = await supabase.from('tender_scoring_runs').select('id').eq('tender_id', tenderId).eq('agency_id', agencyId).in('status', ['QUEUED', 'RUNNING']).maybeSingle()
      if (error) throw error
      return data ? { id: data.id } : null
    },

    async findCurrentRun(tenderId, agencyId) {
      const { data, error } = await supabase.from('tender_scoring_runs').select('*').eq('tender_id', tenderId).eq('agency_id', agencyId).eq('is_current', true).maybeSingle()
      if (error) throw error
      return data ? toRunRecord(data) : null
    },

    async getRun(runId) {
      const { data, error } = await supabase.from('tender_scoring_runs').select('*').eq('id', runId).maybeSingle()
      if (error) throw error
      return data ? toRunRecord(data) : null
    },

    async createRun(input) {
      const { data, error } = await supabase
        .from('tender_scoring_runs')
        .insert({ tender_id: input.tenderId, agency_id: input.agencyId, scoring_configuration_version_id: input.scoringConfigurationVersionId, status: 'QUEUED', triggered_by: input.triggeredBy })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id }
    },

    async updateRun(runId, patch) {
      const update: Record<string, unknown> = {}
      if (patch.status !== undefined) update.status = patch.status
      if (patch.overallScore !== undefined) update.overall_score = patch.overallScore
      if (patch.dataCompleteness !== undefined) update.data_completeness = patch.dataCompleteness
      if (patch.decisionSignal !== undefined) update.decision_signal = patch.decisionSignal
      if (patch.deadlineStatus !== undefined) update.deadline_status = patch.deadlineStatus
      if (patch.timezoneUnknown !== undefined) update.timezone_unknown = patch.timezoneUnknown
      if (patch.inputSnapshot !== undefined) update.input_snapshot = patch.inputSnapshot
      if (patch.error !== undefined) update.error = patch.error
      if (patch.startedAt !== undefined) update.started_at = patch.startedAt
      if (patch.completedAt !== undefined) update.completed_at = patch.completedAt
      const { error } = await supabase.from('tender_scoring_runs').update(update).eq('id', runId)
      if (error) throw error
    },

    async markPreviousRunsNotCurrent(tenderId, agencyId, exceptRunId) {
      const { error } = await supabase.from('tender_scoring_runs').update({ is_current: false }).eq('tender_id', tenderId).eq('agency_id', agencyId).neq('id', exceptRunId)
      if (error) throw error
    },

    async saveComponents(runId, components: ScoredComponent[]) {
      const rows = components.map((c) => ({ run_id: runId, dimension: c.dimension, status: c.status, score: c.score, weight: c.weight, explanation: c.explanation, metadata: c.metadata }))
      const { error } = await supabase.from('tender_score_components').insert(rows)
      if (error) throw error
    },

    async saveDrivers(runId, drivers) {
      if (drivers.length === 0) return
      const { error } = await supabase.from('tender_score_drivers').insert(drivers.map((d) => ({ run_id: runId, dimension: d.dimension, description: d.description, evidence: d.evidence })))
      if (error) throw error
    },

    async saveRisks(runId, risks) {
      if (risks.length === 0) return
      const { error } = await supabase.from('tender_score_risks').insert(risks.map((r) => ({ run_id: runId, dimension: r.dimension, description: r.description, evidence: r.evidence })))
      if (error) throw error
    },

    async saveGates(runId, gates: ScoredGate[]) {
      const { error } = await supabase.from('tender_score_gates').insert(gates.map((g) => ({ run_id: runId, gate_type: g.gateType, status: g.status, description: g.description, evidence: g.evidence })))
      if (error) throw error
    },
  }
}
