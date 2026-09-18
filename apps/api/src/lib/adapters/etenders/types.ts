/**
 * eTenders-specific types (Phase 5 §3). Kept private to this adapter
 * directory — nothing outside `adapters/etenders/` should import
 * these; the rest of the system only ever sees the generic
 * `TenderSourceAdapter` contract (`../types.ts`).
 */

/**
 * One row as it appears on the public eTenders opportunities listing
 * table (https://www.etenders.gov.za/Home/opportunities), using the
 * column headers actually observed on the live page (see
 * docs/SCRAPING-ARCHITECTURE.md): Category, Tender Description,
 * eSubmission, Advertised, Closing Date. This is the raw, untouched
 * text a DOM scrape would read from each `<td>` — normalisation
 * (parsers/dates.ts, normalise.ts) happens strictly downstream of
 * this shape, never inside the transport.
 */
export interface RawListingRow {
  /** The site's own row/record identifier, when it exposes one (e.g. an id embedded in the detail link) — null when it must be derived from the detail URL instead. */
  externalId: string | null
  /** The detail-page URL for this opportunity, relative or absolute. */
  detailUrl: string | null
  category: string | null
  /** The "Tender Description" column — this is a free-text description, not always a clean title; normalise.ts derives a display title from it. */
  description: string | null
  /** The "eSubmission" column — typically "Yes"/"No"/blank; never assumed one way when blank. */
  eSubmission: string | null
  /** The "Advertised" column, source's own date text, unparsed. */
  advertisedText: string | null
  /** The "Closing Date" column, source's own date text, unparsed. */
  closingDateText: string | null
  /** Organisation / "Organ of State", when the listing view (or an applied filter's context) exposes it directly. */
  organisation: string | null
  /** The source's own tender/reference number, when the listing view exposes it directly. */
  tenderNumber: string | null
  province: string | null
  tenderType: string | null
}

/** A document link as it appears on an opportunity's detail page. */
export interface RawDocumentLink {
  url: string | null
  label: string | null
}

/** The full detail-page content for one opportunity. */
export interface RawDetailPage {
  externalId: string
  detailUrl: string
  title: string | null
  description: string | null
  organisation: string | null
  tenderNumber: string | null
  advertisedText: string | null
  closingDateText: string | null
  closingTimeText: string | null
  province: string | null
  briefingText: string | null
  documents: RawDocumentLink[]
}

/** Discovery scope/filters accepted by the transport — Phase 5 §5: controlled, conservative discovery only. */
export interface EtendersDiscoveryParams {
  /** 1-based page number. */
  page: number
  pageSize: number
  /** Restrict to currently open/advertised opportunities — the conservative default (Phase 5 §5). */
  statusFilter: 'OPEN' | 'ALL'
  /** Optional ISO date lower bound on "Advertised" — omitted means "no lower bound beyond the status filter itself". */
  advertisedFrom?: string
}

/**
 * The transport boundary this adapter is built against (Phase 5's
 * live-access finding, docs/SCRAPING-ARCHITECTURE.md §12): everything
 * above this interface (discover.ts, details.ts, documents.ts,
 * health.ts, normalise.ts, dedupe.ts) is pure and unit-testable
 * without a browser or network access. Exactly one implementation is
 * "real" (transport/playwrightTransport.ts, headless Chromium against
 * the live public site); a second (transport/fixtureTransport.ts)
 * replays captured/constructed fixture data for every test and for
 * the documented dev fixture-import path.
 */
export interface EtendersTransport {
  fetchListingPage(params: EtendersDiscoveryParams): Promise<RawListingRow[]>
  fetchDetailPage(detailUrl: string, externalId: string): Promise<RawDetailPage>
  /** Cheap reachability probe only — must never perform a full discovery pass (Phase 5 §20). */
  checkReachable(): Promise<{ reachable: boolean; message: string }>
}
