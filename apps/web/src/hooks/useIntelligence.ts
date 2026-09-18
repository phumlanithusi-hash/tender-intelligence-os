import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AsyncState } from '@tender-os/types'
import { apiFetch } from '../lib/apiClient.js'
import { toAsyncState } from '../lib/asyncState.js'

/**
 * Phase 18 §28/§29 — read/write hooks over the predictive-intelligence
 * API. Every aggregation happens server-side (spec §41) — these hooks
 * only render whatever the server computed.
 */

export interface DatasetReadiness {
  totalCandidateRecords: number
  verifiedLabelledRecords: number
  positiveCount: number
  negativeCount: number
  classBalance: number | null
  featureCompleteness: number
  temporalCoverageStart: string | null
  temporalCoverageEnd: string | null
  duplicateRate: number
  leakageCheckPassed: boolean
  leakageFindings: string[]
  eligibilityState: string
  eligibilityReasons: string[]
}

export function useIntelligenceReadiness(): AsyncState<DatasetReadiness> {
  const query = useQuery({
    queryKey: ['intelligence', 'readiness'],
    queryFn: async () => (await apiFetch<{ data: DatasetReadiness }>('/api/intelligence/readiness')).data,
    staleTime: 15_000,
  })
  return toAsyncState(query)
}

/** Raw DB row shape (snake_case) as returned by GET /api/intelligence/datasets — distinct from the camelCase DatasetReadiness the live /readiness endpoint returns. */
export interface ModelDataset {
  id: string
  dataset_version: number
  total_candidate_records: number
  verified_labelled_records: number
  positive_count: number
  negative_count: number
  eligibility_state: string
  is_test_fixture: boolean
  generated_at: string
}

export function useIntelligenceDatasets(): AsyncState<ModelDataset[]> {
  const query = useQuery({
    queryKey: ['intelligence', 'datasets'],
    queryFn: async () => (await apiFetch<{ data: ModelDataset[] }>('/api/intelligence/datasets')).data,
    staleTime: 15_000,
  })
  return toAsyncState(query)
}

export function useCreateDataset() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (isTestFixture: boolean) => (await apiFetch('/api/intelligence/datasets', { method: 'POST', body: JSON.stringify({ isTestFixture }) })) as { data: ModelDataset },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['intelligence', 'datasets'] })
    },
  })
}

export interface ModelRegistryRow {
  id: string
  name: string
  description: string | null
  created_at: string
}

export function useIntelligenceModels(): AsyncState<ModelRegistryRow[]> {
  const query = useQuery({
    queryKey: ['intelligence', 'models'],
    queryFn: async () => (await apiFetch<{ data: ModelRegistryRow[] }>('/api/intelligence/models')).data,
    staleTime: 15_000,
  })
  return toAsyncState(query)
}

export function useCreateModel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => (await apiFetch('/api/intelligence/models', { method: 'POST', body: JSON.stringify({ name }) })) as { data: ModelRegistryRow },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['intelligence', 'models'] })
    },
  })
}

export interface ModelVersionRow {
  id: string
  version: number
  model_type: string
  status: string
  dataset_id: string
  training_sample_count: number
  positive_sample_count: number
  negative_sample_count: number
  training_period_start: string | null
  training_period_end: string | null
  test_period_start: string | null
  test_period_end: string | null
  retirement_reason: string | null
}

export function useModelDetail(modelId: string | null): AsyncState<{ data: ModelRegistryRow; versions: ModelVersionRow[] }> {
  const query = useQuery({
    queryKey: ['intelligence', 'model', modelId],
    queryFn: async () => await apiFetch<{ data: ModelRegistryRow; versions: ModelVersionRow[] }>(`/api/intelligence/models/${modelId}`),
    enabled: !!modelId,
    staleTime: 5_000,
  })
  return toAsyncState(query)
}

export interface EvaluationRow {
  id: string
  evaluation_type: string
  sample_size: number
  auc: number | null
  pr_auc: number | null
  precision_score: number | null
  recall_score: number | null
  f1_score: number | null
  brier_score: number | null
  log_loss_score: number | null
}
export interface CalibrationRow {
  id: string
  calibration_version: number
  method: string
  calibration_error: number | null
  brier_score: number | null
  sample_size: number
  buckets: Array<{ bucketIndex: number; predictedRangeLow: number; predictedRangeHigh: number; meanPredicted: number | null; observedFrequency: number | null; sampleSize: number; insufficientSample: boolean }>
}

export function useVersionDetail(versionId: string | null) {
  const query = useQuery({
    queryKey: ['intelligence', 'version', versionId],
    queryFn: async () =>
      await apiFetch<{ data: ModelVersionRow; evaluations: EvaluationRow[]; calibrations: CalibrationRow[]; card: unknown; promotions: unknown[]; trainingRuns: unknown[] }>(`/api/intelligence/versions/${versionId}`),
    enabled: !!versionId,
    staleTime: 5_000,
  })
  return toAsyncState(query)
}

function useVersionAction(action: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ versionId, body }: { versionId: string; body?: Record<string, unknown> }) =>
      await apiFetch(`/api/intelligence/versions/${versionId}/${action}`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['intelligence', 'version', variables.versionId] })
      void queryClient.invalidateQueries({ queryKey: ['intelligence', 'models'] })
    },
  })
}

export function useTrainVersion() {
  return useVersionAction('train')
}
export function useCalibrateVersion() {
  return useVersionAction('calibrate')
}
export function useCandidateVersion() {
  return useVersionAction('candidate')
}
export function useApproveVersion() {
  return useVersionAction('approve')
}
export function useRejectVersion() {
  return useVersionAction('reject')
}
export function useRetireVersion() {
  return useVersionAction('retire')
}

export function useCreateVersion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ modelId, datasetId }: { modelId: string; datasetId: string }) =>
      await apiFetch<{ data: ModelVersionRow }>(`/api/intelligence/models/${modelId}/versions`, { method: 'POST', body: JSON.stringify({ datasetId }) }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['intelligence', 'model', variables.modelId] })
    },
  })
}

export interface PredictionResult {
  id: string
  predicted_probability: number | null
  abstained: boolean
  model_version_label: string | null
  prediction_timestamp: string
}
export interface PredictionExplanation {
  explanation_text: string
  top_positive_features: Array<{ feature: string; contribution: number }>
  top_negative_features: Array<{ feature: string; contribution: number }>
  missing_features: string[]
}

export function useRequestPrediction() {
  return useMutation({
    mutationFn: async ({ bidProjectId, modelRegistryId }: { bidProjectId: string; modelRegistryId: string }) =>
      await apiFetch<{ data: PredictionResult; abstained: boolean; reason?: string; explanation?: PredictionExplanation | string }>('/api/intelligence/predictions', {
        method: 'POST',
        body: JSON.stringify({ bidProjectId, modelRegistryId }),
      }),
  })
}

export function usePredictionHistory(bidProjectId: string | null) {
  const query = useQuery({
    queryKey: ['intelligence', 'predictions', bidProjectId],
    queryFn: async () => await apiFetch<{ data: PredictionResult[]; explanations: PredictionExplanation[] }>(`/api/intelligence/predictions/${bidProjectId}`),
    enabled: !!bidProjectId,
  })
  return toAsyncState(query)
}

export interface ScoreBandRow {
  band: string
  sampleSize: number
  verifiedOutcomeCount: number
  observedWinRate: number | null
  completeness: number | null
  caveat: string | null
}
export function useScoreCalibration(): AsyncState<ScoreBandRow[]> {
  const query = useQuery({
    queryKey: ['intelligence', 'score-calibration'],
    queryFn: async () => (await apiFetch<{ data: ScoreBandRow[] }>('/api/intelligence/score-calibration')).data,
    staleTime: 30_000,
  })
  return toAsyncState(query)
}

export interface SegmentRow {
  segmentKey: string
  sampleSize: number
  verifiedOutcomes: number
  missingOutcomes: number
  observedWinRate: number | null
  caveat: string | null
  insufficientSample: boolean
}
export function useIntelligenceSegments(): AsyncState<SegmentRow[]> {
  const query = useQuery({
    queryKey: ['intelligence', 'segments'],
    queryFn: async () => (await apiFetch<{ data: SegmentRow[] }>('/api/intelligence/segments')).data,
    staleTime: 30_000,
  })
  return toAsyncState(query)
}
