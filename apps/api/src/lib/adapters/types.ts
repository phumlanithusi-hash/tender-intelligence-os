/**
 * The source adapter contract (Phase 4 §2, master specification).
 * This is the ONLY boundary through which a source-specific
 * implementation (Phase 5+: eTenders, and later others) is allowed to
 * touch the rest of the system — generic tender services never
 * branch on which source they're talking to (Phase 4 §2: "Do not
 * hard-code source-specific logic into generic tender services").
 *
 * No adapter is implemented against this interface yet in Phase 4 —
 * see adapters/registry.ts and adapters/index.ts. Phase 4 is
 * infrastructure only (Phase 4 §1: "The Source Registry is
 * infrastructure, not the scraper itself"; §25: no live scraping).
 */

/** A tender found during a source's discovery pass — the minimal identity of an opportunity, not its full detail. */
export interface TenderDiscovery {
  /** The identifier the SOURCE uses for this opportunity (not this system's internal tender id). */
  externalId: string
  title: string
  url: string
  publishedDate?: string
  closingDate?: string
  /**
   * Phase 5 §4/§9 addition (additive, optional — never required by a
   * Phase 4 adapter): the issuing organisation as the source states
   * it, when the listing view exposes one. Organisation is one of the
   * primary deduplication signals (Phase 5 §9), so an adapter that
   * can determine it during discovery should populate it here rather
   * than forcing every caller to fetch full details just to dedupe.
   */
  organisation?: string
  /** Phase 5 §4 addition: the source's own tender/reference number, when the listing exposes one — distinct from `externalId` (the source's internal record id, which may not be the human-facing tender number). */
  tenderNumber?: string
  /**
   * Phase 5 §6 addition: the untouched source metadata for this
   * listing row (raw field values, retrieval timestamp inputs, a
   * content hash the adapter computed) — preserved verbatim so
   * normalisation is never the only surviving copy of what the
   * source actually said (Phase 5 §6/§28).
   */
  rawMetadata?: Record<string, unknown>
}

/** The fuller record for one discovered tender, fetched on demand rather than during the discovery pass. */
export interface TenderDetails extends TenderDiscovery {
  organisation?: string
  description?: string
  documents: DocumentReference[]
}

/** A reference to a document available from the source — not the downloaded file itself (Phase 4 §25: no document downloading yet). */
export interface DocumentReference {
  url: string
  filename: string
  mimeType?: string
}

/**
 * The result of asking an adapter whether its source is currently
 * reachable and operational (Phase 4 §20). This is explicitly NOT a
 * scrape — an adapter's `healthCheck()` should be cheap (a single
 * request, or none at all) and must never itself call `discover()`.
 */
export interface AdapterHealthCheckResult {
  status: 'HEALTHY' | 'WARNING' | 'FAILED'
  message: string
  checkedAt: string
}

export interface TenderSourceAdapter {
  /** Must match a `tender_sources.adapter_key` value exactly — this is how the registry and a source row are connected. */
  readonly key: string
  readonly version: string

  discover(): Promise<TenderDiscovery[]>
  fetchDetails(externalId: string): Promise<TenderDetails>
  fetchDocuments(externalId: string): Promise<DocumentReference[]>
  healthCheck(): Promise<AdapterHealthCheckResult>
}
