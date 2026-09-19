/**
 * TenderBulletins-specific types, private to this adapter directory.
 *
 * Investigated directly against the live public site
 * (https://www.tenderbulletin.co.za) before writing this adapter: its
 * `/search` page shows a real list of tenders (source's own tender
 * ref, title, closing date, a compact "issuer · region · category"
 * meta line) with NO public per-tender detail page — "Save tender"
 * and anything past the summary sits behind `/login` / `/register`.
 * This adapter therefore deliberately implements DISCOVERY ONLY. It
 * never attempts to log in or otherwise get past that wall (this
 * project never automates past authentication it wasn't explicitly
 * given), so `fetchDetails` and `fetchDocuments` are honest, limited
 * implementations — see adapter.ts's own comments.
 */

/** One row as it appears on the public `/search` listing. */
export interface RawListingRow {
  /**
   * The source's own reference text, taken verbatim from its
   * `.tb-tender-ref` element — the only identifier this source
   * exposes publicly. Confirmed directly (a live diagnostic run) that
   * this field is NOT always a clean alphanumeric code: some rows
   * show it glued to a status word with no separating space (e.g.
   * "E2232GXMPTUTPublish") and at least one row shows free text
   * instead of a code at all ("Smart Meter Supplier Engagement
   * Forum- documents"). This adapter takes the field's value exactly
   * as the source displays it rather than trying to parse a "real"
   * id out of it — inventing a cleanup rule here would be a guess
   * about the source's own data, which this project does not do.
   */
  tenderId: string | null
  /** The first "·"-separated segment of the card's meta line (e.g. "Eskom Tender Bulletin") — the source's own literal text, not a parsed-out organisation name (see normalise.ts for why the remaining segments aren't used). */
  organisation: string | null
  description: string | null
  /** From `.tb-tender-closing__date` — the source already renders this as an ISO date (e.g. "2031-12-31"), not free text. */
  closingDateText: string | null
}

export interface TenderBulletinsTransport {
  /** No pagination parameter yet — this adapter's first live run should confirm whether /search paginates and how, before this is extended (documented gap, not a silent limitation). */
  fetchListingPage(): Promise<RawListingRow[]>
  checkReachable(): Promise<{ reachable: boolean; message: string }>
}
