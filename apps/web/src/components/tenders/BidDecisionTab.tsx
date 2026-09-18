import { useState } from 'react'
import type { BidDecisionRuleResultDto } from '@tender-os/schemas'
import { BID_DECISION_EVALUATE_ROLES, BID_DECISION_OVERRIDE_ROLES } from '@tender-os/constants'
import { Button } from '../ui/button.js'
import { LoadingState } from '../states/LoadingState.js'
import { ErrorState } from '../states/ErrorState.js'
import { EmptyState } from '../states/EmptyState.js'
import { BidRecommendationBadge, BidRuleStatusBadge, BidRuleSeverityBadge, BidEffortBadge } from './badges.js'
import { useBidDecision, useEvaluateBidDecision, useOverrideBidDecision } from '../../hooks/useBidDecision.js'
import { useCurrentUser } from '../../hooks/useCurrentUser.js'

/**
 * Phase 11 §47-§54 — the Bid Decision tab. Deliberately separate from
 * Phase 10's "Scoring Engine" tab (how attractive) and from the
 * pre-existing legacy "Score"/"Risk" tabs — never merged (see
 * docs/DECISIONS.md).
 */
export function BidDecisionTab({ tenderId, enabled }: { tenderId: string; enabled: boolean }) {
  const decision = useBidDecision(tenderId, enabled)
  const currentUser = useCurrentUser()
  const canEvaluate = currentUser.status === 'success' && (BID_DECISION_EVALUATE_ROLES as readonly string[]).includes(currentUser.data.role)
  const canOverride = currentUser.status === 'success' && (BID_DECISION_OVERRIDE_ROLES as readonly string[]).includes(currentUser.data.role)
  const evaluate = useEvaluateBidDecision(tenderId)
  const override = useOverrideBidDecision(tenderId)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overrideDecision, setOverrideDecision] = useState<'BID' | 'NO_BID' | 'REVIEW'>('REVIEW')
  const [overrideReason, setOverrideReason] = useState('')

  if (decision.status === 'loading') return <LoadingState rows={4} />
  if (decision.status === 'error') return <ErrorState message={decision.error} />
  if (decision.status !== 'success') return null

  const { run, ruleResults, blockers, warnings, unresolvedItems } = decision.data
  const finalDecision = run?.finalDecision ?? null
  const hasOverride = Boolean(run?.humanDecision)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
        <div>
          <p className="text-sm font-medium text-foreground">Bid decision</p>
          <p className="text-xs text-muted-foreground">
            A deterministic, rule-based recommendation on whether this agency should invest resources in bidding — distinct from the Scoring Engine tab, which only measures how attractive the
            opportunity is. Never AI-generated.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={!canEvaluate || evaluate.isPending} title={canEvaluate ? undefined : 'Requires ADMIN or BID_MANAGER'} onClick={() => evaluate.mutate()}>
          {evaluate.isPending ? 'Evaluating…' : run ? 'Re-evaluate' : 'Evaluate bid decision'}
        </Button>
      </div>

      {!run ? <EmptyState title="No bid decision has been computed for this tender yet." description="Click Evaluate bid decision above to run the deterministic rule engine." /> : null}

      {run ? (
        <>
          <div className="rounded-md border border-border p-4">
            <div className="flex flex-wrap items-center gap-3">
              <BidRecommendationBadge decision={finalDecision} />
              <span className="text-xs text-muted-foreground">Bid effort:</span>
              <BidEffortBadge level={run.bidEffort} />
              {run.isStale ? <span className="rounded-sm border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">Stale — inputs changed since this run</span> : null}
            </div>

            {hasOverride ? (
              <div className="mt-3 grid gap-2 rounded-sm border border-border bg-muted/30 p-2 text-xs sm:grid-cols-3">
                <div>
                  <p className="font-semibold uppercase text-muted-foreground">System decision</p>
                  <BidRecommendationBadge decision={run.systemDecision} />
                </div>
                <div>
                  <p className="font-semibold uppercase text-muted-foreground">Human decision</p>
                  <BidRecommendationBadge decision={run.humanDecision} />
                  <p className="mt-1 text-muted-foreground">{run.overrideReason}</p>
                </div>
                <div>
                  <p className="font-semibold uppercase text-muted-foreground">Final decision</p>
                  <BidRecommendationBadge decision={run.finalDecision} />
                </div>
              </div>
            ) : null}

            {run.decisionExplanation ? <p className="mt-3 text-sm text-foreground">{run.decisionExplanation}</p> : null}
          </div>

          {/* Phase 11 §49 — blockers always shown first, prominently. */}
          {blockers.length > 0 ? (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
              <p className="text-sm font-semibold text-destructive">BLOCKERS</p>
              <ol className="mt-1 flex flex-col gap-1 text-xs text-foreground">
                {blockers.map((b, i) => (
                  <li key={b.ruleId}>
                    {i + 1}. <span className="font-medium">{b.ruleId.replace(/-/g, ' ')}</span> — {b.explanation}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {/* Phase 11 §52 — human actions for REVIEW. */}
          {finalDecision === 'REVIEW' && unresolvedItems.length > 0 ? (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
              <p className="text-sm font-semibold text-warning">ACTION REQUIRED</p>
              <ul className="mt-1 flex flex-col gap-1 text-xs text-foreground">
                {unresolvedItems.map((u) => (
                  <li key={u.ruleId}>☐ {u.explanation}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Phase 11 §51 — warnings shown distinctly from failures. */}
          {warnings.filter((w) => w.status !== 'PASS').length > 0 ? (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p className="text-sm font-semibold text-muted-foreground">WARNINGS</p>
              <ul className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
                {warnings
                  .filter((w) => w.status !== 'PASS')
                  .map((w) => (
                    <li key={w.ruleId}>⚠ {w.explanation}</li>
                  ))}
              </ul>
            </div>
          ) : null}

          <RulesTable ruleResults={ruleResults} />

          {/* Phase 11 §53/§54 — override control, always alongside full context, never a bare toggle. */}
          <div className="rounded-md border border-border p-3">
            <button type="button" className="text-sm font-medium text-foreground underline disabled:cursor-not-allowed disabled:opacity-50" disabled={!canOverride} onClick={() => setOverrideOpen((v) => !v)}>
              {overrideOpen ? 'Cancel override' : 'Override this decision'}
            </button>
            {!canOverride ? <span className="ml-2 text-xs text-muted-foreground">Viewing only — overriding requires ADMIN or BID_MANAGER.</span> : null}
            {overrideOpen ? (
              <div className="mt-3 flex flex-col gap-2">
                <label className="text-xs font-medium text-foreground">
                  New decision
                  <select className="mt-1 block rounded-sm border border-border bg-background p-1 text-sm" value={overrideDecision} onChange={(e) => setOverrideDecision(e.target.value as 'BID' | 'NO_BID' | 'REVIEW')}>
                    <option value="BID">BID</option>
                    <option value="NO_BID">NO_BID</option>
                    <option value="REVIEW">REVIEW</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-foreground">
                  Reason (required)
                  <textarea className="mt-1 block w-full rounded-sm border border-border bg-background p-2 text-sm" rows={2} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
                </label>
                <Button
                  size="sm"
                  disabled={override.isPending || overrideReason.trim().length === 0}
                  onClick={() => {
                    override.mutate(
                      { decision: overrideDecision, reason: overrideReason },
                      {
                        onSuccess: () => {
                          setOverrideOpen(false)
                          setOverrideReason('')
                        },
                      },
                    )
                  }}
                >
                  {override.isPending ? 'Saving…' : 'Confirm override'}
                </Button>
                {override.isError ? <p className="text-xs text-destructive">{override.error instanceof Error ? override.error.message : 'Could not save the override.'}</p> : null}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}

function RulesTable({ ruleResults }: { ruleResults: BidDecisionRuleResultDto[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="p-2">Rule</th>
            <th className="p-2">Status</th>
            <th className="p-2">Severity</th>
            <th className="p-2">Explanation</th>
          </tr>
        </thead>
        <tbody>
          {ruleResults.map((r) => (
            <tr key={r.ruleId} className="border-t border-border align-top">
              <td className="p-2 text-foreground">{r.ruleId.replace(/-/g, ' ')}</td>
              <td className="p-2">
                <BidRuleStatusBadge status={r.status} />
              </td>
              <td className="p-2">
                <BidRuleSeverityBadge severity={r.severity} />
              </td>
              <td className="p-2 text-xs text-muted-foreground">{r.explanation}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
