import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/apiClient.js'
import { toAsyncState } from '../lib/asyncState.js'

/** Phase 19 §16 hook. */
export interface OpsHealthDashboard {
  sources: { totalSources: number; activeSources: number; healthySources: number; warningSources: number; failedSources: number; notConnectedSources: number; lastScanAt: string | null }
  documents: { queued: number; processing: number; completed: number; failed: number; requiresReview: number }
  ai: { totalRuns: number; failedRuns: number; requiresReviewRuns: number; embeddingFailures: number }
  outcomes: { verified: number; unknown: number; conflicting: number; requiresFollowUp: number }
  jobs: { queuedScans: number; runningScans: number; failedScans: number }
  storage: { documentsWithStoragePath: number; documentsMissingStoragePath: number }
  generatedAt: string
}

export function useOpsHealth() {
  const query = useQuery({
    queryKey: ['ops', 'health'],
    queryFn: async () => (await apiFetch<{ data: OpsHealthDashboard }>('/api/ops/health')).data,
    refetchInterval: 30_000,
  })
  return toAsyncState(query)
}
