import type { ReactNode } from 'react'
import type { AsyncState } from '@tender-os/types'
import { LoadingState } from './LoadingState.js'
import { EmptyState } from './EmptyState.js'
import { ErrorState } from './ErrorState.js'

/**
 * Renders the correct one of loading/empty/error/success for any
 * AsyncState<T> (shared/types/src/api.ts) — the mechanism that makes
 * "every data view must show all four states explicitly" (spec §10)
 * structurally easy to satisfy rather than something each page has
 * to remember to hand-roll.
 */
export function AsyncBoundary<T>({
  state,
  isEmpty,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  onRetry,
  children,
}: {
  state: AsyncState<T>
  isEmpty?: (data: T) => boolean
  emptyTitle?: string
  emptyDescription?: string
  onRetry?: () => void
  children: (data: T) => ReactNode
}) {
  if (state.status === 'loading') return <LoadingState />
  if (state.status === 'error') return <ErrorState message={state.error} onRetry={onRetry} />
  if (state.status === 'empty' || (state.status === 'success' && isEmpty?.(state.data))) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />
  }
  if (state.status === 'success') return <>{children(state.data)}</>
  return null
}
