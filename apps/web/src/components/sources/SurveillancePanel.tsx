import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js'
import { Badge } from '../ui/badge.js'
import { Button } from '../ui/button.js'
import { AsyncBoundary } from '../states/AsyncBoundary.js'
import { SURVEILLANCE_MANAGE_ROLES } from '@tender-os/constants'
import { useCurrentUser } from '../../hooks/useCurrentUser.js'
import { usePollSchedule, useRunSurveillanceScan } from '../../hooks/useSurveillance.js'

/**
 * Phase 20 §4A — the continuous surveillance / polling schedule
 * panel on the Source Registry. This system has no live background
 * scheduler (no BullMQ/Redis wiring exists in this codebase) — this
 * panel shows exactly what a real scheduler WOULD do on the reported
 * cadence, and lets an authorized operator trigger the same
 * on-demand scan seam a future queue worker would call.
 */
export function SurveillancePanel() {
  const currentUser = useCurrentUser()
  const canManage = currentUser.status === 'success' && (SURVEILLANCE_MANAGE_ROLES as readonly string[]).includes(currentUser.data.role)
  const schedule = usePollSchedule()
  const runScan = useRunSurveillanceScan()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Continuous surveillance</CardTitle>
      </CardHeader>
      <CardContent>
        <AsyncBoundary state={schedule} emptyTitle="No sources configured" isEmpty={(d) => d.length === 0}>
          {(rows) => (
            <ul className="flex flex-col gap-2 text-sm">
              {rows.map((r) => (
                <li key={r.sourceId} className="flex items-center justify-between rounded border border-border p-2">
                  <div>
                    <span className="font-medium">{r.name ?? r.sourceId}</span>
                    <p className="text-xs text-muted-foreground">{r.reason}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.due ? <Badge variant="warning">DUE</Badge> : <Badge>UP TO DATE</Badge>}
                    {canManage ? (
                      <Button size="sm" variant="outline" disabled={runScan.isPending} onClick={() => runScan.mutate(r.sourceId)}>
                        Scan now
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </AsyncBoundary>
      </CardContent>
    </Card>
  )
}
