import { useState } from 'react'
import type { OpportunityScoreComponentDto, OpportunityScoreDriverDto, OpportunityScoreGateDto } from '@tender-os/schemas'
import { OPPORTUNITY_SCORE_ACTION_ROLES } from '@tender-os/constants'
import { Button } from '../ui/button.js'
import { LoadingState } from '../states/LoadingState.js'
import { ErrorState } from '../states/ErrorState.js'
import { EmptyState } from '../states/EmptyState.js'
import { DecisionSignalBadge, ScoreGateStatusBadge, ScoreComponentStatusBadge } from './badges.js'
import { useOpportunityScore, useComputeOpportunityScore } from '../../hooks/useOpportunityScore.js'
import { useCurrentUser } from '../../hooks/useCurrentUser.js'

const DIMENSION_LABEL: Record<string, string> = {
  QUALIFICATION: 'Qualification',
  REQUIREMENT_COVERAGE: 'Requirement Coverage',
  EVALUATION_FIT: 'Evaluation Fit',
  EVIDENCE_STRENGTH: 'Evidence Strength',
  COMMERCIAL_FIT: 'Commercial Fit',
  STRATEGIC_FIT: 'Strategic Fit',
}

/**
 * Phase 10 §39-§45 — the Opportunity Score tab. Deliberately a
 * completely separate screen/hook/vocabulary from the pre-existing
 * legacy "Score" tab (Phase 3, `ScoreTab`/`useTenderScore`) elsewhere in
 * this file — never merge the two, per docs/DECISIONS.md.
 */
export function OpportunityScoreTab({ tenderId, enabled }: { tenderId: string; enabled: boolean }) {
  const score = useOpportunityScore(tenderId, enabled)
  const currentUser = useCurrentUser()
  const canAct = currentUser.status === 'success' && (OPPORTUNITY_SCORE_ACTION_ROLES as readonly string[]).includes(currentUser.data.role)
  const compute = useComputeOpportunityScore(tenderId)

  if (score.status === 'loading') return <LoadingState rows={4} />
  if (score.status === 'error') return <ErrorState message={score.error} />
  if (score.status !== 'success') return null

  const { run, components, drivers, risks, gates } = score.data
  const blockedGates = gates.filter((g) => g.status === 'TRIGGERED')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
        <div>
          <p className="text-sm font-medium text-foreground">Opportunity score</p>
          <p className="text-xs text-muted-foreground">
            A deterministic, evidence-grounded internal score of how well this agency currently fits this tender's requirements and evaluation framework — computed from qualification, requirement
            coverage, evaluation fit, evidence, and profile data already on file.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={!canAct || compute.isPending} title={canAct ? undefined : 'Requires ADMIN or BID_MANAGER'} onClick={() => compute.mutate()}>
          {compute.isPending ? 'Computing…' : run ? 'Re-compute score' : 'Compute score'}
        </Button>
      </div>

      {!run ? <EmptyState title="No opportunity score has been computed for this tender yet." description="Click Compute score above to run the deterministic engine." /> : null}

      {run ? (
        <>
          <div className="rounded-md border border-border p-4">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-2xl font-semibold tabular-nums text-foreground">{run.overallScore !== null ? `${Math.round(run.overallScore)}/100` : 'Unscored'}</span>
              <DecisionSignalBadge signal={run.decisionSignal} />
              {run.isStale ? <span className="rounded-sm border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">Stale — inputs changed since this run</span> : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Data completeness: {run.dataCompleteness !== null ? `${Math.round(run.dataCompleteness * 100)}%` : 'Unknown'} — this measures how much of the score is backed by known data, not how
              confident or accurate the score is.
            </p>
            <p className="mt-2 text-xs italic text-muted-foreground">
              This is an internal opportunity score. It is not a prediction of winning, a win probability, or a bid/no-bid decision.
            </p>
          </div>

          {blockedGates.length > 0 ? (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
              <p className="text-sm font-semibold text-destructive">BLOCKED</p>
              <ul className="mt-1 flex flex-col gap-1 text-xs text-foreground">
                {blockedGates.map((g) => (
                  <li key={g.id}>
                    <span className="font-medium">{g.gateType.replace(/_/g, ' ')}</span> — {g.description}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <ScoreBreakdown components={components} />
          <WhyThisScore drivers={drivers} risks={risks} unknowns={score.data.unknowns} />
          <GatesTable gates={gates} />
        </>
      ) : null}
    </div>
  )
}

function ScoreBreakdown({ components }: { components: OpportunityScoreComponentDto[] }) {
  const order = ['QUALIFICATION', 'REQUIREMENT_COVERAGE', 'EVALUATION_FIT', 'EVIDENCE_STRENGTH', 'COMMERCIAL_FIT', 'STRATEGIC_FIT']
  const sorted = [...components].sort((a, b) => order.indexOf(a.dimension) - order.indexOf(b.dimension))
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-sm font-medium text-foreground">Score breakdown</p>
      <div className="mt-3 flex flex-col gap-3">
        {sorted.map((c) => (
          <div key={c.dimension}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-medium text-foreground">
                {DIMENSION_LABEL[c.dimension] ?? c.dimension} <span className="text-muted-foreground">(weight {Math.round(c.weight * 100)}%)</span>
              </span>
              <span className="flex items-center gap-2">
                <ScoreComponentStatusBadge status={c.status} />
                <span className="tabular-nums text-foreground">{c.score !== null ? `${Math.round(c.score)}/100` : '—'}</span>
              </span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${c.score ?? 0}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{c.explanation}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function WhyThisScore({ drivers, risks, unknowns }: { drivers: OpportunityScoreDriverDto[]; risks: OpportunityScoreDriverDto[]; unknowns: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-border p-3">
      <button type="button" className="text-sm font-medium text-foreground underline" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide' : 'Why is this score what it is?'}
      </button>
      {open ? (
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase text-success">Positive drivers</p>
            {drivers.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">None recorded.</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-2 text-xs text-foreground">
                {drivers.map((d) => (
                  <li key={d.id}>{d.description}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-destructive">Risks</p>
            {risks.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">None recorded.</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-2 text-xs text-foreground">
                {risks.map((r) => (
                  <li key={r.id}>{r.description}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground">Unknowns</p>
            {unknowns.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">None — every dimension resolved to a known state.</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-2 text-xs text-muted-foreground">
                {unknowns.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function GatesTable({ gates }: { gates: OpportunityScoreGateDto[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="p-2">Hard gate</th>
            <th className="p-2">Status</th>
            <th className="p-2">Description</th>
          </tr>
        </thead>
        <tbody>
          {gates.map((g) => (
            <tr key={g.id} className="border-t border-border align-top">
              <td className="p-2 text-foreground">{g.gateType.replace(/_/g, ' ')}</td>
              <td className="p-2">
                <ScoreGateStatusBadge status={g.status} />
              </td>
              <td className="p-2 text-xs text-muted-foreground">{g.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
