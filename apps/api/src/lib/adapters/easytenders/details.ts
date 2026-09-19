import type { DocumentReference, TenderDetails } from '../types.js'
import { toDocumentReferences } from './documents.js'
import { normaliseDetailPage } from './normalise.js'
import type { EasyTendersTransport } from './types.js'

export async function fetchEasyTendersDetails(
  transport: EasyTendersTransport,
  slug: string,
  detailUrl: string,
): Promise<TenderDetails> {
  const raw = await transport.fetchDetailPage(detailUrl, slug)
  const normalised = normaliseDetailPage(raw)
  const documents: DocumentReference[] = toDocumentReferences(raw.documents)

  return {
    externalId: slug,
    title: normalised.title ?? '(no title provided by source)',
    url: raw.detailUrl,
    publishedDate: normalised.publishedDate ?? undefined,
    closingDate: normalised.closingDate ?? undefined,
    organisation: normalised.organisation ?? undefined,
    tenderNumber: normalised.tenderNumber ?? undefined,
    description: normalised.description ?? undefined,
    documents,
  }
}
