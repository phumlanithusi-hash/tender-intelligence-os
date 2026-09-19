/// <reference lib="dom" />
import type { Browser, Page } from 'playwright-core'
import { isAllowedDocumentUrl } from '../allowlist.js'
import type { RawListingRow, TenderBulletinsTransport } from '../types.js'

/**
 * REAL transport against the public TenderBulletins search listing
 * (https://www.tenderbulletin.co.za/search) ONLY — this adapter never
 * navigates past `/login` or `/register`, and never attempts to
 * authenticate, matching this project's hard rule against automating
 * past a source's own login wall (see this adapter directory's
 * types.ts module comment for the research finding behind that
 * decision).
 *
 * Not yet run against the live site with a real browser (this sandbox
 * has no network access to tenderbulletin.co.za). The extraction below
 * anchors on the one DOM detail confirmed by direct research — each
 * tender's "Save" link (`href*="intent=save"`) — rather than guessing
 * card class names, since that's the most stable thing to build on
 * without having actually rendered the page.
 */
export interface PlaywrightTransportConfig {
  baseUrl: string
  executablePath?: string
  navigationTimeoutMs: number
}

export const DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG: PlaywrightTransportConfig = {
  baseUrl: 'https://www.tenderbulletin.co.za',
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  navigationTimeoutMs: 20_000,
}

export function resolveAndAllowlist(url: string, baseUrl: string): string {
  const absolute = new URL(url, baseUrl).toString()
  if (!isAllowedDocumentUrl(absolute)) {
    throw Object.assign(new Error(`Refusing to fetch a URL outside the TenderBulletins domain allow-list: ${absolute}`), {
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
    const saveLinks = Array.from(document.querySelectorAll('a[href*="intent=save"]'))
    const rows: Array<{ tenderId: string | null; organisation: string | null; description: string | null; closingDateText: string | null }> = []

    for (const link of saveLinks) {
      let container: Element = link
      for (let i = 0; i < 5 && container.parentElement; i += 1) {
        container = container.parentElement
        if ((container.textContent?.trim().length ?? 0) > 40) break
      }
      const text = container.textContent?.replace(/\s+/g, ' ').trim() ?? null
      // The source's own tender id, as shown in the listing (e.g.
      // "E2232GXMPTUT") — an uppercase alphanumeric token, distinct
      // from the internal UUID in the save link's own `tender_id=`
      // query param (that UUID belongs to TenderBulletins' own
      // database, not the source tender itself).
      const idMatch = text?.match(/\b[A-Z][A-Z0-9]{5,23}\b/)
      rows.push({
        tenderId: idMatch ? idMatch[0] : null,
        organisation: null,
        description: text,
        closingDateText: text,
      })
    }
    return rows
  })
}

export function createPlaywrightTransport(
  config: PlaywrightTransportConfig = DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG,
): TenderBulletinsTransport {
  return {
    async fetchListingPage(): Promise<RawListingRow[]> {
      return withBrowser(config, async (page) => {
        const target = resolveAndAllowlist('/search', config.baseUrl)
        await page.goto(target, { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('a[href*="intent=save"]', { timeout: config.navigationTimeoutMs }).catch(() => undefined)
        return extractListingRows(page)
      })
    },

    async checkReachable(): Promise<{ reachable: boolean; message: string }> {
      try {
        return await withBrowser(config, async (page) => {
          const target = resolveAndAllowlist('/search', config.baseUrl)
          const response = await page.goto(target, { waitUntil: 'domcontentloaded' })
          if (!response) return { reachable: false, message: 'No response received from the TenderBulletins search page.' }
          if (!response.ok()) return { reachable: false, message: `TenderBulletins responded with HTTP ${response.status()}.` }
          return { reachable: true, message: 'TenderBulletins search page responded successfully.' }
        })
      } catch (err) {
        return { reachable: false, message: err instanceof Error ? err.message : 'Unknown error reaching TenderBulletins.' }
      }
    },
  }
}
