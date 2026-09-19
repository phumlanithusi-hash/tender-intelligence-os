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
 * REVISED after a real first live run found the initial best-effort
 * extraction (walking up from each "Save" link and regexing the
 * flattened container text for an uppercase-token id) missed 6 of 10
 * real rows, because the DOM glues the reference text directly to a
 * following status word with no whitespace (e.g.
 * "E2232GXMPTUTPublish"), which a plain \b-bounded regex cannot see
 * past. A diagnostic run against the live site
 * (tenderbulletinsInspect.ts) found the real, precise structure
 * instead:
 *
 *   article.tb-tender-card                        (one per opportunity)
 *     .tb-tender-ref                                <- the ref, verbatim (see types.ts)
 *     h2.card-title                                 <- title
 *     .tb-tender-closing__date                      <- ISO closing date, e.g. "2031-12-31"
 *     p.small.text-secondary  ("A · B · C")         <- meta line; segment A is used as `organisation` (see types.ts — the remaining segments' meaning isn't stable across rows, so they're left unused rather than guessed)
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
    const cards = Array.from(document.querySelectorAll('article.tb-tender-card'))
    const rows: Array<{ tenderId: string | null; organisation: string | null; description: string | null; closingDateText: string | null }> = []

    for (const card of cards) {
      const tenderId = card.querySelector('.tb-tender-ref')?.textContent?.trim() || null
      const description = card.querySelector('h2.card-title')?.textContent?.replace(/\s+/g, ' ').trim() || null
      const closingDateText = card.querySelector('.tb-tender-closing__date')?.textContent?.trim() || null
      const metaLine = card.querySelector('p.small.text-secondary')?.textContent?.replace(/\s+/g, ' ').trim() || null
      const organisation = metaLine ? metaLine.split('·')[0]!.trim() || null : null

      rows.push({ tenderId, organisation, description, closingDateText })
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
        await page.waitForSelector('article.tb-tender-card', { timeout: config.navigationTimeoutMs }).catch(() => undefined)
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
