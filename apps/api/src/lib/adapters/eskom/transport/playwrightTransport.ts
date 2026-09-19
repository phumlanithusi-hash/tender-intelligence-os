/// <reference lib="dom" />
import type { Browser, Page } from 'playwright-core'
import { isAllowedDocumentUrl } from '../allowlist.js'
import type { EskomDiscoveryParams, EskomTransport, RawTenderCard } from '../types.js'

/**
 * REAL transport against Eskom's live tender bulletin
 * (https://tenderbulletin.eskom.co.za) — see types.ts's module
 * comment for the live investigation.
 *
 * Same no-named-binding-inside-page.evaluate discipline as every
 * other adapter written after the __name bug was first found (see
 * eTenders'/EasyTenders' playwrightTransport.ts comments) — only
 * inline anonymous arrows and plain for/if control flow inside the
 * callback.
 */
export interface PlaywrightTransportConfig {
  baseUrl: string
  executablePath?: string
  navigationTimeoutMs: number
}

export const DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG: PlaywrightTransportConfig = {
  baseUrl: 'https://tenderbulletin.eskom.co.za',
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  navigationTimeoutMs: 45_000,
}

export function resolveAndAllowlist(url: string, baseUrl: string): string {
  const absolute = new URL(url, baseUrl).toString()
  if (!isAllowedDocumentUrl(absolute)) {
    throw Object.assign(new Error(`Refusing to fetch a URL outside the Eskom domain allow-list: ${absolute}`), {
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

async function extractTenderCards(page: Page): Promise<RawTenderCard[]> {
  return page.evaluate(() => {
    const articles = Array.from(document.querySelectorAll('article'))
    const cards: Array<{
      externalId: string | null
      referenceNumber: string | null
      description: string | null
      organisation: string | null
      location: string | null
      closingDateText: string | null
      publishedDateText: string | null
      downloadAllDocsUrl: string | null
      detailUrl: string | null
    }> = []
    for (const article of articles) {
      const detailLink = article.querySelector('a[href^="/tender/"]')
      const detailHref = detailLink ? detailLink.getAttribute('href') : null
      const externalId = detailHref ? detailHref.split('/').filter(Boolean).pop() ?? null : null
      const referenceNumber = article.querySelector('h3')?.textContent?.replace(/\s+/g, ' ').trim() ?? null
      const description = article.querySelector('p')?.textContent?.replace(/\s+/g, ' ').trim() ?? null
      const downloadLink = article.querySelector('a[href*="/webapi/api/Files/DownloadAll"]')
      const downloadAllDocsUrl = downloadLink ? downloadLink.getAttribute('href') : null

      let organisation: string | null = null
      let location: string | null = null
      let closingDateText: string | null = null
      let publishedDateText: string | null = null
      const dtEls = Array.from(article.querySelectorAll('dt'))
      let dtIndex = 0
      for (const dt of dtEls) {
        const label = dt.textContent?.replace(/\s+/g, ' ').trim() ?? ''
        const dd = dt.nextElementSibling
        const value = dd ? dd.textContent?.replace(/\s+/g, ' ').trim() ?? null : null
        if (dtIndex === 0) {
          organisation = label.length > 0 ? label : null // The first dt/dd pair is the organisation name; its dd is a repeat of the description and is ignored.
        } else if (label === 'Location') {
          location = value
        } else if (label === 'Closing Date') {
          closingDateText = value
        } else if (label === 'Published Date') {
          publishedDateText = value
        }
        dtIndex += 1
      }

      cards.push({
        externalId,
        referenceNumber,
        description,
        organisation,
        location,
        closingDateText,
        publishedDateText,
        downloadAllDocsUrl,
        detailUrl: detailHref,
      })
    }
    return cards
  })
}

export function createPlaywrightTransport(config: PlaywrightTransportConfig = DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG): EskomTransport {
  return {
    async fetchListingPage(params: EskomDiscoveryParams): Promise<RawTenderCard[]> {
      return withBrowser(config, async (page) => {
        const url = new URL('/', config.baseUrl)
        url.searchParams.set('pageSize', String(params.pageSize))
        url.searchParams.set('pageNumber', String(params.pageNumber))
        const target = resolveAndAllowlist(url.toString(), config.baseUrl)
        await page.goto(target, { waitUntil: 'domcontentloaded' })
        // This is a client-side rendered app — the initial HTML shows
        // only "Loading Tenders ..." for several seconds. Wait for a
        // real card rather than a fixed sleep.
        await page.waitForSelector('article', { timeout: config.navigationTimeoutMs }).catch(() => undefined)
        return extractTenderCards(page)
      })
    },

    async checkReachable(): Promise<{ reachable: boolean; message: string }> {
      try {
        return await withBrowser(config, async (page) => {
          const target = resolveAndAllowlist('/?pageSize=1&pageNumber=1', config.baseUrl)
          const response = await page.goto(target, { waitUntil: 'domcontentloaded' })
          if (!response) {
            return { reachable: false, message: 'No response received from the Eskom tender bulletin.' }
          }
          if (!response.ok()) {
            return { reachable: false, message: `Eskom tender bulletin responded with HTTP ${response.status()}.` }
          }
          return { reachable: true, message: 'Eskom tender bulletin responded successfully.' }
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error reaching the Eskom tender bulletin.'
        return { reachable: false, message }
      }
    },
  }
}
