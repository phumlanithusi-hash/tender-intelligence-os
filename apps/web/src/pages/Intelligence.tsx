import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader.js'
import { AsyncBoundary } from '../components/states/AsyncBoundary.js'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.js'
import { Badge } from '../components/ui/badge.js'
import { Button } from '../components/ui/button.js'
import { Input } from '../components/ui/input.js'
import { Tabs, TabPanel } from '../components/ui/tabs.js'
import { ROUTES, INTELLIGENCE_MANAGE_ROLES, INTELLIGENCE_APPROVE_ROLES } from '@tender-os/constants'
import { useCurrentUser } from '../hooks/useCurrentUser.js'
import {
  useIntelligenceReadiness,
  useIntelligenceDatasets,
  useCreateDataset,
  useIntelligenceModels,
  useCreateModel,
  useModelDetail,
  useVersionDetail,
  useCreateVersion,
  useTrainVersion,
  useCalibrateVersion,
  useCandidateVersion,
  useApproveVersion,
  useRejectVersion,
  useRetireVersion,
  useRequestPrediction,
  useScoreCalibration,
  useIntelligenceSegments,
} from '../hooks/useIntelligence.js'

/**
 * Phase 18 §29 — the /intelligence area. Six sections in one page
 * (tabbed, mirroring the tender/bid-detail tab convention): Model
 * Readiness, Score Calibration, Model Performance & Registry
 * (combined — a model version IS the performance/calibration/
 * governance unit), Prediction, and a link out to the existing
 * Outcomes/Historical Learning dashboard rather than duplicating it
 * (spec §29 "don't duplicate the Outcomes dashboard unnecessarily").
 */

const TABS = [
  { value: 'readiness', label: 'Model Readiness' },
  { value: 'score-calibration', label: 'Score Calibration' },
  { value: 'registry', label: 'Model Registry & Performance' },
  { value: 'prediction', label: 'Prediction' },
  { value: 'learning', label: 'Historical Learning' },
]

function eligibilityBadgeVariant(state: string): 'success' | 'warning' | 'destructive' | 'default' {
  if (state === 'PRODUCTION_ELIGIBLE' || state === 'READY_FOR_TRAINING' || state === 'READY_FOR_EVALUATION') return 'success'
  if (state === 'LEAKAGE_DETECTED') return 'destructive'
  return 'warning'
}

function ReadinessTab() {
  const readiness = useIntelligenceReadiness()
  const datasets = useIntelligenceDatasets()
  const createDataset = useCreateDataset()
  const currentUser = useCurrentUser()
  const canManage = currentUser.status === 'success' && (INTELLIGENCE_MANAGE_ROLES as readonly string[]).includes(currentUser.data.role)

  return (
    <div className="space-y-6">
      <AsyncBoundary state={readiness} emptyTitle="No decision-time observations yet">
        {(data) => (
          <Card>
            <CardHeader>
              <CardTitle>Live dataset readiness</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-3 flex items-center gap-2">
                <Badge variant={eligibilityBadgeVariant(data.eligibilityState)} data-testid="eligibility-state">
                  {data.eligibilityState}
                </Badge>
                {data.eligibilityState === 'INSUFFICIENT_DATA' && (
                  <span className="text-sm text-muted-foreground">NOT ENOUGH VERIFIED DATA — this is an expected, honest system state, not a failure.</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <div className="text-xs text-muted-foreground">Total candidate records</div>
                  <div className="font-semibold" data-testid="readiness-total">{data.totalCandidateRecords}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Verified labelled</div>
                  <div className="font-semibold" data-testid="readiness-verified">{data.verifiedLabelledRecords}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Class balance (WON / LOST)</div>
                  <div className="font-semibold">
                    {data.positiveCount} / {data.negativeCount}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Feature completeness</div>
                  <div className="font-semibold">{(data.featureCompleteness * 100).toFixed(0)}%</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Temporal coverage</div>
                  <div className="font-semibold">
                    {data.temporalCoverageStart ? new Date(data.temporalCoverageStart).toLocaleDateString('en-ZA') : 'UNKNOWN'} –{' '}
                    {data.temporalCoverageEnd ? new Date(data.temporalCoverageEnd).toLocaleDateString('en-ZA') : 'UNKNOWN'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Duplicate rate</div>
                  <div className="font-semibold">{(data.duplicateRate * 100).toFixed(1)}%</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Leakage check</div>
                  <div className="font-semibold">{data.leakageCheckPassed ? 'PASSED' : 'FAILED'}</div>
                </div>
              </div>
              <ul className="mt-4 list-inside list-disc space-y-1 text-xs text-muted-foreground">
                {data.eligibilityReasons.map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
              {canManage && (
                <Button className="mt-4" size="sm" disabled={createDataset.isPending} onClick={() => createDataset.mutate(false)}>
                  Snapshot this as a new dataset version
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </AsyncBoundary>

      <Card>
        <CardHeader>
          <CardTitle>Dataset version history</CardTitle>
        </CardHeader>
        <CardContent>
          <AsyncBoundary state={datasets} emptyTitle="No dataset snapshots yet" isEmpty={(d) => d.length === 0}>
            {(rows) => (
              <div className="space-y-2">
                {rows.map((d) => (
                  <div key={d.id} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
                    <span>
                      v{d.dataset_version} {d.is_test_fixture && <Badge variant="warning">TEST FIXTURE</Badge>}
                    </span>
                    <Badge variant={eligibilityBadgeVariant(d.eligibility_state)}>{d.eligibility_state}</Badge>
                    <span className="text-xs text-muted-foreground">{d.verified_labelled_records} labelled records</span>
                  </div>
                ))}
              </div>
            )}
          </AsyncBoundary>
        </CardContent>
      </Card>
    </div>
  )
}

function ScoreCalibrationTab() {
  const calibration = useScoreCalibration()
  const segments = useIntelligenceSegments()
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Opportunity Score retrospective calibration</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            Descriptive analysis of the existing Phase 10 Opportunity Score against verified Phase 17 outcomes — never automatically changes scoring weights (spec §15).
          </p>
          <AsyncBoundary state={calibration} emptyTitle="No score bands available">
            {(rows) => (
              <div className="space-y-2">
                {rows.map((row) => (
                  <div key={row.band} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
                    <span>{row.band}</span>
                    <span>{row.observedWinRate === null ? 'UNKNOWN' : `${(row.observedWinRate * 100).toFixed(0)}% observed win rate`}</span>
                    <span className="text-xs text-muted-foreground">
                      {row.verifiedOutcomeCount} verified / {row.sampleSize} total
                    </span>
                    {row.caveat && <Badge variant="warning">{row.caveat}</Badge>}
                  </div>
                ))}
              </div>
            )}
          </AsyncBoundary>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Performance by segment</CardTitle>
        </CardHeader>
        <CardContent>
          <AsyncBoundary state={segments} emptyTitle="No segments available" isEmpty={(rows) => rows.length === 0}>
            {(rows) => (
              <div className="space-y-2">
                {rows.map((row) => (
                  <div key={row.segmentKey} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
                    <span>{row.segmentKey}</span>
                    <span>{row.observedWinRate === null ? 'UNKNOWN' : `${(row.observedWinRate * 100).toFixed(0)}%`}</span>
                    <span className="text-xs text-muted-foreground">
                      {row.verifiedOutcomes} verified / {row.missingOutcomes} missing
                    </span>
                    {row.insufficientSample && <Badge variant="warning">{row.caveat}</Badge>}
                  </div>
                ))}
              </div>
            )}
          </AsyncBoundary>
        </CardContent>
      </Card>
    </div>
  )
}

function VersionCard({ versionId }: { versionId: string }) {
  const detail = useVersionDetail(versionId)
  const train = useTrainVersion()
  const calibrate = useCalibrateVersion()
  const candidate = useCandidateVersion()
  const approve = useApproveVersion()
  const reject = useRejectVersion()
  const retire = useRetireVersion()
  const [rationale, setRationale] = useState('')
  const currentUser = useCurrentUser()
  const canManage = currentUser.status === 'success' && (INTELLIGENCE_MANAGE_ROLES as readonly string[]).includes(currentUser.data.role)
  const canApprove = currentUser.status === 'success' && (INTELLIGENCE_APPROVE_ROLES as readonly string[]).includes(currentUser.data.role)

  return (
    <AsyncBoundary state={detail} emptyTitle="Version not found">
      {(d) => {
        const modelEval = d.evaluations.find((e) => e.evaluation_type === 'MODEL')
        const baselinePrevalence = d.evaluations.find((e) => e.evaluation_type === 'BASELINE_PREVALENCE')
        const baselineScore = d.evaluations.find((e) => e.evaluation_type === 'BASELINE_OPPORTUNITY_SCORE')
        const latestCalibration = d.calibrations[0]
        return (
          <div className="rounded-md border border-border p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="font-semibold" data-testid="version-number">v{d.data.version}</span>
              <Badge data-testid="version-status">{d.data.status}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div>Sample: {d.data.training_sample_count}</div>
              <div>WON: {d.data.positive_sample_count}</div>
              <div>LOST: {d.data.negative_sample_count}</div>
              <div>
                Test period: {d.data.test_period_start ? new Date(d.data.test_period_start).toLocaleDateString('en-ZA') : 'n/a'}
              </div>
            </div>

            {modelEval && (
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4" data-testid="evaluation-metrics">
                <div>Model AUC: {modelEval.auc?.toFixed(3) ?? 'n/a'} (n={modelEval.sample_size})</div>
                <div>PR-AUC: {modelEval.pr_auc?.toFixed(3) ?? 'n/a'}</div>
                <div>Precision: {modelEval.precision_score?.toFixed(2) ?? 'n/a'}</div>
                <div>Recall: {modelEval.recall_score?.toFixed(2) ?? 'n/a'}</div>
                <div>F1: {modelEval.f1_score?.toFixed(2) ?? 'n/a'}</div>
                <div>Brier: {modelEval.brier_score?.toFixed(3) ?? 'n/a'}</div>
                <div>Baseline (prevalence) AUC: {baselinePrevalence?.auc?.toFixed(3) ?? 'n/a'}</div>
                <div>Baseline (Opportunity Score) AUC: {baselineScore?.auc?.toFixed(3) ?? 'n/a'}</div>
              </div>
            )}

            {latestCalibration && (
              <div className="mt-3 text-xs" data-testid="calibration-metrics">
                Calibration v{latestCalibration.calibration_version}: mean error {latestCalibration.calibration_error?.toFixed(3) ?? 'n/a'}, Brier {latestCalibration.brier_score?.toFixed(3) ?? 'n/a'} (n=
                {latestCalibration.sample_size})
              </div>
            )}

            {canManage && d.data.status === 'EXPERIMENTAL' && (
              <Button size="sm" className="mt-3" disabled={train.isPending} onClick={() => train.mutate({ versionId })}>
                Train
              </Button>
            )}
            {canManage && d.data.status === 'EVALUATED' && (
              <Button size="sm" className="mt-3" disabled={calibrate.isPending} onClick={() => calibrate.mutate({ versionId })}>
                Calibrate
              </Button>
            )}
            {canManage && d.data.status === 'CALIBRATED' && (
              <Button size="sm" className="mt-3" disabled={candidate.isPending} onClick={() => candidate.mutate({ versionId })}>
                Mark as production candidate
              </Button>
            )}
            {canApprove && d.data.status === 'PRODUCTION_CANDIDATE' && (
              <div className="mt-3 space-y-2">
                <Input placeholder="Approval/rejection rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} />
                <div className="flex gap-2">
                  <Button size="sm" disabled={approve.isPending || !rationale} onClick={() => approve.mutate({ versionId, body: { rationale } })}>
                    Approve for production
                  </Button>
                  <Button size="sm" variant="outline" disabled={reject.isPending || !rationale} onClick={() => reject.mutate({ versionId, body: { rationale } })}>
                    Reject
                  </Button>
                </div>
              </div>
            )}
            {canApprove && d.data.status === 'PRODUCTION' && (
              <div className="mt-3 space-y-2">
                <Input placeholder="Retirement reason" value={rationale} onChange={(e) => setRationale(e.target.value)} />
                <Button size="sm" variant="outline" disabled={retire.isPending || !rationale} onClick={() => retire.mutate({ versionId, body: { rationale } })}>
                  Retire model
                </Button>
              </div>
            )}
            {d.data.status === 'RETIRED' && <p className="mt-2 text-xs text-muted-foreground">Retired: {d.data.retirement_reason}</p>}
            {d.data.status === 'FAILED' && <p className="mt-2 text-xs text-destructive">This version did not pass its governance gates and will never be promoted.</p>}
          </div>
        )
      }}
    </AsyncBoundary>
  )
}

function RegistryTab() {
  const models = useIntelligenceModels()
  const createModel = useCreateModel()
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [newModelName, setNewModelName] = useState('')
  const modelDetail = useModelDetail(selectedModelId)
  const createVersion = useCreateVersion()
  const datasets = useIntelligenceDatasets()
  const currentUser = useCurrentUser()
  const canManage = currentUser.status === 'success' && (INTELLIGENCE_MANAGE_ROLES as readonly string[]).includes(currentUser.data.role)
  const latestDatasetId = datasets.status === 'success' && datasets.data.length > 0 ? datasets.data[0]!.id : null

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Models</CardTitle>
        </CardHeader>
        <CardContent>
          {canManage && (
            <div className="mb-4 flex gap-2">
              <Input placeholder="New model name" value={newModelName} onChange={(e) => setNewModelName(e.target.value)} />
              <Button size="sm" disabled={!newModelName || createModel.isPending} onClick={() => createModel.mutate(newModelName, { onSuccess: () => setNewModelName('') })}>
                Create model
              </Button>
            </div>
          )}
          <AsyncBoundary state={models} emptyTitle="No models registered yet" isEmpty={(rows) => rows.length === 0}>
            {(rows) => (
              <div className="flex flex-wrap gap-2">
                {rows.map((m) => (
                  <Button key={m.id} size="sm" variant={selectedModelId === m.id ? 'default' : 'outline'} onClick={() => setSelectedModelId(m.id)}>
                    {m.name}
                  </Button>
                ))}
              </div>
            )}
          </AsyncBoundary>
        </CardContent>
      </Card>

      {selectedModelId && (
        <Card>
          <CardHeader>
            <CardTitle>Versions</CardTitle>
          </CardHeader>
          <CardContent>
            {canManage && latestDatasetId && (
              <Button size="sm" className="mb-4" disabled={createVersion.isPending} onClick={() => createVersion.mutate({ modelId: selectedModelId, datasetId: latestDatasetId })}>
                Create new version from latest dataset
              </Button>
            )}
            <AsyncBoundary state={modelDetail} emptyTitle="No versions yet" isEmpty={(d) => d.versions.length === 0}>
              {(d) => (
                <div className="space-y-3">
                  {d.versions.map((v) => (
                    <VersionCard key={v.id} versionId={v.id} />
                  ))}
                </div>
              )}
            </AsyncBoundary>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function PredictionTab() {
  const [bidProjectId, setBidProjectId] = useState('')
  const [modelRegistryId, setModelRegistryId] = useState('')
  const requestPrediction = useRequestPrediction()
  const models = useIntelligenceModels()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Request a prediction</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          This is decision support, not a procurement decision. The human remains responsible for Bid/No-Bid and submission decisions.
        </p>
        <div className="mb-4 flex flex-wrap gap-2">
          <Input placeholder="Bid project ID" value={bidProjectId} onChange={(e) => setBidProjectId(e.target.value)} className="w-72" />
          <AsyncBoundary state={models} emptyTitle="No models" isEmpty={(rows) => rows.length === 0}>
            {(rows) => (
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={modelRegistryId}
                onChange={(e) => setModelRegistryId(e.target.value)}
              >
                <option value="">Select a model</option>
                {rows.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </AsyncBoundary>
          <Button
            disabled={!bidProjectId || !modelRegistryId || requestPrediction.isPending}
            onClick={() => requestPrediction.mutate({ bidProjectId, modelRegistryId })}
          >
            Get prediction
          </Button>
        </div>

        {requestPrediction.isError && (
          <p className="text-sm text-destructive" data-testid="prediction-error">
            {requestPrediction.error instanceof Error ? requestPrediction.error.message : 'Failed to request a prediction.'}
          </p>
        )}

        {requestPrediction.data && (
          <div className="rounded-md border border-border p-4" data-testid="prediction-result">
            {requestPrediction.data.abstained ? (
              <div>
                <Badge variant="warning">PREDICTION ABSTAINED</Badge>
                <p className="mt-2 text-sm">Reason: {requestPrediction.data.reason}</p>
                <p className="mt-1 text-xs text-muted-foreground">{typeof requestPrediction.data.explanation === 'string' ? requestPrediction.data.explanation : ''}</p>
              </div>
            ) : (
              <div>
                <div className="text-2xl font-semibold" data-testid="predicted-probability">
                  {requestPrediction.data.data.predicted_probability !== null ? `${Math.round(requestPrediction.data.data.predicted_probability * 100)}%` : 'UNKNOWN'}
                </div>
                <p className="text-xs text-muted-foreground">Model version: {requestPrediction.data.data.model_version_label} · predicted {new Date(requestPrediction.data.data.prediction_timestamp).toLocaleString('en-ZA')}</p>
                {typeof requestPrediction.data.explanation === 'object' && requestPrediction.data.explanation && (
                  <p className="mt-2 text-sm" data-testid="prediction-explanation">
                    {requestPrediction.data.explanation.explanation_text}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function LearningTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Historical Learning</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Full historical win/loss analytics, the outcome funnel, win rate by category, and learning readiness live on the existing{' '}
          <Link to={ROUTES.outcomes} className="underline">
            Outcomes dashboard
          </Link>{' '}
          (Phase 17) — not duplicated here.
        </p>
      </CardContent>
    </Card>
  )
}

export function Intelligence() {
  const [tab, setTab] = useState('readiness')
  return (
    <div>
      <PageHeader
        title="Predictive Intelligence"
        description="Data readiness, score calibration, model governance and decision-support predictions — every number shown with its sample size, and a numerical prediction is refused whenever the evidence is insufficient (Phase 18)."
      />
      <Tabs items={TABS} value={tab} onChange={setTab}>
        <TabPanel value="readiness" activeValue={tab}>
          <ReadinessTab />
        </TabPanel>
        <TabPanel value="score-calibration" activeValue={tab}>
          <ScoreCalibrationTab />
        </TabPanel>
        <TabPanel value="registry" activeValue={tab}>
          <RegistryTab />
        </TabPanel>
        <TabPanel value="prediction" activeValue={tab}>
          <PredictionTab />
        </TabPanel>
        <TabPanel value="learning" activeValue={tab}>
          <LearningTab />
        </TabPanel>
      </Tabs>
    </div>
  )
}
