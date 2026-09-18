import { Link, useNavigate } from 'react-router-dom'
import { ROUTES } from '@tender-os/constants'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table.js'
import { SourceHealthBadge, AdapterStateBadge, AuthorityBadge } from './badges.js'
import type { TenderSourceWithSchedule } from '../../hooks/useSourceRegistry.js'

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * The Source Registry table (Phase 4 §15). Dense and scannable —
 * every column is either a plain value or a single restrained badge,
 * never multiple competing colours per row.
 */
export function SourceTable({ rows }: { rows: TenderSourceWithSchedule[] }) {
  const navigate = useNavigate()

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Source</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Authority</TableHead>
          <TableHead>Jurisdiction</TableHead>
          <TableHead>Adapter</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Last Scan</TableHead>
          <TableHead>Last Success</TableHead>
          <TableHead>Errors</TableHead>
          <TableHead>Documents</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const href = ROUTES.sourceDetail(row.id)
          return (
            <TableRow
              key={row.id}
              tabIndex={0}
              role="link"
              aria-label={`Open ${row.name}`}
              onClick={() => navigate(href)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  navigate(href)
                }
              }}
              className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <TableCell className="max-w-[220px]">
                <div className="truncate font-medium text-foreground">{row.name}</div>
                <div className="truncate text-xs text-muted-foreground">{row.base_url}</div>
              </TableCell>
              <TableCell className="text-muted-foreground">{row.source_type}</TableCell>
              <TableCell>
                <AuthorityBadge authority={row.authority_level} />
              </TableCell>
              <TableCell className="text-muted-foreground">{row.jurisdiction ?? '—'}</TableCell>
              <TableCell>
                <AdapterStateBadge state={row.adapter_state} />
              </TableCell>
              <TableCell>
                <SourceHealthBadge status={row.health_status} />
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(row.last_scan_at)}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(row.last_success_at)}</TableCell>
              <TableCell className="tabular-nums text-muted-foreground">{row.error_count}</TableCell>
              <TableCell className="text-muted-foreground">{row.supports_documents ? 'Yes' : 'No'}</TableCell>
              <TableCell className="text-right">
                <Link
                  to={href}
                  onClick={(event) => event.stopPropagation()}
                  className="text-sm text-muted-foreground underline hover:text-foreground"
                >
                  View
                </Link>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
