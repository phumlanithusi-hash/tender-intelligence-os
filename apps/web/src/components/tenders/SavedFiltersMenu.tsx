import { useState } from 'react'
import { Button } from '../ui/button.js'
import { Input } from '../ui/input.js'
import { useSavedFilters, useCreateSavedFilter, useDeleteSavedFilter } from '../../hooks/useSavedFilters.js'
import { hasActiveFilters, type TenderFilters } from '../../lib/tenderFilters.js'

/**
 * Saved filters (Phase 3 §16). A minimal popover rather than a full
 * modal/workflow — list existing saved filters (click to apply,
 * delete to remove), and a single-field form to save the current
 * filter state under a name. No filter-builder UI: the filter being
 * saved is whatever the panel/search already produced.
 */
export function SavedFiltersMenu({
  currentFilters,
  onApply,
}: {
  currentFilters: TenderFilters
  onApply: (filters: TenderFilters) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const savedFilters = useSavedFilters()
  const createSavedFilter = useCreateSavedFilter()
  const deleteSavedFilter = useDeleteSavedFilter()

  return (
    <div className="relative">
      <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true">
        Saved filters
      </Button>
      {open ? (
        <div className="absolute right-0 z-10 mt-2 w-72 rounded-md border border-border bg-card p-3 shadow-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your saved filters</p>
          {savedFilters.isPending ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : savedFilters.data && savedFilters.data.rows.length > 0 ? (
            <ul className="mb-3 flex flex-col gap-1">
              {savedFilters.data.rows.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className="flex-1 truncate rounded px-1.5 py-1 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      onApply(row.filter as TenderFilters)
                      setOpen(false)
                    }}
                  >
                    {row.name}
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete saved filter ${row.name}`}
                    onClick={() => deleteSavedFilter.mutate(row.id)}
                  >
                    ×
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-muted-foreground">No saved filters yet.</p>
          )}

          <form
            className="flex gap-1.5"
            onSubmit={(event) => {
              event.preventDefault()
              if (!name.trim()) return
              createSavedFilter.mutate(
                { name: name.trim(), filter: currentFilters },
                { onSuccess: () => setName('') },
              )
            }}
          >
            <Input
              aria-label="Save current filters as"
              placeholder="e.g. Print, WC, 14 days"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!hasActiveFilters(currentFilters)}
            />
            <Button type="submit" size="sm" disabled={!name.trim() || !hasActiveFilters(currentFilters)}>
              Save
            </Button>
          </form>
          {!hasActiveFilters(currentFilters) ? (
            <p className="mt-1 text-xs text-muted-foreground">Apply at least one filter before saving.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
