/**
 * EasyTenders-specific types, private to this adapter directory (same
 * boundary rule as adapters/etenders/types.ts — nothing outside
 * `adapters/easytenders/` should import these; the rest of the system
 * only ever sees the generic `TenderSourceAdapter` contract).
 *
 * Investigated directly against the live public site
 * (https://easytenders.co.za) before writing this adapter: the
 * `/tenders` listing is plain server-rendered HTML with real `<a>`
 * links to per-tender detail pages (no hidden JSON endpoint needed,
 * unlike eTenders) — e.g.
 * `/tenders/gt-gdsacr-035-2026-gauteng-pre-qualified-panel`. The detail
 * page carries the full reference number, organisation, category,
 * province, advertised/closing dates, and a direct document link.
 */

/** One row as it appears on the public `/tenders` listing page. */
export interface RawListingRow {
  /** The tender's unique URL slug (from its detail-page href) — the only stable identifier the listing itself exposes; there is no separate numeric id in the rendered HTML. */
  slug: string | null
  detailUrl: string | null
  organisation: string | null
  /** The listing's short description text — often truncated; the detail page's own description (when present) is preferred once fetched. */
  description: string | null
  closingDateText: string | null
}

/** A document link as it appears on a tender's detail page. */
export interface RawDocumentLink {
  url: string | null
  label: string | null
}

/** The full detail-page content for one opportunity. */
export interface RawDetailPage {
  slug: string
  detailUrl: string
  title: string | null
  tenderNumber: string | null
  organisation: string | null
  category: string | null
  province: string | null
  description: string | null
  advertisedText: string | null
  closingDateText: string | null
  briefingText: string | null
  documents: RawDocumentLink[]
}

/** Discovery scope accepted by the transport — mirrors the eTenders adapter's conservative, paginated design (Phase 5 §5's pattern, applied here). */
export interface EasyTendersDiscoveryParams {
  /** 1-based page number, matching the site's own `?page=N` query param. */
  page: number
}

export interface EasyTendersTransport {
  fetchListingPage(params: EasyTendersDiscoveryParams): Promise<RawListingRow[]>
  fetchDetailPage(detailUrl: string, slug: string): Promise<RawDetailPage>
  checkReachable(): Promise<{ reachable: boolean; message: string }>
}
