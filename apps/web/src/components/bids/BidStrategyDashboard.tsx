import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge } from '../ui/badge.js'
import { Button } from '../ui/button.js'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js'
import { Tabs, TabPanel } from '../ui/tabs.js'
import { LoadingState } from '../states/LoadingState.js'
import { ErrorState } from '../states/ErrorState.js'
import { EmptyState } from '../states/EmptyState.js'
import { useCurrentUser } from '../../hooks/useCurrentUser.js'
import { BID_STRATEGY_MANAGE_ROLES, BID_STRATEGY_APPROVE_ROLES, EVIDENCE_MATCH_GENERATE_ROLES, EVIDENCE_MATCH_DECIDE_ROLES, PROPOSAL_EDIT_ROLES, PROPOSAL_REVIEW_ROLES, AUDIT_TRAIL_VIEW_ROLES, ROUTES } from '@tender-os/constants'
import {
  useBidProjects,
  useBidProject,
  useBidStrategyDetail,
  useBidEvaluation,
  useBidRequirements,
  useBidEvidenceNeeds,
  useBidTasks,
  useBidMilestones,
  useBidQuestions,
  useBidRisks,
  useBidReadiness,
  useGenerateStrategy,
  useApproveStrategy,
  useCreateBidQuestion,
} from '../../hooks/useBidStrategy.js'
import { useEvidenceMatches, useEvidenceClaims, useEvidenceGaps, useGenerateEvidenceMatches, useApproveEvidenceMatch, useRejectEvidenceMatch, type BidEvidenceMatchRow } from '../../hooks/useEvidenceMatching.js'
import { useProposal, useCreateProposal, useProposalSection, useGenerateProposalSection, useReviewProposalSection, useProposalCompliance, useRunProposalCompliance, type BidProposalSectionRow } from '../../hooks/useProposal.js'
import { useSubmissionReadiness, useRunSubmissionReadinessCheck, usePricing, useAddPricingItem, useSubmissionPack, useBuildSubmissionPack, useSubmissionManifest, useApproveForSubmission } from '../../hooks/useSubmissionReadiness.js'
import { SUBMISSION_MANAGE_ROLES, SUBMISSION_PRICING_ROLES, SUBMISSION_APPROVE_ROLES } from '@tender-os/constants'
import { useSubmissionExecution, usePrepareSubmission, useConfirmSubmission, useAttemptSubmission, useManualCompleteSubmission, useCaptureSubmissionReceipt, useCancelSubmission } from '../../hooks/useSubmissionExecution.js'
import { SUBMISSION_EXECUTION_MANAGE_ROLES, SUBMISSION_EXECUTION_CONFIRM_ROLES } from '@tender-os/constants'
import { useBidOutcome } from '../../hooks/useOutcomes.js'
import { useBidAddenda, useAcknowledgeAddendum } from '../../hooks/useAddenda.js'
import { ADDENDUM_ACK_ROLES } from '@tender-os/constants'

/**
 * Phase 12 §30/§31/§33 — the standalone Bid Strategy dashboard.
 * DECISION → STRATEGY → EVIDENCE → EXECUTION → READINESS is the
 * mental model driving the layout, not a flat task list. Reuses the
 * existing badge/tab/card visual language from Phases 4/7/8/9/10/11
 * rather than inventing a new one. Deliberately separate from the
 * Tender Radar (apps/web/src/components/tenders/TenderRadar.tsx).
 */

function severityVariant(sev: string): 'default' | 'success' | 'warning' | 'destructive' {
  if (sev === 'CRITICAL') return 'destructive'
  if (sev === 'HIGH') return 'warning'
  if (sev === 'LOW') return 'default'
  return 'default'
}

function statusVariant(status: string): 'default' | 'success' | 'warning' | 'destructive' {
  if (['READY', 'APPROVED', 'DONE', 'SATISFIED', 'PASS', 'COMPLETED', 'READY_TO_SUBMIT', 'APPROVED_FOR_SUBMISSION', 'VERIFIED', 'PRESENT', 'VALID', 'MATCHES_CONVENTION', 'SUBMITTED'].includes(status)) return 'success'
  if (['BLOCKED', 'MISSED', 'CANCELLED', 'MISSING', 'EXPIRED', 'INVALID', 'REJECTED', 'DOES_NOT_MATCH_CONVENTION', 'CLOSED', 'FAILED'].includes(status)) return 'destructive'
  if (['REVIEW', 'AT_RISK', 'IN_REVIEW', 'IN_PROGRESS', 'REQUIRES_REVIEW', 'CLOSING_SOON', 'UNKNOWN', 'REQUIRES_MANUAL_ACTION', 'SUBMISSION_REPORTED', 'AWAITING_HUMAN_CONFIRMATION', 'SUBMITTING'].includes(status)) return 'warning'
  return 'default'
}

export function BidsList() {
  const bids = useBidProjects()

  if (bids.status === 'loading') return <LoadingState rows={5} />
  if (bids.status === 'error') return <ErrorState message={bids.error} />
  if (bids.status !== 'success') return null

  const rows = bids.data.rows as Array<Record<string, unknown>>

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Bid Projects</h1>
        <p className="text-sm text-muted-foreground">Every tender your agency is actively pursuing — decision, strategy, evidence, execution, and readiness in one place.</p>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No bid projects yet" description="A Bid Project is created from a tender's Bid Decision tab once the final decision is BID (or an authorized REVIEW)." />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3">Project</th>
                <th className="p-3">Status</th>
                <th className="p-3">Priority</th>
                <th className="p-3">Bid Effort</th>
                <th className="p-3">Target Submission</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id as string} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="p-3">
                    <Link to={`/bids/${row.id as string}`} className="font-medium text-foreground underline-offset-2 hover:underline">
                      {row.project_name as string}
                    </Link>
                  </td>
                  <td className="p-3">
                    <Badge variant={statusVariant(row.status as string)}>{(row.status as string).replace(/_/g, ' ')}</Badge>
                  </td>
                  <td className="p-3">{row.priority as string}</td>
                  <td className="p-3">{row.bid_effort as string}</td>
                  <td className="p-3">{(row.target_submission_date as string) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ReadinessCard({ id }: { id: string }) {
  const readiness = useBidReadiness(id, true)
  if (readiness.status === 'loading') return <LoadingState rows={2} />
  if (readiness.status === 'error') return <ErrorState message={readiness.error} />
  if (readiness.status !== 'success' || !readiness.data) return null
  const r = readiness.data as { status: string; blockers: Array<{ message: string }>; warnings: Array<{ message: string }>; completeness: Record<string, number> }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Readiness <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p className="text-xs text-muted-foreground">Blockers always override completeness — a high completeness figure never hides an outstanding mandatory item.</p>
        {r.blockers.length > 0 && (
          <div>
            <p className="font-medium text-destructive">Blockers</p>
            <ul className="list-inside list-disc text-xs">
              {r.blockers.map((b, i) => (
                <li key={i}>{b.message}</li>
              ))}
            </ul>
          </div>
        )}
        {r.warnings.length > 0 && (
          <div>
            <p className="font-medium text-warning">Warnings</p>
            <ul className="list-inside list-disc text-xs">
              {r.warnings.map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 text-xs">
          {Object.entries(r.completeness).map(([k, v]) => (
            <div key={k} className="flex justify-between rounded border border-border p-1">
              <span>{k}</span>
              <span>{Math.round(v * 100)}%</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function StrategyTab({ id }: { id: string }) {
  const strategy = useBidStrategyDetail(id)
  const currentUser = useCurrentUser()
  const generate = useGenerateStrategy(id)
  const approve = useApproveStrategy(id)
  const canManage = currentUser.status === 'success' && (BID_STRATEGY_MANAGE_ROLES as readonly string[]).includes(currentUser.data.role)
  const canApprove = currentUser.status === 'success' && (BID_STRATEGY_APPROVE_ROLES as readonly string[]).includes(currentUser.data.role)

  if (strategy.status === 'loading') return <LoadingState rows={4} />
  if (strategy.status === 'error') return <ErrorState message={strategy.error} />
  if (strategy.status !== 'success') return null

  const current = strategy.data.current as { strategy: Record<string, unknown>; priorities: Array<Record<string, unknown>>; winThemes: Array<Record<string, unknown>>; differentiators: Array<Record<string, unknown>> } | null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-md border border-border p-3">
        <div>
          <p className="text-sm font-medium">Bid strategy</p>
          <p className="text-xs text-muted-foreground">Deterministically generated from the tender's requirements, evaluation criteria, qualification result, and bid decision — never an LLM output.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={!canManage || generate.isPending} onClick={() => generate.mutate()}>
            {generate.isPending ? 'Generating…' : current ? 'Regenerate strategy' : 'Generate strategy'}
          </Button>
          {current && current.strategy.status !== 'APPROVED' && (
            <Button size="sm" disabled={!canApprove || approve.isPending} onClick={() => approve.mutate({})}>
              {approve.isPending ? 'Approving…' : 'Approve strategy'}
            </Button>
          )}
        </div>
      </div>

      {!current ? (
        <EmptyState title="No strategy generated yet" description="Generate a strategy to see win themes, evaluation strategy, evidence needs, requirement plans, risks and assumptions." />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Strategy v{current.strategy.version as number} <Badge variant={statusVariant(current.strategy.status as string)}>{current.strategy.status as string}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              <p className="font-medium">Strategic objective</p>
              <p className="text-muted-foreground">{current.strategy.objective as string}</p>
              <p className="mt-2 text-xs text-muted-foreground">{current.strategy.strategy_summary as string}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Client & Tender Priorities</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1 text-sm">
                {current.priorities
                  .filter((p) => p.priority_class === 'TENDER')
                  .sort((a, b) => (Number(a.rank ?? 0) as number) - (Number(b.rank ?? 0) as number))
                  .map((p) => (
                    <li key={p.id as string} className="flex justify-between border-b border-border py-1 last:border-0">
                      <span>{p.title as string}</span>
                      <span className="text-xs text-muted-foreground">{p.weight !== null ? `Weight ${p.weight}` : 'Weight UNKNOWN'}</span>
                    </li>
                  ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Win Themes</CardTitle>
            </CardHeader>
            <CardContent>
              {current.winThemes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No win themes yet — none could be traced to verified evidence. Never invented because they "sound good".</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {current.winThemes.map((w) => (
                    <li key={w.id as string} className="rounded border border-border p-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{w.title as string}</span>
                        <Badge variant={statusVariant(w.evidence_status as string)}>{w.evidence_status as string}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{w.description as string}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Differentiators</CardTitle>
            </CardHeader>
            <CardContent>
              {current.differentiators.length === 0 ? (
                <p className="text-sm text-muted-foreground">None recorded yet — differentiators are always human-authored and evidence-backed, never auto-generated.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {current.differentiators.map((d) => (
                    <li key={d.id as string} className="flex items-center justify-between rounded border border-border p-2">
                      <span>{d.title as string}</span>
                      <Badge variant={statusVariant(d.evidence_status as string)}>{d.evidence_status as string}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function EvaluationTab({ id }: { id: string }) {
  const evaluation = useBidEvaluation(id, true)
  if (evaluation.status === 'loading') return <LoadingState rows={3} />
  if (evaluation.status === 'error') return <ErrorState message={evaluation.error} />
  if (evaluation.status !== 'success') return null
  const rows = evaluation.data.rows as Array<Record<string, unknown>>
  if (rows.length === 0) return <EmptyState title="No evaluation strategy yet" description="Generate a strategy first." />
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.id as string} className="rounded border border-border p-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium">Criterion {r.evaluation_criterion_id as string}</span>
            <div className="flex gap-1">
              <Badge>{r.priority as string}</Badge>
              <Badge variant={statusVariant(r.evidence_status as string)}>{r.evidence_status as string}</Badge>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{(r.strategy as string) ?? 'No response strategy defined yet.'}</p>
        </li>
      ))}
    </ul>
  )
}

function RequirementsTab({ id }: { id: string }) {
  const requirements = useBidRequirements(id, true)
  if (requirements.status === 'loading') return <LoadingState rows={3} />
  if (requirements.status === 'error') return <ErrorState message={requirements.error} />
  if (requirements.status !== 'success') return null
  const rows = requirements.data.rows as Array<Record<string, unknown>>
  if (rows.length === 0) return <EmptyState title="No requirement plans yet" description="Generate a strategy first." />
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.id as string} className="flex items-center justify-between rounded border border-border p-2 text-sm">
          <span>Requirement {r.tender_requirement_id as string}</span>
          <div className="flex gap-1">
            <Badge>{r.response_type as string}</Badge>
            <Badge variant={statusVariant(r.response_status as string)}>{r.response_status as string}</Badge>
          </div>
        </li>
      ))}
    </ul>
  )
}

function EvidenceNeedsTab({ id }: { id: string }) {
  const needs = useBidEvidenceNeeds(id, true)
  if (needs.status === 'loading') return <LoadingState rows={3} />
  if (needs.status === 'error') return <ErrorState message={needs.error} />
  if (needs.status !== 'success') return null
  const rows = needs.data.rows as Array<Record<string, unknown>>
  if (rows.length === 0) return <EmptyState title="No evidence gaps identified" />
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((n) => (
        <li key={n.id as string} className="rounded border border-border p-2 text-sm">
          <div className="flex items-center justify-between">
            <Badge variant={severityVariant(n.severity as string)}>{n.severity as string}</Badge>
            <Badge variant={statusVariant(n.status as string)}>{n.status as string}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{n.description as string}</p>
        </li>
      ))}
    </ul>
  )
}

function TasksTab({ id }: { id: string }) {
  const tasks = useBidTasks(id, true)
  if (tasks.status === 'loading') return <LoadingState rows={3} />
  if (tasks.status === 'error') return <ErrorState message={tasks.error} />
  if (tasks.status !== 'success') return null
  const rows = tasks.data.rows as Array<Record<string, unknown>>
  if (rows.length === 0) return <EmptyState title="No tasks yet" description="Tasks are created manually per workstream — never auto-generated by the strategy engine." />
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((t) => (
        <li key={t.id as string} className="flex items-center justify-between rounded border border-border p-2 text-sm">
          <span>{t.title as string}</span>
          <Badge variant={statusVariant(t.status as string)}>{t.status as string}</Badge>
        </li>
      ))}
    </ul>
  )
}

function MilestonesTab({ id }: { id: string }) {
  const milestones = useBidMilestones(id, true)
  if (milestones.status === 'loading') return <LoadingState rows={3} />
  if (milestones.status === 'error') return <ErrorState message={milestones.error} />
  if (milestones.status !== 'success') return null
  const rows = milestones.data.rows as Array<Record<string, unknown>>
  if (rows.length === 0) return <EmptyState title="No milestones yet" />
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((m) => (
        <li key={m.id as string} className="flex items-center justify-between rounded border border-border p-2 text-sm">
          <span>{m.name as string}</span>
          <Badge variant={statusVariant(m.computed_status as string)}>{m.computed_status as string}</Badge>
        </li>
      ))}
    </ul>
  )
}

function QuestionsTab({ id }: { id: string }) {
  const questions = useBidQuestions(id, true)
  const createQuestion = useCreateBidQuestion(id)
  const [text, setText] = useState('')
  if (questions.status === 'loading') return <LoadingState rows={3} />
  if (questions.status === 'error') return <ErrorState message={questions.error} />
  if (questions.status !== 'success') return null
  const rows = questions.data.rows as Array<Record<string, unknown>>
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm" placeholder="Draft a clarification question…" value={text} onChange={(e) => setText(e.target.value)} />
        <Button
          size="sm"
          disabled={!text.trim() || createQuestion.isPending}
          onClick={() => {
            createQuestion.mutate({ question: text })
            setText('')
          }}
        >
          Add question
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">The system never invents a question or an answer — a human always supplies the text.</p>
      {rows.length === 0 ? (
        <EmptyState title="No clarification questions yet" />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((q) => (
            <li key={q.id as string} className="rounded border border-border p-2 text-sm">
              <div className="flex items-center justify-between">
                <span>{q.question as string}</span>
                <Badge variant={statusVariant(q.status as string)}>{q.status as string}</Badge>
              </div>
              {q.answer ? <p className="mt-1 text-xs text-muted-foreground">Answer: {q.answer as string} (source: {q.answer_source as string})</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RisksTab({ id }: { id: string }) {
  const risks = useBidRisks(id, true)
  if (risks.status === 'loading') return <LoadingState rows={3} />
  if (risks.status === 'error') return <ErrorState message={risks.error} />
  if (risks.status !== 'success') return null
  const rows = risks.data.rows as Array<Record<string, unknown>>
  if (rows.length === 0) return <EmptyState title="No risks identified" />
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.id as string} className="rounded border border-border p-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium">{r.title as string}</span>
            <Badge variant={severityVariant(r.severity as string)}>{r.severity as string}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">{r.description as string}</p>
        </li>
      ))}
    </ul>
  )
}

/**
 * Phase 13 §H — Evidence Needs → Candidate Matches → Approved Evidence
 * → Evidence Gaps, inside the existing bid project detail view. NAMING
 * NOTE (checked first, same discipline Phase 10 documented for its own
 * "Opportunity Score" → "Scoring Engine" rename): the pre-existing
 * 'evidence' tab is already labelled "Evidence Needs" (Phase 12) — this
 * new tab is labelled "Evidence Matches" (a distinct, non-colliding
 * name) rather than reusing or renaming that tab, since the two show
 * genuinely different things (a need's own record vs. its candidate
 * matches/claims/gaps).
 */
function verificationVariant(passed: boolean | null): 'default' | 'success' | 'warning' | 'destructive' {
  if (passed === null) return 'default'
  return passed ? 'success' : 'destructive'
}

function EvidenceMatchCard({ id, match }: { id: string; match: BidEvidenceMatchRow }) {
  const currentUser = useCurrentUser()
  const approve = useApproveEvidenceMatch(id)
  const reject = useRejectEvidenceMatch(id)
  const [showReject, setShowReject] = useState(false)
  const [reason, setReason] = useState('')
  const [showInspector, setShowInspector] = useState(false)
  const canDecide = currentUser.status === 'success' && (EVIDENCE_MATCH_DECIDE_ROLES as readonly string[]).includes(currentUser.data.role)
  const decided = match.status === 'APPROVED' || match.status === 'REJECTED'

  return (
    <li className="rounded border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant(match.status)}>{match.status.replace(/_/g, ' ')}</Badge>
          <span className="text-xs text-muted-foreground">{match.candidate_entity_type.replace(/_/g, ' ')}</span>
          {match.is_stale ? <Badge variant="warning">STALE</Badge> : null}
        </div>
        <span className="text-xs">Semantic score: {match.semantic_score !== null ? `${Math.round(match.semantic_score * 100)}%` : '—'}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{match.rationale ?? 'No rationale recorded.'}</p>
      <div className="mt-1 flex items-center gap-2 text-xs">
        <span>Deterministic verification:</span>
        <Badge variant={verificationVariant(match.verification_passed)}>{match.verification_passed === null ? 'UNKNOWN' : match.verification_passed ? 'STRUCTURALLY FIT' : 'FAILED'}</Badge>
      </div>
      <button type="button" className="mt-1 text-xs underline" onClick={() => setShowInspector((v) => !v)}>
        {showInspector ? 'Hide evidence detail' : 'Inspect underlying evidence'}
      </button>
      {showInspector ? (
        <ul className="mt-2 flex flex-col gap-1 rounded bg-muted p-2 text-xs">
          {(match.verification_result.checks ?? []).map((c) => (
            <li key={c.code} className={c.passed ? 'text-foreground' : 'text-destructive'}>
              [{c.passed ? 'OK' : 'FAIL'}] {c.code}: {c.message}
            </li>
          ))}
        </ul>
      ) : null}
      {match.status === 'REJECTED' && match.rejection_reason ? <p className="mt-1 text-xs text-destructive">Rejection reason: {match.rejection_reason}</p> : null}
      {!decided && canDecide ? (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex gap-2">
            <Button size="sm" onClick={() => approve.mutate(match.id)} disabled={approve.isPending}>
              Approve
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowReject((v) => !v)}>
              Reject
            </Button>
          </div>
          {showReject ? (
            <div className="flex gap-2">
              <input className="flex-1 rounded border border-border px-2 py-1 text-xs" placeholder="Rejection reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button
                size="sm"
                variant="destructive"
                disabled={reason.trim().length === 0 || reject.isPending}
                onClick={() => {
                  reject.mutate({ matchId: match.id, reason })
                  setShowReject(false)
                  setReason('')
                }}
              >
                Confirm reject
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

function EvidenceMatchesTab({ id }: { id: string }) {
  const currentUser = useCurrentUser()
  const matches = useEvidenceMatches(id, true)
  const claims = useEvidenceClaims(id, true)
  const gaps = useEvidenceGaps(id, true)
  const generate = useGenerateEvidenceMatches(id)
  const [filter, setFilter] = useState('')
  const canGenerate = currentUser.status === 'success' && (EVIDENCE_MATCH_GENERATE_ROLES as readonly string[]).includes(currentUser.data.role)

  if (matches.status === 'loading') return <LoadingState rows={3} />
  if (matches.status === 'error') return <ErrorState message={matches.error} />
  if (matches.status !== 'success') return null

  const rows = matches.data.rows.filter((m) => m.is_current)
  const filtered = filter ? rows.filter((m) => m.candidate_entity_type.toLowerCase().includes(filter.toLowerCase()) || m.status.toLowerCase().includes(filter.toLowerCase())) : rows

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Candidate Matches</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Semantic similarity and deterministic verification are advisory only — a candidate never reaches APPROVED/REJECTED without a human decision (
            {EVIDENCE_MATCH_DECIDE_ROLES.join('/')} roles).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {canGenerate ? (
              <Button size="sm" onClick={() => generate.mutate(undefined)} disabled={generate.isPending}>
                {generate.isPending ? 'Generating…' : 'Generate candidate matches'}
              </Button>
            ) : null}
            <input className="rounded border border-border px-2 py-1 text-xs" placeholder="Filter by type or status…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          {generate.isError ? <ErrorState message={(generate.error as Error).message} /> : null}
          {filtered.length === 0 ? <EmptyState title="No candidate matches yet" description="Generate candidates for this project's open evidence needs, or refine the filter." /> : <ul className="flex flex-col gap-2">{filtered.map((m) => <EvidenceMatchCard key={m.id} id={id} match={m} />)}</ul>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Approved Evidence</CardTitle>
        </CardHeader>
        <CardContent>
          {claims.status === 'success' && claims.data.rows.length === 0 ? (
            <EmptyState title="No evidence approved yet" />
          ) : claims.status === 'success' ? (
            <ul className="flex flex-col gap-2 text-sm">
              {(claims.data.rows as Array<Record<string, unknown>>).map((c) => (
                <li key={c.id as string} className="rounded border border-border p-2">
                  {(c.candidate_entity_type as string).replace(/_/g, ' ')} — approved {new Date(c.approved_at as string).toLocaleDateString()}
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Evidence Gaps</CardTitle>
        </CardHeader>
        <CardContent>
          {gaps.status === 'success' && gaps.data.rows.filter((g) => g.isGap).length === 0 ? (
            <EmptyState title="No open evidence gaps" description="Every evidence need either has an approved claim, or is waived/blocked by a human decision." />
          ) : gaps.status === 'success' ? (
            <ul className="flex flex-col gap-2 text-sm">
              {gaps.data.rows
                .filter((g) => g.isGap)
                .map((g) => (
                  <li key={g.evidenceNeedId} className="flex items-center justify-between rounded border border-border p-2">
                    <span>{g.reason}</span>
                    <Badge variant={severityVariant(g.severity)}>{g.severity}</Badge>
                  </li>
                ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Phase 14 UI — Proposal workspace (spec §29/§30). Left/main/right
 * inspector layout: outline (section list) + current section
 * inspector (requirements/evaluation/claims/warnings/generation
 * history). Extends the existing Bid Project interface rather than
 * duplicating any Phase 12/13 tab.
 */
function ProposalSectionInspector({ bidProjectId, sectionId }: { bidProjectId: string; sectionId: string }) {
  const currentUser = useCurrentUser()
  const detail = useProposalSection(bidProjectId, sectionId)
  const generate = useGenerateProposalSection(bidProjectId, sectionId)
  const review = useReviewProposalSection(bidProjectId, sectionId)
  const [instructions, setInstructions] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const canEdit = currentUser.status === 'success' && (PROPOSAL_EDIT_ROLES as readonly string[]).includes(currentUser.data.role)
  const canReview = currentUser.status === 'success' && (PROPOSAL_REVIEW_ROLES as readonly string[]).includes(currentUser.data.role)

  if (detail.status === 'loading') return <LoadingState rows={3} />
  if (detail.status === 'error') return <ErrorState message={detail.error} />
  if (detail.status !== 'success') return null

  const { section, blocks, claims, requirementLinks, evaluationLinks, generations } = detail.data

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{section.status as string}</Badge>
        <Badge>{section.origin as string}</Badge>
        {canEdit ? (
          <>
            <input className="rounded border border-border px-2 py-1 text-xs" placeholder="Optional instructions for the AI…" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
            <Button size="sm" onClick={() => generate.mutate(instructions || undefined)} disabled={generate.isPending}>
              {blocks.length > 0 ? (generate.isPending ? 'Regenerating…' : 'Regenerate') : generate.isPending ? 'Generating…' : 'Generate'}
            </Button>
          </>
        ) : null}
        {canReview ? (
          <>
            <Button size="sm" variant="outline" onClick={() => review.mutate({ action: 'review' })} disabled={review.isPending}>
              Mark reviewed
            </Button>
            <Button size="sm" onClick={() => review.mutate({ action: 'approve' })} disabled={review.isPending}>
              Approve
            </Button>
            <input className="rounded border border-border px-2 py-1 text-xs" placeholder="Rejection reason…" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            <Button size="sm" variant="destructive" onClick={() => rejectReason && review.mutate({ action: 'reject', reason: rejectReason })} disabled={review.isPending || !rejectReason}>
              Reject
            </Button>
          </>
        ) : null}
      </div>
      {generate.isError ? <ErrorState message={(generate.error as Error).message} /> : null}
      {review.isError ? <ErrorState message={(review.error as Error).message} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Content</CardTitle>
        </CardHeader>
        <CardContent>
          {blocks.length === 0 ? (
            <EmptyState title="No content generated yet" description="Use Generate to draft this section from approved evidence and tender requirements." />
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {blocks.map((b) => (
                <li key={b.id as string} className="rounded border border-border p-2">
                  <span className="text-xs text-muted-foreground">{b.block_type as string}</span>
                  <div>{JSON.stringify(b.content)}</div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Claims &amp; Traceability</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div>
            <strong>Claims:</strong>{' '}
            {claims.length === 0 ? 'None' : claims.map((c) => `${c.claim_text} (${c.support_status})`).join('; ')}
          </div>
          <div>
            <strong>Requirements covered:</strong> {requirementLinks.filter((r) => r.coverage_status !== 'NOT_COVERED').length}/{requirementLinks.length}
          </div>
          <div>
            <strong>Evaluation criteria covered:</strong> {evaluationLinks.filter((r) => r.coverage_status !== 'NOT_COVERED').length}/{evaluationLinks.length}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Generation History</CardTitle>
        </CardHeader>
        <CardContent>
          {generations.length === 0 ? (
            <EmptyState title="Never generated" />
          ) : (
            <ul className="flex flex-col gap-1 text-xs">
              {generations.map((g) => (
                <li key={g.id as string}>
                  v{g.generation_version as number} — {g.status as string} — {g.model ? `${g.model} · ` : ''}
                  {g.prompt_version as string} — {new Date(g.created_at as string).toLocaleString()}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ProposalTab({ id }: { id: string }) {
  const currentUser = useCurrentUser()
  const proposal = useProposal(id)
  const create = useCreateProposal(id)
  const compliance = useProposalCompliance(id)
  const runCompliance = useRunProposalCompliance(id)
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
  const canEdit = currentUser.status === 'success' && (PROPOSAL_EDIT_ROLES as readonly string[]).includes(currentUser.data.role)

  if (proposal.status === 'loading') return <LoadingState rows={3} />

  if (proposal.status === 'error' || (proposal.status === 'success' && !proposal.data.proposal)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No proposal yet</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">Create a proposal to generate a section blueprint from this bid's requirements, evaluation criteria and approved evidence.</p>
          {canEdit ? (
            <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create Proposal'}
            </Button>
          ) : null}
          {create.isError ? <ErrorState message={(create.error as Error).message} /> : null}
        </CardContent>
      </Card>
    )
  }

  if (proposal.status !== 'success') return null
  const sections: BidProposalSectionRow[] = [...proposal.data.sections].sort((a, b) => a.sort_order - b.sort_order)
  const activeSectionId = selectedSectionId ?? sections[0]?.id ?? null

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">
      <div className="flex flex-col gap-2">
        <Card>
          <CardHeader>
            <CardTitle>Outline</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1">
              {sections.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-muted ${activeSectionId === s.id ? 'bg-muted font-medium' : ''}`}
                    onClick={() => setSelectedSectionId(s.id)}
                  >
                    {s.title} <Badge>{s.status}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Compliance</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {canEdit ? (
              <Button size="sm" onClick={() => runCompliance.mutate()} disabled={runCompliance.isPending}>
                {runCompliance.isPending ? 'Running…' : 'Run Compliance'}
              </Button>
            ) : null}
            {compliance.status === 'success' && compliance.data.rows.length > 0 ? (
              <Badge variant={compliance.data.rows[0]!.result === 'BLOCKED' ? 'destructive' : compliance.data.rows[0]!.result === 'REQUIRES_REVIEW' ? 'warning' : 'success'}>{compliance.data.rows[0]!.result as string}</Badge>
            ) : (
              <span className="text-xs text-muted-foreground">Not yet run</span>
            )}
          </CardContent>
        </Card>
      </div>
      <div>{activeSectionId ? <ProposalSectionInspector bidProjectId={id} sectionId={activeSectionId} /> : <EmptyState title="No sections yet" />}</div>
    </div>
  )
}

/**
 * Phase 15 UI — Submission Readiness tab (spec §42-§46). Header shows
 * overall status; Blocker Panel (§43) and Warning Panel (§44) are kept
 * visually distinct; Manifest UI (§45) and Final Approval UI (§46,
 * with the approve button withheld entirely while BLOCKED) round out
 * the flow: N checks → blockers → resolve → re-check → 0 blockers →
 * READY TO SUBMIT → build pack → inspect manifest → human final
 * review → APPROVED FOR HUMAN SUBMISSION. Never a real submission
 * (§39/§63 binding constraint) — the copy below says so explicitly.
 */
/**
 * Phase 19 §12 — addenda acknowledgement, scoped to this bid project.
 * Every addendum's materiality is derived from its confirmed
 * `*_changed` flags, never assumed (Phase 2 §9/Phase 19 §12 binding
 * constraint) — acknowledging one is an explicit human action, never
 * inferred from a document merely being viewed.
 */
function AddendaCard({ id }: { id: string }) {
  const currentUser = useCurrentUser()
  const addenda = useBidAddenda(id)
  const acknowledge = useAcknowledgeAddendum(id)
  const canAcknowledge = currentUser.status === 'success' && (ADDENDUM_ACK_ROLES as readonly string[]).includes(currentUser.data.role)

  if (addenda.status === 'loading') return <LoadingState rows={2} />
  if (addenda.status === 'error') return <ErrorState message={addenda.error} />
  if (addenda.status !== 'success') return null
  const rows = addenda.data
  if (rows.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Addenda</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2 text-sm">
          {rows.map((a) => (
            <li key={a.id} className="rounded border border-border p-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">Addendum {a.addendum_number}</span>
                <div className="flex items-center gap-1">
                  {a.detected_via === 'DIFF_ENGINE' ? <Badge variant="warning">AUTO-DETECTED</Badge> : null}
                  {a.isMaterial ? <Badge variant="warning">MATERIAL</Badge> : <Badge>ADMINISTRATIVE</Badge>}
                  {a.acknowledgement ? <Badge variant="success">ACKNOWLEDGED</Badge> : <Badge variant="destructive">NOT ACKNOWLEDGED</Badge>}
                  {a.acknowledgement?.reconciled ? <Badge variant="success">RECONCILED</Badge> : null}
                </div>
              </div>
              {a.summary ? <p className="text-xs text-muted-foreground">{a.summary}</p> : null}
              {!a.acknowledgement && canAcknowledge ? (
                <Button size="sm" variant="outline" className="mt-2" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate({ addendumId: a.id, reconciled: false })}>
                  {acknowledge.isPending ? 'Acknowledging…' : 'Acknowledge'}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function SubmissionReadinessTab({ id }: { id: string }) {
  const currentUser = useCurrentUser()
  const readiness = useSubmissionReadiness(id)
  const runCheck = useRunSubmissionReadinessCheck(id)
  const pricing = usePricing(id)
  const addPricingItem = useAddPricingItem(id)
  const pack = useSubmissionPack(id)
  const buildPack = useBuildSubmissionPack(id)
  const manifest = useSubmissionManifest(id)
  const approve = useApproveForSubmission(id)
  const [approvalReason, setApprovalReason] = useState('')
  const [newItem, setNewItem] = useState({ description: '', quantity: '1', unitPrice: '0' })

  const canManage = currentUser.status === 'success' && (SUBMISSION_MANAGE_ROLES as readonly string[]).includes(currentUser.data.role)
  const canPrice = currentUser.status === 'success' && (SUBMISSION_PRICING_ROLES as readonly string[]).includes(currentUser.data.role)
  const canApprove = currentUser.status === 'success' && (SUBMISSION_APPROVE_ROLES as readonly string[]).includes(currentUser.data.role)

  if (readiness.status === 'loading') return <LoadingState rows={4} />
  if (readiness.status === 'error') return <ErrorState message={readiness.error} />
  if (readiness.status !== 'success') return null

  const r = readiness.data.readiness
  const items = readiness.data.items
  const blockers = items.filter((i) => i.severity === 'BLOCKER')
  const warnings = items.filter((i) => i.severity === 'WARNING')
  const info = items.filter((i) => i.severity === 'INFO')
  const isBlocked = !r || r.status === 'BLOCKED'
  const isReady = r?.status === 'READY_TO_SUBMIT'
  const isApproved = r?.status === 'APPROVED_FOR_SUBMISSION'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-md border border-border p-3">
        <div>
          <p className="text-sm font-medium">Final submission readiness</p>
          <p className="text-xs text-muted-foreground">
            Deterministic engine only — never an AI decision. This system prepares and validates the package; it never submits to eTenders, any portal, or by email (Phase 15 binding constraint).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant(r?.status ?? 'DRAFT')}>{(r?.status ?? 'NOT YET CHECKED').replace(/_/g, ' ')}</Badge>
          {canManage ? (
            <Button size="sm" variant="outline" disabled={runCheck.isPending} onClick={() => runCheck.mutate()}>
              {runCheck.isPending ? 'Checking…' : r ? 'Re-run check' : 'Run readiness check'}
            </Button>
          ) : null}
        </div>
      </div>
      {runCheck.isError ? <ErrorState message={(runCheck.error as Error).message} /> : null}

      {r ? (
        <Card>
          <CardHeader>
            <CardTitle>Category summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
              {Object.entries(r.categorySummary ?? {}).map(([category, summary]) => (
                <div key={category} className="rounded border border-border p-2">
                  <div className="font-medium">{category.replace(/_/g, ' ')}</div>
                  <div className="text-muted-foreground">
                    {summary.blockers} blocker{summary.blockers === 1 ? '' : 's'} · {summary.warnings} warning{summary.warnings === 1 ? '' : 's'}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <EmptyState title="No readiness check has been run yet" description="Run a readiness check to reconcile every mandatory requirement, evaluation criterion, evidence item, pricing line, document, form, certificate, signature, file, submission method and deadline." />
      )}

      <AddendaCard id={id} />

      {/* Blocker Panel (§43) — prominent, distinct from warnings. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">Blockers ({blockers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {blockers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No blockers.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {blockers.map((b) => (
                <li key={b.id} className="rounded border border-destructive/40 bg-destructive/5 p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{b.category.replace(/_/g, ' ')}</span>
                    <Badge variant="destructive">{b.code}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{b.message}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Warning Panel (§44) — separate, non-alarming presentation. */}
      <Card>
        <CardHeader>
          <CardTitle>Warnings ({warnings.length}) &amp; Notices ({info.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {warnings.length === 0 && info.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing outstanding.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {[...warnings, ...info].map((w) => (
                <li key={w.id} className="rounded border border-border p-2">
                  <div className="flex items-center justify-between">
                    <span>{w.category.replace(/_/g, ' ')}</span>
                    <Badge variant={w.severity === 'WARNING' ? 'warning' : 'default'}>{w.code}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{w.message}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Pricing (§18/§19/§56 — restricted to authorised roles). */}
      {canPrice ? (
        <Card>
          <CardHeader>
            <CardTitle>Pricing</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {pricing.status === 'success' && pricing.data.pricing ? (
              <ul className="flex flex-col gap-1">
                {((pricing.data.pricing as { items: Array<Record<string, unknown>> }).items ?? []).map((item) => (
                  <li key={item.id as string} className="flex justify-between border-b border-border py-1 last:border-0">
                    <span>{item.description as string}</span>
                    <span className="text-xs text-muted-foreground">
                      {item.quantity as number} × {item.unitPrice as number} = {item.lineTotal as number}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No pricing schedule started yet.</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <input className="rounded border border-border px-2 py-1 text-xs" placeholder="Description" value={newItem.description} onChange={(e) => setNewItem({ ...newItem, description: e.target.value })} />
              <input className="w-20 rounded border border-border px-2 py-1 text-xs" placeholder="Qty" value={newItem.quantity} onChange={(e) => setNewItem({ ...newItem, quantity: e.target.value })} />
              <input className="w-28 rounded border border-border px-2 py-1 text-xs" placeholder="Unit price" value={newItem.unitPrice} onChange={(e) => setNewItem({ ...newItem, unitPrice: e.target.value })} />
              <Button
                size="sm"
                variant="outline"
                disabled={!newItem.description || addPricingItem.isPending}
                onClick={() => {
                  const quantity = Number(newItem.quantity) || 0
                  const unitPrice = Number(newItem.unitPrice) || 0
                  const existingCount = pricing.status === 'success' && pricing.data.pricing ? ((pricing.data.pricing as { items: unknown[] }).items ?? []).length : 0
                  addPricingItem.mutate({ lineNumber: existingCount + 1, description: newItem.description, quantity, unitPrice, lineTotal: Math.round(quantity * unitPrice * 100) / 100 })
                  setNewItem({ description: '', quantity: '1', unitPrice: '0' })
                }}
              >
                Add line
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Never AI-generated, estimated, or optimised — pricing is always agency-entered; totals are re-verified deterministically on every readiness check.</p>
          </CardContent>
        </Card>
      ) : null}

      {/* Submission Pack + Manifest (§32-§35, §45). */}
      <Card>
        <CardHeader>
          <CardTitle>Submission pack &amp; manifest</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {canManage ? (
            <Button size="sm" variant="outline" disabled={!r || buildPack.isPending} onClick={() => buildPack.mutate()}>
              {buildPack.isPending ? 'Building…' : 'Build submission pack'}
            </Button>
          ) : null}
          {buildPack.isError ? <ErrorState message={(buildPack.error as Error).message} /> : null}
          {pack.status === 'success' && pack.data.pack ? (
            <div className="flex flex-col gap-1">
              <p>
                Pack version {(pack.data.pack as Record<string, unknown>).version as number} — <Badge>{(pack.data.pack as Record<string, unknown>).status as string}</Badge>
              </p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1">Document</th>
                    <th>Hash</th>
                    <th>Size</th>
                  </tr>
                </thead>
                <tbody>
                  {(((pack.data.pack as Record<string, unknown>).files as Array<Record<string, unknown>>) ?? []).map((f) => (
                    <tr key={f.id as string} className="border-t border-border">
                      <td className="py-1">{f.fileName as string}</td>
                      <td className="font-mono text-[10px]">{(f.sha256 as string).slice(0, 12)}…</td>
                      <td>{(f.sizeBytes as number | null) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No submission pack built yet.</p>
          )}
          {manifest.status === 'success' && manifest.data.manifest ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Manifest JSON</summary>
              <pre className="overflow-x-auto rounded bg-muted p-2">{JSON.stringify(manifest.data.manifest, null, 2)}</pre>
            </details>
          ) : null}
        </CardContent>
      </Card>

      {/* Final Approval (§37-§39, §46) — never presented while blocked. */}
      <Card>
        <CardHeader>
          <CardTitle>Final approval</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {isApproved ? (
            <p className="font-medium text-success">APPROVED FOR HUMAN SUBMISSION — this system has not submitted anything to any external portal, email, or agency. A human must now perform the actual submission.</p>
          ) : isBlocked ? (
            <p className="text-xs text-muted-foreground">Approval is unavailable while blocking issues remain. Resolve every blocker above, then re-run the readiness check.</p>
          ) : isReady && canApprove ? (
            <>
              <p className="text-xs text-muted-foreground">READY FOR HUMAN SUBMISSION. Approving here only records an internal decision — it never submits anything externally.</p>
              <input className="rounded border border-border px-2 py-1 text-xs" placeholder="Approval reason / confirmation…" value={approvalReason} onChange={(e) => setApprovalReason(e.target.value)} />
              <Button size="sm" disabled={!approvalReason.trim() || !(pack.status === 'success' && pack.data.pack) || approve.isPending} onClick={() => approve.mutate(approvalReason)}>
                {approve.isPending ? 'Approving…' : 'Approve for submission'}
              </Button>
              {!(pack.status === 'success' && pack.data.pack) ? <p className="text-xs text-muted-foreground">Build a submission pack first.</p> : null}
            </>
          ) : isReady ? (
            <p className="text-xs text-muted-foreground">Ready to submit — only an ADMIN or BID_MANAGER may give final approval.</p>
          ) : (
            <p className="text-xs text-muted-foreground">Run a readiness check first.</p>
          )}
          {approve.isError ? <ErrorState message={(approve.error as Error).message} /> : null}
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Phase 16 UI — the Submission Execution tab (spec §30-§36). Status
 * header, deadline/method/target, pack integrity summary, human
 * confirmation flow, attempt/receipt capture, manual-action guidance,
 * and an immutable timeline. Never claims SUBMITTED without a verified
 * receipt (§5/§62 binding constraint) — the copy below always says so.
 */
function SubmissionExecutionTab({ id }: { id: string }) {
  const currentUser = useCurrentUser()
  const submission = useSubmissionExecution(id)
  const prepare = usePrepareSubmission(id)
  const confirm = useConfirmSubmission(id)
  const attempt = useAttemptSubmission(id)
  const manualComplete = useManualCompleteSubmission(id)
  const captureReceipt = useCaptureSubmissionReceipt(id)
  const cancel = useCancelSubmission(id)

  const [statement, setStatement] = useState('')
  const [confirmChecked, setConfirmChecked] = useState(false)
  const [receiptForm, setReceiptForm] = useState({ providerReference: '', notes: '' })

  const canManage = currentUser.status === 'success' && (SUBMISSION_EXECUTION_MANAGE_ROLES as readonly string[]).includes(currentUser.data.role)
  const canConfirm = currentUser.status === 'success' && (SUBMISSION_EXECUTION_CONFIRM_ROLES as readonly string[]).includes(currentUser.data.role)

  if (submission.status === 'loading') return <LoadingState rows={4} />
  if (submission.status === 'error') return <ErrorState message={submission.error} />
  if (submission.status !== 'success') return null

  const execution = submission.data.execution
  const attempts = submission.data.attempts
  const confirmations = submission.data.confirmations
  const receipts = submission.data.receipts
  const activeConfirmation = confirmations.find((c) => !c.invalidated) ?? null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-md border border-border p-3">
        <div>
          <p className="text-sm font-medium">Submission execution</p>
          <p className="text-xs text-muted-foreground">
            SUBMITTED is only ever shown once independently-captured/verified evidence supports it. A human report alone shows SUBMISSION REPORTED — VERIFICATION REQUIRED, never SUBMITTED.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant(execution?.status ?? 'NOT_READY')}>{(execution?.status ?? 'NOT READY').replace(/_/g, ' ')}</Badge>
          {canManage ? (
            <Button size="sm" variant="outline" disabled={prepare.isPending} onClick={() => prepare.mutate({})}>
              {prepare.isPending ? 'Preparing…' : execution ? 'Re-prepare' : 'Prepare submission'}
            </Button>
          ) : null}
        </div>
      </div>
      {prepare.isError ? <ErrorState message={(prepare.error as Error).message} /> : null}

      {execution ? (
        <Card>
          <CardHeader>
            <CardTitle>Method &amp; package</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            <p>
              Method: <Badge>{execution.submissionMethod}</Badge> — Automation: <Badge variant={execution.automationStatus === 'AUTOMATION_AVAILABLE' ? 'success' : 'default'}>{execution.automationStatus.replace(/_/g, ' ')}</Badge>
            </p>
            <p className="text-xs text-muted-foreground">Target: {execution.targetValue ?? 'Not yet resolved'}</p>
            <p className="text-xs text-muted-foreground">
              Pack v{execution.submissionPackVersion ?? '—'} — hash {execution.submissionPackHash ? `${execution.submissionPackHash.slice(0, 16)}…` : '—'}
            </p>
            {execution.failureCode ? <p className="text-xs text-destructive">Last outcome: {execution.failureCode} — {execution.failureMessage}</p> : null}
          </CardContent>
        </Card>
      ) : (
        <EmptyState title="No submission has been prepared yet" description="Prepare submission to resolve the submission method, target, and the exact approved package before any human confirmation can occur." />
      )}

      {/* Human Confirmation UI (§3/§8/§30) — never hides target/deadline/hash, never allowed once the package has changed. */}
      {execution && execution.status === 'AWAITING_HUMAN_CONFIRMATION' && canConfirm ? (
        <Card>
          <CardHeader>
            <CardTitle>Human confirmation required</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p className="text-xs text-muted-foreground">
              Method: {execution.submissionMethod} · Target: {execution.targetValue ?? '—'} · Pack v{execution.submissionPackVersion} · Hash {execution.submissionPackHash?.slice(0, 16)}…
            </p>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} />
              I confirm that I am authorised to submit this bid using the exact approved submission pack.
            </label>
            <textarea className="rounded border border-border px-2 py-1 text-xs" placeholder="Confirmation statement (e.g. name, role, authorisation)…" value={statement} onChange={(e) => setStatement(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setConfirmChecked(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={!confirmChecked || statement.trim().length < 20 || confirm.isPending} onClick={() => confirm.mutate(statement)}>
                {confirm.isPending ? 'Confirming…' : 'Confirm & submit'}
              </Button>
            </div>
            {confirm.isError ? <ErrorState message={(confirm.error as Error).message} /> : null}
          </CardContent>
        </Card>
      ) : null}

      {execution && activeConfirmation && (execution.status === 'AWAITING_HUMAN_CONFIRMATION' || execution.status === 'SUBMITTING') && canConfirm ? (
        <Card>
          <CardHeader>
            <CardTitle>Submission attempt</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <Button size="sm" disabled={attempt.isPending} onClick={() => attempt.mutate(false)}>
              {attempt.isPending ? 'Attempting…' : 'Attempt submission'}
            </Button>
            {attempt.isError ? <ErrorState message={(attempt.error as Error).message} /> : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Manual action guidance (§18/§30) — the second action never auto-claims a verified submission. */}
      {execution && execution.status === 'REQUIRES_MANUAL_ACTION' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Manual action required</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p className="text-xs text-muted-foreground">{execution.failureMessage ?? 'This submission method or outcome requires a manual step.'}</p>
            {canManage ? (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => execution.targetValue && window.open(execution.targetValue, '_blank', 'noopener')}>
                  Open portal
                </Button>
                <Button size="sm" disabled={manualComplete.isPending} onClick={() => manualComplete.mutate('Completed manually by user.')}>
                  {manualComplete.isPending ? 'Recording…' : "I've completed the submission"}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {execution && execution.status === 'SUBMISSION_REPORTED' ? (
        <Card>
          <CardHeader>
            <CardTitle>SUBMISSION REPORTED — VERIFICATION REQUIRED</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">A human reported this submission as complete. This is not yet verified — capture a receipt below to move to a verified SUBMITTED status.</CardContent>
        </Card>
      ) : null}

      {execution && execution.status === 'SUBMITTED' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-success">SUBMITTED</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Verified provider/receipt evidence confirms this submission reached the recipient.</CardContent>
        </Card>
      ) : null}

      {/* Receipt capture (§19/§20/§34). */}
      {execution && canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Receipts</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <ul className="flex flex-col gap-1">
              {receipts.map((r) => (
                <li key={r.id} className="flex items-center justify-between rounded border border-border p-2 text-xs">
                  <span>
                    {r.receiptType.replace(/_/g, ' ')} — {r.providerReference ?? '—'}
                  </span>
                  <Badge variant={r.verificationStatus === 'VERIFIED' ? 'success' : r.verificationStatus === 'CONFLICTING' ? 'destructive' : 'default'}>RECEIPT STATUS: {r.verificationStatus}</Badge>
                </li>
              ))}
              {receipts.length === 0 ? <p className="text-xs text-muted-foreground">No receipts captured yet.</p> : null}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <input className="rounded border border-border px-2 py-1 text-xs" placeholder="Reference number" value={receiptForm.providerReference} onChange={(e) => setReceiptForm({ ...receiptForm, providerReference: e.target.value })} />
              <input className="rounded border border-border px-2 py-1 text-xs" placeholder="Notes" value={receiptForm.notes} onChange={(e) => setReceiptForm({ ...receiptForm, notes: e.target.value })} />
              <Button
                size="sm"
                variant="outline"
                disabled={!receiptForm.providerReference || captureReceipt.isPending}
                onClick={() => {
                  captureReceipt.mutate({ receiptType: 'MANUAL_ATTESTATION', providerReference: receiptForm.providerReference, notes: receiptForm.notes || null, providerIssued: false })
                  setReceiptForm({ providerReference: '', notes: '' })
                }}
              >
                Save receipt
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Immutable submission timeline (§21/§36). */}
      <Card>
        <CardHeader>
          <CardTitle>Submission timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-1 text-xs">
            {confirmations.map((c) => (
              <li key={c.id} className="border-b border-border py-1">
                {c.confirmedAt} — Confirmed by {c.confirmedBy} (pack v{c.packVersion}){c.invalidated ? ' — INVALIDATED' : ''}
              </li>
            ))}
            {attempts.map((a) => (
              <li key={a.id} className="border-b border-border py-1">
                {a.startedAt} — Attempt #{a.attemptNumber} ({a.method}) → {a.status}
                {a.errorCode ? ` — ${a.errorCode}` : ''}
              </li>
            ))}
            {receipts.map((r) => (
              <li key={`ts-${r.id}`} className="border-b border-border py-1">
                {r.capturedAt} — Receipt captured: {r.receiptType} ({r.verificationStatus})
              </li>
            ))}
            {confirmations.length === 0 && attempts.length === 0 && receipts.length === 0 ? <p className="text-muted-foreground">Nothing recorded yet.</p> : null}
          </ul>
        </CardContent>
      </Card>

      {execution && canManage && execution.status !== 'SUBMITTED' && execution.status !== 'CANCELLED' ? (
        <Button size="sm" variant="outline" onClick={() => cancel.mutate('Cancelled by user.')} disabled={cancel.isPending}>
          Cancel submission
        </Button>
      ) : null}
    </div>
  )
}

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'strategy', label: 'Strategy' },
  { value: 'evaluation', label: 'Evaluation' },
  { value: 'requirements', label: 'Requirements' },
  { value: 'evidence', label: 'Evidence Needs' },
  { value: 'evidence-matches', label: 'Evidence Matches' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'milestones', label: 'Milestones' },
  { value: 'questions', label: 'Questions' },
  { value: 'risks', label: 'Risks' },
  { value: 'readiness', label: 'Readiness' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'submission-readiness', label: 'Submission Readiness' },
  { value: 'submission-execution', label: 'Submission Execution' },
  // Phase 17 §53 — our own reconciled bid result: distinct from the
  // tender-level "Outcome" tab on TenderDetail (which shows the
  // public FACT layer only).
  { value: 'outcome', label: 'Outcome' },
]

export function BidProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const [tab, setTab] = useState('overview')
  const project = useBidProject(id)
  const currentUser = useCurrentUser()
  const canViewAuditTrail = currentUser.status === 'success' && (AUDIT_TRAIL_VIEW_ROLES as readonly string[]).includes(currentUser.data.role)

  if (project.status === 'loading') return <LoadingState rows={6} />
  if (project.status === 'error') return <ErrorState message={project.error} />
  if (project.status !== 'success' || !project.data) return null

  const p = project.data as Record<string, unknown>

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{p.project_name as string}</h1>
          <p className="text-xs text-muted-foreground">
            Decision → Strategy → Evidence → Execution → Readiness. Owner: {(p.owner_user_id as string) ?? 'Unassigned'} · Bid effort: {p.bid_effort as string}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canViewAuditTrail && id ? (
            <Link to={`${ROUTES.settingsAuditLogs}?correlationId=${id}`} className="text-xs text-primary underline">
              View audit trail
            </Link>
          ) : null}
          <Badge variant={statusVariant(p.status as string)}>{(p.status as string).replace(/_/g, ' ')}</Badge>
        </div>
      </div>

      <Tabs items={TABS} value={tab} onChange={setTab}>
        <TabPanel value="overview" activeValue={tab}>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Overview</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm">
                <p>Priority: {p.priority as string}</p>
                <p>Target submission date: {(p.target_submission_date as string) ?? '—'} (planning only — the tender's own closing date remains authoritative)</p>
                <p>Opportunity score snapshot: {(p.overall_score_snapshot as number | null) ?? 'Not captured'}</p>
                <p>Strategy version: {p.current_strategy_version as number}</p>
              </CardContent>
            </Card>
            {id ? <ReadinessCard id={id} /> : null}
          </div>
        </TabPanel>
        <TabPanel value="strategy" activeValue={tab}>{id ? <StrategyTab id={id} /> : null}</TabPanel>
        <TabPanel value="evaluation" activeValue={tab}>{id ? <EvaluationTab id={id} /> : null}</TabPanel>
        <TabPanel value="requirements" activeValue={tab}>{id ? <RequirementsTab id={id} /> : null}</TabPanel>
        <TabPanel value="evidence" activeValue={tab}>{id ? <EvidenceNeedsTab id={id} /> : null}</TabPanel>
        <TabPanel value="evidence-matches" activeValue={tab}>{id ? <EvidenceMatchesTab id={id} /> : null}</TabPanel>
        <TabPanel value="tasks" activeValue={tab}>{id ? <TasksTab id={id} /> : null}</TabPanel>
        <TabPanel value="milestones" activeValue={tab}>{id ? <MilestonesTab id={id} /> : null}</TabPanel>
        <TabPanel value="questions" activeValue={tab}>{id ? <QuestionsTab id={id} /> : null}</TabPanel>
        <TabPanel value="risks" activeValue={tab}>{id ? <RisksTab id={id} /> : null}</TabPanel>
        <TabPanel value="readiness" activeValue={tab}>{id ? <ReadinessCard id={id} /> : null}</TabPanel>
        <TabPanel value="proposal" activeValue={tab}>{id ? <ProposalTab id={id} /> : null}</TabPanel>
        <TabPanel value="submission-readiness" activeValue={tab}>{id ? <SubmissionReadinessTab id={id} /> : null}</TabPanel>
        <TabPanel value="submission-execution" activeValue={tab}>{id ? <SubmissionExecutionTab id={id} /> : null}</TabPanel>
        <TabPanel value="outcome" activeValue={tab}>{id ? <BidOutcomeTab id={id} enabled={tab === 'outcome'} /> : null}</TabPanel>
      </Tabs>
    </div>
  )
}

/**
 * Phase 17 §53 — bid-detail outcome section: our reconciled result,
 * our score vs winning score, loss reasons, and follow-up status.
 * Fetching this endpoint also (re)computes/persists the reconciled
 * bid_outcomes row server-side — see routes/outcomes.ts.
 */
function BidOutcomeTab({ id, enabled }: { id: string; enabled: boolean }) {
  const outcome = useBidOutcome(id, enabled)

  if (!enabled) return null
  if (outcome.status === 'loading') return <LoadingState rows={4} />
  if (outcome.status === 'error') return <ErrorState message={outcome.error} />
  if (outcome.status !== 'success') return null

  const { data, tenderOutcome, lossReasons, followUp, winnerMatchBasis } = outcome.data

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Our result: {data.ourResult}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Our score: {data.ourScore ?? 'UNKNOWN'} · Winning score: {data.winningScore ?? 'UNKNOWN'} · Winner: {tenderOutcome?.winnerName ?? 'UNKNOWN'}
            </p>
          </div>
          <Badge variant={data.ourResult === 'WON' ? 'success' : data.ourResult === 'LOST' || data.ourResult === 'DISQUALIFIED' ? 'destructive' : 'default'}>{data.ourResult}</Badge>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{data.reconciliationBasis}</p>
        {winnerMatchBasis && <p className="mt-1 text-xs text-muted-foreground">Winner match basis: {winnerMatchBasis}</p>}
      </div>

      {followUp.requiresFollowUp && (
        <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-warning">Outcome follow-up required: {followUp.reason}</div>
      )}

      {lossReasons.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recorded loss reasons</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {lossReasons.map((reason) => (
              <div key={reason.id} className="flex items-center justify-between border-b border-border pb-1 last:border-0">
                <span>
                  {reason.category} {reason.isPrimary ? '(primary)' : ''}
                </span>
                <Badge>{reason.provenance}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
