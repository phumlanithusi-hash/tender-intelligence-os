import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { requireSupabase } from '../lib/requireSupabase.js'
import { requireRole } from '../lib/requireRole.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { getTenderDocumentById } from '../repositories/tenderDocuments.js'
import { listTenderDocumentVersions, getTenderDocumentVersionById } from '../repositories/tenderDocumentVersions.js'
import { getTenderDocumentProcessing } from '../repositories/tenderDocumentProcessing.js'
import { listTenderDocumentPages } from '../repositories/tenderDocumentPages.js'
import { listTenderDocumentSections } from '../repositories/tenderDocumentSections.js'
import { listTenderDocumentChunks } from '../repositories/tenderDocumentChunks.js'
import { processDocument, reprocessDocumentVersion } from '../lib/documents/pipeline.js'
import { createSupabaseDocumentPipelineStore } from '../lib/documents/supabaseDocumentPipelineStore.js'
import { createSupabaseDocumentStorage } from '../lib/documents/storage.js'
import { TesseractOcrEngine } from '../lib/documents/ocr/tesseractEngine.js'
import { resolveAllowedHostsForDocument } from '../lib/documents/allowedHosts.js'
import { logger } from '../lib/logger.js'
import { notifyAgenciesForTender } from '../lib/notifications/fanout.js'
import { buildDocumentProcessingFailedNotification } from '../lib/notifications/build.js'

const documentParamsSchema = z.object({ id: z.string().uuid(), documentId: z.string().uuid() })

/** Same view-role convention as the Source Registry (Phase 4 §18) — any authenticated caller in one of these roles can read the evidence pipeline's output. */
const VIEW_ROLES = ['ADMIN', 'BID_MANAGER', 'RESEARCHER'] as const
/** Triggering a (re)download/reprocess run is an operational action, not a read — gated more tightly, same as Source Registry mutations. */
const ACTION_ROLES = ['ADMIN', 'BID_MANAGER'] as const

const ocrEngine = new TesseractOcrEngine()

/**
 * Tender document evidence pipeline endpoints (Phase 6 §25). Reads go
 * through the caller's own RLS-scoped client (these tables carry a
 * shared-catalogue select-for-authenticated policy — Phase 6 §16's
 * migration); the two action endpoints run the pipeline
 * (lib/documents/pipeline.ts) against the privileged service-role
 * client, since writing pages/sections/chunks/processing state must
 * never happen via a browser-scoped RLS client (no authenticated
 * write policy exists for these tables at all).
 *
 * Phase 6 §32: this runs the pipeline synchronously inside the
 * request handler only because no job queue exists yet in this
 * codebase (checked: no BullMQ wiring in apps/api — see
 * docs/DOCUMENT-INGESTION.md "Queue seam"). `processDocument`/
 * `reprocessDocumentVersion` are already the exact, composable,
 * idempotent unit a future BullMQ worker would call per job — only
 * the caller changes, not the pipeline.
 */
export async function tenderDocumentsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/api/tenders/:id/documents/:documentId', async (request, reply) => {
    if (!requireRole(request, reply, VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId, documentId } = documentParamsSchema.parse(request.params)
    const document = await getTenderDocumentById(supabase, tenderId, documentId)
    if (!document) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Document not found.' } })
      return
    }
    const versions = await listTenderDocumentVersions(supabase, documentId)
    const currentVersion = document.current_version_id
      ? await getTenderDocumentVersionById(supabase, document.current_version_id)
      : null
    const processing = currentVersion ? await getTenderDocumentProcessing(supabase, currentVersion.id) : null
    return { document, versions, currentVersion, processing }
  })

  app.get('/api/tenders/:id/documents/:documentId/pages', async (request, reply) => {
    if (!requireRole(request, reply, VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId, documentId } = documentParamsSchema.parse(request.params)
    const document = await getTenderDocumentById(supabase, tenderId, documentId)
    if (!document) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Document not found.' } })
    if (!document.current_version_id) return []
    return listTenderDocumentPages(supabase, document.current_version_id)
  })

  app.get('/api/tenders/:id/documents/:documentId/sections', async (request, reply) => {
    if (!requireRole(request, reply, VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId, documentId } = documentParamsSchema.parse(request.params)
    const document = await getTenderDocumentById(supabase, tenderId, documentId)
    if (!document) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Document not found.' } })
    if (!document.current_version_id) return []
    return listTenderDocumentSections(supabase, document.current_version_id)
  })

  app.get('/api/tenders/:id/documents/:documentId/chunks', async (request, reply) => {
    if (!requireRole(request, reply, VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId, documentId } = documentParamsSchema.parse(request.params)
    const document = await getTenderDocumentById(supabase, tenderId, documentId)
    if (!document) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Document not found.' } })
    if (!document.current_version_id) return []
    return listTenderDocumentChunks(supabase, document.current_version_id)
  })

  app.post('/api/tenders/:id/documents/:documentId/download', async (request, reply) => {
    if (!requireRole(request, reply, ACTION_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId, documentId } = documentParamsSchema.parse(request.params)
    const document = await getTenderDocumentById(supabase, tenderId, documentId)
    if (!document) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Document not found.' } })

    const admin = getSupabaseAdmin()
    if (!admin) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }

    const allowedHosts = await resolveAllowedHostsForDocument(admin, document.source_id, document.file_url)
    if (allowedHosts.length === 0) {
      reply.code(422).send({
        error: { code: 'NO_ALLOWED_HOST', message: 'This document has no known source URL to download from.' },
      })
      return
    }

    logger.info({ tenderId, documentId, executionId: request.id }, 'document download requested via API')
    const result = await processDocument(
      {
        store: createSupabaseDocumentPipelineStore(admin),
        storage: createSupabaseDocumentStorage(admin),
        ocrEngine,
        allowedHosts,
      },
      { documentId, executionId: request.id },
    )
    if (!result.success) {
      await notifyAgenciesForTender(admin, tenderId, (agencyId, _bidStrategyProjectId) =>
        buildDocumentProcessingFailedNotification({ agencyId, documentId, tenderId, state: result.state, error: result.error ?? null }),
      )
    }
    return result
  })

  app.post('/api/tenders/:id/documents/:documentId/reprocess', async (request, reply) => {
    if (!requireRole(request, reply, ACTION_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId, documentId } = documentParamsSchema.parse(request.params)
    const document = await getTenderDocumentById(supabase, tenderId, documentId)
    if (!document) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Document not found.' } })
    if (!document.current_version_id) {
      reply.code(422).send({
        error: { code: 'NO_VERSION', message: 'This document has never been successfully downloaded — use the download action first.' },
      })
      return
    }

    const admin = getSupabaseAdmin()
    if (!admin) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }

    const version = await getTenderDocumentVersionById(admin, document.current_version_id)
    if (!version || !version.storage_path) {
      reply.code(422).send({ error: { code: 'NO_STORED_FILE', message: 'No stored file exists for this version to reprocess.' } })
      return
    }

    logger.info({ tenderId, documentId, versionId: version.id, executionId: request.id }, 'document reprocess requested via API')
    const result = await reprocessDocumentVersion(
      {
        store: createSupabaseDocumentPipelineStore(admin),
        storage: createSupabaseDocumentStorage(admin),
        ocrEngine,
        allowedHosts: [],
      },
      {
        documentId,
        versionId: version.id,
        storagePath: version.storage_path,
        filename: version.filename,
        detectedFileKind: version.detected_file_kind,
        executionId: request.id,
      },
    )
    if (!result.success) {
      await notifyAgenciesForTender(admin, tenderId, (agencyId, _bidStrategyProjectId) =>
        buildDocumentProcessingFailedNotification({ agencyId, documentId, tenderId, state: result.state, error: result.error ?? null }),
      )
    }
    return result
  })
}
