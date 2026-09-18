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
 * visitor sees, with no login and no anti-bot circumvention. This is
 * necessary (not merely convenient) because the listing table is
 * populated client-side after page load — a plain HTTP fetch of the
 * page returns only the "loading, please wait..." shell with an empty
 * table body (confirmed during this phase's investigation).
 *
 * This module could NOT be exercised against the live site from this
 * build environment (outbound network access to etenders.gov.za is
 * blocked by the sandbox's egress allowlist — confirmed directly,
 * `CONNECT` returns 403). It is written to the best of what the
 * static/markdown fetch of the page revealed about its structure and
 * is the mechanism a deployment with real network access should run
 * and adjust against the live DOM on first use — see
 * docs/SCRAPING-ARCHITECTURE.md's "Limitations" section.
 */
export interface PlaywrightTransportConfig {
  baseUrl: string
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
 * Extracts listing rows from the rendered opportunities table.
 * Documented, best-effort selectors based on the observed column
 * headers (Category, Tender Description, eSubmission, Advertised,
 * Closing Date) — a real deployment's first live run should verify
 * these selectors still match the current DOM and adjust if the site
 * has changed (docs/SCRAPING-ARCHITECTURE.md).
 */
async function extractListingRows(page: Page): Promise<RawListingRow[]> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('table tbody tr'))
    return rows.map((row) => {
      const cells = Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent?.trim() ?? null)
      const link = row.querySelector('a[href]') as HTMLAnchorElement | null
      return {
        externalId: null,
        detailUrl: link?.getAttribute('href') ?? null,
        category: cells[0] ?? null,
        description: cells[1] ?? null,
        eSubmission: cells[2] ?? null,
        advertisedText: cells[3] ?? null,
        closingDateText: cells[4] ?? null,
        organisation: null,
        tenderNumber: null,
        province: null,
        tenderType: null,
      }
    })
  })
}

export function createPlaywrightTransport(
  config: PlaywrightTransportConfig = DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG,
): EtendersTransport {
  return {
    async fetchListingPage(params: EtendersDiscoveryParams): Promise<RawListingRow[]> {
      return withBrowser(config, async (page) => {
        const url = new URL('/Home/opportunities', config.baseUrl)
        url.searchParams.set('page', String(params.page))
        if (params.statusFilter === 'OPEN') url.searchParams.set('status', 'Currently Advertised')
        if (params.advertisedFrom) url.searchParams.set('dateFrom', params.advertisedFrom)
        const target = resolveAndAllowlist(url.toString(), config.baseUrl)

        await page.goto(target, { waitUntil: 'networkidle' })
        // The table is populated client-side after load (this phase's
        // investigation finding) — wait for at least one data row
        // rather than assuming a fixed delay is long enough.
        await page.waitForSelector('table tbody tr', { timeout: config.navigationTimeoutMs }).catch(() => undefined)
        return extractListingRows(page)
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
