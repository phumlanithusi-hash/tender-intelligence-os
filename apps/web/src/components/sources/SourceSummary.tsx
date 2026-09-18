import { Skeleton } from '../ui/skeleton.js'
import { useTenderSourceSummary } from '../../hooks/useSourceRegistry.js'

/**
 * Source dashboard summary (Phase 4 §14). Every number is the real
 * `getTenderSourceSummary` aggregate — never fabricated.
 */
export function SourceSummary() {
  const summary = useTenderSourceSummary()

  if (summary.status === 'loading') {
    return (
      <div className="flex flex-wrap gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex min-w-[120px] flex-1 flex-col gap-2 rounded-md border border-border bg-card px-4 py-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-10" />
          </div>
        ))}
      </div>
    )
  }

  if (summary.status === 'error') {
    return (
      <div className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
        Source summary is unavailable right now ({summary.error}).
      </div>
    )
  }

  if (summary.status !== 'success') return null

  const cards = [
    { label: 'Total Sources', value: summary.data.totalSources },
    { label: 'Active', value: summary.data.active },
    { label: 'Healthy', value: summary.data.healthy },
    { label: 'Warning', value: summary.data.warning },
    { label: 'Failed', value: summary.data.failed },
    { label: 'Not Connected', value: summary.data.notConnected },
  ]

  return (
    <div className="flex flex-wrap gap-3">
      {cards.map((card) => (
        <div key={card.label} className="flex min-w-[120px] flex-1 flex-col gap-1 rounded-md border border-border bg-card px-4 py-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{card.label}</span>
          <span className="text-xl font-semibold tabular-nums tracking-tight text-foreground">{card.value}</span>
        </div>
      ))}
    </div>
  )
}
