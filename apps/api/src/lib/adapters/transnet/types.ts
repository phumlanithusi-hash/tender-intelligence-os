/**
 * Transnet-specific types, private to this adapter directory (same
 * boundary rule as every other adapter's types.ts).
 *
 * Investigated directly against the live public site across several
 * rounds. transnet.net's own "Transnet Tenders" page
 * (https://www.transnet.net/TransnetTenders) does NOT itself list
 * tenders — it points to a separate real tender system, the "Transnet
 * eTender" app hosted at
 * https://transnetetenders.azurewebsites.net/Home/AdvertisedTenders.
 * That page renders a DataTable that is populated client-side from
 * two real, public, unauthenticated JSON endpoints (confirmed live,
 * both returning `{ success: true, result: [...] }`):
 *
 *   GET  /Home/GetAdvertisedTenders            -> the "Open Tenders" tab (currently-open opportunities)
 *   POST /Home/GetOtherAdvertisedTendersCached -> the "Other Tenders" tab
 *
 * Both return the same row shape, but a live check (a full pull of
 * both endpoints, September 2026) showed they are NOT two slices of
 * the same "current tenders" list: `GetAdvertisedTenders` returned 57
 * rows, all `tenderStatus: "Open"`, all closing in 2026/2027.
 * `GetOtherAdvertisedTendersCached` returned 18,083 rows spanning
 * back to 2022, with EVERY row already "Cancelled", "Closed", or
 * "Awarded" — none "Open". That endpoint is Transnet's own historical
 * tender archive, not a second feed of live opportunities, so this
 * adapter deliberately does not call it — only `GetAdvertisedTenders`
 * is fetched. This is not a status-filter guess about ambiguous data;
 * it is treating an entire endpoint the source itself separates out
 * ("cached" historical results) as out of scope for a tender
 * intelligence system meant to surface things you can actually bid
 * on. `rowKey` is the source's own stable numeric id (used as
 * `externalId`, since `tenderNumber` is free text); the `attachment`
 * field is a single document-bundle URL per tender (same "one
 * server-generated bundle" shape as the Eskom adapter) — no
 * per-document listing exists.
 *
 * Date fields (`briefingDate`, `closingDate`, `publishedDate`) are
 * US-style `M/D/YYYY h:mm:ss AM/PM` text (e.g. "9/29/2026 10:00:00
 * AM") — parsed explicitly in parsers/dates.ts, never via
 * locale-dependent `Date.parse`.
 */

export interface RawTransnetTender {
  nameOfTender: string | null
  descriptionOfTender: string | null
  tenderNumber: string | null
  briefingDate: string | null
  briefingDetails: string | null
  closingDate: string | null
  contactPersonEmailAddress: string | null
  contactPersonName: string | null
  publishedDate: string | null
  attachment: string | null
  tenderType: string | null
  locationOfService: string | null
  nameOfInstitution: string | null
  tenderCategory: string | null
  tenderStatus: string | null
  rowKey: string | null
  tenderAccessType: string | null
}

export interface TransnetTransport {
  /** Only the "Open Tenders" endpoint — see module comment for why the "Other Tenders" (cached historical archive) endpoint is deliberately never called. */
  fetchAllTenders(): Promise<RawTransnetTender[]>
  checkReachable(): Promise<{ reachable: boolean; message: string }>
}
