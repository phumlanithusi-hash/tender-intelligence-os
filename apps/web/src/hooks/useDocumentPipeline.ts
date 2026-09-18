import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  TenderDocumentRow,
  TenderDocumentVersionRow,
  TenderDocumentProcessingRow,
  TenderDocumentPageRow,
  TenderDocumentSectionRow,
  TenderDocumentChunkRow,
} from '@tender-os/schemas'
import { apiFetch } from '../lib/apiClient.js'
import { toAsyncState } from '../lib/asyncState.js'

export interface DocumentDetailResponse {
  document: TenderDocumentRow
  versions: TenderDocumentVersionRow[]
  currentVersion: TenderDocumentVersionRow | null
  processing: TenderDocumentProcessingRow | null
}

/** The Phase 6 evidence pipeline's per-document detail — versions, current processing state (Phase 6 §26). */
export function useTenderDocumentDetail(tenderId: string | undefined, documentId: string | undefined, enabled = true) {
  const query = useQuery({
    queryKey: ['tenders', tenderId, 'documents', documentId, 'detail'],
    queryFn: () => apiFetch<DocumentDetailResponse>(`/api/tenders/${tenderId}/documents/${documentId}`),
    enabled: Boolean(tenderId) && Boolean(documentId) && enabled,
    staleTime: 10_000,
  })
  return toAsyncState(query)
}

export function useTenderDocumentPages(tenderId: string | undefined, documentId: string | undefined, enabled: boolean) {
  const query = useQuery({
    queryKey: ['tenders', tenderId, 'documents', documentId, 'pages'],
    queryFn: () => apiFetch<TenderDocumentPageRow[]>(`/api/tenders/${tenderId}/documents/${documentId}/pages`),
    enabled: Boolean(tenderId) && Boolean(documentId) && enabled,
    staleTime: 30_000,
  })
  return toAsyncState(query)
}

export function useTenderDocumentSections(tenderId: string | undefined, documentId: string | undefined, enabled: boolean) {
  const query = useQuery({
    queryKey: ['tenders', tenderId, 'documents', documentId, 'sections'],
    queryFn: () => apiFetch<TenderDocumentSectionRow[]>(`/api/tenders/${tenderId}/documents/${documentId}/sections`),
    enabled: Boolean(tenderId) && Boolean(documentId) && enabled,
    staleTime: 30_000,
  })
  return toAsyncState(query)
}

export function useTenderDocumentChunks(tenderId: string | undefined, documentId: string | undefined, enabled: boolean) {
  const query = useQuery({
    queryKey: ['tenders', tenderId, 'documents', documentId, 'chunks'],
    queryFn: () => apiFetch<TenderDocumentChunkRow[]>(`/api/tenders/${tenderId}/documents/${documentId}/chunks`),
    enabled: Boolean(tenderId) && Boolean(documentId) && enabled,
    staleTime: 30_000,
  })
  return toAsyncState(query)
}

/** Triggers the DOWNLOAD -> VALIDATE -> ... pipeline for a document (Phase 6 §25/§26) — gated server-side by role regardless of what the UI shows. */
export function useDownloadDocument(tenderId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (documentId: string) =>
      apiFetch<{ state: string }>(`/api/tenders/${tenderId}/documents/${documentId}/download`, { method: 'POST' }),
    onSuccess: (_data, documentId) => {
      void queryClient.invalidateQueries({ queryKey: ['tenders', tenderId, 'documents', documentId] })
      void queryClient.invalidateQueries({ queryKey: ['tenders', tenderId, 'documents'] })
    },
  })
}

/** Triggers reprocessing of a document's current stored version (Phase 6 §20). */
export function useReprocessDocument(tenderId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (documentId: string) =>
      apiFetch<{ state: string }>(`/api/tenders/${tenderId}/documents/${documentId}/reprocess`, { method: 'POST' }),
    onSuccess: (_data, documentId) => {
      void queryClient.invalidateQueries({ queryKey: ['tenders', tenderId, 'documents', documentId] })
      void queryClient.invalidateQueries({ queryKey: ['tenders', tenderId, 'documents'] })
    },
  })
}
