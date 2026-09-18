import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ROUTES } from '@tender-os/constants'
import type { TenderSourceScanRow, TenderSourceErrorRow } from '@tender-os/schemas'
import { PageHeader } from '../PageHeader.js'
import { Button } from '../ui/button.js'
import { Tabs, TabPanel } from '../ui/tabs.js'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table.js'
import { LoadingState } from '../states/LoadingState.js'
import { ErrorState } from '../states/ErrorState.js'
import { EmptyState } from '../states/EmptyState.js'
import { SourceHealthBadge, AdapterStateBadge, AuthorityBadge } from './badges.js'
import { useCurrentUser } from '../../hooks/useCurrentUser.js'
import {
  useTenderSource,
  useTenderSourceScans,
  useTenderSourceErrors,
  useEnableSource,
  useDisableSource,
  usePauseSource,
  useResumeSource,
  useRunHealthCheck,
  isForbiddenError,
} from '../../hooks/useSourceRegistry.js'

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'health', label: 'Health' },
  { value: 'scans', label: 'Scan History' },
  { value: 'errors', label: 'Errors' },
  { value: 'configuration', label: 'Configuration' },
  { value: 'notes', label: 'Notes' },
]

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function SourceDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState('overview')
  const [actionMessage, setActionMessage] = useState<string | null>(null)

  const source = useTenderSource(id)
  const currentUser = useCurrentUser()
  const isAdmin = currentUser.status === 'success' && currentUser.data.role === 'ADMIN'

  const enable = useEnableSource()
  const disable = useDisableSource()
  const pause = usePauseSource()
  const resume = useResumeSource()
  const healthCheck = useRunHealthCheck()

  if (source.status === 'loading') return <LoadingState rows={6} />
  if (source.status === 'error') return <ErrorState message={source.error} onRetry={() => navigate(0)} />
  if (source.status === 'empty') {
    return (
      <EmptyState
        title="This source could not be found."
        action={
          <Button variant="outline" size="sm" onClick={() => navigate(ROUTES.sources)}>
            Back to Source Registry
          </Button>
        }
      />
    )
  }

  const data = source.data

  function runAction(
    mutation: { mutate: (id: string) => void },
    successMessage: string,
  ) {
    if (!id) return
    setActionMessage(null)
    mutation.mutate(id)
    // React Query mutations report errors via `.error` on the hook
    // itself, not a promise here — each button below reads its own
    // mutation's error state instead of this local message for the
    // authoritative failure reason. This just gives immediate,
    // optimistic-but-honest feedback that the action was sent.
    setActionMessage(successMessage)
  }

  return (
    <div>
      <div className="mb-2">
        <Link to={ROUTES.sources} className="text-sm text-muted-foreground hover:text-foreground">
          ← Source Registry
        </Link>
      </div>

      <PageHeader
        title={data.name}
        description={data.base_url}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AuthorityBadge authority={data.authority_level} />
            <AdapterStateBadge state={data.adapter_state} />
            <SourceHealthBadge status={data.health_status} />
          </div>
        }
      />

      {!isAdmin ? (
        <p className="mb-4 text-xs text-muted-foreground">
          Source configuration actions are restricted to ADMIN users. You can view this source's health and history.
        </p>
      ) : null}

      <div className="mb-6 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!isAdmin || healthCheck.isPending}
          onClick={() => runAction(healthCheck, 'Health check requested.')}
        >
          Run health check
        </Button>
        {data.adapter_state === 'PAUSED' ? (
          <Button variant="outline" size="sm" disabled={!isAdmin || resume.isPending} onClick={() => runAction(resume, 'Resumed.')}>
            Resume
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={!isAdmin || pause.isPending || data.adapter_state !== 'ACTIVE'}
            onClick={() => runAction(pause, 'Paused.')}
          >
            Pause
          </Button>
        )}
        {data.active ? (
          <Button variant="outline" size="sm" disabled={!isAdmin || disable.isPending} onClick={() => runAction(disable, 'Disabled.')}>
            Disable
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={!isAdmin || enable.isPending || !data.adapter_key}
            title={!data.adapter_key ? 'No adapter is implemented for this source yet' : undefined}
            onClick={() => runAction(enable, 'Enabled.')}
          >
            Enable
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => window.open(data.base_url, '_blank', 'noopener,noreferrer')}>
          Open Source →
        </Button>
      </div>

      {actionMessage ? <p className="mb-4 text-xs text-muted-foreground">{actionMessage}</p> : null}
      {[enable, disable, pause, resume, healthCheck].map((mutation, i) =>
        mutation.error ? (
          <p key={i} role="alert" className="mb-2 text-xs text-destructive">
            {isForbiddenError(mutation.error)
              ? 'You do not have permission to perform this action.'
              : mutation.error instanceof Error
                ? mutation.error.message
                : 'The action failed.'}
          </p>
        ) : null,
      )}

      <Tabs items={TABS} value={tab} onChange={setTab}>
        <TabPanel value="overview" activeValue={tab}>
          <OverviewTab
            sourceType={data.source_type}
            authorityLevel={data.authority_level}
            jurisdiction={data.jurisdiction}
            adapterKey={data.adapter_key}
            active={data.active}
            supportsDocuments={data.supports_documents}
            requiresLogin={data.requires_login}
            nextScheduledScanAt={data.nextScheduledScanAt}
          />
        </TabPanel>
        <TabPanel value="health" activeValue={tab}>
          <HealthTab
            healthStatus={data.health_status}
            lastScanAt={data.last_scan_at}
            lastSuccessAt={data.last_success_at}
            lastFailureAt={data.last_failure_at}
            errorCount={data.error_count}
            pausedAt={data.paused_at}
          />
        </TabPanel>
        <TabPanel value="scans" activeValue={tab}>
          <ScansTab sourceId={data.id} enabled={tab === 'scans'} />
        </TabPanel>
        <TabPanel value="errors" activeValue={tab}>
          <ErrorsTab sourceId={data.id} enabled={tab === 'errors'} />
        </TabPanel>
        <TabPanel value="configuration" activeValue={tab}>
          <ConfigurationTab
            scanFrequency={data.scan_frequency}
            active={data.active}
            adapterKey={data.adapter_key}
            requiresLogin={data.requires_login}
            supportsDocuments={data.supports_documents}
            requiresManualIngestion={data.requires_manual_ingestion}
          />
        </TabPanel>
        <TabPanel value="notes" activeValue={tab}>
          {data.notes ? (
            <p className="whitespace-pre-line text-sm text-foreground">{data.notes}</p>
          ) : (
            <EmptyState title="No notes have been added for this source." />
          )}
        </TabPanel>
      </Tabs>
    </div>
  )
}

function OverviewTab({
  sourceType,
  authorityLevel,
  jurisdiction,
  adapterKey,
  active,
  supportsDocuments,
  requiresLogin,
  nextScheduledScanAt,
}: {
  sourceType: string
  authorityLevel: string
  jurisdiction: string | null
  adapterKey: string | null
  active: boolean
  supportsDocuments: boolean
  requiresLogin: boolean
  nextScheduledScanAt: string | null
}) {
  const fields: Array<[string, string]> = [
    ['Source type', sourceType],
    ['Authority level', authorityLevel],
    ['Jurisdiction', jurisdiction ?? '—'],
    ['Adapter', adapterKey ?? 'Not connected'],
    ['Active', active ? 'Yes' : 'No'],
    ['Document support', supportsDocuments ? 'Yes' : 'No'],
    ['Requires authentication', requiresLogin ? 'Yes' : 'No'],
    ['Next scheduled scan', nextScheduledScanAt ? formatDateTime(nextScheduledScanAt) : 'Not scheduled'],
  ]
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
      {fields.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
          <dd className="text-sm text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function HealthTab({
  healthStatus,
  lastScanAt,
  lastSuccessAt,
  lastFailureAt,
  errorCount,
  pausedAt,
}: {
  healthStatus: string
  lastScanAt: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  errorCount: number
  pausedAt: string | null
}) {
  const fields: Array<[string, string]> = [
    ['Current status', healthStatus],
    ['Last scan', formatDateTime(lastScanAt)],
    ['Last successful scan', formatDateTime(lastSuccessAt)],
    ['Last failure', formatDateTime(lastFailureAt)],
    ['Total recorded errors', String(errorCount)],
  ]
  if (pausedAt) fields.push(['Paused since', formatDateTime(pausedAt)])
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
      {fields.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
          <dd className="text-sm text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function ScansTab({ sourceId, enabled }: { sourceId: string; enabled: boolean }) {
  const scans = useTenderSourceScans(sourceId, enabled)
  if (scans.status === 'loading') return <LoadingState rows={4} />
  if (scans.status === 'error') return <ErrorState message={scans.error} />
  if (scans.status !== 'success') return null
  const rows: TenderSourceScanRow[] = scans.data.rows
  if (rows.length === 0) {
    return <EmptyState title="This source has not been scanned yet." description="No scan history exists until a real adapter is connected (Phase 5+)." />
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Started</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Discovered</TableHead>
          <TableHead>Processed</TableHead>
          <TableHead>Failed</TableHead>
          <TableHead>Documents</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((scan) => (
          <TableRow key={scan.id}>
            <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(scan.started_at)}</TableCell>
            <TableCell>{scan.status}</TableCell>
            <TableCell className="tabular-nums">{scan.records_discovered}</TableCell>
            <TableCell className="tabular-nums">{scan.records_processed}</TableCell>
            <TableCell className="tabular-nums">{scan.records_failed}</TableCell>
            <TableCell className="tabular-nums">{scan.documents_discovered}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function ErrorsTab({ sourceId, enabled }: { sourceId: string; enabled: boolean }) {
  const errors = useTenderSourceErrors(sourceId, enabled)
  if (errors.status === 'loading') return <LoadingState rows={4} />
  if (errors.status === 'error') return <ErrorState message={errors.error} />
  if (errors.status !== 'success') return null
  const rows: TenderSourceErrorRow[] = errors.data.rows
  if (rows.length === 0) {
    return <EmptyState title="No errors have been recorded for this source." />
  }
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((error) => (
        <li key={error.id} className="rounded-md border border-border p-3 text-sm">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium uppercase tracking-wide">{error.error_type}</span>
            <span>{error.severity}</span>
            <span>{formatDateTime(error.occurred_at)}</span>
            {error.resolved_at ? <span>Resolved</span> : <span>Unresolved</span>}
          </div>
          <p className="text-foreground">{error.message}</p>
        </li>
      ))}
    </ul>
  )
}

function ConfigurationTab({
  scanFrequency,
  active,
  adapterKey,
  requiresLogin,
  supportsDocuments,
  requiresManualIngestion,
}: {
  scanFrequency: string
  active: boolean
  adapterKey: string | null
  requiresLogin: boolean
  supportsDocuments: boolean
  requiresManualIngestion: boolean
}) {
  // Deliberately shows only non-secret configuration (Phase 4 §11:
  // "Do NOT store secrets in the database... Never expose credentials
  // through the frontend") — there is no field here that could ever
  // be a credential, because the schema this reads from has none.
  const fields: Array<[string, string]> = [
    ['Scan frequency', scanFrequency],
    ['Active', active ? 'Yes' : 'No'],
    ['Adapter', adapterKey ?? 'Not connected'],
    ['Requires authentication', requiresLogin ? 'Yes' : 'No'],
    ['Document support', supportsDocuments ? 'Yes' : 'No'],
    ['Manual ingestion required', requiresManualIngestion ? 'Yes' : 'No'],
  ]
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
      {fields.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
          <dd className="text-sm text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
