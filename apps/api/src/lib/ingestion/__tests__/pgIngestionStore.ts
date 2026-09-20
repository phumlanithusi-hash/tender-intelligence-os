import type pg from 'pg'
import type { TenderRow, TenderSourceRecordRow, TenderSourceScanRow } from '@tender-os/schemas'
import type { CreateTenderInput } from '../../../repositories/tenders.js'
import type { IngestionStore } from '../store.js'
import { deriveTenderStatus, isAutoDerivableStatus } from '../deriveTenderStatus.js'

/**
 * Test-only `IngestionStore` backed directly by a real Postgres
 * connection (raw `pg`, not supabase-js) — see store.ts's doc comment
 * for why this seam exists: this sandbox has no running PostgREST
 * endpoint, so a true end-to-end database integration test (Phase 5
 * §29) can only reach the real schema this way. Every write here goes
 * through the exact same tables/constraints/triggers the production
 * Supabase-backed store writes to (this is the real
 * `database/migrations` schema, not a mock) — only the client library
 * differs.
 */
export function createPgIngestionStore(pool: pg.Pool): IngestionStore {
  return {
    async createScan({ sourceId, executionId, adapterVersion }) {
      const { rows } = await pool.query(
        `insert into tender_source_scans (source_id, status, execution_id, adapter_version)
         values ($1, 'QUEUED', $2, $3) returning *`,
        [sourceId, executionId, adapterVersion],
      )
      return mapScan(rows[0])
    },

    async updateScan(id, patch) {
      const { rows } = await pool.query(
        `update tender_source_scans set
           status = coalesce($2, status),
           completed_at = coalesce($3, completed_at),
           records_discovered = coalesce($4, records_discovered),
           records_processed = coalesce($5, records_processed),
           records_failed = coalesce($6, records_failed),
           documents_discovered = coalesce($7, documents_discovered),
           error_count = coalesce($8, error_count),
           error_message = coalesce($9, error_message),
           records_duplicate = coalesce($10, records_duplicate),
           retry_count = coalesce($11, retry_count)
         where id = $1 returning *`,
        [
          id,
          patch.status ?? null,
          patch.completedAt ?? null,
          patch.recordsDiscovered ?? null,
          patch.recordsProcessed ?? null,
          patch.recordsFailed ?? null,
          patch.documentsDiscovered ?? null,
          patch.errorCount ?? null,
          patch.errorMessage ?? null,
          patch.recordsDuplicate ?? null,
          patch.retryCount ?? null,
        ],
      )
      return mapScan(rows[0])
    },

    async createError(input) {
      await pool.query(
        `insert into tender_source_errors
           (source_id, scan_id, error_type, severity, message, url, status_code, retryable, metadata)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          input.sourceId,
          input.scanId,
          input.errorType,
          input.severity,
          input.message,
          input.url,
          input.statusCode,
          input.retryable,
          input.metadata ? JSON.stringify(input.metadata) : null,
        ],
      )
    },

    async findSourceRecordByExternalId(sourceId, externalId) {
      const { rows } = await pool.query(
        `select * from tender_source_records where source_id = $1 and external_id = $2`,
        [sourceId, externalId],
      )
      return rows[0] ? mapSourceRecord(rows[0]) : null
    },

    async createSourceRecord(input) {
      const { rows } = await pool.query(
        `insert into tender_source_records
           (tender_id, source_id, external_id, source_url, raw_title, raw_description,
            raw_closing_date, raw_closing_time, raw_organisation, raw_data, content_hash)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
        [
          input.tenderId,
          input.sourceId,
          input.externalId,
          input.sourceUrl,
          input.rawTitle,
          input.rawDescription,
          input.rawClosingDate,
          input.rawClosingTime,
          input.rawOrganisation,
          input.rawData ? JSON.stringify(input.rawData) : null,
          input.contentHash,
        ],
      )
      return mapSourceRecord(rows[0])
    },

    async updateSourceRecord(id, input) {
      const { rows } = await pool.query(
        `update tender_source_records set
           tender_id = coalesce($2, tender_id),
           source_url = coalesce($3, source_url),
           raw_title = coalesce($4, raw_title),
           raw_description = coalesce($5, raw_description),
           raw_closing_date = coalesce($6, raw_closing_date),
           raw_closing_time = coalesce($7, raw_closing_time),
           raw_organisation = coalesce($8, raw_organisation),
           raw_data = coalesce($9, raw_data),
           content_hash = coalesce($10, content_hash),
           last_seen_at = $11
         where id = $1 returning *`,
        [
          id,
          input.tenderId ?? null,
          input.sourceUrl ?? null,
          input.rawTitle ?? null,
          input.rawDescription ?? null,
          input.rawClosingDate ?? null,
          input.rawClosingTime ?? null,
          input.rawOrganisation ?? null,
          input.rawData ? JSON.stringify(input.rawData) : null,
          input.contentHash ?? null,
          input.lastSeenAt,
        ],
      )
      return mapSourceRecord(rows[0])
    },

    async findTenderCandidates({ organisation, tenderNumber }) {
      if (tenderNumber) {
        const { rows } = await pool.query(
          `select id, tender_number, organisation, title, closing_date from tenders where tender_number = $1`,
          [tenderNumber],
        )
        return rows
      }
      if (organisation) {
        const { rows } = await pool.query(
          `select id, tender_number, organisation, title, closing_date from tenders where organisation = $1`,
          [organisation],
        )
        return rows
      }
      return []
    },

    async getTenderById(id) {
      const { rows } = await pool.query(`select * from tenders where id = $1`, [id])
      return rows[0] ? mapTender(rows[0]) : null
    },

    async createTender(input: CreateTenderInput) {
      const { rows } = await pool.query(
        `insert into tenders
           (tender_number, title, organisation, province, category, description,
            published_date, closing_date, closing_time, submission_method,
            original_document_url, status, briefing_required)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, coalesce($13, false))
         returning *`,
        [
          input.tenderNumber,
          input.title,
          input.organisation,
          input.province,
          input.category,
          input.description,
          input.publishedDate,
          input.closingDate,
          input.closingTime,
          input.submissionMethod,
          input.originalDocumentUrl,
          deriveTenderStatus(input.closingDate),
          input.briefingRequired,
        ],
      )
      return mapTender(rows[0])
    },

    async fillUnknownTenderFields(id, current, candidate) {
      const update: Record<string, unknown> = {}
      if (current.tender_number === null && candidate.tenderNumber) update.tender_number = candidate.tenderNumber
      if (current.organisation === null && candidate.organisation) update.organisation = candidate.organisation
      if (current.closing_date === null && candidate.closingDate) update.closing_date = candidate.closingDate
      if (current.published_date === null && candidate.publishedDate) update.published_date = candidate.publishedDate
      if (current.original_document_url === null && candidate.originalDocumentUrl) {
        update.original_document_url = candidate.originalDocumentUrl
      }
      if (isAutoDerivableStatus(current.status)) {
        const effectiveClosingDate = (update.closing_date as string | undefined) ?? current.closing_date
        const derivedStatus = deriveTenderStatus(effectiveClosingDate)
        if (derivedStatus !== current.status) update.status = derivedStatus
      }
      if (Object.keys(update).length === 0) return current

      const setClauses = Object.keys(update).map((key, i) => `${key} = $${i + 2}`)
      const { rows } = await pool.query(
        `update tenders set ${setClauses.join(', ')} where id = $1 returning *`,
        [id, ...Object.values(update)],
      )
      return mapTender(rows[0])
    },

    async findDocumentByTenderAndUrl(tenderId, fileUrl) {
      const { rows } = await pool.query(`select id from tender_documents where tender_id = $1 and file_url = $2`, [
        tenderId,
        fileUrl,
      ])
      return rows[0] ? { id: rows[0].id as string } : null
    },

    async createTenderDocument(input) {
      const { rows } = await pool.query(
        `insert into tender_documents
           (tender_id, source_id, document_type, filename, file_url, mime_type, version,
            published_at, is_original, is_addendum, extraction_status)
         values ($1,$2,'OTHER',$3,$4,$5,1,$6,true,false,'NOT_APPLICABLE')
         returning id`,
        [input.tenderId, input.sourceId, input.filename, input.fileUrl, input.mimeType, input.publishedAt],
      )
      return { id: rows[0].id as string }
    },

    async getNextAddendumNumber(tenderId) {
      const { rows } = await pool.query(
        `select max(addendum_number) as max_number from tender_addenda where tender_id = $1`,
        [tenderId],
      )
      const max = rows[0]?.max_number as number | null
      return (max ?? 0) + 1
    },

    async createTenderAddendum(input) {
      const { rows } = await pool.query(
        `insert into tender_addenda
           (tender_id, document_id, addendum_number, published_at, summary,
            deadline_changed, briefing_changed, requirement_changed, evaluation_changed, pricing_changed,
            other_changes, content_hash, impact_assessment, detected_via)
         values ($1, null, $2, now(), $3, $4, $5, $6, $7, $8, $9, $10, $11, 'DIFF_ENGINE')
         returning id`,
        [
          input.tenderId,
          input.addendumNumber,
          input.summary,
          input.deadlineChanged,
          input.briefingChanged,
          input.requirementChanged,
          input.evaluationChanged,
          input.pricingChanged,
          input.otherChanges,
          input.contentHash,
          JSON.stringify(input.impactAssessment),
        ],
      )
      return { id: rows[0].id as string }
    },
  }
}

function mapScan(row: Record<string, unknown>): TenderSourceScanRow {
  return {
    id: row.id as string,
    source_id: row.source_id as string,
    started_at: toIso(row.started_at),
    completed_at: row.completed_at ? toIso(row.completed_at) : null,
    status: row.status as TenderSourceScanRow['status'],
    records_discovered: Number(row.records_discovered),
    records_processed: Number(row.records_processed),
    records_failed: Number(row.records_failed),
    documents_discovered: Number(row.documents_discovered),
    records_duplicate: Number(row.records_duplicate ?? 0),
    retry_count: Number(row.retry_count ?? 0),
    error_count: Number(row.error_count),
    error_message: (row.error_message as string | null) ?? null,
    execution_id: (row.execution_id as string | null) ?? null,
    adapter_version: (row.adapter_version as string | null) ?? null,
    created_at: toIso(row.created_at),
  }
}

function mapSourceRecord(row: Record<string, unknown>): TenderSourceRecordRow {
  return {
    id: row.id as string,
    tender_id: (row.tender_id as string | null) ?? null,
    source_id: row.source_id as string,
    external_id: (row.external_id as string | null) ?? null,
    source_url: (row.source_url as string | null) ?? null,
    discovered_at: toIso(row.discovered_at),
    last_seen_at: toIso(row.last_seen_at),
    source_status: row.source_status as TenderSourceRecordRow['source_status'],
    raw_title: (row.raw_title as string | null) ?? null,
    raw_description: (row.raw_description as string | null) ?? null,
    raw_closing_date: (row.raw_closing_date as string | null) ?? null,
    raw_closing_time: (row.raw_closing_time as string | null) ?? null,
    raw_organisation: (row.raw_organisation as string | null) ?? null,
    raw_data: (row.raw_data as Record<string, unknown> | null) ?? null,
    content_hash: (row.content_hash as string | null) ?? null,
    document_hash: (row.document_hash as string | null) ?? null,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  }
}

function mapTender(row: Record<string, unknown>): TenderRow {
  return {
    id: row.id as string,
    tender_number: (row.tender_number as string | null) ?? null,
    title: row.title as string,
    organisation: (row.organisation as string | null) ?? null,
    entity_type: (row.entity_type as string | null) ?? null,
    province: (row.province as string | null) ?? null,
    municipality: (row.municipality as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    published_date: row.published_date ? toIso(row.published_date).slice(0, 10) : null,
    closing_date: row.closing_date ? toIso(row.closing_date).slice(0, 10) : null,
    closing_time: (row.closing_time as string | null) ?? null,
    briefing_required: Boolean(row.briefing_required),
    briefing_date: row.briefing_date ? toIso(row.briefing_date).slice(0, 10) : null,
    briefing_location: (row.briefing_location as string | null) ?? null,
    briefing_url: (row.briefing_url as string | null) ?? null,
    estimated_value: row.estimated_value !== null ? Number(row.estimated_value) : null,
    contract_duration: (row.contract_duration as string | null) ?? null,
    submission_method: (row.submission_method as string | null) ?? null,
    submission_url: (row.submission_url as string | null) ?? null,
    submission_email: (row.submission_email as string | null) ?? null,
    original_document_url: (row.original_document_url as string | null) ?? null,
    status: row.status as TenderRow['status'],
    confidence_score: row.confidence_score !== null ? Number(row.confidence_score) : null,
    discovered_at: toIso(row.discovered_at),
    verified_at: row.verified_at ? toIso(row.verified_at) : null,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  }
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  return String(value)
}
