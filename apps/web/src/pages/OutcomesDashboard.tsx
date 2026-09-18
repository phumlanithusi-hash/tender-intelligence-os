import { useState } from 'react'
import { PageHeader } from '../components/PageHeader.js'
import { AsyncBoundary } from '../components/states/AsyncBoundary.js'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.js'
import { Badge } from '../components/ui/badge.js'
import { Button } from '../components/ui/button.js'
import { Select } from '../components/ui/select.js'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table.js'
import { BID_RESULT, OUTCOME_VERIFY_ROLES } from '@tender-os/constants'
import { useCurrentUser } from '../hooks/useCurrentUser.js'
import {
  useLearningReadiness,
  useOpenConflicts,
  useOutcomesAnalytics,
  useResolveConflict,
  useWinLossByCategory,
  type OutcomeMetric,
  type WinLossFilters,
} from '../hooks/useOutcomes.js'

/**
 * Phase 17 §49/§50/§54/§82/§83-85 — the Outcomes dashboard. Every
 * metric is rendered alongside its numerator/denominator/completeness
 * (spec §28) and UNKNOWN is a first-class, clearly-labelled state
 * (spec §54) — never silently hidden or forced into WON/LOST.
 */
function MetricTile({ label, metric }: { label: string; metric: OutcomeMetric }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">
          {metric.rate === null ? 'UNKNOWN' : `${(metric.rate * 100).toFixed(0)}%`}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {metric.numerator} of {metric.denominator} recorded
          {metric.completeness !== null ? ` · completeness ${(metric.completeness * 100).toFixed(0)}%` : ''}
        </p>
        {metric.insufficientSample && (
          <Badge variant="warning" className="mt-2">
            Sample too small for a reliable rate
          </Badge>
        )}
      </CardContent>
    </Card>
  )
}

function formatAward(value: number | null): string {
  if (value === null) return 'UNKNOWN'
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(value)
}

/** Phase 17 §51 — the win/loss table, filterable by result/category/province, all filtering server-side (spec §69). */
function WinLossTable() {
  const [filters, setFilters] = useState<WinLossFilters>({})
  const winLoss = useWinLossByCategory(filters)

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle>Win/loss table</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap gap-2">
          <Select value={filters.result ?? ''} onChange={(e) => setFilters((f) => ({ ...f, result: e.target.value || undefined }))} className="w-auto">
            <option value="">All results</option>
            {BID_RESULT.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
          {(filters.result || filters.category || filters.province) && (
            <Button variant="outline" size="sm" onClick={() => setFilters({})}>
              Clear filters
            </Button>
          )}
        </div>
        <AsyncBoundary state={winLoss} emptyTitle="No recorded bid outcomes yet" isEmpty={(d) => d.rows.length === 0}>
          {(data) => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tender</TableHead>
                  <TableHead>Organisation</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Winner</TableHead>
                  <TableHead>Award value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.tenderTitle ?? row.tenderId}</TableCell>
                    <TableCell>{row.organisation ?? 'UNKNOWN'}</TableCell>
                    <TableCell>
                      <Badge variant={row.ourResult === 'WON' ? 'success' : row.ourResult === 'LOST' || row.ourResult === 'DISQUALIFIED' ? 'destructive' : 'default'}>{row.ourResult}</Badge>
                    </TableCell>
                    <TableCell>{row.winnerName ?? 'UNKNOWN'}</TableCell>
                    <TableCell>{formatAward(row.awardValue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </AsyncBoundary>
      </CardContent>
    </Card>
  )
}

/** Phase 17 §17/§106 — minimal conflict-review UI: list open conflicts, show the disagreeing values, allow an authorized user to resolve or dismiss with a reason. */
function ConflictReviewPanel() {
  const conflicts = useOpenConflicts('OPEN')
  const resolve = useResolveConflict()
  const currentUser = useCurrentUser()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const canResolve = currentUser.status === 'success' && (OUTCOME_VERIFY_ROLES as readonly string[]).includes(currentUser.data.role)

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle>Open outcome conflicts</CardTitle>
      </CardHeader>
      <CardContent>
        <AsyncBoundary state={conflicts} emptyTitle="No open conflicts" emptyDescription="Every recorded outcome's sources currently agree." isEmpty={(rows) => rows.length === 0}>
          {(rows) => (
            <div className="space-y-3">
              {rows.map((c) => (
                <div key={c.id} className="rounded-md border border-border p-3 text-sm">
                  <p className="font-medium">
                    {c.fieldName}: &quot;{c.existingValue}&quot; vs &quot;{c.conflictingValue}&quot;
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">Discovered {new Date(c.discoveredAt).toLocaleString('en-ZA')}</p>
                  {canResolve && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        className="h-8 w-56 rounded-md border border-input bg-background px-2 text-xs"
                        placeholder="Resolution note (optional)"
                        value={notes[c.id] ?? ''}
                        onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))}
                      />
                      <Button size="sm" variant="outline" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: c.id, status: 'RESOLVED', notes: notes[c.id] })}>
                        Resolve
                      </Button>
                      <Button size="sm" variant="outline" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: c.id, status: 'DISMISSED', notes: notes[c.id] })}>
                        Dismiss
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </AsyncBoundary>
      </CardContent>
    </Card>
  )
}

export function OutcomesDashboard() {
  const analytics = useOutcomesAnalytics()
  const winLoss = useWinLossByCategory()
  const learning = useLearningReadiness()

  return (
    <div>
      <PageHeader
        title="Outcomes"
        description="What happened to our tenders and bids — every rate shown with its denominator and completeness, never as a bare percentage (Phase 17)."
      />

      <AsyncBoundary state={analytics} emptyTitle="No recorded outcomes yet">
        {(data) => (
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricTile label="Win rate" metric={data.metrics.winRate} />
            <MetricTile label="Loss rate" metric={data.metrics.lossRate} />
            <MetricTile label="Disqualification rate" metric={data.metrics.disqualificationRate} />
            <MetricTile label="Submission rate" metric={data.metrics.submissionRate} />
          </div>
        )}
      </AsyncBoundary>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Outcome funnel</CardTitle>
        </CardHeader>
        <CardContent>
          <AsyncBoundary state={analytics} emptyTitle="No opportunities recorded yet">
            {(data) => (
              <div className="flex flex-wrap gap-4">
                {data.funnel.map((stage) => (
                  <div key={stage.stage} className="min-w-[100px]">
                    <div className="text-lg font-semibold">{stage.count}</div>
                    <div className="text-xs text-muted-foreground">{stage.stage}</div>
                  </div>
                ))}
              </div>
            )}
          </AsyncBoundary>
        </CardContent>
      </Card>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Win rate by category</CardTitle>
        </CardHeader>
        <CardContent>
          <AsyncBoundary state={winLoss} emptyTitle="No categorised outcomes yet" isEmpty={(d) => d.byCategory.length === 0}>
            {(data) => (
              <div className="space-y-2">
                {data.byCategory.map((row) => (
                  <div key={row.groupKey} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
                    <span>{row.groupKey}</span>
                    <span className="flex items-center gap-2">
                      {row.winRate.rate === null ? 'UNKNOWN' : `${(row.winRate.rate * 100).toFixed(0)}%`}
                      {row.caveat && (
                        <Badge variant="warning" title={row.caveat}>
                          Small sample (n={row.sampleSize})
                        </Badge>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </AsyncBoundary>
        </CardContent>
      </Card>

      <WinLossTable />
      <ConflictReviewPanel />

      <Card>
        <CardHeader>
          <CardTitle>Historical learning readiness</CardTitle>
        </CardHeader>
        <CardContent>
          <AsyncBoundary state={learning} emptyTitle="No records yet">
            {(data) => (
              <div>
                <p className="text-sm">
                  {data.learningReadyRecords} of {data.totalBids} bids are learning-ready (verified outcome + complete decision-time snapshot).
                </p>
                <p className="mt-2 text-xs text-muted-foreground">{data.readinessNote}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  This is an observation/readiness count only — Phase 17 never predicts a win probability and never automatically changes scoring, bid/no-bid, or strategy rules.
                </p>
              </div>
            )}
          </AsyncBoundary>
        </CardContent>
      </Card>
    </div>
  )
}
