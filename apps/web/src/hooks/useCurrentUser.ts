import { useQuery } from '@tanstack/react-query'
import type { AppUser } from '@tender-os/types'
import { apiFetch } from '../lib/apiClient.js'
import { toAsyncState } from '../lib/asyncState.js'

/**
 * The caller's own resolved profile (apps/api/src/routes/me.ts). Used
 * only to decide which Source Registry admin actions to *show*
 * (Phase 4 §18) — the API re-checks the role on every mutating
 * request regardless, so hiding a button here is a UX convenience,
 * never the actual access boundary.
 */
export function useCurrentUser() {
  const query = useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<AppUser>('/api/me'),
    staleTime: 60_000,
  })
  return toAsyncState(query)
}
