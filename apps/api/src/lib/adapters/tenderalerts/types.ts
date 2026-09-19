/**
 * TenderAlerts-specific types, private to this adapter directory.
 *
 * Investigated directly against the live public site
 * (https://tenderalerts.co.za) across several rounds: `/tenders/all`
 * is a genuinely public listing (no sign-in required to browse it —
 * confirmed live), paginated via a plain `?page=N` query parameter
 * (confirmed: a real pagination control links to
 * `/tenders/all?page=2` .. `?page=68` at the time this was checked,
 * for ~4083 open tenders). Each listing card exposes: a title
 * (linking to `/tenders/view/{slug}`), a stable numeric id embedded
 * in a `span[id="bookmark_{ID}"]` element, and a `dl.row` of dt/dd
 * pairs ("Tender no:", "Province where service required:", "Closing
 * date & time:", "Briefing date & time:").
 *
 * This adapter is DISCOVERY ONLY, same reasoning/shape as the
 * TenderBulletins and City of Cape Town adapters: a live check of a
 * real tender's detail page (`/tenders/view/{slug}`) showed the exact
 * text "Only subscribers can see details and documents | Subscribe
 * Now" in place of any further content or document links — this
 * source's own listing already gives everything this adapter will
 * ever surface, and `fetchDetails`/`fetchDocuments` never attempt to
 * cross that subscription wall (this project never automates past
 * authentication/paywalls it wasn't explicitly given).
 */

export interface RawListingRow {
  /** The numeric id embedded in the card's own `bookmark_{ID}` element — the only stable identity this source exposes publicly (title text and slug can both repeat/change). */
  externalId: string | null
  title: string | null
  /** The card's own `/tenders/view/{slug}` link, resolved to an absolute URL by discover.ts. */
  detailHref: string | null
  tenderNumber: string | null
  province: string | null
  closingDateText: string | null
  briefingDateText: string | null
}

export interface TenderAlertsDiscoveryParams {
  page: number
}

export interface TenderAlertsTransport {
  fetchListingPage(params: TenderAlertsDiscoveryParams): Promise<RawListingRow[]>
  checkReachable(): Promise<{ reachable: boolean; message: string }>
}
