import type { NotificationTrigger } from '@tender-os/constants'
import type { CreateNotificationInput } from './types.js'

/**
 * Pure builders for each of the 10 spec §15 triggers. Zero I/O — every
 * function takes already-fetched data and returns the exact
 * `CreateNotificationInput` the store will (idempotently) persist.
 * Kept pure and unit-tested so the *decision* of when a notification
 * fires is verifiable without a database.
 */

/** Deterministic dedup key: same fact -> same key, regardless of how many times the detector runs (spec §15 "deduplicated"). */
export function buildDedupKey(eventType: NotificationTrigger, entityType: string, entityId: string, extra?: string): string {
  return [eventType, entityType, entityId, extra].filter((p) => p !== undefined && p !== null && p !== '').join(':')
}

export function buildOutcomeDetectedNotification(input: {
  agencyId: string
  tenderOutcomeId: string
  tenderId: string
  bidStrategyProjectId: string | null
  outcomeStatus: string
}): CreateNotificationInput {
  return {
    userId: null,
    agencyId: input.agencyId,
    eventType: 'OUTCOME_DETECTED',
    entityType: 'tender_outcome',
    entityId: input.tenderOutcomeId,
    relatedTenderId: input.tenderId,
    bidStrategyProjectId: input.bidStrategyProjectId,
    payload: { outcomeStatus: input.outcomeStatus },
    dedupKey: buildDedupKey('OUTCOME_DETECTED', 'tender_outcome', input.tenderOutcomeId, input.agencyId),
  }
}

export function buildOutcomeConflictNotification(input: {
  agencyId: string
  conflictId: string
  tenderOutcomeId: string
  tenderId: string | null
  bidStrategyProjectId: string | null
  fieldName: string
}): CreateNotificationInput {
  return {
    userId: null,
    agencyId: input.agencyId,
    eventType: 'OUTCOME_CONFLICT',
    entityType: 'outcome_conflict',
    entityId: input.conflictId,
    relatedTenderId: input.tenderId,
    bidStrategyProjectId: input.bidStrategyProjectId,
    payload: { fieldName: input.fieldName },
    dedupKey: buildDedupKey('OUTCOME_CONFLICT', 'outcome_conflict', input.conflictId, input.agencyId),
  }
}

export function buildOutcomeRequiresReviewNotification(input: {
  agencyId: string
  bidStrategyProjectId: string
  tenderOutcomeId: string
  tenderId: string
  reason: string
}): CreateNotificationInput {
  return {
    userId: null,
    agencyId: input.agencyId,
    eventType: 'OUTCOME_REQUIRES_REVIEW',
    entityType: 'bid_strategy_project',
    entityId: input.bidStrategyProjectId,
    relatedTenderId: input.tenderId,
    bidStrategyProjectId: input.bidStrategyProjectId,
    payload: { reason: input.reason, tenderOutcomeId: input.tenderOutcomeId },
    dedupKey: buildDedupKey('OUTCOME_REQUIRES_REVIEW', 'bid_strategy_project', input.bidStrategyProjectId, input.tenderOutcomeId),
  }
}

export function buildDocumentProcessingFailedNotification(input: {
  agencyId: string | null
  userId?: string | null
  documentId: string
  tenderId: string | null
  state: string
  error: string | null
}): CreateNotificationInput {
  return {
    userId: input.userId ?? null,
    agencyId: input.agencyId,
    eventType: 'DOCUMENT_PROCESSING_FAILED',
    entityType: 'tender_document',
    entityId: input.documentId,
    relatedTenderId: input.tenderId,
    payload: { state: input.state, error: input.error },
    dedupKey: buildDedupKey('DOCUMENT_PROCESSING_FAILED', 'tender_document', input.documentId, input.state),
  }
}

export function buildAddendumDetectedNotification(input: {
  agencyId: string
  bidStrategyProjectId: string
  addendumId: string
  tenderId: string
  addendumNumber: number
}): CreateNotificationInput {
  return {
    userId: null,
    agencyId: input.agencyId,
    eventType: 'ADDENDUM_DETECTED',
    entityType: 'tender_addendum',
    entityId: input.addendumId,
    relatedTenderId: input.tenderId,
    bidStrategyProjectId: input.bidStrategyProjectId,
    payload: { addendumNumber: input.addendumNumber },
    dedupKey: buildDedupKey('ADDENDUM_DETECTED', 'tender_addendum', input.addendumId, input.agencyId),
  }
}

export function buildTenderUpdatedNotification(input: { agencyId: string; bidStrategyProjectId: string; tenderId: string; updatedAt: string }): CreateNotificationInput {
  return {
    userId: null,
    agencyId: input.agencyId,
    eventType: 'TENDER_UPDATED',
    entityType: 'tender',
    entityId: input.tenderId,
    relatedTenderId: input.tenderId,
    bidStrategyProjectId: input.bidStrategyProjectId,
    dedupKey: buildDedupKey('TENDER_UPDATED', 'tender', input.tenderId, input.updatedAt),
  }
}

export function buildDeadlineNotification(input: {
  trigger: 'BRIEFING_DEADLINE' | 'TENDER_DEADLINE'
  agencyId: string
  bidStrategyProjectId: string
  tenderId: string
  deadlineIso: string
  dateBucket: string
}): CreateNotificationInput {
  return {
    userId: null,
    agencyId: input.agencyId,
    eventType: input.trigger,
    entityType: 'tender',
    entityId: input.tenderId,
    relatedTenderId: input.tenderId,
    bidStrategyProjectId: input.bidStrategyProjectId,
    payload: { deadline: input.deadlineIso },
    dedupKey: buildDedupKey(input.trigger, 'tender', input.tenderId, input.dateBucket),
  }
}

export function buildNewRelevantTenderNotification(input: { userId: string; agencyId: string; tenderId: string; savedFilterId: string }): CreateNotificationInput {
  return {
    userId: input.userId,
    agencyId: input.agencyId,
    eventType: 'NEW_RELEVANT_TENDER',
    entityType: 'tender',
    entityId: input.tenderId,
    relatedTenderId: input.tenderId,
    dedupKey: buildDedupKey('NEW_RELEVANT_TENDER', 'tender', input.tenderId, `${input.userId}:${input.savedFilterId}`),
  }
}

export function buildSubmissionOutcomeUnknownNotification(input: {
  agencyId: string
  bidStrategyProjectId: string
  tenderId: string
  daysSinceSubmission: number
  dateBucket: string
}): CreateNotificationInput {
  return {
    userId: null,
    agencyId: input.agencyId,
    eventType: 'SUBMISSION_OUTCOME_UNKNOWN',
    entityType: 'bid_strategy_project',
    entityId: input.bidStrategyProjectId,
    relatedTenderId: input.tenderId,
    bidStrategyProjectId: input.bidStrategyProjectId,
    payload: { daysSinceSubmission: input.daysSinceSubmission },
    dedupKey: buildDedupKey('SUBMISSION_OUTCOME_UNKNOWN', 'bid_strategy_project', input.bidStrategyProjectId, input.dateBucket),
  }
}
