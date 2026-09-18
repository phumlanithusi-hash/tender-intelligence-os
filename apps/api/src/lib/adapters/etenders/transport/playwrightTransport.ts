/// <reference lib="dom" />
// The reference above brings in `document`/`HTMLAnchorElement` etc.
// typings ONLY for this file, for the `page.evaluate(() => ...)`
// callback bodies below that execute inside a browser page context —
// this project's own tsconfig deliberately has no "dom" lib (it is a
// Node server), so nothing else in apps/api gains browser globals.
import type { Browser, Page } from 'playwright-core'
import { isAllowedDocumentUrl } from '../allowlist.js'
import type { EtendersDiscoveryParams, EtendersTransport, RawDetailPage, RawDocumentLink, RawListingRow } from '../types.js'

/**
 * REAL transport (Phase 5's binding discovery-mechanism decision —
 * see docs/SCRAPING-ARCHITECTURE.md §12): headless Chromium against
 * the public eTenders opportunities listing,
 * https://www.etenders.gov.za/Home/opportunities — the page a human
 * visitor sees, with no login and no anti-bot circumvention.
 *
 * UPDATE (first genuine live run, real network access): this file was
 * originally written entirely from a static/markdown fetch of the page
 * with no way to exercise it against the live site (this build
 * environment's egress is blocked to etenders.gov.za). The first real
 * run against the live site found the original DOM-scraping approach
 * for `fetchListingPage` didn't work — the rendered table has no real
 * link/id in it at all — and replaced it with a direct call to the
 * JSON endpoint the page's own JavaScript uses
 * (`PaginatedTenderOpportunities`); see that function's own comment
 * for the detail. `fetchDetailPage` below is UNCHANGED and still
 * exactly the original best-effort guess — it has not yet been run
 * against a live detail page and should be treated with the same
 * suspicion the listing fetch turned out to deserve.
 */
export interface PlaywrightTransportConfig {
  baseUrl: string
  /**
   * Optional override for the Chromium binary Playwright should launch.
   * Leave unset to let `playwright-core` resolve the browser it finds
   * in its own install cache (populated by `npx playwright install
   * chromium`, or by $PLAYWRIGHT_BROWSERS_PATH when that's set) — this
   * is the right default on a developer machine or a normal deploy
   * target. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH only when a
   * specific environment (e.g. a sandboxed build container) ships its
   * own fixed browser location that autodetection won't find.
   */
  executablePath?: string
  /** Per-navigation timeout, ms. */
  navigationTimeoutMs: number
}

export const DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG: PlaywrightTransportConfig = {
  baseUrl: 'https://www.etenders.gov.za',
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  navigationTimeoutMs: 20_000,
}

/** Resolves a possibly-relative source URL against the configured base and enforces the document/page domain allow-list before any navigation or fetch (Phase 5 §31/§32) — throws rather than silently skipping, since a resolution failure here means the caller must not proceed to fetch anything. */
export function resolveAndAllowlist(url: string, baseUrl: string): string {
  const absolute = new URL(url, baseUrl).toString()
  if (!isAllowedDocumentUrl(absolute)) {
    throw Object.assign(new Error(`Refusing to fetch a URL outside the eTenders domain allow-list: ${absolute}`), {
      code: 'DISALLOWED_DOMAIN',
    })
  }
  return absolute
}

async function withBrowser<T>(
  config: PlaywrightTransportConfig,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  // Dynamic import: this adapter must remain importable (and its
  // pure logic testable) in an environment without a Chromium binary
  // at all — the dependency is only touched once a real navigation is
  // actually attempted.
  const { chromium } = await import('playwright-core')
  let browser: Browser | undefined
  try {
    browser = await chromium.launch({ executablePath: config.executablePath, headless: true })
    const page = await browser.newPage()
    page.setDefaultNavigationTimeout(config.navigationTimeoutMs)
    page.setDefaultTimeout(config.navigationTimeoutMs)
    return await fn(page)
  } finally {
    await browser?.close().catch(() => undefined)
  }
}

/**
 * First real live run (this environment's own genuine first network
 * access to eTenders — see the git history around this comment)
 * revealed that the rendered table has NO real link or id in its DOM
 * at all: the "Tender Description" cell is a DataTables
 * `details-control` expander, not an anchor. The actual data — a real
 * numeric `id`, `tender_No`, full organisation/closing-date/briefing
 * fields, even the document list — comes from a JSON endpoint the
 * page's own JavaScript calls on load:
 * `GET /Home/PaginatedTenderOpportunities` (a standard server-side
 * jQuery DataTables source, `{ data: [...] }`). Calling that endpoint
 * directly (from inside the page's own browser context, so it carries
 * whatever cookies a normal visit sets) is strictly more reliable than
 * scraping the rendered HTML, and is still exactly what a real visitor's
 * browser does when it loads this page — no login, no anti-bot
 * circumvention, no different treatment than an ordinary page view.
 * The exact query-string shape below (column definitions, ordering)
 * mirrors what the live page itself sends; only `start`/`length`
 * (pagination) and `status` vary per discovery request.
 */
function buildOpportunitiesQuery(params: EtendersDiscoveryParams): string {
  const columns: Array<{ data: string; orderable: boolean }> = [
    { data: '', orderable: false },
    { data: 'category', orderable: true },
    { data: 'description', orderable: false },
    { data: 'eSubmission', orderable: true },
    { data: 'date_Published', orderable: true },
    { data: 'closing_Date', orderable: true },
    { data: 'actions', orderable: true },
  ]

  const qs = new URLSearchParams()
  qs.set('draw', '1')
  columns.forEach((col, i) => {
    qs.set(`columns[${i}][data]`, col.data)
    qs.set(`columns[${i}][name]`, '')
    qs.set(`columns[${i}][searchable]`, 'true')
    qs.set(`columns[${i}][orderable]`, String(col.orderable))
    qs.set(`columns[${i}][search][value]`, '')
    qs.set(`columns[${i}][search][regex]`, 'false')
  })
  qs.set('order[0][column]', '2')
  qs.set('order[0][dir]', 'desc')
  qs.set('start', String((params.page - 1) * params.pageSize))
  qs.set('length', String(params.pageSize))
  qs.set('search[value]', '')
  qs.set('search[regex]', 'false')
  // `status=1` is what the live site's own default ("currently
  // advertised") view sends — confirmed by direct observation. The
  // value for the 'ALL' filter has NOT been confirmed against the live
  // site yet (no observed request used it); omitting the param here is
  // a documented guess, not a verified behaviour, until checked.
  if (params.statusFilter === 'OPEN') qs.set('status', '1')
  qs.set('_', String(Date.now()))
  return qs.toString()
}

/** One record as `PaginatedTenderOpportunities` actually returns it — only the fields this adapter uses, everything else on the real payload (awards, bidders, discussions, ...) is intentionally left untyped/ignored here. */
interface RawOpportunityRecord {
  id: number | string
  tender_No?: string | null
  description?: string | null
  category?: string | null
  organ_of_State?: string | null
  department?: string | null
  province?: string | null
  type?: string | null
  eSubmission?: boolean | null
  date_Published?: string | null
  closing_Date?: string | null
}

function mapOpportunityRecord(item: RawOpportunityRecord): RawListingRow {
  const externalId = item.id != null ? String(item.id) : null
  return {
    externalId,
    detailUrl: externalId ? `/Home/opportunities?id=${externalId}` : null,
    category: item.category ?? null,
    description: item.description ?? null,
    eSubmission: item.eSubmission === true ? 'Yes' : item.eSubmission === false ? 'No' : null,
    // Replacing the ISO "T" separator with a space keeps
    // parseEtendersDateOnly's year-first match working AND gives
    // parseEtendersTime a word boundary before the hour digits — both
    // parsers still just read what the source literally sent.
    advertisedText: item.date_Published ? item.date_Published.replace('T', ' ') : null,
    closingDateText: item.closing_Date ? item.closing_Date.replace('T', ' ') : null,
    organisation: item.organ_of_State ?? item.department ?? null,
    tenderNumber: item.tender_No ?? null,
    province: item.province ?? null,
    tenderType: item.type ?? null,
  }
}

export function createPlaywrightTransport(
  config: PlaywrightTransportConfig = DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG,
): EtendersTransport {
  return {
    async fetchListingPage(params: EtendersDiscoveryParams): Promise<RawListingRow[]> {
      return withBrowser(config, async (page) => {
        // Load the real page first (establishes whatever cookies a
        // normal visit sets) before calling the JSON endpoint it uses.
        const listingUrl = resolveAndAllowlist('/Home/opportunities', config.baseUrl)
        await page.goto(listingUrl, { waitUntil: 'domcontentloaded' })

        const endpoint = resolveAndAllowlist(
          `/Home/PaginatedTenderOpportunities?${buildOpportunitiesQuery(params)}`,
          config.baseUrl,
        )
        const payload = await page.evaluate(async (url: string) => {
          const res = await fetch(url, { credentials: 'same-origin' })
          if (!res.ok) throw new Error(`PaginatedTenderOpportunities responded with HTTP ${res.status}`)
          return res.json()
        }, endpoint)

        const records = Array.isArray((payload as { data?: unknown[] })?.data)
          ? ((payload as { data: RawOpportunityRecord[] }).data)
          : []
        return records.map(mapOpportunityRecord)
      })
    },

    async fetchDetailPage(detailUrl: string, externalId: string): Promise<RawDetailPage> {
      return withBrowser(config, async (page) => {
        const target = resolveAndAllowlist(detailUrl, config.baseUrl)
        await page.goto(target, { waitUntil: 'networkidle' })

        const extracted = await page.evaluate(() => {
          const text = (selector: string) => document.querySelector(selector)?.textContent?.trim() ?? null
          const links = Array.from(document.querySelectorAll('a[href*="document"]')).map((a) => ({
            url: a.getAttribute('href'),
            label: a.textContent?.trim() ?? null,
          }))
          return {
            title: text('h1, .tender-title'),
            description: text('.tender-description, .description'),
            organisation: text('.organ-of-state, .organisation'),
            tenderNumber: text('.tender-number, .reference-number'),
            advertisedText: text('.advertised-date'),
            closingDateText: text('.closing-date'),
            closingTimeText: text('.closing-time'),
            province: text('.province'),
            briefingText: text('.briefing-info'),
            documents: links as RawDocumentLink[],
          }
        })

        return { externalId, detailUrl: target, ...extracted }
      })
    },

    async checkReachable(): Promise<{ reachable: boolean; message: string }> {
      try {
        return await withBrowser(config, async (page) => {
          const target = resolveAndAllowlist('/Home/opportunities', config.baseUrl)
          const response = await page.goto(target, { waitUntil: 'domcontentloaded' })
          if (!response) {
            return { reachable: false, message: 'No response received from the eTenders opportunities page.' }
          }
          if (!response.ok()) {
            return { reachable: false, message: `eTenders responded with HTTP ${response.status()}.` }
          }
          return { reachable: true, message: 'eTenders opportunities page responded successfully.' }
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error reaching eTenders.'
        return { reachable: false, message }
      }
    },
  }
}
