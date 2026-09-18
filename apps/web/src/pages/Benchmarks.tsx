import { useState } from 'react'
import { PageHeader } from '../components/PageHeader.js'
import { AsyncBoundary } from '../components/states/AsyncBoundary.js'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.js'
import { Badge } from '../components/ui/badge.js'
import { Button } from '../components/ui/button.js'
import { Select } from '../components/ui/select.js'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table.js'
import { BENCHMARK_MANAGE_ROLES, BENCHMARK_MIN_GROUP_SIZE } from '@tender-os/constants'
import { useCurrentUser } from '../hooks/useCurrentUser.js'
import { useBenchmarks, useRecomputeBenchmarks } from '../hooks/useBenchmarks.js'

const METRIC_LABELS: Record<string, string> = {
  CYCLE_DAYS: 'Publication → award (days)',
  PRICE_VARIANCE: 'Award value distribution',
  VOLUME: 'Tender volume',
}

/**
 * Phase 20 §4C — the anonymized cross-agency benchmark view. Every
 * row is either real, k-anonymized (>= 5 distinct entities) group
 * statistics, or an honest INSUFFICIENT_BENCHMARK_DATA marker — never
 * a fabricated or interpolated value, and never a per-agency/per-bid
 * figure (spec §3 binding constraint).
 */
export function Benchmarks() {
  const currentUser = useCurrentUser()
  const canManage = currentUser.status === 'success' && (BENCHMARK_MANAGE_ROLES as readonly string[]).includes(currentUser.data.role)
  const [metricType, setMetricType] = useState('')
  const benchmarks = useBenchmarks({ metricType: metricType || undefined })
  const recompute = useRecomputeBenchmarks()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Industry Benchmarks"
        description="Anonymized cross-agency procurement trends — cycle times, award-value distribution, and tender volume. Any group with fewer than 5 distinct contributing entities is masked, never estimated."
        actions={
          canManage ? (
            <Button size="sm" disabled={recompute.isPending} onClick={() => recompute.mutate()}>
              {recompute.isPending ? 'Recomputing…' : 'Recompute benchmarks'}
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Filter by metric</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Metric</span>
            <Select value={metricType} onChange={(e) => setMetricType(e.target.value)}>
              <option value="">All</option>
              <option value="CYCLE_DAYS">Cycle time</option>
              <option value="PRICE_VARIANCE">Price variance</option>
              <option value="VOLUME">Volume</option>
            </Select>
          </div>

          <AsyncBoundary state={benchmarks} emptyTitle="No benchmark data computed yet" emptyDescription="An ADMIN can trigger a recompute." isEmpty={(d) => d.length === 0}>
            {(rows) => (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Metric</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Region</TableHead>
                      <TableHead>Sample size</TableHead>
                      <TableHead>p25</TableHead>
                      <TableHead>p50</TableHead>
                      <TableHead>p75</TableHead>
                      <TableHead>Mean</TableHead>
                      <TableHead>Std dev</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r, i) => (
                      <TableRow key={`${r.category}-${r.region}-${r.metric_type}-${i}`}>
                        <TableCell>{METRIC_LABELS[r.metric_type] ?? r.metric_type}</TableCell>
                        <TableCell>{r.category ?? '—'}</TableCell>
                        <TableCell>{r.region ?? '—'}</TableCell>
                        <TableCell>{r.sample_size}</TableCell>
                        {r.status === 'INSUFFICIENT_BENCHMARK_DATA' ? (
                          <TableCell colSpan={5}>
                            <Badge variant="warning">INSUFFICIENT_BENCHMARK_DATA</Badge>
                            <span className="ml-2 text-xs text-muted-foreground">Fewer than {BENCHMARK_MIN_GROUP_SIZE} distinct entities.</span>
                          </TableCell>
                        ) : (
                          <>
                            <TableCell>{fmt(r.p25)}</TableCell>
                            <TableCell>{fmt(r.p50)}</TableCell>
                            <TableCell>{fmt(r.p75)}</TableCell>
                            <TableCell>{fmt(r.mean)}</TableCell>
                            <TableCell>{fmt(r.stddev)}</TableCell>
                          </>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </AsyncBoundary>
        </CardContent>
      </Card>
    </div>
  )
}

function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
