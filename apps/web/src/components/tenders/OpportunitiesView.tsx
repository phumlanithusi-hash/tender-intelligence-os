import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '@tender-os/constants'
import { OPPORTUNITY_DECISION_SIGNAL, type OpportunityDecisionSignal } from '@tender-os/constants'
import { PageHeader } from '../PageHeader.js'
import { Button } from '../ui/button.js'
import { Select } from '../ui/select.js'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table.js'
import { EmptyState } from '../states/EmptyState.js'
import { LoadingState } from '../states/LoadingState.js'
import { ErrorState } from '../states/ErrorState.js'
import { Pagination } from './Pagination.js'
import { DecisionSignalBadge } from './badges.js'
import { useOpportunities, useScanOpportunities } from '../../hooks/useOpportunities.js'

const PAGE_SIZE = 25

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * The Opportunities page (Phase 10 §37 area) — "which currently
 * active tenders should we bid on", answered entirely from the real,
 * deterministic scoring engine already built for the tender detail
 * view (lib/scoring/, routes/tenderScoring.ts). This page adds no new
 * scoring logic: it lists what the engine has already computed
 * (`GET /api/opportunities`) and lets the user trigger it in bulk
 * across every active tender (`POST /api/opportunities/scan`, looped
 * to completion by useScanOpportunities) instead of one at a time
 * from each tender's own page.
 *
 * A tender that has never been scanned has no row here yet — this is
 * an honest gap, not a bug, matching the rest of the app's rule
 * against showing invented data. The Scan action is what closes it.
 */
export function OpportunitiesView() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [decisionSignal, setDecisionSignal] = useState<OpportunityDecisionSignal | undefined>(undefined)

  const opportunities = useOpportunities({ decisionSignal }, { page, pageSize: PAGE_SIZE })
  const scan = useScanOpportunities()

  const totalPages = opportunities.data?.total !== undefined ? Math.max(1, Math.ceil(opportunities.data.total / PAGE_SIZE)) : null

  function updateSignalFilter(value: string) {
    setDecisionSignal(value ? (value as OpportunityDecisionSignal) : undefined)
    setPage(1)
  }

  return (
    <div>
      <PageHeader
        title="Opportunities"
        description="Currently active tenders scored by the opportunity scoring engine, highest scoring first."
        actions={
          <Button size="sm" onClick={() => void scan.scan()} disabled={scan.isScanning}>
            {scan.isScanning
              ? scan.progress
                ? `Scanning… ${scan.progress.scanned}/${scan.progress.total}`
                : 'Scanning…'
              : 'Scan active tenders'}
          </Button>
        }
      />

      {scan.error ? (
        <div className="mb-4">
          <ErrorState message={scan.error} onRetry={() => void scan.scan()} />
        </div>
      ) : null}

      {!scan.isScanning && scan.progress ? (
        <p className="mb-4 text-sm text-muted-foreground">
          Last scan: {scan.progress.scanned} of {scan.progress.total} active tenders processed
          {scan.progress.failed > 0 ? `, ${scan.progress.failed} could not be scored` : ''}.
        </p>
      ) : null}

      <div className="mb-4 flex items-center gap-2">
        <label htmlFor="opportunity-signal-filter" className="text-sm text-muted-foreground">
          Decision signal
        </label>
        <Select
          id="opportunity-signal-filter"
          value={decisionSignal ?? ''}
          onChange={(e) => updateSignalFilter(e.target.value)}
          className="w-auto"
        >
          <option value="">All signals</option>
          {OPPORTUNITY_DECISION_SIGNAL.map((signal) => (
            <option key={signal} value={signal}>
              {signal.replace('_', ' ')}
            </option>
          ))}
        </Select>
      </div>

      <div className="rounded-md border border-border bg-card">
        {opportunities.status === 'pending' ? (
          <div className="p-4">
            <LoadingState rows={8} />
          </div>
        ) : opportunities.status === 'error' ? (
          <div className="p-4">
            <ErrorState
              message={opportunities.error instanceof Error ? opportunities.error.message : 'Failed to load opportunities.'}
              onRetry={() => void opportunities.refetch()}
            />
          </div>
        ) : opportunities.data && opportunities.data.rows.length === 0 ? (
          <EmptyState
            title={decisionSignal ? `No active tenders currently have a ${decisionSignal.replace('_', ' ')} signal.` : 'No opportunity intelligence yet.'}
            description={
              decisionSignal
                ? 'Try a different signal, or run a fresh scan — scoring inputs (qualification, requirements) may have changed.'
                : "Run a scan to score every currently active tender, or a tender's own page may not have been qualified yet — an unqualified tender scores as INSUFFICIENT_DATA rather than being guessed at."
            }
            action={
              <Button size="sm" onClick={() => void scan.scan()} disabled={scan.isScanning}>
                Scan active tenders
              </Button>
            }
          />
        ) : opportunities.data ? (
          <>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Tender</TableHead>
                  <TableHead>Organisation</TableHead>
                  <TableHead>Closing</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Signal</TableHead>
                  <TableHead>Data completeness</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {opportunities.data.rows.map((row) => {
                  const href = ROUTES.tenderDetail(row.tenderId)
                  return (
                    <TableRow
                      key={row.tenderId}
                      tabIndex={0}
                      role="link"
                      aria-label={`Open ${row.title}`}
                      onClick={() => navigate(href)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          navigate(href)
                        }
                      }}
                      className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    >
                      <TableCell className="max-w-[280px] truncate font-medium text-foreground">{row.title}</TableCell>
                      <TableCell className="max-w-[180px] truncate text-muted-foreground">{row.organisation ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(row.closingDate)}</TableCell>
                      <TableCell className="tabular-nums font-medium">{row.overallScore !== null ? `${Math.round(row.overallScore)}/100` : '—'}</TableCell>
                      <TableCell>
                        <DecisionSignalBadge signal={row.decisionSignal} />
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {row.dataCompleteness !== null ? `${Math.round(row.dataCompleteness * 100)}%` : '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </>
        ) : null}
      </div>

      <p className="mt-3 text-xs italic text-muted-foreground">
        These are internal opportunity scores. They are not a prediction of winning, a win probability, or a bid/no-bid decision.
      </p>
    </div>
  )
}
