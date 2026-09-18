import { useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../PageHeader.js'
import { Button } from '../ui/button.js'
import { LoadingState } from '../states/LoadingState.js'
import { ErrorState } from '../states/ErrorState.js'
import { EmptyState } from '../states/EmptyState.js'
import { SourceSummary } from './SourceSummary.js'
import { SourceTable } from './SourceTable.js'
import { SurveillancePanel } from './SurveillancePanel.js'
import { useTenderSourceRegistry } from '../../hooks/useSourceRegistry.js'

/**
 * The Source Registry's operational control centre (Phase 4 §13/§14).
 * Reads only — every configuration action lives on the detail page
 * (Phase 4 §16/§17), so this page stays a dashboard, not a form.
 */
export function SourceRegistry() {
  const queryClient = useQueryClient()
  const registry = useTenderSourceRegistry()

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['tender-sources'] })
  }

  return (
    <div>
      <PageHeader
        title="Source Registry"
        description="Which procurement sources are configured, their authority, and their operational health."
        actions={
          <Button variant="outline" size="sm" onClick={refresh}>
            Refresh
          </Button>
        }
      />

      <div className="mb-6">
        <SourceSummary />
      </div>

      <div className="mb-6">
        <SurveillancePanel />
      </div>

      <div className="rounded-md border border-border bg-card">
        {registry.status === 'loading' ? (
          <div className="p-4">
            <LoadingState rows={6} />
          </div>
        ) : registry.status === 'error' ? (
          <div className="p-4">
            <ErrorState message={registry.error} onRetry={refresh} />
          </div>
        ) : registry.status === 'success' && registry.data.rows.length === 0 ? (
          <EmptyState title="No tender sources have been configured yet." />
        ) : registry.status === 'success' ? (
          <SourceTable rows={registry.data.rows} />
        ) : null}
      </div>
    </div>
  )
}
