import { useState } from 'react'
import { PageHeader } from '../components/PageHeader.js'
import { AsyncBoundary } from '../components/states/AsyncBoundary.js'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.js'
import { Badge } from '../components/ui/badge.js'
import { Button } from '../components/ui/button.js'
import { Select } from '../components/ui/select.js'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table.js'
import { DATA_QUALITY_MANAGE_ROLES } from '@tender-os/constants'
import { useCurrentUser } from '../hooks/useCurrentUser.js'
import { useDataQualityViolations, useDataQualityCompleteness, useRunDataQualityScan, useResolveDataQualityViolation } from '../hooks/useDataQuality.js'

/**
 * Phase 19 §17/§18 — the Data Quality dashboard. Completeness is shown
 * per-domain as separate KNOWN/UNVERIFIED/UNKNOWN/MISSING/CONFLICTING
 * counts (never collapsed into one percentage, spec §17 binding
 * constraint); the violations ledger is a real, persisted, resolvable
 * list — never a transient in-memory computation the user cannot act
 * on or come back to.
 */
function severityVariant(sev: string): 'destructive' | 'warning' | 'default' {
  if (sev === 'CRITICAL' || sev === 'HIGH') return 'destructive'
  if (sev === 'MEDIUM') return 'warning'
  return 'default'
}

export function DataQuality() {
  const currentUser = useCurrentUser()
  const canManage = currentUser.status === 'success' && (DATA_QUALITY_MANAGE_ROLES as readonly string[]).includes(currentUser.data.role)
  const [statusFilter, setStatusFilter] = useState('OPEN')
  const completeness = useDataQualityCompleteness()
  const violations = useDataQualityViolations({ status: statusFilter || undefined })
  const runScan = useRunDataQualityScan()
  const resolve = useResolveDataQualityViolation()
  const [resolutionDrafts, setResolutionDrafts] = useState<Record<string, string>>({})

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Data Quality"
        description="Deterministic completeness metrics and rule-based violation detection across the whole pipeline — never AI-judged, never a single fabricated score."
        actions={
          canManage ? (
            <Button size="sm" disabled={runScan.isPending} onClick={() => runScan.mutate()}>
              {runScan.isPending ? 'Scanning…' : 'Run data quality scan'}
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Completeness by domain</CardTitle>
        </CardHeader>
        <CardContent>
          <AsyncBoundary state={completeness} emptyTitle="No data yet" isEmpty={(d) => d.length === 0}>
            {(rows) => (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Domain</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Known</TableHead>
                      <TableHead>Unverified</TableHead>
                      <TableHead>Unknown</TableHead>
                      <TableHead>Missing</TableHead>
                      <TableHead>Conflicting</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.domain}>
                        <TableCell className="font-medium">{r.domain}</TableCell>
                        <TableCell>{r.total}</TableCell>
                        <TableCell>{r.known}</TableCell>
                        <TableCell>{r.unverified}</TableCell>
                        <TableCell>{r.unknown}</TableCell>
                        <TableCell>{r.missing}</TableCell>
                        <TableCell>{r.conflicting > 0 ? <Badge variant="destructive">{r.conflicting}</Badge> : r.conflicting}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </AsyncBoundary>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Violations</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Status</span>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="OPEN">Open</option>
              <option value="RESOLVED">Resolved</option>
              <option value="DISMISSED">Dismissed</option>
              <option value="">All</option>
            </Select>
          </div>
          <AsyncBoundary state={violations} emptyTitle="No violations found" emptyDescription="Run a scan to check current data." isEmpty={(d) => d.length === 0}>
            {(rows) => (
              <ul className="flex flex-col gap-2">
                {rows.map((v) => (
                  <li key={v.id} className="rounded border border-border p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{v.rule.replace(/_/g, ' ')}</span>
                      <Badge variant={severityVariant(v.severity)}>{v.severity}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {v.entity_type} · {v.entity_id} · detected {new Date(v.detected_at).toLocaleString()} · <Badge>{v.status}</Badge>
                    </p>
                    {v.status === 'OPEN' && canManage ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input
                          className="flex-1 rounded border border-border px-2 py-1 text-xs"
                          placeholder="Resolution reason…"
                          value={resolutionDrafts[v.id] ?? ''}
                          onChange={(e) => setResolutionDrafts({ ...resolutionDrafts, [v.id]: e.target.value })}
                        />
                        <Button size="sm" variant="outline" disabled={!resolutionDrafts[v.id]?.trim() || resolve.isPending} onClick={() => resolve.mutate({ id: v.id, status: 'RESOLVED', resolution: resolutionDrafts[v.id] })}>
                          Resolve
                        </Button>
                        <Button size="sm" variant="ghost" disabled={!resolutionDrafts[v.id]?.trim() || resolve.isPending} onClick={() => resolve.mutate({ id: v.id, status: 'DISMISSED', resolution: resolutionDrafts[v.id] })}>
                          Dismiss
                        </Button>
                      </div>
                    ) : v.resolution ? (
                      <p className="mt-1 text-xs text-muted-foreground">Resolution: {v.resolution}</p>
                    ) : null}
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
