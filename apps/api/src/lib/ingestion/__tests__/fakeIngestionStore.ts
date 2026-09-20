import { randomUUID } from 'node:crypto'
import type { TenderRow, TenderSourceRecordRow, TenderSourceScanRow } from '@tender-os/schemas'
import type { CreateTenderInput } from '../../../repositories/tenders.js'
import type { IngestionStore } from '../store.js'
import { deriveTenderStatus, isAutoDerivableStatus } from '../deriveTenderStatus.js'

/**
 * Minimal in-memory `IngestionStore` for scanRunner unit tests — not
 * a database, just enough state to assert the runner's own
 * orchestration logic (creates vs. updates vs. errors, counts,
 * lifecycle transitions) without a real Postgres instance. The real
 * write path is exercised for real in
 * `ingestion.integration.test.ts` (Phase 5 §29) via a raw-`pg`-backed
 * store.
 */
export function createFakeIngestionStore() {
  const scans = new Map<string, TenderSourceScanRow>()
  const errorLog: Array<Record<string, unknown>> = []
  const sourceRecords = new Map<string, TenderSourceRecordRow>()
  const tenders = new Map<string, TenderRow>()
  const documents = new Map<string, { id: string }>()
  const addenda: Array<Record<string, unknown>> = []

  function nowIso() {
    return new Date().toISOString()
  }

  const store: IngestionStore = {
    async createScan(input) {
      const row: TenderSourceScanRow = {
        id: randomUUID(),
        source_id: input.sourceId,
        started_at: nowIso(),
        completed_at: null,
        status: 'QUEUED',
        records_discovered: 0,
        records_processed: 0,
        records_failed: 0,
        documents_discovered: 0,
        records_duplicate: 0,
        retry_count: 0,
        error_count: 0,
        error_message: null,
        execution_id: input.executionId,
        adapter_version: input.adapterVersion,
        created_at: nowIso(),
      }
      scans.set(row.id, row)
      return row
    },
    async updateScan(id, patch) {
      const existing = scans.get(id)
      if (!existing) throw new Error('scan not found')
      const updated: TenderSourceScanRow = {
        ...existing,
        status: patch.status ?? existing.status,
        completed_at: patch.completedAt ?? existing.completed_at,
        records_discovered: patch.recordsDiscovered ?? existing.records_discovered,
        records_processed: patch.recordsProcessed ?? existing.records_processed,
        records_failed: patch.recordsFailed ?? existing.records_failed,
        documents_discovered: patch.documentsDiscovered ?? existing.documents_discovered,
        records_duplicate: patch.recordsDuplicate ?? existing.records_duplicate,
        retry_count: patch.retryCount ?? existing.retry_count,
        error_count: patch.errorCount ?? existing.error_count,
        error_message: patch.errorMessage ?? existing.error_message,
      }
      scans.set(id, updated)
      return updated
    },
    async createError(input) {
      errorLog.push(input)
    },
    async findSourceRecordByExternalId(sourceId, externalId) {
      for (const record of sourceRecords.values()) {
        if (record.source_id === sourceId && record.external_id === externalId) return record
      }
      return null
    },
    async createSourceRecord(input) {
      const row: TenderSourceRecordRow = {
        id: randomUUID(),
        tender_id: input.tenderId,
        source_id: input.sourceId,
        external_id: input.externalId,
        source_url: input.sourceUrl,
        discovered_at: nowIso(),
        last_seen_at: nowIso(),
        source_status: 'ACTIVE',
        raw_title: input.rawTitle,
        raw_description: input.rawDescription,
        raw_closing_date: input.rawClosingDate,
        raw_closing_time: input.rawClosingTime,
        raw_organisation: input.rawOrganisation,
        raw_data: input.rawData,
        content_hash: input.contentHash,
        document_hash: null,
        created_at: nowIso(),
        updated_at: nowIso(),
      }
      sourceRecords.set(row.id, row)
      return row
    },
    async updateSourceRecord(id, input) {
      const existing = sourceRecords.get(id)
      if (!existing) throw new Error('source record not found')
      const updated: TenderSourceRecordRow = {
        ...existing,
        tender_id: input.tenderId !== undefined ? input.tenderId : existing.tender_id,
        source_url: input.sourceUrl !== undefined ? input.sourceUrl : existing.source_url,
        raw_title: input.rawTitle !== undefined ? input.rawTitle : existing.raw_title,
        raw_description: input.rawDescription !== undefined ? input.rawDescription : existing.raw_description,
        raw_closing_date: input.rawClosingDate !== undefined ? input.rawClosingDate : existing.raw_closing_date,
        raw_closing_time: input.rawClosingTime !== undefined ? input.rawClosingTime : existing.raw_closing_time,
        raw_organisation: input.rawOrganisation !== undefined ? input.rawOrganisation : existing.raw_organisation,
        raw_data: input.rawData !== undefined ? input.rawData : existing.raw_data,
        content_hash: input.contentHash !== undefined ? input.contentHash : existing.content_hash,
        last_seen_at: input.lastSeenAt,
      }
      sourceRecords.set(id, updated)
      return updated
    },
    async findTenderCandidates({ organisation, tenderNumber }) {
      return [...tenders.values()]
        .filter((t) => (tenderNumber ? t.tender_number === tenderNumber : organisation ? t.organisation === organisation : false))
        .map((t) => ({ id: t.id, tender_number: t.tender_number, organisation: t.organisation, title: t.title, closing_date: t.closing_date }))
    },
    async getTenderById(id) {
      return tenders.get(id) ?? null
    },
    async createTender(input: CreateTenderInput) {
      if (!input.title) throw new Error('title is required')
      const row: TenderRow = {
        id: randomUUID(),
        tender_number: input.tenderNumber,
        title: input.title,
        organisation: input.organisation,
        entity_type: null,
        province: input.province,
        municipality: null,
        category: input.category,
        description: input.description,
        published_date: input.publishedDate,
        closing_date: input.closingDate,
        closing_time: input.closingTime,
        briefing_required: input.briefingRequired ?? false,
        briefing_date: null,
        briefing_location: null,
        briefing_url: null,
        estimated_value: null,
        contract_duration: null,
        submission_method: input.submissionMethod,
        submission_url: null,
        submission_email: null,
        original_document_url: input.originalDocumentUrl,
        status: deriveTenderStatus(input.closingDate),
        confidence_score: null,
        discovered_at: nowIso(),
        verified_at: null,
        created_at: nowIso(),
        updated_at: nowIso(),
      }
      tenders.set(row.id, row)
      return row
    },
    async fillUnknownTenderFields(id, current, candidate) {
      const update: Partial<TenderRow> = {}
      if (current.tender_number === null && candidate.tenderNumber) update.tender_number = candidate.tenderNumber
      if (current.organisation === null && candidate.organisation) update.organisation = candidate.organisation
      if (current.closing_date === null && candidate.closingDate) update.closing_date = candidate.closingDate
      if (current.published_date === null && candidate.publishedDate) update.published_date = candidate.publishedDate
      if (current.original_document_url === null && candidate.originalDocumentUrl) {
        update.original_document_url = candidate.originalDocumentUrl
      }
      if (isAutoDerivableStatus(current.status)) {
        const effectiveClosingDate = update.closing_date ?? current.closing_date
        const derivedStatus = deriveTenderStatus(effectiveClosingDate)
        if (derivedStatus !== current.status) update.status = derivedStatus
      }
      if (Object.keys(update).length === 0) return current
      const updated = { ...current, ...update }
      tenders.set(id, updated)
      return updated
    },
    async findDocumentByTenderAndUrl(tenderId, fileUrl) {
      return documents.get(`${tenderId}:${fileUrl}`) ?? null
    },
    async createTenderDocument(input) {
      const row = { id: randomUUID() }
      documents.set(`${input.tenderId}:${input.fileUrl}`, row)
      return row
    },
    async getNextAddendumNumber(tenderId) {
      const existing = addenda.filter((a) => a.tender_id === tenderId)
      return existing.length === 0 ? 1 : Math.max(...existing.map((a) => a.addendum_number as number)) + 1
    },
    async createTenderAddendum(input) {
      const row = {
        id: randomUUID(),
        tender_id: input.tenderId,
        document_id: null,
        addendum_number: input.addendumNumber,
        published_at: nowIso(),
        summary: input.summary,
        deadline_changed: input.deadlineChanged,
        briefing_changed: input.briefingChanged,
        requirement_changed: input.requirementChanged,
        evaluation_changed: input.evaluationChanged,
        pricing_changed: input.pricingChanged,
        other_changes: input.otherChanges,
        content_hash: input.contentHash,
        impact_assessment: input.impactAssessment,
        detected_via: 'DIFF_ENGINE',
        created_at: nowIso(),
      }
      addenda.push(row)
      return { id: row.id }
    },
  }

  return { store, scans, errorLog, sourceRecords, tenders, documents, addenda }
}
