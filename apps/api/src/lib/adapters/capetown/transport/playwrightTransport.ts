/// <reference lib="dom" />
import type { Browser, Page } from 'playwright-core'
import { isAllowedDocumentUrl } from '../allowlist.js'
import type { CapeTownTransport, RawTenderRow } from '../types.js'

/**
 * REAL transport against the City of Cape Town's live "Procurement
 * Administration Portal" tender listing — see types.ts's module
 * comment for the live investigation (a classic, fully client-side
 * jQuery DataTable with no ajax/server-side config: every tender is
 * already in the initial page load, and pagination is pure in-browser
 * redraw with zero extra network calls). This means the ENTIRE
 * discovery pass must click through every page inside one browser
 * session, unlike every other adapter's URL/page-number pagination.
 *
 * Same no-named-binding-inside-page.evaluate discipline as every
 * other adapter written after the __name bug was first found.
 */
export interface PlaywrightTransportConfig {
  baseUrl: string
  listingPath: string
  executablePath?: string
  navigationTimeoutMs: number
  /** Hard ceiling on pages clicked through in one session — a safety net against an unexpected infinite pagination loop, not a real limit this site is expected to hit (46 tenders / 15 per page = 4 pages when this was last checked). */
  maxPages: number
}

export const DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG: PlaywrightTransportConfig = {
  baseUrl: 'https://web1.capetown.gov.za',
  listingPath: '/web1/tenderportal/Tender',
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  navigationTimeoutMs: 45_000,
  maxPages: 30,
}

export function resolveAndAllowlist(url: string, baseUrl: string): string {
  const absolute = new URL(url, baseUrl).toString()
  if (!isAllowedDocumentUrl(absolute)) {
    throw Object.assign(new Error(`Refusing to fetch a URL outside the City of Cape Town domain allow-list: ${absolute}`), {
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

async function extractCurrentPageRows(page: Page): Promise<RawTenderRow[]> {
  return page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll('#rfqsTable tbody tr'))
    const rows: Array<{
      externalId: string | null
      tenderNumber: string | null
      description: string | null
      directorate: string | null
      department: string | null
      closingDateText: string | null
      postedDateText: string | null
    }> = []
    for (const tr of trs) {
      const cells = Array.from(tr.querySelectorAll('td'))
      if (cells.length < 6) continue // Not a real data row.
      const detailsLink = tr.querySelector('a.linkDetails')
      const detailsHref = detailsLink ? detailsLink.getAttribute('href') : null
      const externalId = detailsHref ? detailsHref.split('/').filter(Boolean).pop() ?? null : null
      const tenderNumber = cells[0]!.textContent?.replace(/\s+/g, ' ').trim() ?? null
      const descriptionPre = cells[1]!.querySelector('pre')
      const description = (descriptionPre?.getAttribute('title') ?? cells[1]!.textContent)?.replace(/\s+/g, ' ').trim() ?? null
      const directorate = cells[2]!.textContent?.replace(/\s+/g, ' ').trim() ?? null
      const department = cells[3]!.textContent?.replace(/\s+/g, ' ').trim() ?? null
      const closingDateText = cells[4]!.textContent?.replace(/\s+/g, ' ').trim() ?? null
      const postedDateText = cells[5]!.textContent?.replace(/\s+/g, ' ').trim() ?? null
      rows.push({ externalId, tenderNumber, description, directorate, department, closingDateText, postedDateText })
    }
    return rows
  })
}

export function createPlaywrightTransport(config: PlaywrightTransportConfig = DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG): CapeTownTransport {
  return {
    async fetchAllTenders(): Promise<RawTenderRow[]> {
      return withBrowser(config, async (page) => {
        const target = resolveAndAllowlist(config.listingPath, config.baseUrl)
        await page.goto(target, { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('#rfqsTable tbody tr', { timeout: config.navigationTimeoutMs }).catch(() => undefined)

        const allRows: RawTenderRow[] = []
        for (let pageIndex = 0; pageIndex < config.maxPages; pageIndex += 1) {
          const rows = await extractCurrentPageRows(page)
          allRows.push(...rows)

          const nextIsDisabled = await page.evaluate(() => {
            const nextEl = document.querySelector('#rfqsTable_next')
            return nextEl ? nextEl.className.includes('disabled') : true
          })
          if (nextIsDisabled) break

          const firstRefBeforeClick = rows[0]?.tenderNumber ?? null
          await page.click('#rfqsTable_next').catch(() => undefined)
          // DataTables redraws in-place with no navigation/network event to
          // wait on — poll for the first row's reference to actually change
          // rather than a fixed sleep, bounded so a stuck click can't hang.
          await page
            .waitForFunction(
              (prevRef: string | null) => {
                const firstCell = document.querySelector('#rfqsTable tbody tr td')
                const currentRef = firstCell?.textContent?.trim() ?? null
                return currentRef !== prevRef
              },
              firstRefBeforeClick,
              { timeout: 10_000 },
            )
            .catch(() => undefined)
        }
        return allRows
      })
    },

    async checkReachable(): Promise<{ reachable: boolean; message: string }> {
      try {
        return await withBrowser(config, async (page) => {
          const target = resolveAndAllowlist(config.listingPath, config.baseUrl)
          const response = await page.goto(target, { waitUntil: 'domcontentloaded' })
          if (!response) {
            return { reachable: false, message: 'No response received from the City of Cape Town tender portal.' }
          }
          if (!response.ok()) {
            return { reachable: false, message: `City of Cape Town tender portal responded with HTTP ${response.status()}.` }
          }
          return { reachable: true, message: 'City of Cape Town tender portal responded successfully.' }
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error reaching the City of Cape Town tender portal.'
        return { reachable: false, message }
      }
    },
  }
}
