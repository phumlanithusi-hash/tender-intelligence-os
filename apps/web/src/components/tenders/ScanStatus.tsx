import { Badge } from '../ui/badge.js'
import { useTenderSources } from '../../hooks/useCatalogue.js'

/**
 * Header scan-status indicator (Phase 3 §3). No scraper exists yet
 * (Phase 4/5), so this never claims a scan happened — it reads the
 * real `tender_sources` rows and reports the honest state: every
 * source is currently `requires_manual_ingestion` with no
 * `last_scan_at`, so "Awaiting source connection" is what the data
 * actually says, not a placeholder string hard-coded independently of
 * it.
 */
export function ScanStatus() {
  const sources = useTenderSources()

  if (sources.status !== 'success') {
    return (
      <Badge variant="default" className="whitespace-nowrap">
        Scan status —
      </Badge>
    )
  }

  const rows = sources.data.rows
  const everScanned = rows.some((row) => row.last_scan_at !== null)

  if (rows.length === 0) {
    return <Badge variant="default">No sources configured</Badge>
  }

  if (!everScanned) {
    return <Badge variant="default">Awaiting source connection</Badge>
  }

  const healthy = rows.filter((row) => row.health_status === 'HEALTHY').length
  return (
    <Badge variant={healthy === rows.length ? 'success' : 'warning'}>
      {healthy}/{rows.length} sources healthy
    </Badge>
  )
}
