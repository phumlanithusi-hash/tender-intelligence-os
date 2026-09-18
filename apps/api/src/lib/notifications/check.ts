import type { SupabaseClient } from '@supabase/supabase-js'
import { NOTIFICATION_CHECK_LOOKBACK_DAYS, NOTIFICATION_DEADLINE_LOOKAHEAD_DAYS } from '@tender-os/constants'
import { evaluateOutcomeFollowUp } from '../outcomes/stateMachine.js'
import type { NotificationStore } from './types.js'
import {
  buildAddendumDetectedNotification,
  buildDeadlineNotification,
  buildNewRelevantTenderNotification,
  buildSubmissionOutcomeUnknownNotification,
  buildTenderUpdatedNotification,
} from './build.js'

/**
 * On-demand fan-out for the time-based / derived triggers that have
 * no single "the fact just happened" write site to hook (spec §15:
 * NEW_RELEVANT_TENDER, TENDER_UPDATED, BRIEFING_DEADLINE,
 * TENDER_DEADLINE, SUBMISSION_OUTCOME_UNKNOWN, and — honestly, see
 * below — ADDENDUM_DETECTED). Mirrors the exact "on-demand check"
 * pattern already established this phase for data-quality scanning
 * (lib/dataQuality/supabaseDataQualityStore.ts `runScan`) rather than
 * introducing a scheduler/queue that does not otherwise exist in this
 * codebase.
 *
 * Idempotency comes entirely from each builder's `dedupKey`, not from
 * this function's lookback window — running this twice, or widening
 * the window, never creates a duplicate row.
 *
 * ADDENDUM_DETECTED: confirmed by repo-wide grep (Phase 19 gap-closing
 * notes) that no code path anywhere inserts into `tender_addenda` —
 * addendum *ingestion* was never implemented as a live feature in any
 * prior phase (a pre-existing Phase 2/6 gap, not something this round
 * introduces). This check still scans the table for completeness —
 * so the moment a future phase wires real addendum ingestion, the
 * notification starts firing with no further change here — and this
 * gap is documented, not silently glossed over, in
 * docs/INTEGRATION-STATUS.md.
 */
export async function runNotificationCheck(supabase: SupabaseClient, store: NotificationStore, agencyId: string, userId: string): Promise<number> {
  const since = new Date(Date.now() - NOTIFICATION_CHECK_LOOKBACK_DAYS * 86_400_000).toISOString()
  const now = new Date()
  const lookaheadMs = NOTIFICATION_DEADLINE_LOOKAHEAD_DAYS * 86_400_000
  let created = 0

  const { data: projects } = await supabase
    .from('bid_strategy_projects')
    .select('id, tender_id, status')
    .eq('agency_id', agencyId)
    .not('status', 'in', '(WITHDRAWN,ARCHIVED)')
  const tenderIds = [...new Set((projects ?? []).map((p) => p.tender_id as string))]
  const projectByTender = new Map((projects ?? []).map((p) => [p.tender_id as string, p.id as string]))

  if (tenderIds.length > 0) {
    const { data: tenders } = await supabase
      .from('tenders')
      .select('id, closing_date, closing_time, briefing_required, briefing_date, updated_at')
      .in('id', tenderIds)

    for (const tender of tenders ?? []) {
      const projectId = projectByTender.get(tender.id as string)
      if (!projectId) continue

      // TENDER_UPDATED — fired once per (tender, updated_at) value.
      if (tender.updated_at && new Date(tender.updated_at as string).getTime() >= new Date(since).getTime()) {
        const n = buildTenderUpdatedNotification({ agencyId, bidStrategyProjectId: projectId, tenderId: tender.id as string, updatedAt: tender.updated_at as string })
        await store.create(n)
        created += 1
      }

      // TENDER_DEADLINE — upcoming closing date within the lookahead window.
      if (tender.closing_date) {
        const closing = new Date(`${tender.closing_date}T${tender.closing_time ?? '00:00:00'}`)
        const delta = closing.getTime() - now.getTime()
        if (delta > 0 && delta <= lookaheadMs) {
          const n = buildDeadlineNotification({
            trigger: 'TENDER_DEADLINE',
            agencyId,
            bidStrategyProjectId: projectId,
            tenderId: tender.id as string,
            deadlineIso: closing.toISOString(),
            dateBucket: (tender.closing_date as string).slice(0, 10),
          })
          await store.create(n)
          created += 1
        }
      }

      // BRIEFING_DEADLINE — same shape, over briefing_date.
      if (tender.briefing_required && tender.briefing_date) {
        const briefing = new Date(`${tender.briefing_date}T00:00:00`)
        const delta = briefing.getTime() - now.getTime()
        if (delta > 0 && delta <= lookaheadMs) {
          const n = buildDeadlineNotification({
            trigger: 'BRIEFING_DEADLINE',
            agencyId,
            bidStrategyProjectId: projectId,
            tenderId: tender.id as string,
            deadlineIso: briefing.toISOString(),
            dateBucket: (tender.briefing_date as string).slice(0, 10),
          })
          await store.create(n)
          created += 1
        }
      }
    }

    // ADDENDUM_DETECTED — see doc-comment above: real once a live write
    // path exists; scanned here so it activates automatically.
    const { data: addenda } = await supabase.from('tender_addenda').select('id, tender_id, addendum_number, created_at').in('tender_id', tenderIds).gte('created_at', since)
    for (const a of addenda ?? []) {
      const projectId = projectByTender.get(a.tender_id as string)
      if (!projectId) continue
      const n = buildAddendumDetectedNotification({ agencyId, bidStrategyProjectId: projectId, addendumId: a.id as string, tenderId: a.tender_id as string, addendumNumber: a.addendum_number as number })
      await store.create(n)
      created += 1
    }

    // SUBMISSION_OUTCOME_UNKNOWN — reuses the existing Phase 17
    // follow-up detector verbatim (never a parallel reimplementation).
    const { data: executions } = await supabase.from('bid_submission_executions').select('id, bid_project_id, status, submitted_at').in('bid_project_id', [...projectByTender.values()])
    const { data: outcomeRows } = await supabase.from('tender_outcomes').select('tender_id, is_current').in('tender_id', tenderIds).eq('is_current', true)
    const outcomeKnownByTender = new Set((outcomeRows ?? []).map((o) => o.tender_id as string))
    const tenderByProject = new Map([...projectByTender.entries()].map(([tid, pid]) => [pid, tid]))

    for (const execution of executions ?? []) {
      const submissionStatus = execution.status === 'SUBMITTED' ? 'VERIFIED_SUBMITTED' : execution.status === 'SUBMISSION_REPORTED' ? 'SUBMISSION_REPORTED' : 'NOT_SUBMITTED'
      const tenderId = tenderByProject.get(execution.bid_project_id as string)
      if (!tenderId) continue
      const followUp = evaluateOutcomeFollowUp({
        submissionStatus: submissionStatus as never,
        outcomeKnown: outcomeKnownByTender.has(tenderId),
        submittedAtIso: (execution.submitted_at as string) ?? null,
        nowIso: now.toISOString(),
      })
      if (followUp.requiresFollowUp) {
        const dateBucket = now.toISOString().slice(0, 10)
        const n = buildSubmissionOutcomeUnknownNotification({
          agencyId,
          bidStrategyProjectId: execution.bid_project_id as string,
          tenderId,
          daysSinceSubmission: followUp.daysSinceSubmission ?? 0,
          dateBucket,
        })
        await store.create(n)
        created += 1
      }
    }
  }

  // NEW_RELEVANT_TENDER — a simple, honestly-scoped category/province
  // match against the user's own saved filters. saved_filters.filter
  // is the literal /api/tenders query-parameter shape used for
  // client-side replay (repositories/savedFilters.ts), not a
  // server-side relevance DSL — a full relevance-matching engine is
  // out of scope for this gap-closing round, so only the two most
  // common, literally-present filter fields are matched.
  const { data: filters } = await supabase.from('saved_filters').select('id, filter').eq('user_id', userId)
  for (const f of filters ?? []) {
    const filter = (f.filter ?? {}) as { category?: string; province?: string }
    if (!filter.category && !filter.province) continue
    let query = supabase.from('tenders').select('id').gte('discovered_at', since)
    if (filter.category) query = query.eq('category', filter.category)
    if (filter.province) query = query.eq('province', filter.province)
    const { data: matches } = await query.limit(25)
    for (const t of matches ?? []) {
      const n = buildNewRelevantTenderNotification({ userId, agencyId, tenderId: t.id as string, savedFilterId: f.id as string })
      await store.create(n)
      created += 1
    }
  }

  return created
}
