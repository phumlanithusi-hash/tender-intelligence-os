import { Input } from '../ui/input.js'

/**
 * The Tender Radar search field (Phase 3 §5). Debouncing happens in
 * the parent (useDebouncedValue) so this stays a plain controlled
 * input — every keystroke updates local state instantly for a
 * responsive field, while the network request itself waits for
 * typing to pause.
 */
export function SearchBar({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="max-w-md flex-1">
      <label htmlFor="tender-search" className="sr-only">
        Search tenders
      </label>
      <Input
        id="tender-search"
        type="search"
        placeholder="Search by tender number, title, organisation, category, province…"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
