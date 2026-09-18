import type { DocumentReference, TenderDetails } from '../types.js'
import { toDocumentReferences } from './documents.js'
import { normaliseDetailPage } from './normalise.js'
import type { EtendersTransport } from './types.js'

/**
 * Fetches and maps one opportunity's detail page into the generic
 * adapter contract's `TenderDetails` shape (Phase 5 §3/§4). The
 * caller supplies the listing-derived `detailUrl` since eTenders'
 * detail pages are addressed by URL, not solely by `externalId`.
 */
export async function fetchEtendersDetails(
  transport: EtendersTransport,
  externalId: string,
  detailUrl: string,
): Promise<TenderDetails> {
  const raw = await transport.fetchDetailPage(detailUrl, externalId)
  const normalised = normaliseDetailPage(raw)
  const documents: DocumentReference[] = toDocumentReferences(raw.documents)

  return {
    externalId,
    title: normalised.title ?? '(no title provided by source)',
    url: raw.detailUrl,
    publishedDate: normalised.publishedDate ?? undefined,
    closingDate: normalised.closingDate ?? undefined,
    organisation: normalised.organisation ?? undefined,
    description: normalised.description ?? undefined,
    documents,
  }
}
