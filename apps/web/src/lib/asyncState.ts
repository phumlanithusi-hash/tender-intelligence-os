import type { UseQueryResult } from '@tanstack/react-query'
import type { AsyncState } from '@tender-os/types'

/**
 * Converts a TanStack Query result into the shared AsyncState<T> union
 * (shared/types/src/api.ts) that AsyncBoundary renders. Centralising
 * this in one place means every resource hook produces the identical
 * loading/error/success shape, rather than each hook re-deriving it
 * (and risking a subtly different loading/error condition) by hand.
 */
export function toAsyncState<T>(query: UseQueryResult<T>): AsyncState<T> {
  if (query.isPending) return { status: 'loading' }
  if (query.isError) {
    return { status: 'error', error: query.error instanceof Error ? query.error.message : 'Unknown error' }
  }
  return { status: 'success', data: query.data as T }
}
