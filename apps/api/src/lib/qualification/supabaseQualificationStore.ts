import type { SupabaseClient } from '@supabase/supabase-js'
import type { QualificationStore, TenderQualificationContext } from './store.js'
import type { AgencyEvidenceSnapshot, QualificationRequirement, RuleResult, TenderEvidenceRef, AgencyEvidenceRef } from './types.js'

/**
 * Production `QualificationStore` over the privileged service-role
 * Supabase client (same convention as `createSupabaseAiStore`,
 * `createSupabaseDocumentPipelineStore`). All writes here bypass RLS —
 * never called with a browser-scoped client (routes/tenderQualification.ts
 * enforces this the same way routes/tenderAi.ts does).
 */
export function createSupabaseQualificationStore(supabase: SupabaseClient): QualificationStore {
  return {
    async getRequirements(tenderId): Promise<QualificationRequirement[]> {
      const { data, error } = await supabase
        .from('tender_requirements')
        .select('id, tender_id, category, requirement_text, mandatory_status, rule_type, rule_config, requirement_status, source_document_id, page_number, section_reference, evidence_text, superseded_by')
        .eq('tender_id', tenderId)
        .is('superseded_by', null)
      if (error) throw error

      return (data ?? []).map((r) => {
        const tenderEvidence: TenderEvidenceRef[] = r.source_document_id
          ? [
              {
                kind: 'TENDER',
                documentId: r.source_document_id,
                documentVersionId: null,
                sectionId: null,
                chunkId: null,
                pageId: null,
                pageNumber: r.page_number,
                evidenceText: r.evidence_text ?? r.requirement_text,
              },
            ]
          : []
        return {
          id: r.id,
          tenderId: r.tender_id,
          category: r.category,
          description: r.requirement_text,
          mandatoryStatus: r.mandatory_status,
          ruleType: r.rule_type,
          ruleConfig: (r.rule_config ?? {}) as Record<string, unknown>,
          requirementStatus: r.requirement_status,
          tenderEvidence,
        }
      })
    },

    async getAgencySnapshot(agencyId): Promise<AgencyEvidenceSnapshot> {
      const [{ data: agency, error: agencyErr }, { data: certificates, error: certErr }, { data: caseStudies, error: csErr }, { data: references, error: refErr }, { data: financials, error: finErr }, { data: team, error: teamErr }] =
        await Promise.all([
          supabase
            .from('agencies')
            .select('id, csd_number, csd_status, tax_status, tax_status_status, tax_expiry, b_bbee_level, b_bbee_status, registration_status, years_in_business')
            .eq('id', agencyId)
            .maybeSingle(),
          supabase.from('agency_certificates').select('id, certificate_type, expiry_date, lifecycle_status, status').eq('agency_id', agencyId),
          supabase.from('agency_case_studies').select('id, service_id, industry, client_type, project_type, budget, year, geography_text, evidence_status').eq('agency_id', agencyId),
          supabase.from('agency_references').select('id, is_current, reference_period_start, reference_period_end, client_id, agency_clients(industry)').eq('agency_id', agencyId),
          supabase.from('agency_financial_records').select('id, annual_turnover, evidence_status').eq('agency_id', agencyId).order('created_at', { ascending: false }).limit(1),
          supabase.from('agency_team').select('id, is_key_personnel').eq('agency_id', agencyId),
        ])
      if (agencyErr) throw agencyErr
      if (certErr) throw certErr
      if (csErr) throw csErr
      if (refErr) throw refErr
      if (finErr) throw finErr
      if (teamErr) throw teamErr

      const agencyEvidenceRef = (id: string): AgencyEvidenceRef => ({ kind: 'AGENCY', agencyEvidenceId: id, description: null })

      const bbbeeLevelNum = agency?.b_bbee_level ? parseInt(String(agency.b_bbee_level).replace(/[^0-9]/g, ''), 10) : NaN

      return {
        agencyId,
        // Never inferred (Phase 8 §18/§43): only an explicitly VERIFIED
        // status with a recorded CSD number counts as REGISTERED; an
        // explicit UNVERIFIED counts as NOT_REGISTERED; anything else
        // (including INFERRED) stays UNKNOWN rather than being upgraded.
        csdStatus: agency?.csd_status === 'VERIFIED' && agency?.csd_number ? 'REGISTERED' : agency?.csd_status === 'UNVERIFIED' ? 'NOT_REGISTERED' : 'UNKNOWN',
        csdEvidence: agency?.csd_status && agency.csd_status !== 'UNKNOWN' ? [agencyEvidenceRef(agency.id)] : [],
        taxCompliant: agency?.tax_status === 'COMPLIANT' ? true : agency?.tax_status === 'NON_COMPLIANT' ? false : null,
        taxExpiry: agency?.tax_expiry ?? null,
        taxEvidence: agency?.tax_status_status && agency.tax_status_status !== 'UNKNOWN' ? [agencyEvidenceRef(agency.id)] : [],
        bbbeeLevel: Number.isFinite(bbbeeLevelNum) && agency?.b_bbee_status !== 'UNKNOWN' ? bbbeeLevelNum : null,
        bbbeeEvidence: agency?.b_bbee_status && agency.b_bbee_status !== 'UNKNOWN' ? [agencyEvidenceRef(agency.id)] : [],
        registrationStatus: agency?.registration_status === 'VERIFIED' ? 'VERIFIED' : agency?.registration_status === 'UNVERIFIED' ? 'UNVERIFIED' : 'UNKNOWN',
        registrationEvidence: agency?.registration_status && agency.registration_status !== 'UNKNOWN' ? [agencyEvidenceRef(agency.id)] : [],
        yearsInBusiness: agency?.years_in_business ?? null,
        yearsInBusinessEvidence: agency?.years_in_business != null ? [agencyEvidenceRef(agency.id)] : [],
        annualTurnover: financials?.[0]?.evidence_status && financials[0].evidence_status !== 'UNKNOWN' && financials[0].evidence_status !== 'UNVERIFIED' ? financials[0].annual_turnover : null,
        turnoverEvidence: financials?.[0] ? [agencyEvidenceRef(financials[0].id)] : [],
        certificates: (certificates ?? []).map((c) => ({
          id: c.id,
          certificateType: c.certificate_type,
          expiryDate: c.expiry_date,
          lifecycleStatus: c.lifecycle_status ?? 'UNKNOWN',
          evidence: [agencyEvidenceRef(c.id)],
        })),
        documents: [],
        experienceRecords: (caseStudies ?? []).map((cs) => ({
          id: cs.id,
          serviceId: cs.service_id,
          industry: cs.industry,
          clientType: cs.client_type,
          projectType: cs.project_type,
          projectValue: cs.budget,
          year: cs.year,
          geographyText: cs.geography_text,
          evidenceStatus: cs.evidence_status ?? 'UNKNOWN',
          evidence: [agencyEvidenceRef(cs.id)],
        })),
        referenceRecords: ((references ?? []) as Array<Record<string, unknown>>).map((r) => ({
          id: r.id as string,
          isCurrent: Boolean(r.is_current),
          periodStart: (r.reference_period_start as string | null) ?? null,
          periodEnd: (r.reference_period_end as string | null) ?? null,
          clientType: null,
          evidenceStatus: r.reference_period_end ? 'VERIFIED' : 'UNKNOWN',
          evidence: [agencyEvidenceRef(r.id as string)],
        })),
        keyPersonnelCount: team ? team.filter((t) => t.is_key_personnel).length : null,
        keyPersonnelEvidence: team && team.length > 0 ? team.filter((t) => t.is_key_personnel).map((t) => agencyEvidenceRef(t.id)) : [],
        briefingAttendance: 'UNKNOWN',
        briefingAttendanceEvidence: [],
        geographyText: null,
        geographyEvidence: [],
      }
    },

    async getTenderContext(tenderId): Promise<TenderQualificationContext | null> {
      const { data, error } = await supabase.from('tenders').select('closing_date, briefing_date, briefing_required').eq('id', tenderId).maybeSingle()
      if (error) throw error
      if (!data) return null
      return { closingDate: data.closing_date, briefingDate: data.briefing_date, briefingRequired: data.briefing_required }
    },

    async findActiveRun(tenderId, agencyId) {
      const { data, error } = await supabase
        .from('tender_qualification_runs')
        .select('id, tender_id, agency_id, status')
        .eq('tender_id', tenderId)
        .eq('agency_id', agencyId)
        .in('status', ['QUEUED', 'RUNNING'])
        .maybeSingle()
      if (error) throw error
      return data ? { id: data.id, tenderId: data.tender_id, agencyId: data.agency_id, status: data.status } : null
    },

    async createRun(input) {
      const { data, error } = await supabase
        .from('tender_qualification_runs')
        .insert({ tender_id: input.tenderId, agency_id: input.agencyId, status: 'QUEUED', triggered_by: input.triggeredBy })
        .select('id, tender_id, agency_id, status')
        .single()
      if (error) throw error
      return { id: data.id, tenderId: data.tender_id, agencyId: data.agency_id, status: data.status }
    },

    async updateRun(runId, patch) {
      const update: Record<string, unknown> = {}
      if (patch.status !== undefined) update.status = patch.status
      if (patch.overallStatus !== undefined) update.overall_status = patch.overallStatus
      if (patch.mandatoryBlockerCount !== undefined) update.mandatory_blocker_count = patch.mandatoryBlockerCount
      if (patch.actionRequiredCount !== undefined) update.action_required_count = patch.actionRequiredCount
      if (patch.requiresReviewCount !== undefined) update.requires_review_count = patch.requiresReviewCount
      if (patch.requirementCount !== undefined) update.requirement_count = patch.requirementCount
      if (patch.error !== undefined) update.error = patch.error
      if (patch.startedAt !== undefined) update.started_at = patch.startedAt
      if (patch.completedAt !== undefined) update.completed_at = patch.completedAt
      const { error } = await supabase.from('tender_qualification_runs').update(update).eq('id', runId)
      if (error) throw error
    },

    async markPreviousRunsNotCurrent(tenderId, agencyId, exceptRunId) {
      const { error } = await supabase
        .from('tender_qualification_runs')
        .update({ is_current: false })
        .eq('tender_id', tenderId)
        .eq('agency_id', agencyId)
        .neq('id', exceptRunId)
      if (error) throw error
    },

    async createResult(input: { runId: string; requirementId: string; tenderId: string; agencyId: string; result: RuleResult }) {
      const { result } = input
      const { data, error } = await supabase
        .from('tender_qualification_results')
        .insert({
          run_id: input.runId,
          requirement_id: input.requirementId,
          tender_id: input.tenderId,
          agency_id: input.agencyId,
          status: result.status,
          mandatory: result.mandatory,
          mandatory_status: result.mandatory ? 'MANDATORY' : 'UNKNOWN',
          explanation: result.explanation,
          evaluated_by: result.evaluatedBy,
          confidence: result.confidence,
          requires_human_review: result.requiresHumanReview,
        })
        .select('id')
        .single()
      if (error) throw error

      for (const ev of result.tenderEvidence) {
        const { error: teErr } = await supabase.from('tender_qualification_result_tender_evidence').insert({
          result_id: data.id,
          document_id: ev.documentId,
          document_version_id: ev.documentVersionId,
          page_id: ev.pageId,
          section_id: ev.sectionId,
          chunk_id: ev.chunkId,
          page_number: ev.pageNumber,
          evidence_text: ev.evidenceText,
        })
        if (teErr) throw teErr
      }
      for (const ev of result.agencyEvidence) {
        const { error: aeErr } = await supabase.from('tender_qualification_result_agency_evidence').insert({
          result_id: data.id,
          agency_evidence_id: ev.agencyEvidenceId,
          description: ev.description,
        })
        if (aeErr) throw aeErr
      }

      return { id: data.id }
    },

    async createAction(input) {
      const { data, error } = await supabase
        .from('tender_qualification_actions')
        .insert({
          run_id: input.runId,
          result_id: input.resultId,
          requirement_id: input.requirementId,
          tender_id: input.tenderId,
          agency_id: input.agencyId,
          description: input.description,
          priority: input.priority,
          due_date: input.dueDate,
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id }
    },

    async createReview(input) {
      const { data, error } = await supabase
        .from('tender_qualification_reviews')
        .insert({
          run_id: input.runId,
          requirement_id: input.requirementId,
          tender_id: input.tenderId,
          agency_id: input.agencyId,
          reviewer_id: input.reviewerId,
          decision: input.decision,
          note: input.note,
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id }
    },
  }
}
