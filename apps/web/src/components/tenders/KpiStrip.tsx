import type { TenderSummary } from '@tender-os/schemas'
import { Skeleton } from '../ui/skeleton.js'
import { useTenderSummary } from '../../hooks/useTenders.js'

/**
 * KPI cards (Phase 3 §4). Every number is the real value from
 * getTenderSummary's aggregate queries — a value this environment
 * genuinely cannot compute yet (no agency context, or no tenders with
 * an estimated value) renders as "—", never a fabricated number.
 */
function formatValue(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return value.toLocaleString('en-ZA')
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(value)
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-[140px] flex-1 flex-col gap-1 rounded-md border border-border bg-card px-4 py-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular-nums tracking-tight text-foreground">{value}</span>
    </div>
  )
}

function KpiCardSkeleton() {
  return (
    <div className="flex min-w-[140px] flex-1 flex-col gap-2 rounded-md border border-border bg-card px-4 py-3">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-6 w-12" />
    </div>
  )
}

function cards(summary: TenderSummary) {
  return [
    { label: 'Open Tenders', value: formatValue(summary.openTenders) },
    { label: 'Relevant', value: formatValue(summary.relevant) },
    { label: 'Priority Bid', value: formatValue(summary.priorityBid) },
    { label: 'Closing <7 Days', value: formatValue(summary.closingWithin7Days) },
    { label: 'Briefings', value: formatValue(summary.briefingsRequired) },
    { label: 'Addenda', value: formatValue(summary.addendaRecent) },
    { label: 'Estimated Value', value: formatCurrency(summary.estimatedValueTotal) },
  ]
}

export function KpiStrip() {
  const summary = useTenderSummary()

  if (summary.status === 'loading') {
    return (
      <div className="flex flex-wrap gap-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (summary.status === 'error') {
    return (
      <div className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
        KPI data is unavailable right now ({summary.error}).
      </div>
    )
  }

  if (summary.status !== 'success') return null

  return (
    <div className="flex flex-wrap gap-3">
      {cards(summary.data).map((card) => (
        <KpiCard key={card.label} label={card.label} value={card.value} />
      ))}
    </div>
  )
}
