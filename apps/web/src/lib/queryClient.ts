import { QueryClient } from '@tanstack/react-query'

/**
 * Single shared TanStack Query client (docs/BUILD-PLAN.md §5 item 5).
 * Conservative defaults: this is procurement data users must trust,
 * so retries are bounded and stale data is never shown indefinitely
 * without a background refetch.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})
