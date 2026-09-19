/**
 * TenderBulletins-specific types, private to this adapter directory.
 *
 * Investigated directly against the live public site
 * (https://www.tenderbulletin.co.za) before writing this adapter: its
 * `/search` page shows a real list of tenders (source's own tender
 * id, organisation, title, closing date) with NO public per-tender
 * detail page — "Save tender" and anything past the summary sits
 * behind `/login` / `/register`. This adapter therefore deliberately
 * implements DISCOVERY ONLY. It never attempts to log in or otherwise
 * get past that wall (this project never automates past
 * authentication it wasn't explicitly given), so `fetchDetails` and
 * `fetchDocuments` are honest, limited implementations — see
 * adapter.ts's own comments.
 */

/** One row as it appears on the public `/search` listing. */
export interface RawListingRow {
  /** The source's own tender id, as displayed in the listing (e.g. "E2232GXMPTUT") — the only identifier this source exposes publicly. */
  tenderId: string | null
  organisation: string | null
  description: string | null
  closingDateText: string | null
}

export interface TenderBulletinsTransport {
  /** No pagination parameter yet — this adapter's first live run should confirm whether /search paginates and how, before this is extended (documented gap, not a silent limitation). */
  fetchListingPage(): Promise<RawListingRow[]>
  checkReachable(): Promise<{ reachable: boolean; message: string }>
}
