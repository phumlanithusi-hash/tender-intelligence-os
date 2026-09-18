import { PageHeader } from '../components/PageHeader.js'
import { AsyncBoundary } from '../components/states/AsyncBoundary.js'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.js'
import { Badge } from '../components/ui/badge.js'
import { useOpsHealth } from '../hooks/useOpsHealth.js'

/**
 * Phase 19 §16 — the operational-health dashboard. Every number here
 * is a live count from real tables (never a fabricated "system OK"
 * banner) — a stale/never-scanned source shows as exactly that, not
 * hidden behind an aggregate green status.
 */
function StatTile({ label, value, tone }: { label: string; value: number | string; tone?: 'warning' | 'destructive' }) {
  return (
    <div className="rounded border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold ${tone === 'destructive' ? 'text-destructive' : tone === 'warning' ? 'text-warning' : ''}`}>{value}</p>
    </div>
  )
}

export function ProductionHealth() {
  const health = useOpsHealth()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Production Health" description="Live source, document, AI, outcome, background-processing and storage health — computed from real rows, never simulated." />
      <AsyncBoundary state={health}>
        {(data) => (
          <>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Generated {new Date(data.generatedAt).toLocaleString()}</p>
              <Badge>LIVE</Badge>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Sources</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 md:grid-cols-6">
                <StatTile label="Total" value={data.sources.totalSources} />
                <StatTile label="Active" value={data.sources.activeSources} />
                <StatTile label="Healthy" value={data.sources.healthySources} />
                <StatTile label="Warning" value={data.sources.warningSources} tone="warning" />
                <StatTile label="Failed" value={data.sources.failedSources} tone="destructive" />
                <StatTile label="Not connected" value={data.sources.notConnectedSources} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Documents</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 md:grid-cols-5">
                <StatTile label="Queued" value={data.documents.queued} />
                <StatTile label="Processing" value={data.documents.processing} />
                <StatTile label="Completed" value={data.documents.completed} />
                <StatTile label="Failed" value={data.documents.failed} tone="destructive" />
                <StatTile label="Requires review" value={data.documents.requiresReview} tone="warning" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>AI</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <StatTile label="Total runs" value={data.ai.totalRuns} />
                <StatTile label="Failed runs" value={data.ai.failedRuns} tone="destructive" />
                <StatTile label="Requires review" value={data.ai.requiresReviewRuns} tone="warning" />
                <StatTile label="Embedding failures" value={data.ai.embeddingFailures} tone="destructive" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Outcomes</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <StatTile label="Verified" value={data.outcomes.verified} />
                <StatTile label="Unknown" value={data.outcomes.unknown} />
                <StatTile label="Conflicting" value={data.outcomes.conflicting} tone="destructive" />
                <StatTile label="Requires follow-up" value={data.outcomes.requiresFollowUp} tone="warning" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Background processing</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">
                  No BullMQ/Redis queue is wired into this deployment — every ingest/processing stage runs synchronously in the request/scan that triggers it (a documented, carried-forward architectural limitation). The counts below are the closest real analogue: source-scan run records.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <StatTile label="Queued scans" value={data.jobs.queuedScans} />
                  <StatTile label="Running scans" value={data.jobs.runningScans} />
                  <StatTile label="Failed scans" value={data.jobs.failedScans} tone="destructive" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Storage</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2">
                <StatTile label="Documents with storage path" value={data.storage.documentsWithStoragePath} />
                <StatTile label="Documents missing storage path" value={data.storage.documentsMissingStoragePath} tone={data.storage.documentsMissingStoragePath > 0 ? 'warning' : undefined} />
              </CardContent>
            </Card>
          </>
        )}
      </AsyncBoundary>
    </div>
  )
}
