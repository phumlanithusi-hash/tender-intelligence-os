import type { SupabaseClient } from '@supabase/supabase-js'
import type { EvidenceEmbeddingEntityType } from '@tender-os/constants'
import { EVIDENCE_MAX_CANDIDATES_PER_NEED, EVIDENCE_MIN_SIMILARITY_THRESHOLD, EVIDENCE_RANKING_WEIGHTS, EVIDENCE_RECENCY_HALF_LIFE_DAYS } from '@tender-os/constants'
import type { EmbeddingClient } from '../ai/embeddingClient.js'
import { embedAgencyEvidence, type EmbeddableEntityRef } from './embedAgencyEvidence.js'
import { rankEvidenceCandidates } from './rankEvidenceCandidates.js'
import { verifyEvidenceCandidate } from './verifyEvidenceCandidate.js'
import { computeEvidenceGap } from './gaps.js'
import { isSnapshotStale } from './staleness.js'
import type { CandidateEmbeddingResult } from './types.js'
import type { EvidenceMatchGenerationResult, EvidenceMatchingStore, BidEvidenceMatchRecord } from './store.js'

/** Column name of the FK on agency_evidence_embeddings/bid_evidence_matches for each entity type. */
const ENTITY_FK_COLUMN: Record<EvidenceEmbeddingEntityType, string> = {
  AGENCY_DOCUMENT: 'document_evidence_id',
  AGENCY_CERTIFICATE: 'certificate_evidence_id',
  AGENCY_CASE_STUDY: 'case_study_evidence_id',
  AGENCY_REFERENCE: 'reference_evidence_id',
  AGENCY_FINANCIAL_RECORD: 'financial_record_evidence_id',
}
const ENTITY_TABLE: Record<EvidenceEmbeddingEntityType, string> = {
  AGENCY_DOCUMENT: 'agency_documents',
  AGENCY_CERTIFICATE: 'agency_certificates',
  AGENCY_CASE_STUDY: 'agency_case_studies',
  AGENCY_REFERENCE: 'agency_references',
  AGENCY_FINANCIAL_RECORD: 'agency_financial_records',
}

function buildContent(entityType: EvidenceEmbeddingEntityType, row: Record<string, unknown>): string {
  switch (entityType) {
    case 'AGENCY_DOCUMENT':
      return [`Document type: ${row.document_type ?? ''}`, row.expiry_date ? `Expires: ${row.expiry_date}` : ''].filter(Boolean).join('. ')
    case 'AGENCY_CERTIFICATE':
      return [`Certificate type: ${row.certificate_type ?? ''}`, row.issuing_body ? `Issued by: ${row.issuing_body}` : '', row.expiry_date ? `Expires: ${row.expiry_date}` : ''].filter(Boolean).join('. ')
    case 'AGENCY_CASE_STUDY':
      return [row.project ? `Project: ${row.project}` : '', row.client ? `Client: ${row.client}` : '', row.industry ? `Industry: ${row.industry}` : '', row.challenge ? `Challenge: ${row.challenge}` : '', row.solution ? `Solution: ${row.solution}` : '', row.results ? `Results: ${row.results}` : ''].filter(Boolean).join('. ')
    case 'AGENCY_REFERENCE':
      return [row.contact_name ? `Reference contact: ${row.contact_name}` : '', row.contact_email ? `Email: ${row.contact_email}` : ''].filter(Boolean).join('. ')
    case 'AGENCY_FINANCIAL_RECORD':
      return [row.period_label ? `Financial period: ${row.period_label}` : '', row.annual_turnover !== null && row.annual_turnover !== undefined ? `Annual turnover: ${row.annual_turnover} ${row.currency ?? 'ZAR'}` : ''].filter(Boolean).join('. ')
  }
}

function evidenceStatusOf(entityType: EvidenceEmbeddingEntityType, row: Record<string, unknown>): 'VERIFIED' | 'INFERRED' | 'UNVERIFIED' | 'UNKNOWN' {
  // agency_references carries no evidence_status column at all (Phase
  // 2 schema, verified) — a documented limitation (docs/DECISIONS.md):
  // is_current is used as the closest honest proxy rather than
  // inventing a status the schema never actually tracks.
  if (entityType === 'AGENCY_REFERENCE') return row.is_current ? 'UNVERIFIED' : 'UNKNOWN'
  const status = row.evidence_status ?? row.status
  if (status === 'VERIFIED' || status === 'INFERRED' || status === 'UNVERIFIED' || status === 'UNKNOWN') return status
  return 'UNKNOWN'
}

function sourceActiveOf(entityType: EvidenceEmbeddingEntityType, row: Record<string, unknown>): boolean {
  // Only agency_documents/agency_certificates carry a real
  // supersession-capable lifecycle_status (Phase 8 migration). The
  // other three evidence types have no equivalent concept in this
  // schema, so they are treated as always-active — a documented
  // limitation, not a fabricated signal (docs/DECISIONS.md).
  if (entityType === 'AGENCY_DOCUMENT' || entityType === 'AGENCY_CERTIFICATE') {
    return row.lifecycle_status === 'VALID' || row.lifecycle_status === 'PENDING_VERIFICATION'
  }
  return true
}

export function createSupabaseEvidenceMatchingStore(supabase: SupabaseClient, embeddingClient: EmbeddingClient, embeddingModel: string): EvidenceMatchingStore {
  async function writeAuditEvent(event: { action: string; agencyId: string; actorId: string | null; entityId: string; oldValue: unknown; newValue: unknown }) {
    const { error } = await supabase.from('audit_logs').insert({
      agency_id: event.agencyId,
      actor_id: event.actorId,
      actor_type: 'USER',
      action: event.action,
      entity_type: 'bid_evidence_match',
      entity_id: event.entityId,
      old_value: event.oldValue as never,
      new_value: event.newValue as never,
    })
    if (error) throw error
  }

  async function loadEntityRow(entityType: EvidenceEmbeddingEntityType, entityId: string, agencyId: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await supabase.from(ENTITY_TABLE[entityType]).select('*').eq('id', entityId).eq('agency_id', agencyId).maybeSingle()
    if (error) throw error
    return data
  }

  async function embedAllPendingForAgency(agencyId: string) {
    let processed = 0
    let ready = 0
    let failed = 0
    let skipped = 0

    for (const entityType of Object.keys(ENTITY_TABLE) as EvidenceEmbeddingEntityType[]) {
      const { data: rows, error } = await supabase.from(ENTITY_TABLE[entityType]).select('*').eq('agency_id', agencyId)
      if (error) throw error
      for (const row of rows ?? []) {
        const ref: EmbeddableEntityRef = { agencyId, entityType, entityId: row.id as string }
        const fkColumn = ENTITY_FK_COLUMN[entityType]
        const outcome = await embedAgencyEvidence(ref, {
          embeddingClient,
          embeddingModel,
          nowIso: () => new Date().toISOString(),
          async loadEntityContent(r) {
            const entityRow = await loadEntityRow(r.entityType, r.entityId, r.agencyId)
            if (!entityRow) return null
            return { content: buildContent(r.entityType, entityRow) }
          },
          async getExistingEmbeddingRecord(r) {
            const { data, error: e } = await supabase.from('agency_evidence_embeddings').select('id, status, content_hash').eq('agency_id', r.agencyId).eq('entity_type', r.entityType).eq(fkColumn, r.entityId).maybeSingle()
            if (e) throw e
            if (!data) return null
            return { id: data.id, status: data.status, contentHash: data.content_hash }
          },
          async markQueued(r, contentHash) {
            const { error: e } = await supabase.from('agency_evidence_embeddings').upsert({ agency_id: r.agencyId, entity_type: r.entityType, [fkColumn]: r.entityId, status: 'QUEUED', content_hash: contentHash, queued_at: new Date().toISOString() }, { onConflict: fkColumn })
            if (e) throw e
          },
          async markProcessing(r) {
            const { error: e } = await supabase.from('agency_evidence_embeddings').update({ status: 'PROCESSING' }).eq('agency_id', r.agencyId).eq('entity_type', r.entityType).eq(fkColumn, r.entityId)
            if (e) throw e
          },
          async markReady(r, patch) {
            const { error: e } = await supabase
              .from('agency_evidence_embeddings')
              .update({ status: 'READY', embedding: patch.embedding, content_hash: patch.contentHash, embedded_content: patch.embeddedContent, embedding_model: patch.model, embedded_at: patch.embeddedAt, last_error: null })
              .eq('agency_id', r.agencyId)
              .eq('entity_type', r.entityType)
              .eq(fkColumn, r.entityId)
            if (e) throw e
          },
          async markFailed(r, patch) {
            const { error: e } = await supabase.from('agency_evidence_embeddings').update({ status: 'FAILED', last_error: patch.error }).eq('agency_id', r.agencyId).eq('entity_type', r.entityType).eq(fkColumn, r.entityId)
            if (e) throw e
          },
        })
        processed += 1
        if (outcome.status === 'READY' && !outcome.skipped) ready += 1
        else if (outcome.skipped) skipped += 1
        else if (outcome.status === 'FAILED') failed += 1
      }
    }
    return { processed, ready, failed, skipped }
  }

  async function fetchPriorHistoryCounts(agencyId: string, entityType: EvidenceEmbeddingEntityType, entityId: string) {
    const fkColumn = ENTITY_FK_COLUMN[entityType]
    const { data, error } = await supabase.from('bid_evidence_matches').select('status').eq('agency_id', agencyId).eq('candidate_entity_type', entityType).eq(fkColumn, entityId).in('status', ['APPROVED', 'REJECTED'])
    if (error) throw error
    const approvals = (data ?? []).filter((r) => r.status === 'APPROVED').length
    const rejections = (data ?? []).filter((r) => r.status === 'REJECTED').length
    return { approvals, rejections }
  }

  async function generateCandidatesForNeed(bidProjectId: string, agencyId: string, need: { id: string; description: string; severity: string; minimumCount: number }, actorId: string | null): Promise<EvidenceMatchGenerationResult> {
    const nowIso = new Date().toISOString()

    // Skip needs that already have an active, non-superseded APPROVED
    // claim (Phase 13 §E) -- never resurface fresh candidates for an
    // already-satisfied need.
    const { data: activeClaim } = await supabase.from('bid_evidence_claims').select('id').eq('evidence_need_id', need.id).is('revoked_at', null).maybeSingle()
    if (activeClaim) {
      return { evidenceNeedId: need.id, candidatesCreated: 0, matchIds: [] }
    }

    // Retrieval (I/O): embed the need description, then run the
    // agency-scoped vector query via the dedicated Postgres function
    // (Phase 13 §11 binding constraint — never a cross-tenant scan).
    const queryEmbedding = await embeddingClient.embed(need.description, embeddingModel)
    const { data: rpcRows, error: rpcError } = await supabase.rpc('match_agency_evidence_embeddings', { p_agency_id: agencyId, p_query_embedding: queryEmbedding, p_top_k: EVIDENCE_MAX_CANDIDATES_PER_NEED * 3 })
    if (rpcError) throw rpcError

    const candidates: CandidateEmbeddingResult[] = []
    for (const row of rpcRows ?? []) {
      const entityType = row.entity_type as EvidenceEmbeddingEntityType
      const fkColumn = ENTITY_FK_COLUMN[entityType]
      const entityId = row[fkColumn] as string
      // Never resurface a candidate that already carries a current
      // REJECTED (or APPROVED-elsewhere) decision for THIS need --
      // hard-gate precedence: a rejected match must never be silently
      // reconsidered (Phase 13 binding constraint #12).
      const { data: existingCurrent } = await supabase.from('bid_evidence_matches').select('status').eq('evidence_need_id', need.id).eq('candidate_entity_type', entityType).eq(fkColumn, entityId).eq('is_current', true).maybeSingle()
      if (existingCurrent && (existingCurrent.status === 'REJECTED' || existingCurrent.status === 'APPROVED')) continue

      const { approvals, rejections } = await fetchPriorHistoryCounts(agencyId, entityType, entityId)
      candidates.push({
        embeddingId: row.id,
        entityType,
        entityId,
        agencyId,
        similarity: Number(row.similarity),
        embeddingStatus: 'READY',
        embeddedAt: row.embedded_at,
        contentHash: row.content_hash,
        priorApprovalCount: approvals,
        priorRejectionCount: rejections,
      })
    }

    const ranked = rankEvidenceCandidates(
      { id: need.id, description: need.description, severity: need.severity as never, minimumCount: need.minimumCount, allowedEntityTypes: null },
      candidates,
      { nowIso, weights: EVIDENCE_RANKING_WEIGHTS, minSimilarityThreshold: EVIDENCE_MIN_SIMILARITY_THRESHOLD, maxCandidates: EVIDENCE_MAX_CANDIDATES_PER_NEED, recencyHalfLifeDays: EVIDENCE_RECENCY_HALF_LIFE_DAYS },
    )

    const matchIds: string[] = []
    for (const candidate of ranked) {
      const sourceCandidate = candidates.find((c) => c.embeddingId === candidate.embeddingId)
      const entityRow = await loadEntityRow(candidate.entityType, candidate.entityId, agencyId)
      if (!entityRow) continue // validation layer: never persist a reference to evidence that no longer resolves.

      const verification = verifyEvidenceCandidate(
        {
          entityType: candidate.entityType,
          entityId: candidate.entityId,
          candidateAgencyId: agencyId,
          evidenceStatus: evidenceStatusOf(candidate.entityType, entityRow),
          expiryDate: (entityRow.expiry_date as string | null) ?? null,
          sourceActive: sourceActiveOf(candidate.entityType, entityRow),
          embeddingStatus: 'READY',
        },
        { id: need.id, requiredAgencyId: agencyId, allowedEntityTypes: null },
        { nowIso },
      )

      // Supersede any prior CURRENT, non-decided row for this same
      // (need, candidate) pairing before inserting the fresh one
      // (append-only versioning, Phase 13 §5/§F).
      const fkColumn = ENTITY_FK_COLUMN[candidate.entityType]
      const { data: prior } = await supabase.from('bid_evidence_matches').select('id').eq('evidence_need_id', need.id).eq('candidate_entity_type', candidate.entityType).eq(fkColumn, candidate.entityId).eq('is_current', true).maybeSingle()
      if (prior) {
        await supabase.from('bid_evidence_matches').update({ status: 'SUPERSEDED', is_current: false }).eq('id', prior.id)
      }

      const { data: inserted, error: insertError } = await supabase
        .from('bid_evidence_matches')
        .insert({
          bid_project_id: bidProjectId,
          agency_id: agencyId,
          evidence_need_id: need.id,
          candidate_entity_type: candidate.entityType,
          candidate_embedding_id: candidate.embeddingId,
          [fkColumn]: candidate.entityId,
          status: verification.resultingStatus,
          semantic_score: candidate.score,
          rank_factors: candidate.factors,
          rationale: candidate.rationale,
          verification_result: { checks: verification.checks },
          verification_passed: verification.passed,
          supersedes_match_id: prior?.id ?? null,
          input_snapshot: { needDescription: need.description, minimumCount: need.minimumCount, contentHash: sourceCandidate?.contentHash ?? null },
        })
        .select('id')
        .single()
      if (insertError) throw insertError
      matchIds.push(inserted.id)
    }

    await writeAuditEvent({ action: 'EVIDENCE_MATCH_CANDIDATES_GENERATED', agencyId, actorId, entityId: need.id, oldValue: null, newValue: { candidateCount: matchIds.length } })
    return { evidenceNeedId: need.id, candidatesCreated: matchIds.length, matchIds }
  }

  function toRecord(row: Record<string, unknown>): BidEvidenceMatchRecord {
    const fkColumn = ENTITY_FK_COLUMN[row.candidate_entity_type as EvidenceEmbeddingEntityType]
    return {
      id: row.id as string,
      bidProjectId: row.bid_project_id as string,
      agencyId: row.agency_id as string,
      evidenceNeedId: row.evidence_need_id as string,
      candidateEntityType: row.candidate_entity_type as EvidenceEmbeddingEntityType,
      status: row.status as never,
      semanticScore: row.semantic_score === null ? null : Number(row.semantic_score),
      rankFactors: (row.rank_factors as Record<string, unknown>) ?? {},
      rationale: (row.rationale as string) ?? null,
      verificationResult: (row.verification_result as Record<string, unknown>) ?? {},
      verificationPassed: row.verification_passed as boolean | null,
      decidedBy: (row.decided_by as string) ?? null,
      decidedAt: (row.decided_at as string) ?? null,
      rejectionReason: (row.rejection_reason as string) ?? null,
      isCurrent: Boolean(row.is_current),
      isStale: Boolean(row.is_stale),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      entityId: row[fkColumn] as string,
    }
  }

  return {
    async generateCandidatesForProject(bidProjectId, agencyId, evidenceNeedId, actorId) {
      let query = supabase.from('bid_evidence_needs').select('id, description, severity, minimum_count, status').eq('bid_project_id', bidProjectId).in('status', ['OPEN', 'PARTIALLY_SATISFIED'])
      if (evidenceNeedId) query = query.eq('id', evidenceNeedId)
      const { data: needs, error } = await query
      if (error) throw error

      const results: EvidenceMatchGenerationResult[] = []
      for (const need of needs ?? []) {
        results.push(await generateCandidatesForNeed(bidProjectId, agencyId, { id: need.id, description: need.description, severity: need.severity, minimumCount: need.minimum_count }, actorId))
      }
      return results
    },

    async listMatchesForProject(bidProjectId, agencyId) {
      const { data, error } = await supabase.from('bid_evidence_matches').select('*').eq('bid_project_id', bidProjectId).eq('agency_id', agencyId).order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map(toRecord)
    },

    async getMatch(matchId) {
      const { data, error } = await supabase.from('bid_evidence_matches').select('*').eq('id', matchId).maybeSingle()
      if (error) throw error
      return data ? toRecord(data) : null
    },

    async approveMatch(matchId, agencyId, actorId) {
      const { data: current, error: fetchError } = await supabase.from('bid_evidence_matches').select('*').eq('id', matchId).eq('agency_id', agencyId).maybeSingle()
      if (fetchError) throw fetchError
      if (!current) throw new Error('Evidence match not found.')
      if (current.status === 'APPROVED' || current.status === 'REJECTED') throw new Error(`This match is already decided (${current.status}) and is immutable.`)

      const { data: updated, error } = await supabase.from('bid_evidence_matches').update({ status: 'APPROVED', decided_by: actorId, decided_at: new Date().toISOString() }).eq('id', matchId).select('*').single()
      if (error) throw error

      // Revoke any prior active claim for this need (a need can have at
      // most one active claim at a time -- see the DB unique index),
      // then insert the new authoritative claim.
      await supabase.from('bid_evidence_claims').update({ revoked_at: new Date().toISOString(), revoked_by: actorId, revoked_reason: 'Superseded by a newly approved evidence match.' }).eq('evidence_need_id', current.evidence_need_id).is('revoked_at', null)

      const fkColumn = ENTITY_FK_COLUMN[current.candidate_entity_type as EvidenceEmbeddingEntityType]
      const { error: claimError } = await supabase.from('bid_evidence_claims').insert({
        bid_project_id: current.bid_project_id,
        agency_id: agencyId,
        evidence_need_id: current.evidence_need_id,
        match_id: matchId,
        candidate_entity_type: current.candidate_entity_type,
        [fkColumn]: current[fkColumn],
        approved_by: actorId,
      })
      if (claimError) throw claimError

      await writeAuditEvent({ action: 'EVIDENCE_MATCH_APPROVED', agencyId, actorId, entityId: matchId, oldValue: { status: current.status }, newValue: { status: 'APPROVED' } })
      return toRecord(updated)
    },

    async rejectMatch(matchId, agencyId, actorId, reason) {
      const { data: current, error: fetchError } = await supabase.from('bid_evidence_matches').select('*').eq('id', matchId).eq('agency_id', agencyId).maybeSingle()
      if (fetchError) throw fetchError
      if (!current) throw new Error('Evidence match not found.')
      if (current.status === 'APPROVED' || current.status === 'REJECTED') throw new Error(`This match is already decided (${current.status}) and is immutable.`)

      const { data: updated, error } = await supabase.from('bid_evidence_matches').update({ status: 'REJECTED', decided_by: actorId, decided_at: new Date().toISOString(), rejection_reason: reason }).eq('id', matchId).select('*').single()
      if (error) throw error

      await writeAuditEvent({ action: 'EVIDENCE_MATCH_REJECTED', agencyId, actorId, entityId: matchId, oldValue: { status: current.status }, newValue: { status: 'REJECTED', reason } })
      return toRecord(updated)
    },

    async listClaimsForProject(bidProjectId, agencyId) {
      const { data, error } = await supabase.from('bid_evidence_claims').select('*').eq('bid_project_id', bidProjectId).eq('agency_id', agencyId).is('revoked_at', null).order('approved_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },

    async computeGapsForProject(bidProjectId, agencyId) {
      const { data: needs, error } = await supabase.from('bid_evidence_needs').select('id, minimum_count, severity, status').eq('bid_project_id', bidProjectId)
      if (error) throw error

      const results = []
      for (const need of needs ?? []) {
        const { count: approvedCount } = await supabase.from('bid_evidence_claims').select('id', { count: 'exact', head: true }).eq('evidence_need_id', need.id).is('revoked_at', null)
        const { data: rejectedOrNone } = await supabase.from('bid_evidence_matches').select('status').eq('evidence_need_id', need.id).eq('is_current', true)
        const hasOnlyRejectedOrNoCandidates = (rejectedOrNone ?? []).length === 0 || (rejectedOrNone ?? []).every((m) => m.status === 'REJECTED')

        const gap = computeEvidenceGap({ need: { id: need.id, minimumCount: need.minimum_count, severity: need.severity, currentStatus: need.status }, approvedClaimCount: approvedCount ?? 0, hasOnlyRejectedOrNoCandidates })

        if (gap.recommendedStatus !== need.status) {
          await supabase.from('bid_evidence_needs').update({ status: gap.recommendedStatus, current_count: approvedCount ?? 0 }).eq('id', need.id)
        }
        if (gap.isGap) results.push({ ...gap, severity: need.severity, agencyId })
      }
      return results
    },

    async backfillEmbeddingsForAgency(agencyId) {
      return embedAllPendingForAgency(agencyId)
    },
  }
}

/** Phase 13 §F — recomputes staleness for a project's current matches by comparing the recorded input_snapshot against a freshly-built one; flags is_stale rather than silently presenting a decided match as current. Exposed separately so routes/scripts can call it without re-running the full generation pipeline. */
export async function recomputeMatchStaleness(supabase: SupabaseClient, bidProjectId: string): Promise<number> {
  const { data: matches, error } = await supabase.from('bid_evidence_matches').select('id, evidence_need_id, input_snapshot').eq('bid_project_id', bidProjectId).eq('is_current', true)
  if (error) throw error
  let flagged = 0
  for (const match of matches ?? []) {
    const { data: need } = await supabase.from('bid_evidence_needs').select('description, minimum_count').eq('id', match.evidence_need_id).maybeSingle()
    if (!need) continue
    const fresh = { needDescription: need.description, minimumCount: need.minimum_count, contentHash: (match.input_snapshot as Record<string, unknown>)?.contentHash }
    if (isSnapshotStale(match.input_snapshot as Record<string, unknown>, fresh)) {
      await supabase.from('bid_evidence_matches').update({ is_stale: true }).eq('id', match.id)
      flagged += 1
    }
  }
  return flagged
}
