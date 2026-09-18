import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ROUTES } from '@tender-os/constants'
import { PageHeader } from '../PageHeader.js'
import { Button } from '../ui/button.js'
import { ErrorState } from '../states/ErrorState.js'
import { LoadingState } from '../states/LoadingState.js'
import { EmptyState } from '../states/EmptyState.js'
import { KpiStrip } from './KpiStrip.js'
import { ScanStatus } from './ScanStatus.js'
import { SearchBar } from './SearchBar.js'
import { FilterPanel } from './FilterPanel.js'
import { TenderTable } from './TenderTable.js'
import { Pagination } from './Pagination.js'
import { SavedFiltersMenu } from './SavedFiltersMenu.js'
import { useTenders } from '../../hooks/useTenders.js'
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js'
import { EMPTY_FILTERS, hasActiveFilters, type TenderFilters } from '../../lib/tenderFilters.js'

const PAGE_SIZE = 25

/**
 * The Tender Radar page (Phase 3 §3-§11) — assembles the header, KPI
 * strip, search, filters, table and pagination around `useTenders`.
 * Every empty/loading/error state below uses the exact copy the spec
 * requires; none of it is invented UI text.
 */
export function TenderRadar() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<TenderFilters>(EMPTY_FILTERS)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebouncedValue(search, 300)

  const effectiveFilters: TenderFilters = { ...filters, search: debouncedSearch || undefined }
  const tenders = useTenders(effectiveFilters, { page, pageSize: PAGE_SIZE })

  function updateFilters(next: TenderFilters) {
    setFilters(next)
    setPage(1)
  }

  function updateSearch(value: string) {
    setSearch(value)
    setPage(1)
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS)
    setSearch('')
    setPage(1)
  }

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['tenders'] })
  }

  const noFiltersAtAll = !hasActiveFilters(filters) && !search

  return (
    <div>
      <PageHeader
        title="Tender Radar"
        description="Monitor, filter and prioritise procurement opportunities."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refresh}>
              Refresh
            </Button>
            <SavedFiltersMenu currentFilters={effectiveFilters} onApply={(next) => updateFilters(next)} />
            <ScanStatus />
          </div>
        }
      />

      <div className="mb-6">
        <KpiStrip />
      </div>

      <div className="mb-4">
        <SearchBar value={search} onChange={updateSearch} />
      </div>

      <div className="flex gap-4">
        <FilterPanel filters={filters} onChange={updateFilters} />

        <div className="min-w-0 flex-1 rounded-md border border-border bg-card">
          {tenders.state.status === 'loading' ? (
            <div className="p-4">
              <LoadingState rows={8} />
            </div>
          ) : tenders.state.status === 'error' ? (
            <div className="p-4">
              <ErrorState message={tenders.state.error} onRetry={refresh} />
            </div>
          ) : tenders.state.status === 'success' && tenders.state.data.rows.length === 0 ? (
            noFiltersAtAll ? (
              <EmptyState
                title="Your Tender Radar is ready, but no procurement opportunities have been imported yet."
                action={
                  <Button size="sm" onClick={() => navigate(ROUTES.sources)}>
                    Configure sources
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title="No tenders match your current filters."
                action={
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            )
          ) : tenders.state.status === 'success' ? (
            <>
              <TenderTable rows={tenders.state.data.rows} />
              <Pagination page={page} totalPages={tenders.state.data.totalPages} onPageChange={setPage} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
