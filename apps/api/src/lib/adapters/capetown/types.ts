/**
 * City of Cape Town-specific types, private to this adapter directory
 * (same boundary rule as every other adapter's types.ts).
 *
 * Investigated directly against the live public "Procurement
 * Administration Portal" (https://web1.capetown.gov.za/web1/TenderPortal)
 * across several rounds — the real listing is at
 * `/web1/tenderportal/Tender`, a classic ASP.NET MVC page rendering a
 * legacy jQuery DataTable with NO server-side/ajax config at all
 * (confirmed from its own init script: no `bServerSide`/`sAjaxSource`).
 * That means ALL tenders load with the initial page HTML and
 * DataTables draws only 15 rows into the DOM at a time — clicking
 * "Next" changes the visible rows with ZERO additional network
 * requests (confirmed directly: captured requests before/after a
 * click were identical). So discovering every tender requires
 * clicking through every page within ONE browser session, not
 * separate page-numbered navigations like every other paginated
 * adapter in this codebase.
 *
 * Real row shape (9 `<td>` per row): tender number, description (the
 * visible text is truncated with "..." — the FULL text is in the
 * `<pre>`'s own `title` attribute), directorate, department, closing
 * date, posted date, then a "Details" link
 * (`/web1/tenderportal/Tender/Details/{numericId}`) plus two
 * apparently-admin action links ("Add Notice", "Delete Tender") that
 * are present in the DOM for anonymous visitors too (client-side-only
 * visibility control, not something this adapter interacts with).
 *
 * The listing page itself states: "In order to access additional
 * detail, suppliers are required to register and log in." — so, like
 * the TenderBulletins adapter, this is discovery-only by design: no
 * document links are exposed to an anonymous visitor, and this
 * adapter never navigates past that login wall (see that adapter's
 * types.ts for the same reasoning). `fetchDocuments` always returns
 * `[]`.
 */

export interface RawTenderRow {
  /** The numeric id from the row's own "Details" link — more stable than the tender-number text alone, though that text is also expected to be unique. */
  externalId: string | null
  tenderNumber: string | null
  /** The FULL description, taken from the `<pre>` cell's `title` attribute (the visible text is truncated with "..."). */
  description: string | null
  directorate: string | null
  department: string | null
  closingDateText: string | null
  postedDateText: string | null
}

export interface CapeTownTransport {
  /** Returns EVERY tender across every page — pagination happens inside this one call/browser session (see module comment for why). */
  fetchAllTenders(): Promise<RawTenderRow[]>
  checkReachable(): Promise<{ reachable: boolean; message: string }>
}
