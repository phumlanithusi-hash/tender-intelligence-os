import type { TenderSourceAdapter, TenderDiscovery } from '../adapters/types.js'
import { matchExistingTender, type DedupeCandidate } from '../adapters/etenders/dedupe.js'
import { classifyError } from '../adapters/etenders/retry.js'
import { DEFAULT_ETENDERS_RATE_LIMIT, sleep, type EtendersRateLimitConfig } from '../adapters/etenders/rateLimit.js'
import { isAllowedDocumentUrl } from '../adapters/etenders/allowlist.js'
import { logger } from '../logger.js'
import { computeContentHash } from './contentHash.js'
import { diffTenderFacts, buildImpactAssessment, type TenderComparableFacts } from '../surveillance/diffEngine.js'
import type { IngestionStore } from './store.js'
import type { TenderSourceRecordRow } from '@tender-os/schemas'

/**
 * The generic ingestion pipeline (Phase 5 §10-§19, §24, §28): given
 * ANY `TenderSourceAdapter` and a matching `IngestionStore`, runs one
 * full scan — discover, normalise (already done by the adapter's own
 * `discover()`), dedupe, canonical tender create/confirm, source
 * record create/update, document discovery, and full scan/error
 * lifecycle recording. Nothing in this file is eTenders-specific
 * beyond importing eTenders' own dedupe/retry/rate-limit modules,
 * which are themselves source-agnostic in shape (a future second
 * adapter could reuse them or bring its own) — this is deliberately
 * the one place a future second live source's ingestion would also
 * run through, per the master spec's "generic tender services never
 * branch on which source they're talking to."
 */
export interface ScanRunnerOptions {
  sourceId: string
  executionId?: string | null
  rateLimit?: EtendersRateLimitConfig
}

export interface ScanRunnerResult {
  scanId: string
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED'
  recordsDiscovered: number
  recordsProcessed: number
  recordsFailed: number
  documentsDiscovered: number
  errorCount: number
  recordsDuplicate: number
}

function fieldsForHash(item: TenderDiscovery) {
  return {
    title: item.title,
    organisation: item.organisation ?? null,
    tenderNumber: item.tenderNumber ?? null,
    publishedDate: item.publishedDate ?? null,
    closingDate: item.closingDate ?? null,
    url: item.url,
  }
}

/** Phase 20 §4A — the incoming side of the structural diff, from this scan's freshly-discovered item. */
function comparableFactsFromDiscovery(item: TenderDiscovery): TenderComparableFacts {
  return {
    title: item.title,
    organisation: item.organisation ?? null,
    tenderNumber: item.tenderNumber ?? null,
    closingDate: item.closingDate ?? null,
    rawMetadata: (item.rawMetadata as TenderComparableFacts['rawMetadata']) ?? null,
  }
}

/** Phase 20 §4A — the previous side of the structural diff, from the source record as it stood before this scan touched it. */
function comparableFactsFromSourceRecord(record: TenderSourceRecordRow): TenderComparableFacts {
  return {
    title: record.raw_title,
    organisation: record.raw_organisation,
    tenderNumber: null, // not separately tracked on tender_source_records — closingDate/title/rawMetadata carry the comparable signal.
    closingDate: record.raw_closing_date,
    rawMetadata: (record.raw_data as TenderComparableFacts['rawMetadata']) ?? null,
  }
}

export async function runEtendersScan(
  store: IngestionStore,
  adapter: TenderSourceAdapter,
  options: ScanRunnerOptions,
): Promise<ScanRunnerResult> {
  const rateLimit = options.rateLimit ?? DEFAULT_ETENDERS_RATE_LIMIT
  const scan = await store.createScan({
    sourceId: options.sourceId,
    executionId: options.executionId ?? null,
    adapterVersion: adapter.version,
  })
  logger.info({ scanId: scan.id, sourceId: options.sourceId, adapterKey: adapter.key }, 'source scan started')
  await store.updateScan(scan.id, { status: 'RUNNING' })
  // Phase 20 §4D — SOURCE_SCAN stage, correlated by the scan itself
  // (no single tender exists yet at this point in the lineage).
  await store.recordAuditEvent?.({
    correlationId: scan.id,
    stage: 'SOURCE_SCAN',
    entityType: 'tender_source_scans',
    entityId: scan.id,
    summary: `Source scan started for source ${options.sourceId} (adapter ${adapter.key}).`,
  })

  let discovered: TenderDiscovery[]
  try {
    discovered = await adapter.discover()
  } catch (err) {
    // Discovery itself failed (Phase 5 §14: a single malformed
    // RECORD must never abort a scan — but a failure of discovery
    // ITSELF, before any records exist, legitimately fails the whole
    // scan since there is nothing to process).
    const classified = classifyError(err)
    const message = err instanceof Error ? err.message : 'eTenders discovery failed with an unknown error.'
    await store.createError({
      sourceId: options.sourceId,
      scanId: scan.id,
      errorType: classified.errorType,
      severity: 'HIGH',
      message,
      url: null,
      statusCode: null,
      retryable: classified.retryable,
      metadata: null,
    })
    const completedAt = new Date().toISOString()
    await store.updateScan(scan.id, { status: 'FAILED', completedAt, errorCount: 1, errorMessage: message })
    logger.error({ scanId: scan.id, sourceId: options.sourceId, err: message }, 'source scan failed during discovery')
    return {
      scanId: scan.id,
      status: 'FAILED',
      recordsDiscovered: 0,
      recordsProcessed: 0,
      recordsFailed: 0,
      documentsDiscovered: 0,
      errorCount: 1,
      recordsDuplicate: 0,
    }
  }

  logger.info({ scanId: scan.id, count: discovered.length }, 'source scan discovered records')

  let processed = 0
  let failed = 0
  let documentsDiscovered = 0
  let errorCount = 0
  // Phase 19 gap-closing (spec §7 "duplicates") — a discovered item
  // that already has a source_records row is a re-confirmation of an
  // already-known record, not a newly imported/updated one.
  let duplicateCount = 0

  for (let i = 0; i < discovered.length; i += 1) {
    if (i > 0 && rateLimit.delayMs > 0) await sleep(rateLimit.delayMs) // Phase 5 §16: conservative, sequential processing.
    const item = discovered[i]!

    try {
      const { tenderId, flaggedAsPotentialDuplicate } = await resolveTenderId(store, item, options.sourceId, scan.id)
      if (flaggedAsPotentialDuplicate) errorCount += 1
      const nowIso = new Date().toISOString()
      const contentHash = computeContentHash(fieldsForHash(item))

      const existingRecord = await store.findSourceRecordByExternalId(options.sourceId, item.externalId)
      if (existingRecord) {
        duplicateCount += 1
        const changed = existingRecord.content_hash !== contentHash

        // Phase 20 §4A — before overwriting the source record, run the
        // structural diff engine against its PRE-scan facts. This is
        // the exact wiring the Phase 19 gap-closing note flagged as
        // missing (`lib/notifications/check.ts`'s ADDENDUM_DETECTED
        // doc-comment): the moment a real structural change is
        // detected on a re-scan, a `tender_addenda` row now actually
        // gets created — no separate document required.
        if (changed) {
          const previousFacts = comparableFactsFromSourceRecord(existingRecord)
          const incomingFacts = comparableFactsFromDiscovery(item)
          const diff = diffTenderFacts(previousFacts, incomingFacts)
          if (diff.isMaterial) {
            try {
              const impactAssessment = buildImpactAssessment(diff)
              const addendumNumber = await store.getNextAddendumNumber(tenderId)
              await store.createTenderAddendum({
                tenderId,
                addendumNumber,
                contentHash,
                summary: diff.summary,
                deadlineChanged: diff.deadlineChanged,
                briefingChanged: diff.briefingChanged,
                requirementChanged: diff.requirementChanged,
                evaluationChanged: diff.evaluationChanged,
                pricingChanged: diff.pricingChanged,
                otherChanges: diff.scopeChanged ? 'Scope/specification text changed.' : null,
                impactAssessment: impactAssessment as unknown as Record<string, unknown>,
              })
              logger.info({ scanId: scan.id, externalId: item.externalId, tenderId, changedFields: diff.changedFields }, 'diff engine detected a material addendum')
              await store.recordAuditEvent?.({
                correlationId: tenderId,
                stage: 'ADDENDUM_DETECTED',
                entityType: 'tender_addenda',
                entityId: null,
                summary: `Diff engine detected a material addendum for tender ${tenderId}: ${diff.summary}`,
              })
            } catch (addendumErr) {
              // Never let addendum creation abort the scan itself — a
              // failure here is recorded as a non-fatal structured
              // error, exactly like the document-discovery try/catch
              // below (Phase 5 §14 pattern reused).
              await store.createError({
                sourceId: options.sourceId,
                scanId: scan.id,
                errorType: 'VALIDATION',
                severity: 'MEDIUM',
                message: addendumErr instanceof Error ? addendumErr.message : 'Failed to record diff-engine addendum.',
                url: item.url,
                statusCode: null,
                retryable: false,
                metadata: { externalId: item.externalId, changedFields: diff.changedFields },
              })
              errorCount += 1
            }
          }
        }

        await store.updateSourceRecord(existingRecord.id, {
          tenderId,
          sourceUrl: item.url,
          rawTitle: item.title,
          rawClosingDate: item.closingDate ?? null,
          rawOrganisation: item.organisation ?? null,
          rawData: item.rawMetadata ?? null,
          contentHash,
          lastSeenAt: nowIso,
        })
        if (changed) {
          logger.info({ scanId: scan.id, externalId: item.externalId, tenderId }, 'source record amended')
        } else {
          logger.debug({ scanId: scan.id, externalId: item.externalId, tenderId }, 'source record confirmed unchanged')
        }
      } else {
        await store.createSourceRecord({
          tenderId,
          sourceId: options.sourceId,
          externalId: item.externalId,
          sourceUrl: item.url,
          rawTitle: item.title,
          rawDescription: null,
          rawClosingDate: item.closingDate ?? null,
          rawClosingTime: null,
          rawOrganisation: item.organisation ?? null,
          rawData: item.rawMetadata ?? null,
          contentHash,
        })
        logger.info({ scanId: scan.id, externalId: item.externalId, tenderId }, 'tender discovered and recorded')
      }

      // Document discovery (Phase 5 §17) — best-effort and never fatal
      // to the record's own success: a documents fetch failing does
      // not mark the whole record FAILED, since the tender itself was
      // still successfully discovered and recorded.
      try {
        const docs = await adapter.fetchDocuments(item.externalId)
        for (const doc of docs) {
          if (!isAllowedDocumentUrl(doc.url)) continue // Defence in depth — the adapter should already have filtered this (Phase 5 §31).
          const existingDoc = await store.findDocumentByTenderAndUrl(tenderId, doc.url)
          if (existingDoc) continue // Phase 5 §19: never duplicate the same document.
          await store.createTenderDocument({
            tenderId,
            sourceId: options.sourceId,
            filename: doc.filename,
            fileUrl: doc.url,
            mimeType: doc.mimeType ?? null,
            publishedAt: null,
          })
          documentsDiscovered += 1
        }
      } catch (docErr) {
        const classified = classifyError(docErr)
        await store.createError({
          sourceId: options.sourceId,
          scanId: scan.id,
          errorType: classified.errorType === 'UNKNOWN' ? 'DOCUMENT' : classified.errorType,
          severity: 'LOW',
          message: docErr instanceof Error ? docErr.message : 'Document discovery failed for this tender.',
          url: item.url,
          statusCode: null,
          retryable: classified.retryable,
          metadata: { externalId: item.externalId },
        })
        errorCount += 1
      }

      processed += 1
    } catch (err) {
      failed += 1
      errorCount += 1
      const classified = classifyError(err)
      const message = err instanceof Error ? err.message : 'Unknown error processing this record.'
      await store.createError({
        sourceId: options.sourceId,
        scanId: scan.id,
        errorType: classified.errorType,
        severity: 'MEDIUM',
        message,
        url: item.url,
        statusCode: null,
        retryable: classified.retryable,
        metadata: { externalId: item.externalId },
      })
      logger.warn({ scanId: scan.id, externalId: item.externalId, err: message }, 'record failed during ingestion')
    }
  }

  const completedAt = new Date().toISOString()
  const status: ScanRunnerResult['status'] = discovered.length === 0 ? 'SUCCESS' : failed > 0 ? (processed > 0 ? 'PARTIAL' : 'FAILED') : 'SUCCESS'

  await store.updateScan(scan.id, {
    status,
    completedAt,
    recordsDiscovered: discovered.length,
    recordsProcessed: processed,
    recordsFailed: failed,
    documentsDiscovered,
    errorCount,
    recordsDuplicate: duplicateCount,
  })

  logger.info(
    { scanId: scan.id, status, discovered: discovered.length, processed, failed, documentsDiscovered, errorCount, duplicateCount },
    'source scan completed',
  )

  return {
    scanId: scan.id,
    status,
    recordsDiscovered: discovered.length,
    recordsProcessed: processed,
    recordsFailed: failed,
    documentsDiscovered,
    errorCount,
    recordsDuplicate: duplicateCount,
  }
}

/**
 * Dedupe + canonical-tender resolution for one discovered item (Phase
 * 5 §9/§10). Throws for a record whose title cannot even be
 * determined (nothing usable to create) — that surfaces as this
 * record's own failure (Phase 5 §14), never a fabricated placeholder
 * silently written to the canonical `tenders` table.
 */
async function resolveTenderId(
  store: IngestionStore,
  item: TenderDiscovery,
  sourceId: string,
  scanId: string,
): Promise<{ tenderId: string; flaggedAsPotentialDuplicate: boolean }> {
  if (!item.title || item.title === '(no title provided by source)') {
    throw Object.assign(new Error('Cannot create a canonical tender with no discoverable title.'), {
      statusCode: 422,
    })
  }

  const candidates = await store.findTenderCandidates({
    organisation: item.organisation ?? null,
    tenderNumber: item.tenderNumber ?? null,
  })
  const dedupeCandidates: DedupeCandidate[] = candidates.map((c) => ({
    id: c.id,
    tenderNumber: c.tender_number,
    organisation: c.organisation,
    title: c.title,
    closingDate: c.closing_date,
  }))

  const decision = matchExistingTender(dedupeCandidates, {
    tenderNumber: item.tenderNumber ?? null,
    organisation: item.organisation ?? null,
    title: item.title,
    closingDate: item.closingDate ?? null,
  })

  if (decision.outcome === 'MATCH') {
    const current = await store.getTenderById(decision.tenderId)
    if (current) {
      await store.fillUnknownTenderFields(decision.tenderId, current, {
        tenderNumber: item.tenderNumber ?? null,
        organisation: item.organisation ?? null,
        closingDate: item.closingDate ?? null,
        publishedDate: item.publishedDate ?? null,
        originalDocumentUrl: item.url,
      })
    }
    return { tenderId: decision.tenderId, flaggedAsPotentialDuplicate: false }
  }

  // AMBIGUOUS (Phase 5 §9): never auto-merge with an uncertain
  // candidate — record a structured, non-fatal flag for human review
  // and proceed to create a new canonical tender (the safe default:
  // guessing which existing tender it is would risk silently
  // overwriting an unrelated one's data via fillUnknownTenderFields).
  if (decision.outcome === 'AMBIGUOUS') {
    await store.createError({
      sourceId,
      scanId,
      errorType: 'VALIDATION',
      severity: 'LOW',
      message: `Potential duplicate flagged, not auto-merged: ${decision.reason}`,
      url: item.url,
      statusCode: null,
      retryable: false,
      metadata: { externalId: item.externalId, candidateTenderIds: decision.candidateIds },
    })
  }

  const created = await store.createTender({
    tenderNumber: item.tenderNumber ?? null,
    title: item.title,
    organisation: item.organisation ?? null,
    province: null,
    category: null,
    description: null,
    publishedDate: item.publishedDate ?? null,
    closingDate: item.closingDate ?? null,
    closingTime: null,
    briefingRequired: null,
    submissionMethod: null,
    originalDocumentUrl: item.url,
  })
  // Phase 20 §4D — TENDER_IMPORT stage, correlated by the new
  // canonical tender itself (its lineage's identity from here on).
  await store.recordAuditEvent?.({
    correlationId: created.id,
    stage: 'TENDER_IMPORT',
    entityType: 'tenders',
    entityId: created.id,
    summary: `Tender imported from source ${sourceId} (scan ${scanId}).`,
  })
  return { tenderId: created.id, flaggedAsPotentialDuplicate: decision.outcome === 'AMBIGUOUS' }
}
