import { Skeleton } from '../ui/skeleton.js'

/**
 * Standard loading state (spec §10 requires loading/empty/error/success
 * on every data view). `rows` controls how many skeleton rows render,
 * so a list page and a detail page can both use this sensibly.
 */
export function LoadingState({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-live="polite" aria-label="Loading" className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}
