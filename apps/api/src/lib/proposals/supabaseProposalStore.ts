import type { SupabaseClient } from '@supabase/supabase-js'
import { generateProposalBlueprint } from './blueprint.js'
import { evaluateProposalCompliance } from './compliance.js'
import { isSnapshotStale } from './staleness.js'
import { assembleProposalDocx, assembleProposalPdf, type AssemblySection } from './documentAssembly.js'
import { runProposalGeneration } from '../ai/execution/runProposalGeneration.js'
import type { OpenAiClient } from '../ai/types.js'
import type { AiConfig } from '../ai/config.js'
import type { ProposalStore } from './store.js'
import { renderUnsupportedClaimPlaceholder } from './unsupportedClaims.js'

const PLACEHOLDER_TEXT = renderUnsupportedClaimPlaceholder()
const PRICING_PLACEHOLDER = '[PRICING INPUT REQUIRED]'

export function createSupabaseProposalStore(supabase: SupabaseClient): ProposalStore {
  async function writeAudit(event: { action: string; agencyId: string; actorId: string | null; entityId: string; oldValue?: unknown; newValue?: unknown }) {
    const { error } = await supabase.from('audit_logs').insert({
      agency_id: event.agencyId,
      actor_id: event.actorId,
      actor_type: 'USER',
      action: event.action,
      entity_type: 'bid_proposal',
      entity_id: event.entityId,
      old_value: (event.oldValue ?? null) as never,
      new_value: (event.newValue ?? null) as never,
    })
    if (error) throw error
  }

  async function fetchCurrentStrategy(bidProjectId: string) {
    const { data, error } = await supabase.from('bid_strategies').select('*').eq('bid_project_id', bidProjectId).eq('is_current', true).maybeSingle()
    if (error) throw error
    return data
  }

  async function fetchWinThemesAndDifferentiators(strategyId: string | null) {
    if (!strategyId) return { winThemes: [], differentiators: [] }
    const [{ data: winThemes, error: e1 }, { data: differentiators, error: e2 }] = await Promise.all([
      supabase.from('bid_win_themes').select('*').eq('strategy_id', strategyId),
      supabase.from('bid_differentiators').select('*').eq('strategy_id', strategyId),
    ])
    if (e1) throw e1
    if (e2) throw e2
    return { winThemes: winThemes ?? [], differentiators: differentiators ?? [] }
  }

  async function fetchTenderRequirements(tenderId: string) {
    const { data, error } = await supabase.from('tender_requirements').select('*').eq('tender_id', tenderId)
    if (error) throw error
    return data ?? []
  }

  async function fetchTenderEvaluationCriteria(tenderId: string) {
    const { data, error } = await supabase.from('tender_evaluation_criteria').select('*').eq('tender_id', tenderId)
    if (error) throw error
    return data ?? []
  }

  async function fetchApprovedEvidenceClaims(bidProjectId: string) {
    const { data, error } = await supabase.from('bid_evidence_claims').select('*').eq('bid_project_id', bidProjectId).is('revoked_at', null)
    if (error) throw error
    return data ?? []
  }

  async function fetchEvidenceMatchStaleness(matchIds: string[]): Promise<Map<string, boolean>> {
    if (matchIds.length === 0) return new Map()
    const { data, error } = await supabase.from('bid_evidence_matches').select('id, is_stale').in('id', matchIds)
    if (error) throw error
    return new Map((data ?? []).map((r) => [r.id as string, Boolean(r.is_stale)]))
  }

  async function computeVersionInputSnapshot(bidProjectId: string, tenderId: string) {
    const [requirements, criteria, strategy, claims] = await Promise.all([fetchTenderRequirements(tenderId), fetchTenderEvaluationCriteria(tenderId), fetchCurrentStrategy(bidProjectId), fetchApprovedEvidenceClaims(bidProjectId)])
    return {
      requirements: requirements.map((r) => ({ id: r.id, mandatory: r.mandatory, text: r.requirement_text })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
      criteria: criteria.map((c) => ({ id: c.id, weight: c.weight, criterion: c.criterion })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
      strategyVersion: strategy?.version ?? null,
      claimIds: claims.map((c) => c.id).sort(),
    }
  }

  return {
    async createProposal(input) {
      const existing = await supabase.from('bid_proposals').select('*').eq('bid_project_id', input.bidProjectId).maybeSingle()
      if (existing.error) throw existing.error
      if (existing.data) return existing.data

      const { data: proposal, error } = await supabase
        .from('bid_proposals')
        .insert({ bid_project_id: input.bidProjectId, tender_id: input.tenderId, agency_id: input.agencyId, created_by: input.createdBy })
        .select('*')
        .single()
      if (error) throw error
      await writeAudit({ action: 'PROPOSAL_CREATED', agencyId: input.agencyId, actorId: input.createdBy, entityId: proposal.id })

      const snapshot = await computeVersionInputSnapshot(input.bidProjectId, input.tenderId)
      const { data: version, error: vErr } = await supabase
        .from('bid_proposal_versions')
        .insert({ proposal_id: proposal.id, agency_id: input.agencyId, version: 1, input_snapshot: snapshot, created_by: input.createdBy })
        .select('*')
        .single()
      if (vErr) throw vErr
      await writeAudit({ action: 'PROPOSAL_VERSION_CREATED', agencyId: input.agencyId, actorId: input.createdBy, entityId: version.id })

      const strategy = await fetchCurrentStrategy(input.bidProjectId)
      const { winThemes, differentiators } = await fetchWinThemesAndDifferentiators(strategy?.id ?? null)
      const claims = await fetchApprovedEvidenceClaims(input.bidProjectId)

      const blueprint = generateProposalBlueprint({
        requirements: snapshot.requirements.map((r) => ({ id: String(r.id), requirementType: 'OTHER', requirementText: String(r.text ?? ''), mandatory: Boolean(r.mandatory) })),
        evaluationCriteria: snapshot.criteria.map((c) => ({ id: String(c.id), criterion: String(c.criterion ?? ''), weight: c.weight === null ? null : Number(c.weight) })),
        winThemes: winThemes.map((w) => ({ id: w.id, title: w.title, sourceType: w.source_type })),
        differentiators: differentiators.map((d) => ({ id: d.id, title: d.title })),
        hasEvidenceNeeds: claims.length > 0,
        hasPricingRequirement: false,
      })

      // requirement_type needs the real column to route into
      // technical/team/social-value sections (Phase 14 §7) — refetch
      // with actual types rather than the flattened snapshot above.
      const realRequirements = await fetchTenderRequirements(input.tenderId)
      const realCriteria = await fetchTenderEvaluationCriteria(input.tenderId)
      const blueprintReal = generateProposalBlueprint({
        requirements: realRequirements.map((r) => ({ id: r.id, requirementType: String(r.requirement_type ?? 'OTHER'), requirementText: String(r.requirement_text ?? ''), mandatory: Boolean(r.mandatory) })),
        evaluationCriteria: realCriteria.map((c) => ({ id: c.id, criterion: String(c.criterion ?? ''), weight: c.weight === null ? null : Number(c.weight) })),
        winThemes: winThemes.map((w) => ({ id: w.id, title: w.title, sourceType: w.source_type })),
        differentiators: differentiators.map((d) => ({ id: d.id, title: d.title })),
        hasEvidenceNeeds: claims.length > 0,
        hasPricingRequirement: false,
      })
      void blueprint

      for (const plan of blueprintReal) {
        const { data: section, error: sErr } = await supabase
          .from('bid_proposal_sections')
          .insert({
            proposal_version_id: version.id,
            agency_id: input.agencyId,
            section_key: plan.sectionKey,
            section_type: plan.sectionType,
            title: plan.title,
            objective: plan.objective,
            sort_order: plan.sortOrder,
            is_mandatory: plan.isMandatory,
          })
          .select('*')
          .single()
        if (sErr) throw sErr
        await writeAudit({ action: 'PROPOSAL_SECTION_CREATED', agencyId: input.agencyId, actorId: input.createdBy, entityId: section.id })

        for (const reqId of plan.requirementIds) {
          await supabase.from('bid_proposal_requirement_links').insert({ section_id: section.id, tender_requirement_id: reqId, coverage_status: 'NOT_COVERED' })
        }
        for (const critId of plan.evaluationCriterionIds) {
          await supabase.from('bid_proposal_evaluation_links').insert({ section_id: section.id, evaluation_criterion_id: critId, coverage_status: 'NOT_COVERED' })
        }
      }

      await supabase.from('bid_proposals').update({ current_version: 1 }).eq('id', proposal.id)
      return { ...proposal, current_version: 1 }
    },

    async getProposalByBidProject(bidProjectId) {
      const { data, error } = await supabase.from('bid_proposals').select('*').eq('bid_project_id', bidProjectId).maybeSingle()
      if (error) throw error
      return data
    },

    async getCurrentVersion(proposalId) {
      const { data, error } = await supabase.from('bid_proposal_versions').select('*').eq('proposal_id', proposalId).eq('is_current', true).maybeSingle()
      if (error) throw error
      return data
    },

    async listSections(versionId) {
      const { data, error } = await supabase.from('bid_proposal_sections').select('*').eq('proposal_version_id', versionId).order('sort_order', { ascending: true })
      if (error) throw error
      return data ?? []
    },

    async getSection(sectionId) {
      const { data, error } = await supabase.from('bid_proposal_sections').select('*').eq('id', sectionId).maybeSingle()
      if (error) throw error
      return data
    },

    async listBlocks(sectionId) {
      const { data, error } = await supabase.from('bid_proposal_blocks').select('*').eq('section_id', sectionId).order('sort_order', { ascending: true })
      if (error) throw error
      return data ?? []
    },

    async listClaims(sectionId) {
      const { data, error } = await supabase.from('bid_proposal_claims').select('*').eq('section_id', sectionId)
      if (error) throw error
      return data ?? []
    },

    async createSection(input) {
      const { data, error } = await supabase
        .from('bid_proposal_sections')
        .insert({
          proposal_version_id: input.versionId,
          agency_id: input.agencyId,
          section_type: input.sectionType,
          section_key: input.sectionKey,
          title: input.title,
          objective: input.objective,
          sort_order: input.sortOrder,
          is_mandatory: input.isMandatory,
        })
        .select('*')
        .single()
      if (error) throw error
      await writeAudit({ action: 'PROPOSAL_SECTION_CREATED', agencyId: input.agencyId, actorId: null, entityId: data.id })
      return data
    },

    async generateSection(deps: { client: OpenAiClient; config: AiConfig }, input) {
      const section = await supabase.from('bid_proposal_sections').select('*').eq('id', input.sectionId).maybeSingle()
      if (section.error) throw section.error
      if (!section.data) throw new Error('Section not found')
      if (section.data.status === 'APPROVED_INTERNAL') throw new Error('Cannot regenerate an APPROVED_INTERNAL section. Reject it first or create a new proposal version.')

      const version = await supabase.from('bid_proposal_versions').select('*').eq('id', section.data.proposal_version_id).maybeSingle()
      if (version.error) throw version.error
      const proposal = await supabase.from('bid_proposals').select('*').eq('id', version.data!.proposal_id).maybeSingle()
      if (proposal.error) throw proposal.error
      const bidProjectId = proposal.data!.bid_project_id as string
      const tenderId = proposal.data!.tender_id as string
      const agencyId = proposal.data!.agency_id as string

      await writeAudit({ action: 'PROPOSAL_GENERATION_STARTED', agencyId, actorId: input.userId, entityId: input.sectionId })

      const [reqLinks, evalLinks, strategy] = await Promise.all([
        supabase.from('bid_proposal_requirement_links').select('*, tender_requirements(requirement_text, mandatory)').eq('section_id', input.sectionId),
        supabase.from('bid_proposal_evaluation_links').select('*, tender_evaluation_criteria(criterion, weight)').eq('section_id', input.sectionId),
        fetchCurrentStrategy(bidProjectId),
      ])
      if (reqLinks.error) throw reqLinks.error
      if (evalLinks.error) throw evalLinks.error

      const { winThemes, differentiators } = await fetchWinThemesAndDifferentiators(strategy?.id ?? null)
      const claims = await fetchApprovedEvidenceClaims(bidProjectId)
      const staleness = await fetchEvidenceMatchStaleness(claims.map((c) => c.match_id as string))

      const allRequirements = await fetchTenderRequirements(tenderId)
      const allCriteria = await fetchTenderEvaluationCriteria(tenderId)

      const context = {
        sectionType: section.data.section_type as string,
        sectionTitle: section.data.title as string,
        sectionObjective: (section.data.objective as string) ?? '',
        requirements: (reqLinks.data ?? []).map((r: Record<string, unknown>) => ({ id: r.tender_requirement_id as string, text: String((r.tender_requirements as Record<string, unknown> | null)?.requirement_text ?? ''), mandatory: Boolean((r.tender_requirements as Record<string, unknown> | null)?.mandatory) })),
        evaluationCriteria: (evalLinks.data ?? []).map((c: Record<string, unknown>) => ({ id: c.evaluation_criterion_id as string, text: String((c.tender_evaluation_criteria as Record<string, unknown> | null)?.criterion ?? ''), weight: (c.tender_evaluation_criteria as Record<string, unknown> | null)?.weight === null ? null : Number((c.tender_evaluation_criteria as Record<string, unknown> | null)?.weight) })),
        winThemes: winThemes.map((w) => ({ id: w.id as string, title: w.title as string, description: (w.description as string | null) ?? null })),
        differentiators: differentiators.map((d) => ({ id: d.id as string, title: d.title as string, description: (d.description as string | null) ?? null })),
        approvedEvidenceClaims: claims.map((c) => ({ id: c.id as string, entityType: c.candidate_entity_type as string, summary: `Approved ${c.candidate_entity_type} evidence (approved ${c.approved_at}).` })),
        agencyProfileSummary: null,
        userInstructions: input.userInstructions,
        tenderExcerpts: [] as string[],
      }

      const outcome = await runProposalGeneration(deps, {
        context,
        strategyVersion: strategy?.version ?? null,
        currentlyApprovedEvidence: new Map(claims.map((c) => [c.id as string, { isStale: staleness.get(c.match_id as string) ?? false }])),
        validRequirementIds: new Set(allRequirements.map((r) => r.id as string)),
        validEvaluationCriterionIds: new Set(allCriteria.map((c) => c.id as string)),
      })

      const { count: priorCount } = await supabase.from('bid_proposal_generations').select('*', { count: 'exact', head: true }).eq('section_id', input.sectionId)
      const generationVersion = (priorCount ?? 0) + 1

      if (outcome.status !== 'SUCCEEDED') {
        const { data: genRow, error: genErr } = await supabase
          .from('bid_proposal_generations')
          .insert({
            section_id: input.sectionId,
            proposal_version_id: section.data.proposal_version_id,
            status: outcome.status,
            prompt_version: outcome.promptVersion,
            generation_version: generationVersion,
            input_context_hash: outcome.inputContextHash,
            error_message: outcome.status === 'AI_UNAVAILABLE' ? outcome.reason : outcome.status === 'FAILED' ? outcome.reason : outcome.reason,
            created_by: input.userId,
          })
          .select('*')
          .single()
        if (genErr) throw genErr
        await writeAudit({ action: 'PROPOSAL_GENERATION_FAILED', agencyId, actorId: input.userId, entityId: input.sectionId, newValue: { status: outcome.status } })
        return genRow
      }

      // Snapshot existing blocks to edit history before replacing them
      // (Phase 14 §16/§19 — regeneration never silently overwrites).
      const existingBlocks = await this.listBlocks(input.sectionId)
      await supabase.from('bid_proposal_section_edit_history').insert({
        section_id: input.sectionId,
        edit_type: existingBlocks.length === 0 ? 'AI_GENERATED' : 'REGENERATED',
        previous_blocks_snapshot: existingBlocks,
        edited_by: input.userId,
      })
      if (existingBlocks.length > 0) {
        await supabase.from('bid_proposal_blocks').delete().eq('section_id', input.sectionId)
        await supabase.from('bid_proposal_claims').delete().eq('section_id', input.sectionId)
      }

      let sortOrder = 0
      for (const block of outcome.result.contentBlocks) {
        await supabase.from('bid_proposal_blocks').insert({
          section_id: input.sectionId,
          block_type: block.blockType,
          sort_order: sortOrder++,
          content: block,
          origin: 'AI_GENERATED',
          created_by: input.userId,
        })
      }
      // Any model-flagged unsupported claim, or a claim downgraded by
      // independent re-verification, is rendered as a PLACEHOLDER block
      // — never silently filled with plausible language (Phase 14 §11).
      for (const text of outcome.result.unsupportedClaims) {
        await supabase.from('bid_proposal_blocks').insert({ section_id: input.sectionId, block_type: 'PLACEHOLDER', sort_order: sortOrder++, content: { blockType: 'PLACEHOLDER', text: PLACEHOLDER_TEXT, originalClaim: text }, origin: 'AI_GENERATED', created_by: input.userId })
      }

      let hasUnsupported = false
      for (const claim of outcome.resolvedClaims) {
        if (claim.supportStatus === 'UNSUPPORTED') hasUnsupported = true
        const { error: claimErr } = await supabase.from('bid_proposal_claims').insert({
          section_id: input.sectionId,
          claim_text: claim.claimText,
          support_status: claim.supportStatus,
          evidence_claim_id: claim.evidenceClaimId,
          rationale: claim.reason,
        })
        if (claimErr) throw claimErr
        if (claim.supportStatus === 'UNSUPPORTED') {
          await writeAudit({ action: 'PROPOSAL_CLAIM_MARKED_UNSUPPORTED', agencyId, actorId: input.userId, entityId: input.sectionId, newValue: { claimText: claim.claimText } })
        } else {
          await writeAudit({ action: 'PROPOSAL_CLAIM_CREATED', agencyId, actorId: input.userId, entityId: input.sectionId, newValue: { claimText: claim.claimText, supportStatus: claim.supportStatus } })
        }
        if (claim.evidenceClaimId) {
          await supabase.from('bid_proposal_evidence_links').insert({ section_id: input.sectionId, bid_evidence_claim_id: claim.evidenceClaimId })
        }
      }

      for (const reqId of outcome.result.requirementReferences) {
        if (!(allRequirements.some((r) => r.id === reqId))) continue
        await supabase.from('bid_proposal_requirement_links').upsert({ section_id: input.sectionId, tender_requirement_id: reqId, coverage_status: 'COVERED' }, { onConflict: 'section_id,tender_requirement_id' })
      }
      for (const critId of outcome.result.evaluationReferences) {
        if (!(allCriteria.some((c) => c.id === critId))) continue
        await supabase.from('bid_proposal_evaluation_links').upsert({ section_id: input.sectionId, evaluation_criterion_id: critId, coverage_status: 'COVERED' }, { onConflict: 'section_id,evaluation_criterion_id' })
      }

      for (const missing of outcome.result.missingInformation) {
        await supabase.from('bid_proposal_missing_information').insert({
          proposal_version_id: section.data.proposal_version_id,
          section_id: input.sectionId,
          description: missing.description,
          source_requirement_id: missing.sourceRequirementId,
          severity: missing.severity,
        })
      }

      const newStatus = hasUnsupported || outcome.droppedReferenceWarnings.length > 0 || outcome.result.missingInformation.length > 0 ? 'REQUIRES_REVIEW' : 'AI_GENERATED'
      const { data: updatedSection, error: updErr } = await supabase
        .from('bid_proposal_sections')
        .update({ status: newStatus, origin: 'AI_GENERATED', last_generated_at: new Date().toISOString() })
        .eq('id', input.sectionId)
        .select('*')
        .single()
      if (updErr) throw updErr

      const { data: genRow, error: genErr } = await supabase
        .from('bid_proposal_generations')
        .insert({
          section_id: input.sectionId,
          proposal_version_id: section.data.proposal_version_id,
          status: 'SUCCEEDED',
          model: outcome.model,
          prompt_version: outcome.promptVersion,
          generation_version: generationVersion,
          input_context_hash: outcome.inputContextHash,
          requirement_ids: outcome.result.requirementReferences,
          evaluation_criterion_ids: outcome.result.evaluationReferences,
          evidence_claim_ids: outcome.result.evidenceReferences,
          strategy_version: strategy?.version ?? null,
          warnings: [...outcome.result.warnings, ...outcome.droppedReferenceWarnings],
          missing_information: outcome.result.missingInformation,
          unsupported_claims: outcome.result.unsupportedClaims,
          confidence: outcome.result.confidence,
          input_tokens_estimate: outcome.usage.inputTokens,
          output_tokens_estimate: outcome.usage.outputTokens,
          created_by: input.userId,
        })
        .select('*')
        .single()
      if (genErr) throw genErr

      await writeAudit({ action: 'PROPOSAL_GENERATION_COMPLETED', agencyId, actorId: input.userId, entityId: input.sectionId, newValue: { status: newStatus } })
      return { ...genRow, section: updatedSection }
    },

    async patchSection(input) {
      const section = await supabase.from('bid_proposal_sections').select('*').eq('id', input.sectionId).maybeSingle()
      if (section.error) throw section.error
      if (!section.data) throw new Error('Section not found')

      if (input.blocks) {
        const existingBlocks = await this.listBlocks(input.sectionId)
        await supabase.from('bid_proposal_section_edit_history').insert({ section_id: input.sectionId, edit_type: 'HUMAN_EDIT', previous_blocks_snapshot: existingBlocks, edited_by: input.userId })
        if (existingBlocks.length > 0) await supabase.from('bid_proposal_blocks').delete().eq('section_id', input.sectionId)
        let sortOrder = 0
        for (const block of input.blocks) {
          const origin = section.data.origin === 'AI_GENERATED' ? 'AI_REVISED' : 'HUMAN_AUTHORED'
          await supabase.from('bid_proposal_blocks').insert({ section_id: input.sectionId, block_type: block.blockType, sort_order: block.sortOrder ?? sortOrder++, content: block.content, origin, created_by: input.userId })
        }
      }

      const update: Record<string, unknown> = { last_edited_at: new Date().toISOString(), last_edited_by: input.userId }
      if (input.title !== undefined) update.title = input.title
      if (input.objective !== undefined) update.objective = input.objective
      if (input.blocks && section.data.origin !== 'AI_GENERATED' && section.data.origin !== 'AI_REVISED') update.origin = 'HUMAN_AUTHORED'
      else if (input.blocks) update.origin = 'AI_REVISED'

      const { data, error } = await supabase.from('bid_proposal_sections').update(update).eq('id', input.sectionId).select('*').single()
      if (error) throw error
      await writeAudit({ action: 'PROPOSAL_SECTION_EDITED', agencyId: section.data.agency_id as string, actorId: input.userId, entityId: input.sectionId })
      return data
    },

    async reviewSection(input) {
      const section = await supabase.from('bid_proposal_sections').select('*').eq('id', input.sectionId).maybeSingle()
      if (section.error) throw section.error
      if (!section.data) throw new Error('Section not found')
      if (input.action === 'REJECTED' && (!input.reason || input.reason.trim().length === 0)) throw new Error('A rejection reason is required.')

      const { data: review, error: revErr } = await supabase.from('bid_proposal_reviews').insert({ section_id: input.sectionId, reviewer_id: input.reviewerId, action: input.action, reason: input.reason ?? null }).select('*').single()
      if (revErr) throw revErr

      const nextStatus = input.action === 'APPROVED' ? 'APPROVED_INTERNAL' : input.action === 'REJECTED' ? 'REJECTED' : 'IN_REVIEW'
      const existingBlocks = await this.listBlocks(input.sectionId)
      await supabase.from('bid_proposal_section_edit_history').insert({ section_id: input.sectionId, edit_type: input.action, previous_blocks_snapshot: existingBlocks, edited_by: input.reviewerId })
      const { error: updErr } = await supabase.from('bid_proposal_sections').update({ status: nextStatus }).eq('id', input.sectionId)
      if (updErr) throw updErr

      const auditAction = input.action === 'APPROVED' ? 'PROPOSAL_SECTION_APPROVED' : input.action === 'REJECTED' ? 'PROPOSAL_SECTION_REJECTED' : 'PROPOSAL_SECTION_REVIEWED'
      await writeAudit({ action: auditAction, agencyId: section.data.agency_id as string, actorId: input.reviewerId, entityId: input.sectionId, newValue: { reason: input.reason ?? null } })
      return review
    },

    async runCompliance(input) {
      const version = await supabase.from('bid_proposal_versions').select('*').eq('id', input.versionId).maybeSingle()
      if (version.error) throw version.error
      if (!version.data) throw new Error('Proposal version not found')
      const proposal = await supabase.from('bid_proposals').select('*').eq('id', version.data.proposal_id).maybeSingle()
      if (proposal.error) throw proposal.error

      const sections = await this.listSections(input.versionId)
      const allBlocks = await Promise.all(sections.map((s) => this.listBlocks(s.id as string)))
      const allClaims = await Promise.all(sections.map((s) => this.listClaims(s.id as string)))

      const reqLinksRes = await supabase.from('bid_proposal_requirement_links').select('*').in('section_id', sections.map((s) => s.id as string))
      if (reqLinksRes.error) throw reqLinksRes.error
      const evalLinksRes = await supabase.from('bid_proposal_evaluation_links').select('*').in('section_id', sections.map((s) => s.id as string))
      if (evalLinksRes.error) throw evalLinksRes.error

      const currentSnapshot = await computeVersionInputSnapshot(proposal.data!.bid_project_id as string, proposal.data!.tender_id as string)
      const isStale = isSnapshotStale(version.data.input_snapshot as Record<string, unknown>, currentSnapshot as unknown as Record<string, unknown>)

      const requirementsById = new Map<string, { mandatory: boolean; coverageStatus: 'COVERED' | 'PARTIAL' | 'NOT_COVERED' }>()
      for (const link of reqLinksRes.data ?? []) {
        const key = link.tender_requirement_id as string
        const existing = requirementsById.get(key)
        const status = link.coverage_status as 'COVERED' | 'PARTIAL' | 'NOT_COVERED'
        if (!existing || status === 'COVERED') requirementsById.set(key, { mandatory: existing?.mandatory ?? false, coverageStatus: existing && existing.coverageStatus === 'COVERED' ? 'COVERED' : status })
      }
      const allTenderRequirements = await fetchTenderRequirements(proposal.data!.tender_id as string)
      for (const r of allTenderRequirements) {
        const existing = requirementsById.get(r.id as string)
        requirementsById.set(r.id as string, { mandatory: Boolean(r.mandatory), coverageStatus: existing?.coverageStatus ?? 'NOT_COVERED' })
      }

      const evaluationsById = new Map<string, { coverageStatus: 'COVERED' | 'PARTIAL' | 'NOT_COVERED'; evidenceExpected: boolean; evidenceLinked: boolean }>()
      const allCriteria = await fetchTenderEvaluationCriteria(proposal.data!.tender_id as string)
      for (const c of allCriteria) {
        evaluationsById.set(c.id as string, { coverageStatus: 'NOT_COVERED', evidenceExpected: false, evidenceLinked: false })
      }
      for (const link of evalLinksRes.data ?? []) {
        const key = link.evaluation_criterion_id as string
        const existing = evaluationsById.get(key) ?? { coverageStatus: 'NOT_COVERED' as const, evidenceExpected: false, evidenceLinked: false }
        evaluationsById.set(key, { ...existing, coverageStatus: link.coverage_status as 'COVERED' | 'PARTIAL' | 'NOT_COVERED' })
      }

      const pricingRequirementTypes = new Set(['PRICING', 'COMMERCIAL', 'PRICE'])
      const pricingRequired = allTenderRequirements.some((r) => pricingRequirementTypes.has(String(r.requirement_type ?? '').toUpperCase()))

      const flatClaims = allClaims.flat()
      const compliance = evaluateProposalCompliance({
        requiredSectionTypesPresent: ['COVER', 'EXECUTIVE_SUMMARY', 'COMPLIANCE'],
        expectedSectionTypes: [],
        sections: sections.map((s, i) => {
          const blocksForSection = allBlocks[i] ?? []
          return {
            id: s.id as string,
            sectionType: s.section_type as never,
            isMandatory: Boolean(s.is_mandatory),
            status: s.status as string,
            hasContent: blocksForSection.length > 0,
            hasUnresolvedPlaceholder: blocksForSection.some((b) => b.block_type === 'PLACEHOLDER' || JSON.stringify(b.content).includes(PLACEHOLDER_TEXT) || JSON.stringify(b.content).includes(PRICING_PLACEHOLDER)),
          }
        }),
        requirements: Array.from(requirementsById.entries()).map(([id, v]) => ({ id, mandatory: v.mandatory, coveredBySectionId: null, coverageStatus: v.coverageStatus })),
        evaluations: Array.from(evaluationsById.entries()).map(([id, v]) => ({ id, coveredBySectionId: null, coverageStatus: v.coverageStatus, evidenceExpected: v.evidenceExpected, evidenceLinked: v.evidenceLinked })),
        claims: flatClaims.map((c) => ({ id: c.id as string, supportStatus: c.support_status as string })),
        pricingRequired,
        pricingProvided: false,
        isStale,
        staleReason: isStale ? 'Tender requirements, evaluation criteria, strategy, or approved evidence changed since this proposal version was generated.' : null,
      })

      const { data: resultRow, error: resErr } = await supabase
        .from('bid_proposal_compliance_results')
        .insert({ proposal_version_id: input.versionId, result: compliance.result, coverage_score: compliance.coverageScore, computed_by: input.computedBy })
        .select('*')
        .single()
      if (resErr) throw resErr

      for (const issue of compliance.issues) {
        await supabase.from('bid_proposal_compliance_issues').insert({
          compliance_result_id: resultRow.id,
          severity: issue.severity,
          code: issue.code,
          message: issue.message,
          section_id: issue.sectionId,
          requirement_id: issue.requirementId,
          evaluation_criterion_id: issue.evaluationCriterionId,
        })
      }

      if (isStale && !version.data.is_stale) {
        await supabase.from('bid_proposal_versions').update({ is_stale: true, stale_reason: 'Upstream tender/strategy/evidence data changed since generation.' }).eq('id', input.versionId)
        await writeAudit({ action: 'PROPOSAL_MARKED_STALE', agencyId: proposal.data!.agency_id as string, actorId: input.computedBy, entityId: input.versionId })
      }
      await writeAudit({ action: 'PROPOSAL_COMPLIANCE_RUN', agencyId: proposal.data!.agency_id as string, actorId: input.computedBy, entityId: input.versionId, newValue: { result: compliance.result } })

      return { ...resultRow, issues: compliance.issues }
    },

    async assembleDocument(input) {
      const version = await supabase.from('bid_proposal_versions').select('*').eq('id', input.versionId).maybeSingle()
      if (version.error) throw version.error
      if (!version.data) throw new Error('Proposal version not found')
      const proposal = await supabase.from('bid_proposals').select('*').eq('id', version.data.proposal_id).maybeSingle()
      if (proposal.error) throw proposal.error
      const tender = await supabase.from('tenders').select('*').eq('id', proposal.data!.tender_id).maybeSingle()
      if (tender.error) throw tender.error
      const agency = await supabase.from('agencies').select('*').eq('id', proposal.data!.agency_id).maybeSingle()
      if (agency.error) throw agency.error
      const bidProject = await supabase.from('bid_strategy_projects').select('*').eq('id', proposal.data!.bid_project_id).maybeSingle()
      if (bidProject.error) throw bidProject.error

      const sections = await this.listSections(input.versionId)
      const assemblySections: AssemblySection[] = []
      for (const s of sections) {
        const blocks = await this.listBlocks(s.id as string)
        assemblySections.push({
          title: s.title as string,
          sectionType: s.section_type as string,
          status: s.status as string,
          blocks: blocks.map((b) => (b.content as Record<string, unknown>) as never),
        })
      }

      const metadata = {
        tenderNumber: (tender.data?.tender_number as string | null) ?? null,
        tenderTitle: (tender.data?.title as string) ?? 'Untitled Tender',
        organisation: (agency.data?.name as string) ?? 'Unknown Agency',
        bidProjectName: (bidProject.data?.project_name as string) ?? 'Bid Project',
        proposalVersion: version.data.version as number,
        generatedDate: new Date().toISOString().slice(0, 10),
        proposalStatus: version.data.status as string,
      }

      const bytes = input.format === 'DOCX' ? await assembleProposalDocx({ metadata, sections: assemblySections }) : await assembleProposalPdf({ metadata, sections: assemblySections })
      const filename = `proposal-v${metadata.proposalVersion}.${input.format.toLowerCase()}`
      const contentType = input.format === 'DOCX' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf'

      const { data: docRow, error: docErr } = await supabase
        .from('bid_proposal_documents')
        .insert({ proposal_version_id: input.versionId, agency_id: proposal.data!.agency_id, format: input.format, filename, assembled_by: input.userId })
        .select('*')
        .single()
      if (docErr) throw docErr

      await writeAudit({ action: 'PROPOSAL_DOCUMENT_ASSEMBLED', agencyId: proposal.data!.agency_id as string, actorId: input.userId, entityId: input.versionId, newValue: { format: input.format } })

      return { record: docRow, bytes, filename, contentType }
    },

    async listGenerations(sectionId) {
      const { data, error } = await supabase.from('bid_proposal_generations').select('*').eq('section_id', sectionId).order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },

    async listMissingInformation(versionId) {
      const { data, error } = await supabase.from('bid_proposal_missing_information').select('*').eq('proposal_version_id', versionId)
      if (error) throw error
      return data ?? []
    },
  }
}
