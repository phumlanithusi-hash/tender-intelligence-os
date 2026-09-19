/// <reference lib="dom" />
import type { Browser, Page } from 'playwright-core'
import { isAllowedDocumentUrl } from '../allowlist.js'
import type { RawListingRow, TenderAlertsDiscoveryParams, TenderAlertsTransport } from '../types.js'

export interface PlaywrightTransportConfig {
  baseUrl: string
  executablePath?: string
  navigationTimeoutMs: number
}

export const DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG: PlaywrightTransportConfig = {
  baseUrl: 'https://tenderalerts.co.za',
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  navigationTimeoutMs: 45_000,
}

export function resolveAndAllowlist(url: string, baseUrl: string): string {
  const absolute = new URL(url, baseUrl).toString()
  if (!isAllowedDocumentUrl(absolute)) {
    throw Object.assign(new Error(`Refusing to fetch a URL outside the TenderAlerts domain allow-list: ${absolute}`), {
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

/**
 * Same no-named-binding-inside-page.evaluate discipline as every
 * other adapter written after the __name bug was first found — only
 * inline anonymous arrows and plain for/if control flow inside the
 * callback (see eTenders'/EasyTenders' playwrightTransport.ts
 * comments for the full explanation).
 *
 * Card structure confirmed live (types.ts's module comment): each
 * tender's title link (`a[href^="/tenders/view/"]`) sits inside a
 * `.row` block; that block's very next sibling element is the
 * `dl.row` carrying the dt/dd fields; the stable numeric id lives in
 * a `span[id^="bookmark_"]` inside the same title block.
 */
async function extractListingRows(page: Page): Promise<RawListingRow[]> {
  return page.evaluate(() => {
    const rows: Array<{
      externalId: string | null
      title: string | null
      detailHref: string | null
      tenderNumber: string | null
      province: string | null
      closingDateText: string | null
      briefingDateText: string | null
    }> = []
    const titleLinks = Array.from(document.querySelectorAll('a[href^="/tenders/view/"]'))
    for (const link of titleLinks) {
      const titleRow = link.closest('.row')
      if (!titleRow) continue
      const dl = titleRow.nextElementSibling
      if (!dl || dl.tagName !== 'DL') continue

      let tenderNumber: string | null = null
      let province: string | null = null
      let closingDateText: string | null = null
      let briefingDateText: string | null = null
      const dtEls = Array.from(dl.querySelectorAll('dt'))
      for (const dt of dtEls) {
        const label = (dt.textContent || '').trim()
        const dd = dt.nextElementSibling
        const value = dd ? (dd.textContent || '').trim() : null
        if (label.startsWith('Tender no')) tenderNumber = value
        else if (label.startsWith('Province')) province = value
        else if (label.startsWith('Closing date')) closingDateText = value
        else if (label.startsWith('Briefing date')) briefingDateText = value
      }

      const bookmarkSpan = titleRow.querySelector('span[id^="bookmark_"]')
      const externalId = bookmarkSpan ? bookmarkSpan.id.replace('bookmark_', '') : null
      const title = (link.textContent || '').trim() || null
      const detailHref = link.getAttribute('href')

      rows.push({ externalId, title, detailHref, tenderNumber, province, closingDateText, briefingDateText })
    }
    return rows
  })
}

export function createPlaywrightTransport(config: PlaywrightTransportConfig = DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG): TenderAlertsTransport {
  return {
    async fetchListingPage(params: TenderAlertsDiscoveryParams): Promise<RawListingRow[]> {
      return withBrowser(config, async (page) => {
        const url = new URL('/tenders/all', config.baseUrl)
        if (params.page > 1) url.searchParams.set('page', String(params.page))
        const target = resolveAndAllowlist(url.toString(), config.baseUrl)
        await page.goto(target, { waitUntil: 'domcontentloaded' })
        return extractListingRows(page)
      })
    },

    async checkReachable(): Promise<{ reachable: boolean; message: string }> {
      try {
        return await withBrowser(config, async (page) => {
          const target = resolveAndAllowlist('/tenders/all', config.baseUrl)
          const response = await page.goto(target, { waitUntil: 'domcontentloaded' })
          if (!response) {
            return { reachable: false, message: 'No response received from TenderAlerts.' }
          }
          if (!response.ok()) {
            return { reachable: false, message: `TenderAlerts responded with HTTP ${response.status()}.` }
          }
          return { reachable: true, message: 'TenderAlerts responded successfully.' }
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error reaching TenderAlerts.'
        return { reachable: false, message }
      }
    },
  }
}
