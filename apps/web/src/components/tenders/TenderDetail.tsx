import { useState } from 'react'
import type { UserRole } from '@tender-os/constants'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type {
  TenderDocumentRow,
  TenderAddendumRow,
  TenderBriefingRow,
  TenderRiskRow,
  TenderScoreRow,
  AuditLogRow,
} from '@tender-os/schemas'
import { ROUTES } from '@tender-os/constants'
import type { TenderStatus } from '@tender-os/constants'
import { PageHeader } from '../PageHeader.js'
import { Button } from '../ui/button.js'
import { Tabs, TabPanel } from '../ui/tabs.js'
import { LoadingState } from '../states/LoadingState.js'
import { ErrorState } from '../states/ErrorState.js'
import { EmptyState } from '../states/EmptyState.js'
import {
  TenderStatusBadge,
  OpportunityClassBadge,
  EvidenceTag,
  AiTruthBadge,
  AiRelevanceBadge,
  AiRunStatusBadge,
  QualificationCheckStatusBadge,
  QualificationOverallStatusBadge,
  QualificationMandatoryStatusBadge,
  RequirementStatusBadge,
  DisqualificationRiskBadge,
} from './badges.js'
import {
  useTender,
  useTenderDocuments,
  useTenderAddenda,
  useTenderBriefing,
  useTenderScore,
  useTenderRisks,
  useTenderActivity,
} from '../../hooks/useTenders.js'
import { useAddToWatchlist, useIsWatched, useRemoveFromWatchlist } from '../../hooks/useWatchlist.js'
import { useCurrentUser } from '../../hooks/useCurrentUser.js'
import {
  useTenderDocumentDetail,
  useTenderDocumentPages,
  useTenderDocumentSections,
  useDownloadDocument,
  useReprocessDocument,
} from '../../hooks/useDocumentPipeline.js'
import { useAiClassification, useAiRuns, useTriggerClassification } from '../../hooks/useAiClassification.js'
import { useQualification, useQualificationRequirements, useQualificationActions, useEvaluateQualification, useSubmitQualificationReview } from '../../hooks/useQualification.js'
import {
  useRequirements,
  useEvaluation,
  useExtractionRuns,
  useTriggerRequirementExtraction,
  useSubmitRequirementReview,
  useSubmitEvaluationCriterionReview,
} from '../../hooks/useRequirementsEvaluation.js'
import type { EvidenceRefDto } from '@tender-os/schemas'
import type { AiEvidence, AiClassification } from '@tender-os/schemas'
import { OpportunityScoreTab } from './OpportunityScoreTab.js'
import { BidDecisionTab } from './BidDecisionTab.js'
import { OutcomeTab } from './OutcomeTab.js'

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'requirements', label: 'Requirements' },
  { value: 'evaluation', label: 'Evaluation' },
  { value: 'briefing', label: 'Briefing' },
  { value: 'documents', label: 'Documents' },
  { value: 'ai', label: 'AI Classification' },
  { value: 'addenda', label: 'Addenda' },
  { value: 'qualification', label: 'Qualification' },
  { value: 'score', label: 'Opportunity Score' },
  // Phase 10's own tab. Named "Scoring Engine" — NOT "Opportunity Score"
  // — because that label is already taken by the pre-existing Phase 3
  // legacy tab immediately above (a different, BID/NO_BID-based score
  // this phase must never touch, merge with, or be confused with; see
  // docs/DECISIONS.md). The in-page heading still reads "Opportunity
  // score" per Phase 10 §39 — only the tab label is disambiguated.
  { value: 'opportunity-score', label: 'Scoring Engine' },
  // Phase 11's own tab. "Bid Decision" was free (never used by the
  // legacy bid_projects.decision field, which has no dedicated tab at
  // all) — see docs/DECISIONS.md.
  { value: 'bid-decision', label: 'Bid Decision' },
  { value: 'risk', label: 'Risk' },
  { value: 'activity', label: 'Activity' },
  // Phase 17's own tab — the tender-level FACT-layer outcome (award/
  // winner/value/date + any open conflicts). Distinct from the
  // Bid Decision tab, which is our own pre-submission recommendation.
  { value: 'outcome', label: 'Outcome' },
]

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatCurrency(value: number | null): string {
  if (value === null) return '—'
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(value)
}

export function TenderDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState('overview')

  const tender = useTender(id)
  const score = useTenderScore(id, tab === 'overview' || tab === 'score')
  const isWatched = useIsWatched(id)
  const addToWatchlist = useAddToWatchlist()
  const removeFromWatchlist = useRemoveFromWatchlist()

  if (tender.status === 'loading') {
    return <LoadingState rows={6} />
  }
  if (tender.status === 'error') {
    return <ErrorState message={tender.error} onRetry={() => navigate(0)} />
  }
  if (tender.status === 'empty') {
    return (
      <EmptyState
        title="This tender could not be found."
        action={
          <Button variant="outline" size="sm" onClick={() => navigate(ROUTES.tenders)}>
            Back to Tender Radar
          </Button>
        }
      />
    )
  }

  const data = tender.data
  const currentScore = score.status === 'success' ? score.data.score : null

  return (
    <div>
      <div className="mb-2">
        <Link to={ROUTES.tenders} className="text-sm text-muted-foreground hover:text-foreground">
          ← Tender Radar
        </Link>
      </div>

      <PageHeader
        title={data.title}
        description={`${data.tender_number ?? 'No tender number'} · ${data.organisation ?? 'Organisation unknown'}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TenderStatusBadge status={data.status as TenderStatus} />
            {currentScore ? <OpportunityClassBadge scoreClass={currentScore.score_class} /> : null}
          </div>
        }
      />

      {currentScore?.mandatory_failure ? (
        <div role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3">
          <p className="text-sm font-semibold text-destructive">Mandatory blocker — do not treat as a normal bid recommendation</p>
          <p className="mt-1 text-sm text-destructive/90">
            {currentScore.mandatory_failure_reason ?? 'A mandatory qualification requirement was not met.'}
          </p>
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap gap-2">
        <Button
          variant={isWatched ? 'outline' : 'default'}
          size="sm"
          onClick={() =>
            isWatched && id ? removeFromWatchlist.mutate(id) : id ? addToWatchlist.mutate({ tenderId: id }) : undefined
          }
          disabled={addToWatchlist.isPending || removeFromWatchlist.isPending}
        >
          {isWatched ? 'Remove from Watchlist' : 'Add to Watchlist'}
        </Button>
        <Button variant="outline" size="sm" disabled title="Bid workflows arrive in a later phase">
          Start Bid (coming soon)
        </Button>
        {data.original_document_url ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(data.original_document_url ?? undefined, '_blank', 'noopener,noreferrer')}
          >
            Open Source →
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled title="No source link recorded for this tender">
            Open Source
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setTab('documents')}>
          View Documents
        </Button>
      </div>

      <Tabs items={TABS} value={tab} onChange={setTab}>
        <TabPanel value="overview" activeValue={tab}>
          <OverviewTab tenderId={data.id} closingDate={data.closing_date} publishedDate={data.published_date} province={data.province} municipality={data.municipality} estimatedValue={data.estimated_value} description={data.description} category={data.category} entityType={data.entity_type} confidenceScore={data.confidence_score} />
        </TabPanel>
        <TabPanel value="requirements" activeValue={tab}>
          <RequirementsTab tenderId={data.id} enabled={tab === 'requirements'} />
        </TabPanel>
        <TabPanel value="evaluation" activeValue={tab}>
          <EvaluationTab tenderId={data.id} enabled={tab === 'evaluation'} />
        </TabPanel>
        <TabPanel value="briefing" activeValue={tab}>
          <BriefingTab tenderId={data.id} enabled={tab === 'briefing'} briefingRequired={data.briefing_required} />
        </TabPanel>
        <TabPanel value="documents" activeValue={tab}>
          <DocumentsTab tenderId={data.id} enabled={tab === 'documents'} />
        </TabPanel>
        <TabPanel value="ai" activeValue={tab}>
          <AiClassificationTab tenderId={data.id} enabled={tab === 'ai'} />
        </TabPanel>
        <TabPanel value="addenda" activeValue={tab}>
          <AddendaTab tenderId={data.id} enabled={tab === 'addenda'} />
        </TabPanel>
        <TabPanel value="qualification" activeValue={tab}>
          <QualificationTab tenderId={data.id} enabled={tab === 'qualification'} />
        </TabPanel>
        <TabPanel value="score" activeValue={tab}>
          <ScoreTab score={currentScore} status={score.status} error={score.status === 'error' ? score.error : undefined} />
        </TabPanel>
        <TabPanel value="opportunity-score" activeValue={tab}>
          <OpportunityScoreTab tenderId={data.id} enabled={tab === 'opportunity-score'} />
        </TabPanel>
        <TabPanel value="bid-decision" activeValue={tab}>
          <BidDecisionTab tenderId={data.id} enabled={tab === 'bid-decision'} />
        </TabPanel>
        <TabPanel value="risk" activeValue={tab}>
          <RiskTab tenderId={data.id} enabled={tab === 'risk'} />
        </TabPanel>
        <TabPanel value="activity" activeValue={tab}>
          <ActivityTab tenderId={data.id} enabled={tab === 'activity'} />
        </TabPanel>
        <TabPanel value="outcome" activeValue={tab}>
          <OutcomeTab tenderId={data.id} enabled={tab === 'outcome'} />
        </TabPanel>
      </Tabs>
    </div>
  )
}

function OverviewTab({
  closingDate,
  publishedDate,
  province,
  municipality,
  estimatedValue,
  description,
  category,
  entityType,
  confidenceScore,
}: {
  tenderId: string
  closingDate: string | null
  publishedDate: string | null
  province: string | null
  municipality: string | null
  estimatedValue: number | null
  description: string | null
  category: string | null
  entityType: string | null
  confidenceScore: number | null
}) {
  const fields: Array<[string, string]> = [
    ['Published', formatDate(publishedDate)],
    ['Closing', formatDate(closingDate)],
    ['Province', province ?? '—'],
    ['Municipality', municipality ?? '—'],
    ['Category', category ?? '—'],
    ['Organisation type', entityType ?? '—'],
    ['Estimated value', formatCurrency(estimatedValue)],
  ]
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <EvidenceTag status="VERIFIED" />
        <span className="text-xs text-muted-foreground">
          These fields come directly from the source tender record.
          {confidenceScore !== null ? ` Extraction confidence: ${Math.round(confidenceScore * 100)}%.` : ''}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
            <dd className="text-sm text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      {description ? (
        <div>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Description</h3>
          <p className="whitespace-pre-line text-sm text-foreground">{description}</p>
        </div>
      ) : null}
    </div>
  )
}

const REQUIREMENT_FILTERS = [
  'ALL',
  'MANDATORY',
  'QUALIFICATION',
  'TECHNICAL',
  'SUBMISSION',
  'ADMINISTRATIVE',
  'COMMERCIAL',
  'OTHER',
] as const
type RequirementFilter = (typeof REQUIREMENT_FILTERS)[number]

/**
 * Phase 9 §38 — Requirements tab: category, title/description, mandatory
 * status, disqualification risk, evidence, verification state, filterable
 * by All/Mandatory/Qualification/Technical/Submission/Administrative/
 * Commercial/Other. Extends the Phase 2 baseline tab that lived at this
 * same path (docs/DECISIONS.md, Phase 9 entry).
 */
function RequirementsTab({ tenderId, enabled }: { tenderId: string; enabled: boolean }) {
  const requirements = useRequirements(tenderId, enabled)
  const runs = useExtractionRuns(tenderId, enabled)
  const currentUser = useCurrentUser()
  const canAct = currentUser.status === 'success' && AI_ACTION_ROLES.includes(currentUser.data.role)
  const extract = useTriggerRequirementExtraction(tenderId)
  const review = useSubmitRequirementReview(tenderId)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewNote, setReviewNote] = useState('')
  const [filter, setFilter] = useState<RequirementFilter>('ALL')

  if (requirements.status === 'loading') return <LoadingState rows={4} />
  if (requirements.status === 'error') return <ErrorState message={requirements.error} />
  if (requirements.status !== 'success') return null

  const latestRun = runs.status === 'success' ? runs.data[0] : undefined
  const isRunning = latestRun ? latestRun.status === 'QUEUED' || latestRun.status === 'RUNNING' : false
  const items = requirements.data.requirements.filter((req) => {
    if (filter === 'ALL') return true
    if (filter === 'MANDATORY') return req.mandatoryStatus === 'MANDATORY'
    return req.category === filter
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
        <div>
          <p className="text-sm font-medium text-foreground">Requirement extraction</p>
          <p className="text-xs text-muted-foreground">
            Structured requirements extracted from this tender's own documents — never invented. Unspecified
            details stay UNKNOWN; disqualification risk is a severity flag only, not a qualification decision.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {latestRun ? <AiRunStatusBadge status={latestRun.status} /> : null}
          <Button
            variant="outline"
            size="sm"
            disabled={!canAct || extract.isPending || isRunning}
            title={canAct ? undefined : 'Requires ADMIN or BID_MANAGER'}
            onClick={() => extract.mutate()}
          >
            {isRunning ? 'Extracting…' : latestRun ? 'Re-extract' : 'Extract requirements'}
          </Button>
        </div>
      </div>

      {requirements.data.conflicts.length > 0 ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
          <p className="text-sm font-semibold text-destructive">
            {requirements.data.conflicts.length} CONFLICT{requirements.data.conflicts.length === 1 ? '' : 'S'} between documents
          </p>
          <ul className="mt-1 flex flex-col gap-1 text-xs text-foreground">
            {requirements.data.conflicts.map((c) => (
              <li key={c.id}>{c.description}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1">
        {REQUIREMENT_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs ${filter === f ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground'}`}
          >
            {f.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState title="No structured requirements match this filter." description={requirements.data.requirements.length === 0 ? 'Click Extract requirements above to run the extraction agent.' : undefined} />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((req) => (
            <li key={req.id} className={req.parentRequirementId ? 'ml-6 rounded-md border border-border p-3' : 'rounded-md border border-border p-3'}>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{req.category.replace(/_/g, ' ')}</span>
                <QualificationMandatoryStatusBadge status={req.mandatoryStatus} />
                <RequirementStatusBadge status={req.requirementStatus} />
                <AiTruthBadge truth={req.sourceTruth as 'FACT' | 'INFERENCE' | 'UNKNOWN' | 'UNVERIFIED'} />
                {req.disqualificationRisk ? <DisqualificationRiskBadge /> : null}
              </div>
              <p className="text-sm font-medium text-foreground">{req.title}</p>
              {req.description && req.description !== req.title ? <p className="text-sm text-muted-foreground">{req.description}</p> : null}
              <RequirementEvidenceList evidence={req.evidence} sourceLabel="Tender Document" />
              <button type="button" className="mt-1 block text-xs underline" onClick={() => setReviewingId(req.id)}>
                Record review
              </button>
            </li>
          ))}
        </ul>
      )}

      {reviewingId ? (
        <ReviewForm
          note={reviewNote}
          onNoteChange={setReviewNote}
          disabled={!canAct}
          pending={review.isPending}
          onSubmit={() => review.mutate({ requirementId: reviewingId, decision: reviewNote.slice(0, 200), note: reviewNote }, { onSuccess: () => { setReviewingId(null); setReviewNote('') } })}
          onCancel={() => { setReviewingId(null); setReviewNote('') }}
        />
      ) : null}
    </div>
  )
}

/**
 * Phase 9 §39 — Evaluation tab: overview only shows what's explicitly
 * supported by evidence, criteria table (Criterion/Type/Points/Weight/
 * Threshold/Evidence), gates shown separately, conflicts prominent.
 * Never displays a computed/invented weight or an agency/bidder score.
 */
function EvaluationTab({ tenderId, enabled }: { tenderId: string; enabled: boolean }) {
  const evaluation = useEvaluation(tenderId, enabled)
  const currentUser = useCurrentUser()
  const canAct = currentUser.status === 'success' && AI_ACTION_ROLES.includes(currentUser.data.role)
  const review = useSubmitEvaluationCriterionReview(tenderId)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewNote, setReviewNote] = useState('')

  if (evaluation.status === 'loading') return <LoadingState rows={4} />
  if (evaluation.status === 'error') return <ErrorState message={evaluation.error} />
  if (evaluation.status !== 'success') return null

  const { criteria, gates, conflicts } = evaluation.data
  const functionalityGate = gates.find((g) => g.thresholdType === 'FUNCTIONALITY_GATE') ?? gates.find((g) => g.threshold !== null)

  return (
    <div className="flex flex-col gap-4">
      {functionalityGate ? (
        <div className="rounded-md border border-border p-3">
          <p className="text-sm font-medium text-foreground">Scoring methodology (as stated in the tender)</p>
          <p className="text-xs text-muted-foreground">
            {functionalityGate.name}
            {functionalityGate.threshold !== null ? ` — minimum threshold ${functionalityGate.threshold}` : ' — threshold not stated (UNKNOWN)'}
          </p>
        </div>
      ) : criteria.length > 0 ? (
        <p className="text-xs italic text-muted-foreground">No explicit scoring methodology/gate statement was found in the extracted evidence.</p>
      ) : null}

      {conflicts.length > 0 ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
          <p className="text-sm font-semibold text-destructive">
            {conflicts.length} EVALUATION CONFLICT{conflicts.length === 1 ? '' : 'S'} between documents
          </p>
          <ul className="mt-1 flex flex-col gap-1 text-xs text-foreground">
            {conflicts.map((c) => (
              <li key={c.id}>{c.description}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {criteria.length === 0 ? (
        <EmptyState title="Evaluation criteria have not been extracted yet." description="Use the Requirements tab to run extraction — it populates both requirements and evaluation criteria." />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-2">Criterion</th>
                <th className="p-2">Type</th>
                <th className="p-2">Points</th>
                <th className="p-2">Weight</th>
                <th className="p-2">Threshold</th>
                <th className="p-2">Status</th>
                <th className="p-2">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {criteria.map((c) => (
                <tr key={c.id} className={c.parentCriterionId ? 'border-t border-border align-top bg-muted/10' : 'border-t border-border align-top'}>
                  <td className="p-2">
                    <p className="text-foreground">{c.name}</p>
                    {c.description ? <p className="text-xs text-muted-foreground">{c.description}</p> : null}
                    {c.gate ? <span className="mt-1 inline-block rounded bg-warning/20 px-1.5 py-0.5 text-[10px] font-medium text-warning">Gate</span> : null}
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">{c.criterionType.replace(/_/g, ' ')}</td>
                  <td className="p-2">{c.maximumPoints ?? <span className="text-xs text-muted-foreground">Unspecified</span>}</td>
                  <td className="p-2">{c.weight !== null ? `${c.weight}%` : <span className="text-xs text-muted-foreground">Unspecified</span>}</td>
                  <td className="p-2">{c.minimumThreshold ?? <span className="text-xs text-muted-foreground">Unspecified</span>}</td>
                  <td className="p-2">
                    <RequirementStatusBadge status={c.status} />
                  </td>
                  <td className="p-2">
                    <RequirementEvidenceList evidence={c.evidence} sourceLabel="Tender Document" />
                    <button type="button" className="mt-1 block text-xs underline" onClick={() => setReviewingId(c.id)}>
                      Record review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {gates.length > 0 ? (
        <div className="rounded-md border border-border p-3">
          <p className="text-sm font-medium text-foreground">Gates</p>
          <ul className="mt-2 flex flex-col gap-2">
            {gates.map((g) => (
              <li key={g.id} className="border-t border-border pt-2 text-xs">
                <span className="font-medium">{g.name}</span>
                {g.threshold !== null ? ` — threshold ${g.threshold}` : ' — threshold UNKNOWN'}
                {g.description ? <p className="mt-1 text-muted-foreground">{g.description}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {reviewingId ? (
        <ReviewForm
          note={reviewNote}
          onNoteChange={setReviewNote}
          disabled={!canAct}
          pending={review.isPending}
          onSubmit={() => review.mutate({ criterionId: reviewingId, decision: reviewNote.slice(0, 200), note: reviewNote }, { onSuccess: () => { setReviewingId(null); setReviewNote('') } })}
          onCancel={() => { setReviewingId(null); setReviewNote('') }}
        />
      ) : null}
    </div>
  )
}

/** Shared evidence viewer (Phase 9 §40 — reuses the exact QualificationEvidence pattern below rather than a second incompatible viewer). */
function RequirementEvidenceList({ evidence, sourceLabel }: { evidence: EvidenceRefDto[]; sourceLabel: string }) {
  const [open, setOpen] = useState(false)
  if (evidence.length === 0) {
    return <p className="text-xs italic text-muted-foreground">No evidence resolved.</p>
  }
  return (
    <div>
      <button type="button" className="text-xs underline" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide evidence' : `View evidence (${evidence.length})`}
      </button>
      {open ? (
        <ul className="mt-1 flex flex-col gap-2">
          {evidence.map((ev) => (
            <li key={ev.id} className="rounded border border-border bg-muted/30 p-2 text-xs">
              <p className="font-medium text-muted-foreground">
                {sourceLabel}
                {ev.pageNumber ? ` · Page ${ev.pageNumber}` : ''}
                {ev.sectionId ? ' · Section reference on file' : ''}
                {ev.chunkId ? ' · Chunk reference on file' : ''}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-foreground">{ev.evidenceText}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** Shared human-review form (Phase 9 §41 — mirrors QualificationTab's review form exactly). */
function ReviewForm({
  note,
  onNoteChange,
  disabled,
  pending,
  onSubmit,
  onCancel,
}: {
  note: string
  onNoteChange: (v: string) => void
  disabled: boolean
  pending: boolean
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-sm font-medium text-foreground">Record human review decision</p>
      <textarea className="mt-2 w-full rounded border border-border p-2 text-sm" rows={3} placeholder="Decision / note" value={note} onChange={(e) => onNoteChange(e.target.value)} />
      <div className="mt-2 flex gap-2">
        <Button size="sm" disabled={disabled || pending || note.trim().length === 0} onClick={onSubmit}>
          Submit review
        </Button>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function BriefingTab({ tenderId, enabled, briefingRequired }: { tenderId: string; enabled: boolean; briefingRequired: boolean }) {
  const briefing = useTenderBriefing(tenderId, enabled)
  if (briefing.status === 'loading') return <LoadingState rows={3} />
  if (briefing.status === 'error') return <ErrorState message={briefing.error} />
  if (briefing.status !== 'success') return null
  const rows: TenderBriefingRow[] = briefing.data.rows
  if (rows.length === 0) {
    return (
      <EmptyState
        title={briefingRequired ? 'A briefing is required, but details have not been captured yet.' : 'No briefing is recorded for this tender.'}
      />
    )
  }
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.id} className="rounded-md border border-border p-3 text-sm">
          <div className="mb-1 flex flex-wrap gap-3 text-muted-foreground">
            <span>{row.mandatory ? 'Mandatory' : 'Optional'}</span>
            <span>{formatDate(row.date)}</span>
            {row.location ? <span>{row.location}</span> : null}
            {row.online_url ? (
              <a href={row.online_url} target="_blank" rel="noreferrer" className="underline">
                Join online
              </a>
            ) : null}
          </div>
          {row.notes ? <p className="text-foreground">{row.notes}</p> : null}
        </li>
      ))}
    </ul>
  )
}

/** Roles allowed to trigger the document evidence pipeline (Phase 6 §25/§26) — mirrors the API's ACTION_ROLES in routes/tenderDocuments.ts; hiding a button here is a UX convenience only, the API re-checks regardless. */
const DOCUMENT_ACTION_ROLES: readonly UserRole[] = ['ADMIN', 'BID_MANAGER']

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Mirrors the API's AI_ACTION_ROLES (routes/tenderAi.ts) — the server re-checks regardless. */
const AI_ACTION_ROLES: readonly UserRole[] = ['ADMIN', 'BID_MANAGER']

function EvidenceList({ evidence }: { evidence: AiEvidence[] }) {
  const [open, setOpen] = useState(false)
  if (evidence.length === 0) {
    return <p className="mt-1 text-xs italic text-muted-foreground">No evidence resolved for this claim.</p>
  }
  return (
    <div className="mt-1">
      <button type="button" className="text-xs underline" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide evidence' : `View evidence (${evidence.length})`}
      </button>
      {open ? (
        <ul className="mt-1 flex flex-col gap-2">
          {evidence.map((ev) => (
            <li key={ev.id} className="rounded border border-border bg-muted/30 p-2 text-xs">
              <p className="font-medium text-muted-foreground">
                Tender Document{ev.pageNumber ? ` · Page ${ev.pageNumber}` : ''}
                {ev.sectionId ? ' · Section reference on file' : ''}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-foreground">{ev.evidenceText}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * Phase 7 §30/§31 — AI Discovery & Classification. An
 * intelligence/research surface, not a chatbot: every claim shows its
 * truth state (never implying certainty just because the model
 * produced an answer) and its resolved, server-verified evidence.
 */
function AiClassificationTab({ tenderId, enabled }: { tenderId: string; enabled: boolean }) {
  const runs = useAiRuns(tenderId, enabled)
  const activeRun = runs.status === 'success' ? runs.data.find((r) => r.status === 'QUEUED' || r.status === 'RUNNING') : undefined
  const hasRuns = runs.status === 'success' && runs.data.length > 0
  const classification = useAiClassification(tenderId, enabled, hasRuns)
  const currentUser = useCurrentUser()
  const canAct = currentUser.status === 'success' && AI_ACTION_ROLES.includes(currentUser.data.role)
  const hasClassification = classification.status === 'success' && classification.data !== null
  const trigger = useTriggerClassification(tenderId, hasClassification ? 'reclassify' : 'classify')

  if (classification.status === 'loading') return <LoadingState rows={4} />
  if (classification.status === 'error') return <ErrorState message={classification.error} />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
        <div>
          <p className="text-sm font-medium text-foreground">AI classification runs</p>
          <p className="text-xs text-muted-foreground">
            AI results are interpretations of ingested documents, not a source of truth — every claim below carries its own
            evidence and truth state.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!canAct || trigger.isPending || Boolean(activeRun)}
          title={canAct ? undefined : 'Requires ADMIN or BID_MANAGER'}
          onClick={() => trigger.mutate()}
        >
          {activeRun ? 'Run in progress…' : hasClassification ? 'Reclassify' : 'Classify with AI'}
        </Button>
      </div>

      {runs.status === 'success' && runs.data.length > 0 ? (
        <details className="rounded-md border border-border p-3 text-sm">
          <summary className="cursor-pointer font-medium text-foreground">Run history ({runs.data.length})</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {runs.data.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-xs">
                <span>
                  {new Date(run.createdAt).toLocaleString('en-ZA')} · {run.model} · {run.promptVersion}
                  {run.error ? ` · ${run.error}` : ''}
                </span>
                <AiRunStatusBadge status={run.status} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {!hasClassification || classification.status !== 'success' || !classification.data ? (
        <EmptyState title="No AI classification exists for this tender yet." description="Trigger a classification run above." />
      ) : (
        <AiClassificationResult classification={classification.data} />
      )}
    </div>
  )
}

function AiClassificationResult({ classification: c }: { classification: AiClassification }) {
  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-md border border-border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <AiRelevanceBadge relevance={c.relevance} />
          <AiTruthBadge truth={c.relevanceTruth} />
          <span className="text-xs text-muted-foreground">Tender type: {c.tenderType.replace(/_/g, ' ')}</span>
          <AiTruthBadge truth={c.tenderTypeTruth} />
        </div>
        {c.summary ? (
          <div className="mt-2">
            <p className="text-sm text-foreground">{c.summary}</p>
            <AiTruthBadge truth={c.summaryTruth} />
          </div>
        ) : null}
      </section>

      <section className="rounded-md border border-border p-3">
        <h3 className="text-sm font-semibold text-foreground">Intent</h3>
        <p className="mt-1 text-sm text-foreground">{c.intentText ?? '—'}</p>
        <AiTruthBadge truth={c.intentTruth} />
        <EvidenceList evidence={c.claims.find((cl) => cl.claimKey === 'intent')?.evidence ?? []} />
      </section>

      <section className="rounded-md border border-border p-3">
        <h3 className="text-sm font-semibold text-foreground">Services</h3>
        {c.services.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">No services assigned.</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-2">
            {c.services.map((s) => (
              <li key={s.serviceId} className="rounded-full border border-border px-2 py-1 text-xs">
                {s.serviceName}
                {s.confidence !== null ? ` (${Math.round(s.confidence * 100)}%)` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-md border border-border p-3">
        <h3 className="text-sm font-semibold text-foreground">Deliverables</h3>
        {c.deliverables.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">No apparent deliverables identified.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {c.deliverables.map((d) => (
              <li key={d.id} className="border-t border-border pt-2 text-sm">
                <div className="flex items-center gap-2">
                  <span>{d.text}</span>
                  <AiTruthBadge truth={d.truth} />
                </div>
                <EvidenceList evidence={d.evidence} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-md border border-border p-3">
        <h3 className="text-sm font-semibold text-foreground">Geographic scope</h3>
        <p className="mt-1 text-sm text-foreground">{c.geographicScope.replace(/_/g, ' ')}</p>
        <AiTruthBadge truth={c.geographyTruth} />
      </section>

      <section className="rounded-md border border-border p-3">
        <h3 className="text-sm font-semibold text-foreground">Contract information</h3>
        <dl className="mt-1 grid grid-cols-2 gap-2 text-sm">
          <div><dt className="text-xs text-muted-foreground">Duration</dt><dd>{c.contract.durationText ?? 'UNKNOWN'}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Estimated value</dt><dd>{c.contract.estimatedValue ?? 'UNKNOWN'}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Procurement method</dt><dd>{c.contract.procurementMethod ?? 'UNKNOWN'}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Framework/panel</dt><dd>{c.contract.isFrameworkOrPanel === null ? 'UNKNOWN' : String(c.contract.isFrameworkOrPanel)}</dd></div>
        </dl>
        <AiTruthBadge truth={c.contractTruth} />
      </section>

      <section className="rounded-md border border-border p-3">
        <h3 className="text-sm font-semibold text-foreground">Compulsory briefing (AI-identified)</h3>
        <p className="mt-1 text-sm text-foreground">
          {c.briefing.status} {c.briefing.date ? `· ${c.briefing.date}` : ''} {c.briefing.time ? `${c.briefing.time}` : ''}{' '}
          {c.briefing.location ? `· ${c.briefing.location}` : ''}
        </p>
        <AiTruthBadge truth={c.briefingTruth} />
      </section>

      {c.apparentRequirements.length > 0 ? (
        <section className="rounded-md border border-border p-3">
          <h3 className="text-sm font-semibold text-foreground">Apparent requirements (discovery only)</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {c.apparentRequirements.map((r) => (
              <li key={r.id} className="border-t border-border pt-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase text-muted-foreground">{r.kind.replace(/_/g, ' ')}</span>
                  <AiTruthBadge truth={r.truth} />
                </div>
                <p>{r.text}</p>
                <EvidenceList evidence={r.evidence} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {c.conflicts.length > 0 ? (
        <section role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-3">
          <h3 className="text-sm font-semibold text-foreground">Conflicts with database fields</h3>
          <p className="text-xs text-muted-foreground">
            A document appears to disagree with the deterministic tender record. Nothing has been changed automatically —
            review before relying on either value.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {c.conflicts.map((cf) => (
              <li key={cf.id} className="border-t border-warning/30 pt-2 text-sm">
                <span className="font-medium">{cf.field.replace(/_/g, ' ')}:</span> database says{' '}
                <span className="font-mono">{cf.dbValue ?? 'UNKNOWN'}</span>, a document says{' '}
                <span className="font-mono">{cf.documentValue}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function DocumentsTab({ tenderId, enabled }: { tenderId: string; enabled: boolean }) {
  const documents = useTenderDocuments(tenderId, enabled)
  const currentUser = useCurrentUser()
  const canAct = currentUser.status === 'success' && DOCUMENT_ACTION_ROLES.includes(currentUser.data.role)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (documents.status === 'loading') return <LoadingState rows={4} />
  if (documents.status === 'error') return <ErrorState message={documents.error} />
  if (documents.status !== 'success') return null
  const rows: TenderDocumentRow[] = documents.data.rows
  if (rows.length === 0) {
    return <EmptyState title="No documents have been collected for this tender yet." />
  }
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((doc) => (
        <li key={doc.id} className="rounded-md border border-border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium text-foreground">{doc.filename}</p>
              <p className="text-xs text-muted-foreground">
                {(doc.classification ?? doc.document_type).replace('_', ' ')} · v{doc.version} ·{' '}
                {formatDate(doc.published_at)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {doc.file_url ? (
                <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-sm underline">
                  Open
                </a>
              ) : (
                <span className="text-xs text-muted-foreground">Not yet downloaded</span>
              )}
              <Button variant="outline" size="sm" onClick={() => setExpandedId(expandedId === doc.id ? null : doc.id)}>
                {expandedId === doc.id ? 'Hide details' : 'View'}
              </Button>
            </div>
          </div>
          {expandedId === doc.id ? (
            <DocumentDetailPanel tenderId={tenderId} documentId={doc.id} canAct={canAct} />
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function DocumentDetailPanel({ tenderId, documentId, canAct }: { tenderId: string; documentId: string; canAct: boolean }) {
  const detail = useTenderDocumentDetail(tenderId, documentId)
  const download = useDownloadDocument(tenderId)
  const reprocess = useReprocessDocument(tenderId)
  const [showEvidence, setShowEvidence] = useState(false)

  if (detail.status === 'loading') return <LoadingState rows={2} />
  if (detail.status === 'error') return <ErrorState message={detail.error} />
  if (detail.status !== 'success') return null

  const { document, versions, currentVersion, processing } = detail.data
  const state = processing?.state ?? 'DISCOVERED'
  const canReprocess = canAct && Boolean(currentVersion?.storage_path)

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-foreground">
          {state.replace(/_/g, ' ')}
        </span>
        {processing?.extraction_method ? (
          <span className="text-xs text-muted-foreground">Extraction: {processing.extraction_method}</span>
        ) : null}
        {processing?.page_count !== null && processing?.page_count !== undefined ? (
          <span className="text-xs text-muted-foreground">{processing.page_count} page(s)</span>
        ) : null}
        {currentVersion ? (
          <span className="text-xs text-muted-foreground">
            {formatBytes(currentVersion.file_size)} · {currentVersion.mime_type ?? currentVersion.detected_file_kind}
          </span>
        ) : null}
        {document.source_id ? <span className="text-xs text-muted-foreground">Source-linked</span> : null}
      </div>

      {processing?.last_error ? (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {processing.last_error_stage ? `${processing.last_error_stage}: ` : ''}
          {processing.last_error}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!canAct || download.isPending}
          onClick={() => download.mutate(documentId)}
          title={canAct ? undefined : 'Requires BID_MANAGER or ADMIN'}
        >
          {currentVersion ? 'Re-download' : 'Download'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!canReprocess || reprocess.isPending}
          onClick={() => reprocess.mutate(documentId)}
          title={canAct ? undefined : 'Requires BID_MANAGER or ADMIN'}
        >
          Reprocess
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowEvidence((v) => !v)} disabled={state !== 'READY_FOR_ANALYSIS' && state !== 'REQUIRES_REVIEW'}>
          {showEvidence ? 'Hide evidence' : 'View evidence'}
        </Button>
      </div>

      {versions.length > 1 ? (
        <p className="text-xs text-muted-foreground">
          {versions.length} version(s) on file — original preserved; the newest is shown above (Phase 6 versioning).
        </p>
      ) : null}

      {showEvidence && currentVersion ? (
        <DocumentEvidenceViewer tenderId={tenderId} documentId={documentId} />
      ) : null}
    </div>
  )
}

/** A minimal document evidence view (Phase 6 §27/§28): page navigation on the left, extracted text in the centre, each page's provenance shown explicitly rather than displaying text with no source. */
function DocumentEvidenceViewer({ tenderId, documentId }: { tenderId: string; documentId: string }) {
  const pages = useTenderDocumentPages(tenderId, documentId, true)
  const sections = useTenderDocumentSections(tenderId, documentId, true)
  const [pageNumber, setPageNumber] = useState<number | null>(null)

  if (pages.status === 'loading' || sections.status === 'loading') return <LoadingState rows={3} />
  if (pages.status === 'error') return <ErrorState message={pages.error} />
  if (pages.status !== 'success' || pages.data.length === 0) {
    return <EmptyState title="No extracted pages are available for this document yet." />
  }

  const activePage = pages.data.find((p) => p.page_number === pageNumber) ?? pages.data[0]!
  const activeSection =
    sections.status === 'success'
      ? sections.data.find((s) => activePage.page_number >= s.page_start && activePage.page_number <= s.page_end)
      : undefined

  return (
    <div className="grid grid-cols-1 gap-3 rounded-md border border-border p-3 sm:grid-cols-[120px_1fr]">
      <div className="flex flex-row gap-1 overflow-x-auto sm:flex-col sm:overflow-visible">
        {pages.data.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPageNumber(p.page_number)}
            className={`rounded px-2 py-1 text-left text-xs ${
              p.page_number === activePage.page_number ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            Page {p.page_number}
          </button>
        ))}
      </div>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Tender Document · Page {activePage.page_number}
          {activeSection?.title || activeSection?.section_number
            ? ` · Section ${activeSection.section_number ?? activeSection.title}`
            : ' · Section UNKNOWN'}
          {' · '}
          {activePage.extraction_method === 'OCR' ? 'OCR extracted' : 'Native text'}
        </p>
        <div className="max-h-96 overflow-y-auto whitespace-pre-line rounded-md bg-muted/40 p-3 text-sm text-foreground">
          {activePage.text.trim().length > 0 ? activePage.text : <span className="text-muted-foreground">No text extracted for this page.</span>}
        </div>
      </div>
    </div>
  )
}

function AddendaTab({ tenderId, enabled }: { tenderId: string; enabled: boolean }) {
  const addenda = useTenderAddenda(tenderId, enabled)
  if (addenda.status === 'loading') return <LoadingState rows={3} />
  if (addenda.status === 'error') return <ErrorState message={addenda.error} />
  if (addenda.status !== 'success') return null
  const rows: TenderAddendumRow[] = addenda.data.rows
  if (rows.length === 0) {
    return <EmptyState title="No addenda have been published for this tender." />
  }
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.id} className="rounded-md border border-border p-3 text-sm">
          <p className="font-medium text-foreground">
            Addendum {row.addendum_number} — {formatDate(row.published_at)}
          </p>
          {row.summary ? <p className="mt-1 text-muted-foreground">{row.summary}</p> : null}
        </li>
      ))}
    </ul>
  )
}

/**
 * Phase 8 §34 — Qualification & Compliance Intelligence. Deliberately
 * has NO percentage/score anywhere (Phase 8 §35: "Qualification: 83%"
 * is explicitly forbidden) — qualification is a collection of
 * requirements each carrying its own explicit state, plus outstanding
 * actions. Mandatory blockers are surfaced prominently, and the
 * overall status badge is worded as "no mandatory blocker found",
 * never a guarantee of success (Phase 8 §25).
 */
function QualificationTab({ tenderId, enabled }: { tenderId: string; enabled: boolean }) {
  const qualification = useQualification(tenderId, enabled)
  const requirements = useQualificationRequirements(tenderId, enabled)
  const actions = useQualificationActions(tenderId, enabled)
  const currentUser = useCurrentUser()
  const canAct = currentUser.status === 'success' && AI_ACTION_ROLES.includes(currentUser.data.role)
  const evaluate = useEvaluateQualification(tenderId)
  const review = useSubmitQualificationReview(tenderId)
  const [reviewingRequirementId, setReviewingRequirementId] = useState<string | null>(null)
  const [reviewNote, setReviewNote] = useState('')

  if (qualification.status === 'loading' || requirements.status === 'loading') return <LoadingState rows={4} />
  if (qualification.status === 'error') return <ErrorState message={qualification.error} />
  if (requirements.status === 'error') return <ErrorState message={requirements.error} />
  if (qualification.status !== 'success' || requirements.status !== 'success') return null

  const run = qualification.data.run
  const results = qualification.data.results
  const resultsByRequirement = new Map(results.map((r) => [r.requirementId, r]))
  const mandatoryBlockers = results.filter((r) => r.mandatory && r.status === 'FAIL')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
        <div>
          <p className="text-sm font-medium text-foreground">Qualification evaluation</p>
          <p className="text-xs text-muted-foreground">
            Whether the agency appears capable of satisfying this tender's mandatory and important eligibility
            requirements, based on verified agency evidence — not a bid/no-bid recommendation, and not a guarantee.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <QualificationOverallStatusBadge status={run?.overallStatus ?? null} />
          <Button variant="outline" size="sm" disabled={!canAct || evaluate.isPending} title={canAct ? undefined : 'Requires ADMIN or BID_MANAGER'} onClick={() => evaluate.mutate()}>
            {evaluate.isPending ? 'Evaluating…' : run ? 'Re-evaluate' : 'Evaluate qualification'}
          </Button>
        </div>
      </div>

      {mandatoryBlockers.length > 0 ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
          <p className="text-sm font-semibold text-destructive">
            {mandatoryBlockers.length} MANDATORY BLOCKER{mandatoryBlockers.length === 1 ? '' : 'S'}
          </p>
          <ul className="mt-1 flex flex-col gap-1 text-xs text-foreground">
            {mandatoryBlockers.map((r) => (
              <li key={r.id}>{r.explanation}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!run ? (
        <EmptyState title="Qualification has not been evaluated yet." description="Click Evaluate qualification above to run the deterministic engine against the agency's current evidence." />
      ) : null}

      {requirements.data.length === 0 ? (
        <EmptyState title="No structured qualification requirements exist for this tender yet." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-2">Requirement</th>
                  <th className="p-2">Category</th>
                  <th className="p-2">Mandatory</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {requirements.data.map((req) => {
                  const result = resultsByRequirement.get(req.id)
                  return (
                    <tr key={req.id} className="border-t border-border align-top">
                      <td className="p-2">
                        <p className="text-foreground">{req.description}</p>
                        {req.requirementStatus === 'PROVISIONAL' ? (
                          <p className="mt-1 text-xs italic text-muted-foreground">Provisional — not yet formally extracted/verified.</p>
                        ) : null}
                        {result?.requiresHumanReview ? <p className="mt-1 text-xs font-medium text-warning">Requires human review</p> : null}
                      </td>
                      <td className="p-2 text-xs text-muted-foreground">{req.category.replace(/_/g, ' ')}</td>
                      <td className="p-2">
                        <QualificationMandatoryStatusBadge status={req.mandatoryStatus} />
                      </td>
                      <td className="p-2">{result ? <QualificationCheckStatusBadge status={result.status} /> : <span className="text-xs text-muted-foreground">Not evaluated</span>}</td>
                      <td className="p-2">
                        {result ? (
                          <QualificationEvidence result={result} />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        <button type="button" className="mt-1 block text-xs underline" onClick={() => setReviewingRequirementId(req.id)}>
                          Record review
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="rounded-md border border-border p-3">
            <p className="text-sm font-medium text-foreground">Outstanding actions</p>
            {actions.status === 'success' && actions.data.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-2">
                {actions.data
                  .filter((a) => a.status === 'OPEN')
                  .map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-xs">
                      <span>
                        <span className="font-medium">{a.priority}</span> · {a.description}
                        {a.dueDate ? ` · due ${formatDate(a.dueDate)}` : ''}
                      </span>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">No outstanding actions.</p>
            )}
          </div>
        </>
      )}

      {reviewingRequirementId ? (
        <div className="rounded-md border border-border p-3">
          <p className="text-sm font-medium text-foreground">Record human review decision</p>
          <textarea
            className="mt-2 w-full rounded border border-border p-2 text-sm"
            rows={3}
            placeholder="Decision / note"
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              disabled={!canAct || review.isPending || reviewNote.trim().length === 0}
              onClick={() => {
                review.mutate(
                  { requirementId: reviewingRequirementId, decision: reviewNote.slice(0, 200), note: reviewNote },
                  { onSuccess: () => { setReviewingRequirementId(null); setReviewNote('') } },
                )
              }}
            >
              Submit review
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setReviewingRequirementId(null); setReviewNote('') }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function QualificationEvidence({ result }: { result: import('@tender-os/schemas').QualificationResultDto }) {
  const [open, setOpen] = useState(false)
  const total = result.tenderEvidence.length + result.agencyEvidence.length
  if (total === 0) {
    return <p className="text-xs italic text-muted-foreground">No evidence resolved.</p>
  }
  return (
    <div>
      <button type="button" className="text-xs underline" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide evidence' : `View evidence (${total})`}
      </button>
      {open ? (
        <ul className="mt-1 flex flex-col gap-2">
          {result.tenderEvidence.map((ev) => (
            <li key={ev.id} className="rounded border border-border bg-muted/30 p-2 text-xs">
              <p className="font-medium text-muted-foreground">
                Tender Document{ev.pageNumber ? ` · Page ${ev.pageNumber}` : ''}
                {ev.sectionId ? ' · Section reference on file' : ''}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-foreground">{ev.evidenceText}</p>
            </li>
          ))}
          {result.agencyEvidence.map((ev) => (
            <li key={ev.id} className="rounded border border-border bg-muted/30 p-2 text-xs">
              <p className="font-medium text-muted-foreground">Agency evidence record</p>
              <p className="mt-1 text-foreground">{ev.description ?? 'On file — see agency profile.'}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

const DIMENSIONS: Array<[keyof TenderScoreRow, string]> = [
  ['service_fit', 'Service fit'],
  ['qualification_likelihood', 'Qualification likelihood'],
  ['relevant_experience', 'Relevant experience'],
  ['functionality_potential', 'Functionality potential'],
  ['commercial_value', 'Commercial value'],
  ['competition', 'Competition'],
  ['time_available', 'Time available'],
  ['compliance_risk', 'Compliance risk'],
  ['strategic_value', 'Strategic value'],
]

function ScoreTab({
  score,
  status,
  error,
}: {
  score: TenderScoreRow | null
  status: 'loading' | 'error' | 'success' | 'empty'
  error?: string
}) {
  if (status === 'loading') return <LoadingState rows={4} />
  if (status === 'error') return <ErrorState message={error ?? 'Unable to load the opportunity score.'} />
  if (!score) {
    return <EmptyState title="This tender has not been scored yet." description="No opportunity score has been calculated for your agency." />
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="text-2xl font-semibold tabular-nums">{score.total_score}/100</span>
        <OpportunityClassBadge scoreClass={score.score_class} />
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        {DIMENSIONS.map(([key, label]) => (
          <div key={key}>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
            <dd className="text-sm tabular-nums text-foreground">{String(score[key] ?? '—')}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function RiskTab({ tenderId, enabled }: { tenderId: string; enabled: boolean }) {
  const risks = useTenderRisks(tenderId, enabled)
  if (risks.status === 'loading') return <LoadingState rows={3} />
  if (risks.status === 'error') return <ErrorState message={risks.error} />
  if (risks.status !== 'success') return null
  const rows: TenderRiskRow[] = risks.data.rows
  if (rows.length === 0) {
    return <EmptyState title="No risks have been identified for this tender yet." />
  }
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((risk) => (
        <li key={risk.id} className="rounded-md border border-border p-3 text-sm">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{risk.risk_type.replace('_', ' ')}</span>
            <span className="text-xs text-muted-foreground">{risk.severity}</span>
          </div>
          <p className="text-foreground">{risk.description}</p>
        </li>
      ))}
    </ul>
  )
}

function ActivityTab({ tenderId, enabled }: { tenderId: string; enabled: boolean }) {
  const activity = useTenderActivity(tenderId, enabled)
  if (activity.status === 'loading') return <LoadingState rows={3} />
  if (activity.status === 'error') return <ErrorState message={activity.error} />
  if (activity.status !== 'success') return null
  const rows: AuditLogRow[] = activity.data.rows
  if (rows.length === 0) {
    return <EmptyState title="No activity has been recorded for this tender yet." />
  }
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((entry) => (
        <li key={entry.id} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
          <span className="text-foreground">{entry.action}</span>
          <span className="text-xs text-muted-foreground">{formatDate(entry.created_at)}</span>
        </li>
      ))}
    </ul>
  )
}
