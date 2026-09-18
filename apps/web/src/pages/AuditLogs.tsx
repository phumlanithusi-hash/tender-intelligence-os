import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader.js'
import { AsyncBoundary } from '../components/states/AsyncBoundary.js'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.js'
import { Badge } from '../components/ui/badge.js'
import { Button } from '../components/ui/button.js'
import { useRecentAuditTrailEvents, useAuditTrailByCorrelation } from '../hooks/useAuditTrail.js'

const STAGE_ORDER = [
  'SOURCE_SCAN',
  'TENDER_IMPORT',
  'REQUIREMENT_EXTRACTION',
  'STRATEGY_GENERATION',
  'EVIDENCE_MATCH',
  'HUMAN_SIGNOFF',
  'SUBMISSION',
  'ADDENDUM_DETECTED',
  'ADDENDUM_ACKNOWLEDGED',
  'OUTCOME_RECORDED',
]

/**
 * Phase 20 §4D — the unified Audit Log Viewer. Clicking (or pasting)
 * any correlation id (a bid project or tender id) shows its complete
 * immutable lineage: Source Scan → Tender Import → Requirement
 * Extraction → Strategy Generation → Evidence Match → Human Signoff →
 * Submission, plus addendum/outcome events — exactly the chain of
 * custody spec §4D names.
 */
export function AuditLogs() {
  const recent = useRecentAuditTrailEvents(100)
  const [searchParams] = useSearchParams()
  const linkedCorrelationId = searchParams.get('correlationId') ?? ''
  const [correlationId, setCorrelationId] = useState(linkedCorrelationId)
  const [lookupId, setLookupId] = useState<string | undefined>(linkedCorrelationId || undefined)
  const lineage = useAuditTrailByCorrelation(lookupId)

  // Spec §4D traceability requirement: arriving here from "View audit
  // trail" on a bid project (BidStrategyDashboard.tsx) immediately
  // shows that bid's complete lineage, with no extra click required.
  useEffect(() => {
    if (linkedCorrelationId) {
      setCorrelationId(linkedCorrelationId)
      setLookupId(linkedCorrelationId)
    }
  }, [linkedCorrelationId])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Audit Trail" description="Full chain-of-custody logging from initial web discovery through to bid submission and outcome record." />

      <Card>
        <CardHeader>
          <CardTitle>Trace a lineage by correlation id</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="flex-1 min-w-[16rem] rounded border border-border px-2 py-1 text-xs"
              placeholder="Bid project or tender id…"
              value={correlationId}
              onChange={(e) => setCorrelationId(e.target.value)}
            />
            <Button size="sm" disabled={!correlationId.trim()} onClick={() => setLookupId(correlationId.trim())}>
              Trace lineage
            </Button>
          </div>
          {lookupId ? (
            <AsyncBoundary state={lineage} emptyTitle="No audit trail events found for this id" isEmpty={(d) => d.length === 0}>
              {(rows) => (
                <ol className="flex flex-col gap-2">
                  {[...rows]
                    .sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || a.created_at.localeCompare(b.created_at))
                    .map((e) => (
                      <li key={e.id} className="rounded border border-border p-2 text-sm">
                        <div className="flex items-center justify-between">
                          <Badge>{e.stage.replace(/_/g, ' ')}</Badge>
                          <span className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{e.summary}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {e.actor_type} · {e.entity_type}
                          {e.entity_id ? ` · ${e.entity_id}` : ''}
                        </p>
                      </li>
                    ))}
                </ol>
              )}
            </AsyncBoundary>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent events</CardTitle>
        </CardHeader>
        <CardContent>
          <AsyncBoundary state={recent} emptyTitle="No audit trail events recorded yet" isEmpty={(d) => d.length === 0}>
            {(rows) => (
              <ul className="flex flex-col gap-2">
                {rows.map((e) => (
                  <li key={e.id} className="rounded border border-border p-2 text-sm">
                    <div className="flex items-center justify-between">
                      <Badge>{e.stage.replace(/_/g, ' ')}</Badge>
                      <span className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{e.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </AsyncBoundary>
        </CardContent>
      </Card>
    </div>
  )
}
