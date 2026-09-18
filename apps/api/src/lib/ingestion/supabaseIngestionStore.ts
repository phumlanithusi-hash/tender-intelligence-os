import type { SupabaseClient } from '@supabase/supabase-js'
import * as tenders from '../../repositories/tenders.js'
import * as sourceRecords from '../../repositories/tenderSourceRecords.js'
import * as scans from '../../repositories/tenderSourceScans.js'
import * as errors from '../../repositories/tenderSourceErrors.js'
import * as documents from '../../repositories/tenderDocuments.js'
import * as addenda from '../../repositories/tenderAddenda.js'
import { recordAuditTrailEvent } from '../auditTrail/writer.js'
import type { IngestionStore } from './store.js'

/** Production `IngestionStore` — a thin adapter over the real repositories, all bound to one privileged Supabase client (Phase 5 §10-§19). */
export function createSupabaseIngestionStore(supabase: SupabaseClient): IngestionStore {
  return {
    createScan: (input) => scans.createTenderSourceScan(supabase, input),
    updateScan: (id, patch) => scans.updateTenderSourceScan(supabase, id, patch),
    createError: async (input) => {
      await errors.createTenderSourceError(supabase, input)
    },
    findSourceRecordByExternalId: (sourceId, externalId) =>
      sourceRecords.findSourceRecordByExternalId(supabase, sourceId, externalId),
    createSourceRecord: (input) => sourceRecords.createSourceRecord(supabase, input),
    updateSourceRecord: (id, input) => sourceRecords.updateSourceRecord(supabase, id, input),
    findTenderCandidates: async ({ organisation, tenderNumber }) => {
      if (tenderNumber) return sourceRecords.findTenderCandidatesByTenderNumber(supabase, tenderNumber)
      if (organisation) return sourceRecords.findTenderCandidatesByOrganisation(supabase, organisation)
      return []
    },
    getTenderById: (id) => tenders.getTenderById(supabase, id),
    createTender: (input) => tenders.createTender(supabase, input),
    fillUnknownTenderFields: (id, current, candidate) => tenders.fillUnknownTenderFields(supabase, id, current, candidate),
    findDocumentByTenderAndUrl: (tenderId, fileUrl) => documents.findDocumentByTenderAndUrl(supabase, tenderId, fileUrl),
    createTenderDocument: (input) => documents.createTenderDocument(supabase, input),
    getNextAddendumNumber: (tenderId) => addenda.getNextAddendumNumber(supabase, tenderId),
    createTenderAddendum: (input) => addenda.createDiffEngineAddendum(supabase, input),
    recordAuditEvent: (input) =>
      recordAuditTrailEvent(supabase, {
        correlationId: input.correlationId,
        agencyId: null,
        stage: input.stage,
        entityType: input.entityType,
        entityId: input.entityId,
        actorType: 'SYSTEM',
        actorId: null,
        summary: input.summary,
      }),
  }
}
