import { PageHeader } from '../components/PageHeader.js'
import { AsyncBoundary } from '../components/states/AsyncBoundary.js'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.js'
import { Badge } from '../components/ui/badge.js'
import { useHealth } from '../hooks/useHealth.js'

/**
 * Dashboard is the one page in Phase 1 wired to a real backend call
 * (GET /api/health), so it demonstrates the full loading/empty/error/
 * success pattern end to end rather than only in isolation. The
 * dashboard's real content (open tenders, priority bids, closing-soon
 * counts, etc. — spec §10) is built in Phase 3 once tender data exists;
 * showing it now would mean inventing numbers, which the project's
 * anti-fabrication rule forbids even for UI scaffolding.
 */
export function Dashboard() {
  const health = useHealth()

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Tender radar, bid pipeline, and coverage overview will appear here once tender data ingestion (Phase 5+) is live."
      />
      <Card>
        <CardHeader>
          <CardTitle>API connectivity</CardTitle>
        </CardHeader>
        <CardContent>
          <AsyncBoundary state={health}>
            {(data) => (
              <div className="flex items-center gap-3 text-sm">
                <Badge variant={data.status === 'ok' ? 'success' : 'warning'}>{data.status}</Badge>
                <span className="text-muted-foreground">{data.service}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">database: {data.checks.database}</span>
              </div>
            )}
          </AsyncBoundary>
        </CardContent>
      </Card>
    </div>
  )
}
