import type { ReactNode } from 'react'
import { TENDER_STATUS, BID_DECISION } from '@tender-os/constants'
import { Select } from '../ui/select.js'
import { Button } from '../ui/button.js'
import { Skeleton } from '../ui/skeleton.js'
import { useServices, useTenderSources } from '../../hooks/useCatalogue.js'
import {
  CLOSING_DATE_PRESETS,
  closingWithinDaysToDate,
  hasActiveFilters,
  todayIsoDate,
  type TenderFilters,
} from '../../lib/tenderFilters.js'

const ENTITY_TYPES = ['National Government', 'Provincial Government', 'Municipality', 'SOE', 'Other']

/**
 * The filter panel (Phase 3 §6). Every option list that comes from
 * the database (service, source) is fetched, never hand-typed into
 * this component — the entity-type and closing-date-preset lists are
 * the two genuinely fixed, non-database vocabularies the spec itself
 * defines.
 */
export function FilterPanel({
  filters,
  onChange,
}: {
  filters: TenderFilters
  onChange: (next: TenderFilters) => void
}) {
  const services = useServices()
  const sources = useTenderSources()

  function set<K extends keyof TenderFilters>(key: K, value: TenderFilters[K]) {
    onChange({ ...filters, [key]: value || undefined })
  }

  function applyClosingPreset(days: number) {
    onChange({ ...filters, closingAfter: todayIsoDate(), closingBefore: closingWithinDaysToDate(days) })
  }

  return (
    <div className="flex w-64 shrink-0 flex-col gap-4 rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Filters</h2>
        {hasActiveFilters(filters) ? (
          <Button variant="ghost" size="sm" onClick={() => onChange({})}>
            Clear all
          </Button>
        ) : null}
      </div>

      <FilterField label="Status" id="filter-status">
        <Select id="filter-status" value={filters.status ?? ''} onChange={(e) => set('status', e.target.value || undefined)}>
          <option value="">Any status</option>
          {TENDER_STATUS.map((status) => (
            <option key={status} value={status}>
              {status.replace('_', ' ')}
            </option>
          ))}
        </Select>
      </FilterField>

      <FilterField label="Service" id="filter-service">
        {services.status === 'loading' ? (
          <Skeleton className="h-9 w-full" />
        ) : services.status === 'success' ? (
          <Select id="filter-service" value={filters.service ?? ''} onChange={(e) => set('service', e.target.value || undefined)}>
            <option value="">Any service</option>
            {services.data.rows.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </Select>
        ) : (
          <p className="text-xs text-muted-foreground">Services unavailable</p>
        )}
      </FilterField>

      <FilterField label="Province" id="filter-province">
        <Select id="filter-province" value={filters.province ?? ''} onChange={(e) => set('province', e.target.value || undefined)}>
          <option value="">Any / National</option>
          {[
            'Eastern Cape',
            'Free State',
            'Gauteng',
            'KwaZulu-Natal',
            'Limpopo',
            'Mpumalanga',
            'Northern Cape',
            'North West',
            'Western Cape',
          ].map((province) => (
            <option key={province} value={province}>
              {province}
            </option>
          ))}
        </Select>
      </FilterField>

      <FilterField label="Organisation type" id="filter-entity-type">
        <Select id="filter-entity-type" value={filters.entityType ?? ''} onChange={(e) => set('entityType', e.target.value || undefined)}>
          <option value="">Any type</option>
          {ENTITY_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>
      </FilterField>

      <fieldset className="flex flex-col gap-1 border-0 p-0 m-0">
        <legend className="text-xs font-medium text-muted-foreground">Closing date</legend>
        <div className="flex flex-wrap gap-1">
          {CLOSING_DATE_PRESETS.map((preset) => (
            <Button key={preset.label} variant="outline" size="sm" onClick={() => applyClosingPreset(preset.days)}>
              {preset.label}
            </Button>
          ))}
          {(filters.closingBefore || filters.closingAfter) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange({ ...filters, closingBefore: undefined, closingAfter: undefined })}
            >
              Clear
            </Button>
          )}
        </div>
      </fieldset>

      <FilterField label="Briefing" id="filter-briefing">
        <Select
          id="filter-briefing"
          value={filters.briefingRequired === undefined ? '' : String(filters.briefingRequired)}
          onChange={(e) => set('briefingRequired', e.target.value === '' ? undefined : e.target.value === 'true')}
        >
          <option value="">Any</option>
          <option value="true">Required</option>
          <option value="false">Not required</option>
        </Select>
      </FilterField>

      <FilterField label="Opportunity class" id="filter-score-class">
        <Select id="filter-score-class" value={filters.scoreClass ?? ''} onChange={(e) => set('scoreClass', e.target.value || undefined)}>
          <option value="">Any (scored tenders only)</option>
          {BID_DECISION.map((decision) => (
            <option key={decision} value={decision}>
              {decision.replace('_', ' ')}
            </option>
          ))}
        </Select>
      </FilterField>

      <FilterField label="Source" id="filter-source">
        {sources.status === 'loading' ? (
          <Skeleton className="h-9 w-full" />
        ) : sources.status === 'success' ? (
          <Select id="filter-source" value={filters.source ?? ''} onChange={(e) => set('source', e.target.value || undefined)}>
            <option value="">Any source</option>
            {sources.data.rows.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </Select>
        ) : (
          <p className="text-xs text-muted-foreground">Sources unavailable</p>
        )}
      </FilterField>
    </div>
  )
}

function FilterField({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}
