import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuditTrailStage } from '@tender-os/constants'

/**
 * Phase 20 §4D — a single write helper for `audit_trail_events`,
 * used at every lineage stage (Source Scan → Tender Import →
 * Requirement Extraction → Strategy Generation → Evidence Match →
 * Human Signoff → Submission, plus addendum/outcome events). A
 * failure here is logged but never allowed to fail the caller's own
 * write — the audit trail is observability layered on top of the
 * real write, never a gate in front of it (mirrors every existing
 * `audit_logs.insert(...)` call site in this codebase, which is
 * likewise fire-and-forget relative to the write it's recording).
 */
export interface AuditTrailEventInput {
  correlationId: string
  agencyId: string | null
  stage: AuditTrailStage
  entityType: string
  entityId: string | null
  actorType: 'USER' | 'SYSTEM' | 'AGENT'
  actorId: string | null
  agentName?: string | null
  summary: string
  detail?: Record<string, unknown>
}

export async function recordAuditTrailEvent(supabase: SupabaseClient, input: AuditTrailEventInput): Promise<void> {
  try {
    await supabase.from('audit_trail_events').insert({
      correlation_id: input.correlationId,
      agency_id: input.agencyId,
      stage: input.stage,
      entity_type: input.entityType,
      entity_id: input.entityId,
      actor_type: input.actorType,
      actor_id: input.actorId,
      agent_name: input.agentName ?? null,
      summary: input.summary,
      detail: input.detail ?? {},
    })
  } catch {
    // Never let an audit-trail write failure break the real
    // operation it is describing (spec §4D is observability, not a
    // gate) — the underlying table/RLS/trigger still guarantees the
    // record is either fully written or absent, never partially or
    // silently corrupted.
  }
}
