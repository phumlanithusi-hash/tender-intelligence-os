/// <reference lib="dom" />
// See adapters/etenders/transport/playwrightTransport.ts's identical
// comment: this reference brings in DOM typings ONLY for the
// page.evaluate(() => ...) callback bodies below.
import type { Browser, Page } from 'playwright-core'
import { isAllowedDocumentUrl } from '../allowlist.js'
import type { EasyTendersDiscoveryParams, EasyTendersTransport, RawDetailPage, RawDocumentLink, RawListingRow } from '../types.js'

/**
 * REAL transport against the public EasyTenders listing
 * (https://easytenders.co.za/tenders) and its per-tender detail pages.
 * Investigated directly (this build's own research step, not a guess
 * from documentation) before writing this file: the listing is plain
 * server-rendered HTML with real `<a href="/tenders/...">` links —
 * no hidden JSON endpoint like eTenders needed. That said, this
 * module has NOT yet been run against the live site with a real
 * browser (this sandbox has no network access to easytenders.co.za
 * either) — the exact container/selector choices below are a
 * documented best-effort guess from a text-only fetch of the page,
 * the same honest caveat the original eTenders transport carried
 * before its own first live run found a real mismatch. Discovery is
 * deliberately kept minimal (just the detail URL, plus whatever
 * secondary text falls out easily) precisely so a wrong guess there
 * degrades to "some fields null" rather than "no tenders found at
 * all" — the detail-page fetch (text-label based, not CSS-class
 * based) is where the real fields come from and is more robust to a
 * DOM this adapter hasn't actually seen.
 */
export interface PlaywrightTransportConfig {
  baseUrl: string
  executablePath?: string
  navigationTimeoutMs: number
}

export const DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG: PlaywrightTransportConfig = {
  baseUrl: 'https://easytenders.co.za',
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  navigationTimeoutMs: 20_000,
}

export function resolveAndAllowlist(url: string, baseUrl: string): string {
  const absolute = new URL(url, baseUrl).toString()
  if (!isAllowedDocumentUrl(absolute)) {
    throw Object.assign(new Error(`Refusing to fetch a URL outside the EasyTenders domain allow-list: ${absolute}`), {
      code: 'DISALLOWED_DOMAIN',
    })
  }
  return absolute
}

async function withBrowser<T>(config: PlaywrightTransportConfig, fn: (page: Page) => Promise<T>): Promise<T> {
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

async function extractListingRows(page: Page): Promise<RawListingRow[]> {
  return page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href^="/tenders/"]')) as HTMLAnchorElement[]
    const seen = new Set<string>()
    const rows: Array<{ slug: string | null; detailUrl: string | null; organisation: string | null; description: string | null; closingDateText: string | null }> = []

    for (const anchor of anchors) {
      const href = anchor.getAttribute('href')
      if (!href || href === '/tenders' || seen.has(href)) continue
      seen.add(href)

      // Walk up to the nearest reasonably-sized ancestor so the whole
      // card's text (org, description, closing date) comes along with
      // the link, rather than just the anchor's own (often short)
      // link text.
      let container: Element = anchor
      for (let i = 0; i < 4 && container.parentElement; i += 1) {
        container = container.parentElement
        if ((container.textContent?.trim().length ?? 0) > 40) break
      }

      const text = container.textContent?.replace(/\s+/g, ' ').trim() ?? null
      const slug = href.split('/').filter(Boolean).pop() ?? null

      rows.push({
        slug,
        detailUrl: href,
        // Deliberately left null here rather than guessed from the
        // card's combined text — normalise.ts backfills it reliably
        // from the detail page instead.
        organisation: null,
        description: text,
        closingDateText: text,
      })
    }
    return rows
  })
}

/** Text-label extraction (not CSS-class selectors) for the detail page's fields — see this file's module comment for why. */
async function extractDetailPage(page: Page): Promise<Omit<RawDetailPage, 'slug' | 'detailUrl'>> {
  return page.evaluate(() => {
    const bodyText = document.body.innerText
    function field(label: string): string | null {
      const re = new RegExp(`${label}\\s*:?\\s*([^\\n]+)`, 'i')
      const match = bodyText.match(re)
      return match ? match[1]!.trim() : null
    }
    const title = document.querySelector('h1')?.textContent?.trim() ?? null
    const documents = Array.from(
      document.querySelectorAll('a[href*="documents.easytenders.co.za"], a[href$=".pdf"], a[href$=".doc"], a[href$=".docx"]'),
    ).map((a) => ({
      url: a.getAttribute('href'),
      label: a.textContent?.trim() ?? null,
    }))

    return {
      title,
      tenderNumber: field('Reference Number') ?? field('Tender Number'),
      organisation: field('Department') ?? field('Organisation') ?? field('Organization'),
      category: field('Category'),
      province: field('Province'),
      description: field('Bid Description') ?? field('Description'),
      advertisedText: field('Published Date') ?? field('Advertised'),
      closingDateText: field('Closing Date'),
      briefingText: field('Briefing Session') ?? field('Briefing'),
      documents: documents as RawDocumentLink[],
    }
  })
}

export function createPlaywrightTransport(
  config: PlaywrightTransportConfig = DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG,
): EasyTendersTransport {
  return {
    async fetchListingPage(params: EasyTendersDiscoveryParams): Promise<RawListingRow[]> {
      return withBrowser(config, async (page) => {
        const url = new URL('/tenders', config.baseUrl)
        if (params.page > 1) url.searchParams.set('page', String(params.page))
        const target = resolveAndAllowlist(url.toString(), config.baseUrl)
        await page.goto(target, { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('a[href^="/tenders/"]', { timeout: config.navigationTimeoutMs }).catch(() => undefined)
        return extractListingRows(page)
      })
    },

    async fetchDetailPage(detailUrl: string, slug: string): Promise<RawDetailPage> {
      return withBrowser(config, async (page) => {
        const target = resolveAndAllowlist(detailUrl, config.baseUrl)
        await page.goto(target, { waitUntil: 'domcontentloaded' })
        const extracted = await extractDetailPage(page)
        return { slug, detailUrl: target, ...extracted }
      })
    },

    async checkReachable(): Promise<{ reachable: boolean; message: string }> {
      try {
        return await withBrowser(config, async (page) => {
          const target = resolveAndAllowlist('/tenders', config.baseUrl)
          const response = await page.goto(target, { waitUntil: 'domcontentloaded' })
          if (!response) return { reachable: false, message: 'No response received from the EasyTenders listing page.' }
          if (!response.ok()) return { reachable: false, message: `EasyTenders responded with HTTP ${response.status()}.` }
          return { reachable: true, message: 'EasyTenders listing page responded successfully.' }
        })
      } catch (err) {
        return { reachable: false, message: err instanceof Error ? err.message : 'Unknown error reaching EasyTenders.' }
      }
    },
  }
}
