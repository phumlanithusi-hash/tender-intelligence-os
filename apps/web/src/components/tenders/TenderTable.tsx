import { useNavigate } from 'react-router-dom'
import { ROUTES } from '@tender-os/constants'
import type { TenderStatus } from '@tender-os/constants'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table.js'
import { TenderStatusBadge, PriorityIndicator, OpportunityClassBadge } from './badges.js'
import type { TenderListRow } from '../../hooks/useTenders.js'

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatList(values: string[]): string {
  if (values.length === 0) return '—'
  if (values.length <= 2) return values.join(', ')
  return `${values[0]}, ${values[1]} +${values.length - 2}`
}

/**
 * The dense Tender Radar table (Phase 3 §7/§8). Every row navigates
 * to the detail view on click or Enter/Space when focused; hover and
 * a visible focus ring communicate interactivity without depending on
 * hover alone (Phase 3 §8: "Do not make the entire interface
 * dependent on hover.").
 */
export function TenderTable({ rows }: { rows: TenderListRow[] }) {
  const navigate = useNavigate()

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-2" aria-label="Priority" />
          <TableHead>Tender</TableHead>
          <TableHead>Organisation</TableHead>
          <TableHead>Services</TableHead>
          <TableHead>Province</TableHead>
          <TableHead>Published</TableHead>
          <TableHead>Closing</TableHead>
          <TableHead>Briefing</TableHead>
          <TableHead>Score</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Source</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const href = ROUTES.tenderDetail(row.id)
          return (
            <TableRow
              key={row.id}
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
              <TableCell className="p-0 pl-2">
                <PriorityIndicator scoreClass={row.currentScore?.scoreClass ?? null} />
              </TableCell>
              <TableCell className="max-w-[280px]">
                <div className="truncate font-medium text-foreground">{row.title}</div>
                <div className="truncate text-xs text-muted-foreground">{row.tender_number ?? 'No tender number'}</div>
              </TableCell>
              <TableCell className="max-w-[180px] truncate text-muted-foreground">
                {row.organisation ?? '—'}
              </TableCell>
              <TableCell className="max-w-[180px] truncate text-muted-foreground">
                {formatList(row.serviceNames)}
              </TableCell>
              <TableCell className="text-muted-foreground">{row.province ?? '—'}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(row.published_date)}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(row.closing_date)}</TableCell>
              <TableCell>{row.briefing_required ? 'Required' : '—'}</TableCell>
              <TableCell>
                {row.currentScore ? (
                  <div className="flex flex-col gap-0.5">
                    <span className="tabular-nums font-medium">{row.currentScore.totalScore}/100</span>
                    <OpportunityClassBadge scoreClass={row.currentScore.scoreClass} />
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                <TenderStatusBadge status={row.status as TenderStatus} />
              </TableCell>
              <TableCell className="max-w-[140px] truncate text-muted-foreground">
                {formatList(row.sourceNames)}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
