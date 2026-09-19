/**
 * City of Johannesburg-specific types, private to this adapter
 * directory (same boundary rule as every other adapter's types.ts).
 *
 * Investigated directly against the live public site
 * (https://www.joburg.org.za) — a multi-round live diagnostic was
 * needed since the tenders section is several navigation layers deep
 * on this site's old SharePoint-style structure and several
 * candidate pages turned out to be stale hubs, not the real listing:
 *
 *   /Pages/procurement.aspx                                  (generic placeholder text, not a listing)
 *   .../Tenders-and-Quotations.aspx                          (a static hub of category links + a few stale PDFs)
 *   .../2022 TENDERS/Tenders.aspx                             (another hub: Bid Opening Registers / Current Bid
 *                                                              Proposals / Closed Bid Proposals / Canceled Bid Proposals)
 *   .../2026-Tenders/2026-Bid-Proposals.aspx                  (the REAL current listing — confirmed live, real
 *                                                              2026-dated opportunities)
 *
 * The real listing is a single HTML `<table>` with one header row and
 * one row per open bid proposal, 3 columns: reference/documents,
 * description, closing date. Confirmed via real row HTML (including a
 * multi-document row) that a cell's FIRST `<a>` is always the
 * tender's own reference number (e.g. "COJ/JTC02/26-27"), and any
 * further `<a>` tags in the same cell are additional documents for
 * that same tender (Proof of Advert, Addendum, Extension Notice,
 * Annexure, etc.) — never a separate tender.
 *
 * Unlike eTenders/EasyTenders, there is no separate per-tender detail
 * page: the listing table itself already carries the full record
 * (reference, description, closing date, every document link), so
 * this adapter's `discover()` is also its `fetchDetails`/
 * `fetchDocuments` source — no second page load per tender needed.
 *
 * The listing's own URL is year-specific
 * (`/2026-Tenders/2026-Bid-Proposals.aspx`) — the site appears to
 * publish a fresh page each calendar year rather than keeping one
 * stable "current tenders" URL. This adapter will need its
 * `baseListingUrl` updated (and re-validated the same way) when the
 * City moves to a `2027-Tenders` page.
 */

/** One row as it appears on the real live listing table. */
export interface RawBidProposalRow {
  /** The tender's own reference number, taken verbatim from the first document link's text (e.g. "COJ/JTC02/26-27") — the only stable identity this listing exposes. */
  referenceNumber: string | null
  description: string | null
  closingDateText: string | null
  documents: RawDocumentLink[]
}

export interface RawDocumentLink {
  url: string | null
  label: string | null
}

export interface JoburgTransport {
  fetchBidProposalsPage(): Promise<RawBidProposalRow[]>
  checkReachable(): Promise<{ reachable: boolean; message: string }>
}
