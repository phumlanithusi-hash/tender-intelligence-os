/**
 * Eskom-specific types, private to this adapter directory (same
 * boundary rule as every other adapter's types.ts).
 *
 * Investigated directly against the live public site
 * (https://tenderbulletin.eskom.co.za) across several rounds — the
 * homepage link from eskom.co.za's "Procurement" section leads to a
 * dedicated tender-bulletin subdomain that is a client-side rendered
 * app: the initial HTML shows only "Loading Tenders ..." for several
 * seconds before real tender cards render, so this adapter must wait
 * for a real card element rather than a fixed navigation event.
 *
 * Confirmed real card structure (one `<article>` per tender):
 *   h3 (inside an `<a href="/tender/{TENDER_ID}">`)  -> reference/title text, e.g. "ERI/2022/BMS/08"
 *   p.text-sm.text-muted-foreground                  -> description
 *   dl > dt/dd pairs, in order:
 *     [org name]/[duplicate description]              -> organisation (dt text; dd is a repeat of the description, ignored)
 *     "Location" / <value>
 *     "Closing Date" / <value, format "YYYY-Mon-DD HH:mm:ss">
 *     "Published Date" / <value, same format>
 *   a[href*="/webapi/api/Files/DownloadAll?TENDER_ID="] -> a single bundle download link for ALL of that
 *                                                          tender's documents (no per-document listing exists)
 *   a[href^="/tender/"]                                 -> the tender's own detail page (not fetched separately —
 *                                                          the listing card already carries the full record)
 *
 * Pagination is via `?pageSize=N&pageNumber=N` query params on the
 * same URL (confirmed: the site's own internal links already use this
 * shape) — a real "Next"/page-number control was seen at the bottom
 * of the list (~17 pages at pageSize=20 when this was checked).
 */

export interface RawTenderCard {
  /** The numeric TENDER_ID from the card's own "Read More"/download links — the only stable identity, since reference-number-shaped text can repeat across cancellation/regret-letter variants of the same underlying tender. */
  externalId: string | null
  referenceNumber: string | null
  description: string | null
  organisation: string | null
  location: string | null
  closingDateText: string | null
  publishedDateText: string | null
  downloadAllDocsUrl: string | null
  detailUrl: string | null
}

export interface EskomDiscoveryParams {
  pageNumber: number
  pageSize: number
}

export interface EskomTransport {
  fetchListingPage(params: EskomDiscoveryParams): Promise<RawTenderCard[]>
  checkReachable(): Promise<{ reachable: boolean; message: string }>
}
