import { useNavigate } from 'react-router-dom'
import { ROUTES } from '@tender-os/constants'
import type { TenderStatus } from '@tender-os/constants'
import type { WatchlistItemRow } from '@tender-os/schemas'
import { PageHeader } from '../PageHeader.js'
import { Button } from '../ui/button.js'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table.js'
import { EmptyState } from '../states/EmptyState.js'
import { LoadingState } from '../states/LoadingState.js'
import { ErrorState } from '../states/ErrorState.js'
import { TenderStatusBadge } from './badges.js'
import { useTender } from '../../hooks/useTenders.js'
import { useWatchlist, useRemoveFromWatchlist } from '../../hooks/useWatchlist.js'

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * One watched tender. Each row resolves its own tender record via
 * `useTender` (the same endpoint the detail view uses) rather than
 * the API inventing a joined watchlist+tender shape — the
 * `watchlist_items` table only ever stores the tender_id (Phase 3
 * §15, apps/api/src/repositories/watchlist.ts), so this is the real
 * data, fetched the same way everywhere else in the app.
 */
function WatchlistRow({ item }: { item: WatchlistItemRow }) {
  const navigate = useNavigate()
  const tender = useTender(item.tender_id)
  const removeFromWatchlist = useRemoveFromWatchlist()

  if (tender.status === 'loading') {
    return (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={6}>
          <LoadingState rows={1} />
        </TableCell>
      </TableRow>
    )
  }

  if (tender.status === 'error' || tender.status === 'empty') {
    return (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={5} className="text-sm text-muted-foreground">
          This watched tender could not be loaded
          {tender.status === 'error' ? `: ${tender.error}` : ' (it may have been removed).'}
        </TableCell>
        <TableCell>
          <Button
            variant="outline"
            size="sm"
            onClick={() => removeFromWatchlist.mutate(item.tender_id)}
            disabled={removeFromWatchlist.isPending}
          >
            Remove
          </Button>
        </TableCell>
      </TableRow>
    )
  }

  const data = tender.data
  const href = ROUTES.tenderDetail(data.id)

  return (
    <TableRow
      tabIndex={0}
      role="link"
      aria-label={`Open ${data.title}`}
      onClick={() => navigate(href)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          navigate(href)
        }
      }}
      className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <TableCell className="max-w-[280px]">
        <div className="truncate font-medium text-foreground">{data.title}</div>
        <div className="truncate text-xs text-muted-foreground">{data.tender_number ?? 'No tender number'}</div>
      </TableCell>
      <TableCell className="max-w-[180px] truncate text-muted-foreground">{data.organisation ?? '—'}</TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(data.closing_date)}</TableCell>
      <TableCell>
        <TenderStatusBadge status={data.status as TenderStatus} />
      </TableCell>
      <TableCell className="max-w-[220px] truncate text-muted-foreground">{item.notes ?? '—'}</TableCell>
      <TableCell>
        <Button
          variant="outline"
          size="sm"
          onClick={(event) => {
            event.stopPropagation()
            removeFromWatchlist.mutate(item.tender_id)
          }}
          disabled={removeFromWatchlist.isPending}
        >
          Remove
        </Button>
      </TableCell>
    </TableRow>
  )
}

/**
 * The Watchlist page (Phase 3 §15). The backend
 * (apps/api/src/routes/watchlist.ts, repositories/watchlist.ts) and
 * the `useWatchlist`/`useAddToWatchlist`/`useRemoveFromWatchlist`
 * hooks were built and already used from the tender detail view's
 * "Add to Watchlist" button — this page was the one piece never
 * wired up, leaving it stuck on the Phase-1 PlaceholderPage.
 */
export function WatchlistView() {
  const watchlist = useWatchlist()

  return (
    <div>
      <PageHeader
        title="Watchlist"
        description="Tenders your agency is tracking without yet committing to a bid decision."
      />

      <div className="rounded-md border border-border bg-card">
        {watchlist.isLoading ? (
          <div className="p-4">
            <LoadingState rows={4} />
          </div>
        ) : watchlist.isError ? (
          <div className="p-4">
            <ErrorState
              message={watchlist.error instanceof Error ? watchlist.error.message : 'Failed to load your watchlist.'}
              onRetry={() => void watchlist.refetch()}
            />
          </div>
        ) : watchlist.data && watchlist.data.rows.length === 0 ? (
          <EmptyState
            title="You haven't added any tenders to your watchlist yet."
            description="Open a tender from the Tender Radar and choose “Add to Watchlist” to track it here."
          />
        ) : watchlist.data ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Tender</TableHead>
                <TableHead>Organisation</TableHead>
                <TableHead>Closing</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead aria-label="Actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {watchlist.data.rows.map((item) => (
                <WatchlistRow key={item.id} item={item} />
              ))}
            </TableBody>
          </Table>
        ) : null}
      </div>
    </div>
  )
}
