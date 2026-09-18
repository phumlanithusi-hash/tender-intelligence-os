import { LoadingState } from '../states/LoadingState.js'
import { ErrorState } from '../states/ErrorState.js'
import { EmptyState } from '../states/EmptyState.js'
import { Badge } from '../ui/badge.js'
import { Button } from '../ui/button.js'
import { useCurrentUser } from '../../hooks/useCurrentUser.js'
import { useTenderOutcome, useVerifyOutcome } from '../../hooks/useOutcomes.js'
import { OUTCOME_VERIFY_ROLES } from '@tender-os/constants'

function formatCurrency(value: number | null): string {
  if (value === null) return 'UNKNOWN'
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(value)
}

/**
 * Phase 17 §52 — tender-detail outcome tab: outcome/winner/award-value/
 * award-date, each with its truth/provenance indicator, plus any open
 * conflicts and a verify action gated by role + evidence (spec §18).
 * UNKNOWN is rendered as a first-class state, never hidden or forced
 * into a fabricated WON/LOST (spec §54).
 */
export function OutcomeTab({ tenderId, enabled }: { tenderId: string; enabled: boolean }) {
  const outcome = useTenderOutcome(enabled ? tenderId : undefined)
  const currentUser = useCurrentUser()
  const verify = useVerifyOutcome()
  const canVerify = currentUser.status === 'success' && (OUTCOME_VERIFY_ROLES as readonly string[]).includes(currentUser.data.role)

  if (!enabled) return null
  if (outcome.status === 'loading') return <LoadingState rows={4} />
  if (outcome.status === 'error') return <ErrorState message={outcome.error} />
  if (outcome.status !== 'success') return null

  const { data, conflicts } = outcome.data

  if (!data) {
    return <EmptyState title="Outcome UNKNOWN" description="No award/outcome has been recorded for this tender yet — this is a valid, first-class state, not a bug." />
  }

  const openConflicts = conflicts.filter((c) => c.status === 'OPEN')

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Outcome status: {data.outcomeStatus}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Winner: {data.winnerName ?? 'UNKNOWN'} · Award value: {formatCurrency(data.awardValue)} · Decision date: {data.decisionDate ?? 'UNKNOWN'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={data.truthStatus === 'VERIFIED' ? 'success' : 'warning'}>{data.truthStatus}</Badge>
            <Badge>{data.provenance}</Badge>
          </div>
        </div>
        {canVerify && data.truthStatus !== 'VERIFIED' && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={verify.isPending}
            onClick={() => verify.mutate(data.id)}
            title={!data.sourceUrl ? 'An outcome cannot be verified without attached evidence' : undefined}
          >
            {verify.isPending ? 'Verifying…' : 'Verify outcome'}
          </Button>
        )}
      </div>

      {openConflicts.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
          <p className="text-sm font-medium text-warning">{openConflicts.length} open conflict(s) on this outcome</p>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {openConflicts.map((c) => (
              <li key={c.id}>
                {c.fieldName}: &quot;{c.existingValue}&quot; vs &quot;{c.conflictingValue}&quot;
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">Resolve these from the Outcomes dashboard&apos;s conflict review panel.</p>
        </div>
      )}
    </div>
  )
}
