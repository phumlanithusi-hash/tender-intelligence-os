import { useState } from 'react'
import { PageHeader } from '../components/PageHeader.js'
import { AsyncBoundary } from '../components/states/AsyncBoundary.js'
import { Card, CardContent } from '../components/ui/card.js'
import { Badge } from '../components/ui/badge.js'
import { Button } from '../components/ui/button.js'
import { Input } from '../components/ui/input.js'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table.js'
import { useDebouncedValue } from '../hooks/useDebouncedValue.js'
import { useCompetitors, type CompetitorFilters } from '../hooks/useOutcomes.js'

function dataQualityVariant(dataQuality: string): 'default' | 'success' | 'warning' {
  if (dataQuality === 'VERIFIED') return 'success'
  if (dataQuality === 'UNKNOWN') return 'warning'
  return 'default'
}

/**
 * Phase 17 gap-close — the competitor directory (spec §64/§65/§90):
 * a standalone browse/search/filter page over
 * `GET /api/analytics/competitors`, replacing the placeholder
 * previously at this route. Every count shown is an observed,
 * server-computed activity count (never a market-share or win-rate
 * estimate) — this stays a directory of what has actually been
 * recorded, not a competitive-intelligence claim (spec §36: "do not
 * fabricate competitor data").
 */
export function CompetitorsDirectory() {
  const [searchInput, setSearchInput] = useState('')
  const [province, setProvince] = useState('')
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebouncedValue(searchInput, 300)

  const filters: CompetitorFilters = {
    search: debouncedSearch || undefined,
    province: province || undefined,
    page,
    pageSize: 25,
  }
  const competitors = useCompetitors(filters)
  const hasFilters = Boolean(debouncedSearch || province)

  return (
    <div>
      <PageHeader
        title="Competitors"
        description="Every competitor and count below is built only from recorded award/bid activity — never inferred or scraped (spec §36)."
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 pt-4">
          <div className="w-56">
            <label htmlFor="competitor-search" className="mb-1 block text-xs text-muted-foreground">
              Search by name
            </label>
            <Input
              id="competitor-search"
              placeholder="e.g. Acme Trading"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value)
                setPage(1)
              }}
            />
          </div>
          <div className="w-44">
            <label htmlFor="competitor-province" className="mb-1 block text-xs text-muted-foreground">
              Province
            </label>
            <Input
              id="competitor-province"
              placeholder="e.g. Gauteng"
              value={province}
              onChange={(e) => {
                setProvince(e.target.value)
                setPage(1)
              }}
            />
          </div>
          {hasFilters && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchInput('')
                setProvince('')
                setPage(1)
              }}
            >
              Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <AsyncBoundary
            state={competitors}
            emptyTitle={hasFilters ? 'No competitors match these filters' : 'No competitors recorded yet'}
            emptyDescription={hasFilters ? undefined : 'Competitor rows are only created from verified award/bid activity, never fabricated.'}
            isEmpty={(d) => d.data.length === 0}
          >
            {(result) => (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Province</TableHead>
                      <TableHead>Data quality</TableHead>
                      <TableHead>Bidder</TableHead>
                      <TableHead>Winner</TableHead>
                      <TableHead>Shortlisted</TableHead>
                      <TableHead>Disqualified</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.data.map((c) => (
                      <TableRow key={c.competitorId}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell>{c.province ?? 'UNKNOWN'}</TableCell>
                        <TableCell>
                          <Badge variant={dataQualityVariant(c.dataQuality)}>{c.dataQuality}</Badge>
                        </TableCell>
                        <TableCell>{c.bidderCount}</TableCell>
                        <TableCell>{c.winnerCount}</TableCell>
                        <TableCell>{c.shortlistedCount}</TableCell>
                        <TableCell>{c.disqualifiedCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {result.total} competitor{result.total === 1 ? '' : 's'} · page {result.page} of {Math.max(result.totalPages, 1)}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={result.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                      Previous
                    </Button>
                    <Button variant="outline" size="sm" disabled={result.page >= result.totalPages} onClick={() => setPage((p) => p + 1)}>
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </AsyncBoundary>
        </CardContent>
      </Card>
    </div>
  )
}
