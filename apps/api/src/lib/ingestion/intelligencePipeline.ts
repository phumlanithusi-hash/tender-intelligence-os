import type { SupabaseClient } from '@supabase/supabase-js'
import { listTenderDocuments } from '../../repositories/tenderDocuments.js'
import { resolveAllowedHostsForDocument } from '../documents/allowedHosts.js'
import { processDocument } from '../documents/pipeline.js'
import { createSupabaseDocumentPipelineStore } from '../documents/supabaseDocumentPipelineStore.js'
import { createSupabaseDocumentStorage } from '../documents/storage.js'
import type { OcrEngine } from '../documents/ocr/types.js'
import type { OpenAiClient } from '../ai/types.js'
import type { AiConfig } from '../ai/config.js'
import { createSupabaseRequirementEvaluationStore } from '../ai/supabaseRequirementEvaluationStore.js'
import { runRequirementEvaluationExtraction } from '../ai/execution/runRequirementEvaluationExtraction.js'
import { AiRunAlreadyActiveError, AiNotConfiguredError } from '../ai/errors.js'
import { createSupabaseQualificationStore } from '../qualification/supabaseQualificationStore.js'
import { runQualification, QualificationRunAlreadyActiveError } from '../qualification/runQualification.js'
import { logger } from '../logger.js'

export interface PipelineAiDeps {
  client: OpenAiClient
  config: AiConfig
}

export interface DocumentPipelineOutcome {
  documentId: string
  filename: string
  outcome: 'ALREADY_PROCESSED' | 'PROCESSED' | 'NO_ALLOWED_HOST' | 'FAILED'
  error?: string
}

export interface TenderPipelineResult {
  tenderId: string
  documents: DocumentPipelineOutcome[]
  extraction: { status: string; requirementCount?: number; criterionCount?: number } | { skipped: string }
  qualification: { overallStatus: string } | { skipped: string } | { error: string }
}

/**
 * Runs the full "make this tender scoreable" chain for one tender:
 * process every still-unprocessed document (download -> extract ->
 * OCR -> chunk), then AI requirement/evaluation-criteria extraction,
 * then deterministic qualification evaluation against the agency's
 * evidence. Scoring itself is deliberately NOT run here — the
 * existing POST /api/opportunities/scan (runScoring) already does
 * that and stays the single place that produces a scoring run, so
 * this function's only job is to give that scan real data to work
 * with. Every stage is wrapped so one tender's (or one document's)
 * failure never aborts the batch — this is a best-effort backfill
 * across thousands of tenders scraped from unreliable external
 * government sites, not an all-or-nothing transaction.
 */
export async function runIntelligencePipelineForTender(
  admin: SupabaseClient,
  ocrEngine: OcrEngine,
  ai: PipelineAiDeps | null,
  tenderId: string,
  agencyId: string,
): Promise<TenderPipelineResult> {
  const documents = await listTenderDocuments(admin, tenderId)
  const documentOutcomes: DocumentPipelineOutcome[] = []

  for (const doc of documents) {
    if (doc.current_version_id) {
      documentOutcomes.push({ documentId: doc.id, filename: doc.filename, outcome: 'ALREADY_PROCESSED' })
      continue
    }
    try {
      const allowedHosts = await resolveAllowedHostsForDocument(admin, doc.source_id, doc.file_url)
      if (allowedHosts.length === 0) {
        documentOutcomes.push({ documentId: doc.id, filename: doc.filename, outcome: 'NO_ALLOWED_HOST' })
        continue
      }
      const result = await processDocument(
        { store: createSupabaseDocumentPipelineStore(admin), storage: createSupabaseDocumentStorage(admin), ocrEngine, allowedHosts },
        { documentId: doc.id, executionId: null },
      )
      documentOutcomes.push({
        documentId: doc.id,
        filename: doc.filename,
        outcome: result.success ? 'PROCESSED' : 'FAILED',
        error: result.success ? undefined : result.error,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error({ err, tenderId, documentId: doc.id }, 'document pipeline step failed during bulk intelligence backfill')
      documentOutcomes.push({ documentId: doc.id, filename: doc.filename, outcome: 'FAILED', error: message })
    }
  }

  let extraction: TenderPipelineResult['extraction']
  if (!ai) {
    extraction = { skipped: 'AI_NOT_CONFIGURED' }
  } else {
    try {
      const store = createSupabaseRequirementEvaluationStore(admin)
      const result = await runRequirementEvaluationExtraction({ store, client: ai.client, config: ai.config }, { tenderId, triggeredBy: null })
      extraction = { status: result.status, requirementCount: result.requirementCount, criterionCount: result.criterionCount }
    } catch (err) {
      if (err instanceof AiRunAlreadyActiveError) {
        extraction = { skipped: 'RUN_ALREADY_ACTIVE' }
      } else if (err instanceof AiNotConfiguredError) {
        extraction = { skipped: 'AI_NOT_CONFIGURED' }
      } else {
        const message = err instanceof Error ? err.message : String(err)
        logger.error({ err, tenderId }, 'requirement/evaluation extraction failed during bulk intelligence backfill')
        extraction = { skipped: `ERROR: ${message}` }
      }
    }
  }

  let qualification: TenderPipelineResult['qualification']
  try {
    const store = createSupabaseQualificationStore(admin)
    const result = await runQualification(store, { tenderId, agencyId, triggeredBy: null })
    qualification = { overallStatus: result.overallStatus }
  } catch (err) {
    if (err instanceof QualificationRunAlreadyActiveError) {
      qualification = { skipped: 'RUN_ALREADY_ACTIVE' }
    } else {
      const message = err instanceof Error ? err.message : String(err)
      logger.error({ err, tenderId, agencyId }, 'qualification evaluation failed during bulk intelligence backfill')
      qualification = { error: message }
    }
  }

  return { tenderId, documents: documentOutcomes, extraction, qualification }
}
