import type { SupabaseClient } from '@supabase/supabase-js'
import type { BidOutcomeRecord, LossReasonRecord, OutcomeConflictRecord, OutcomeStore, TenderOutcomeRecord } from './store.js'

/** Production OutcomeStore over the service-role Supabase client — bypasses RLS; only ever called from routes/outcomes.ts. */
export function createSupabaseOutcomeStore(supabase: SupabaseClient): OutcomeStore {
  function toTenderOutcome(row: Record<string, unknown>): TenderOutcomeRecord {
    return {
      id: row.id as string,
      tenderId: row.tender_id as string,
      awardId: (row.award_id as string) ?? null,
      outcomeStatus: row.outcome_status as TenderOutcomeRecord['outcomeStatus'],
      publishedDate: (row.published_date as string) ?? null,
      decisionDate: (row.decision_date as string) ?? null,
      winnerName: (row.winner_name as string) ?? null,
      winnerRegistrationNumber: (row.winner_registration_number as string) ?? null,
      winnerProvince: (row.winner_province as string) ?? null,
      winnerEntityType: (row.winner_entity_type as string) ?? null,
      awardValue: row.award_value === null ? null : Number(row.award_value),
      awardCurrency: (row.award_currency as string) ?? 'ZAR',
      contractDuration: (row.contract_duration as string) ?? null,
      procurementMethod: (row.procurement_method as string) ?? null,
      sourceUrl: (row.source_url as string) ?? null,
      sourceDocumentId: (row.source_document_id as string) ?? null,
      sourceEvidenceRef: (row.source_evidence_ref as string) ?? null,
      truthStatus: row.truth_status as TenderOutcomeRecord['truthStatus'],
      provenance: row.provenance as TenderOutcomeRecord['provenance'],
      recordedBy: (row.recorded_by as string) ?? null,
      recordedAt: row.recorded_at as string,
      verifiedBy: (row.verified_by as string) ?? null,
      verifiedAt: (row.verified_at as string) ?? null,
      notes: (row.notes as string) ?? null,
      isCurrent: row.is_current as boolean,
      version: row.version as number,
      supersedesId: (row.supersedes_id as string) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }
  }

  function toBidOutcome(row: Record<string, unknown>): BidOutcomeRecord {
    return {
      id: row.id as string,
      bidProjectId: row.bid_project_id as string,
      agencyId: row.agency_id as string,
      tenderId: row.tender_id as string,
      tenderOutcomeId: (row.tender_outcome_id as string) ?? null,
      ourResult: row.our_result as BidOutcomeRecord['ourResult'],
      ourRank: row.our_rank === null || row.our_rank === undefined ? null : Number(row.our_rank),
      ourScore: row.our_score === null || row.our_score === undefined ? null : Number(row.our_score),
      winningScore: row.winning_score === null || row.winning_score === undefined ? null : Number(row.winning_score),
      disqualificationReason: (row.disqualification_reason as string) ?? null,
      submissionStatusSnapshot: row.submission_status_snapshot as string,
      reconciliationBasis: (row.reconciliation_basis as string) ?? null,
      reconciledAt: (row.reconciled_at as string) ?? null,
      truthStatus: row.truth_status as BidOutcomeRecord['truthStatus'],
      provenance: row.provenance as BidOutcomeRecord['provenance'],
      recordedBy: (row.recorded_by as string) ?? null,
      recordedAt: row.recorded_at as string,
      verifiedBy: (row.verified_by as string) ?? null,
      verifiedAt: (row.verified_at as string) ?? null,
      notes: (row.notes as string) ?? null,
      isCurrent: row.is_current as boolean,
      version: row.version as number,
    }
  }

  function toLossReason(row: Record<string, unknown>): LossReasonRecord {
    return {
      id: row.id as string,
      bidOutcomeId: row.bid_outcome_id as string,
      agencyId: row.agency_id as string,
      category: row.category as LossReasonRecord['category'],
      isPrimary: row.is_primary as boolean,
      provenance: row.provenance as LossReasonRecord['provenance'],
      sourceDocumentId: (row.source_document_id as string) ?? null,
      notes: (row.notes as string) ?? null,
      recordedBy: (row.recorded_by as string) ?? null,
      recordedAt: row.recorded_at as string,
    }
  }

  function toConflict(row: Record<string, unknown>): OutcomeConflictRecord {
    return {
      id: row.id as string,
      tenderOutcomeId: row.tender_outcome_id as string,
      fieldName: row.field_name as string,
      existingValue: (row.existing_value as string) ?? null,
      conflictingValue: (row.conflicting_value as string) ?? null,
      existingSource: (row.existing_source as string) ?? null,
      conflictingSource: (row.conflicting_source as string) ?? null,
      status: row.status as OutcomeConflictRecord['status'],
      discoveredAt: row.discovered_at as string,
      resolvedBy: (row.resolved_by as string) ?? null,
      resolvedAt: (row.resolved_at as string) ?? null,
      resolutionNotes: (row.resolution_notes as string) ?? null,
    }
  }

  return {
    async listTenderOutcomes(filters) {
      let query = supabase.from('tender_outcomes').select('*').order('recorded_at', { ascending: false }).limit(filters.limit)
      if (filters.tenderId) query = query.eq('tender_id', filters.tenderId)
      if (filters.outcomeStatus) query = query.eq('outcome_status', filters.outcomeStatus)
      const { data } = await query
      return (data ?? []).map(toTenderOutcome)
    },
    async getTenderOutcome(id) {
      const { data } = await supabase.from('tender_outcomes').select('*').eq('id', id).maybeSingle()
      return data ? toTenderOutcome(data) : null
    },
    async getCurrentTenderOutcomeForTender(tenderId) {
      const { data } = await supabase.from('tender_outcomes').select('*').eq('tender_id', tenderId).eq('is_current', true).maybeSingle()
      return data ? toTenderOutcome(data) : null
    },
    async createTenderOutcome(record) {
      if (record.isCurrent) {
        await supabase.from('tender_outcomes').update({ is_current: false }).eq('tender_id', record.tenderId).eq('is_current', true)
      }
      const { data, error } = await supabase
        .from('tender_outcomes')
        .insert({
          tender_id: record.tenderId,
          award_id: record.awardId,
          outcome_status: record.outcomeStatus,
          published_date: record.publishedDate,
          decision_date: record.decisionDate,
          winner_name: record.winnerName,
          winner_registration_number: record.winnerRegistrationNumber,
          winner_province: record.winnerProvince,
          winner_entity_type: record.winnerEntityType,
          award_value: record.awardValue,
          award_currency: record.awardCurrency,
          contract_duration: record.contractDuration,
          procurement_method: record.procurementMethod,
          source_url: record.sourceUrl,
          source_document_id: record.sourceDocumentId,
          source_evidence_ref: record.sourceEvidenceRef,
          truth_status: record.truthStatus,
          provenance: record.provenance,
          recorded_by: record.recordedBy,
          verified_by: record.verifiedBy,
          verified_at: record.verifiedAt,
          notes: record.notes,
          is_current: record.isCurrent,
          version: record.version,
          supersedes_id: record.supersedesId,
        })
        .select('*')
        .single()
      if (error || !data) throw new Error(error?.message ?? 'failed to create tender outcome')
      return toTenderOutcome(data)
    },
    async updateTenderOutcome(id, patch) {
      const row: Record<string, unknown> = {}
      if (patch.notes !== undefined) row.notes = patch.notes
      if (patch.truthStatus !== undefined) row.truth_status = patch.truthStatus
      if (patch.outcomeStatus !== undefined) row.outcome_status = patch.outcomeStatus
      const { data, error } = await supabase.from('tender_outcomes').update(row).eq('id', id).select('*').single()
      if (error || !data) throw new Error(error?.message ?? 'failed to update tender outcome')
      return toTenderOutcome(data)
    },
    async verifyTenderOutcome(id, verifiedBy, verifiedAt) {
      const { data, error } = await supabase.from('tender_outcomes').update({ truth_status: 'VERIFIED', verified_by: verifiedBy, verified_at: verifiedAt }).eq('id', id).select('*').single()
      if (error || !data) throw new Error(error?.message ?? 'failed to verify tender outcome')
      return toTenderOutcome(data)
    },
    async getBidOutcome(bidProjectId) {
      const { data } = await supabase.from('bid_outcomes').select('*').eq('bid_project_id', bidProjectId).eq('is_current', true).maybeSingle()
      return data ? toBidOutcome(data) : null
    },
    async upsertBidOutcome(record) {
      await supabase.from('bid_outcomes').update({ is_current: false }).eq('bid_project_id', record.bidProjectId).eq('is_current', true)
      const { data, error } = await supabase
        .from('bid_outcomes')
        .insert({
          bid_project_id: record.bidProjectId,
          agency_id: record.agencyId,
          tender_id: record.tenderId,
          tender_outcome_id: record.tenderOutcomeId,
          our_result: record.ourResult,
          our_rank: record.ourRank,
          our_score: record.ourScore,
          winning_score: record.winningScore,
          disqualification_reason: record.disqualificationReason,
          submission_status_snapshot: record.submissionStatusSnapshot,
          reconciliation_basis: record.reconciliationBasis,
          reconciled_at: record.reconciledAt,
          truth_status: record.truthStatus,
          provenance: record.provenance,
          recorded_by: record.recordedBy,
          verified_by: record.verifiedBy,
          verified_at: record.verifiedAt,
          notes: record.notes,
          is_current: record.isCurrent,
          version: record.version,
        })
        .select('*')
        .single()
      if (error || !data) throw new Error(error?.message ?? 'failed to upsert bid outcome')
      return toBidOutcome(data)
    },
    async addLossReason(record) {
      const { data, error } = await supabase
        .from('loss_reasons')
        .insert({
          bid_outcome_id: record.bidOutcomeId,
          agency_id: record.agencyId,
          category: record.category,
          is_primary: record.isPrimary,
          provenance: record.provenance,
          source_document_id: record.sourceDocumentId,
          notes: record.notes,
          recorded_by: record.recordedBy,
        })
        .select('*')
        .single()
      if (error || !data) throw new Error(error?.message ?? 'failed to add loss reason')
      return toLossReason(data)
    },
    async listLossReasons(bidOutcomeId) {
      const { data } = await supabase.from('loss_reasons').select('*').eq('bid_outcome_id', bidOutcomeId).order('recorded_at', { ascending: false })
      return (data ?? []).map(toLossReason)
    },
    async createConflict(record) {
      const { data, error } = await supabase
        .from('outcome_conflicts')
        .insert({
          tender_outcome_id: record.tenderOutcomeId,
          field_name: record.fieldName,
          existing_value: record.existingValue,
          conflicting_value: record.conflictingValue,
          existing_source: record.existingSource,
          conflicting_source: record.conflictingSource,
          status: record.status,
        })
        .select('*')
        .single()
      if (error || !data) throw new Error(error?.message ?? 'failed to create conflict')
      return toConflict(data)
    },
    async listConflicts(tenderOutcomeId) {
      const { data } = await supabase.from('outcome_conflicts').select('*').eq('tender_outcome_id', tenderOutcomeId).order('discovered_at', { ascending: false })
      return (data ?? []).map(toConflict)
    },
    async resolveConflict(id, status, resolvedBy, resolvedAt, notes) {
      const { data, error } = await supabase.from('outcome_conflicts').update({ status, resolved_by: resolvedBy, resolved_at: resolvedAt, resolution_notes: notes }).eq('id', id).select('*').single()
      if (error || !data) throw new Error(error?.message ?? 'failed to resolve conflict')
      return toConflict(data)
    },
  }
}
