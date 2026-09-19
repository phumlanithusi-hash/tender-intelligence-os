/// <reference lib="dom" />
// DOM typings ONLY for the page.evaluate(() => ...) callback bodies
// below — same convention as every other adapter's transport file.
import type { Browser, Page } from 'playwright-core'
import { isAllowedDocumentUrl } from '../allowlist.js'
import type { JoburgTransport, RawBidProposalRow } from '../types.js'

/**
 * REAL transport against the City of Johannesburg's live "Current Bid
 * Proposals" listing page — see types.ts's module comment for the
 * multi-round live investigation that found this real URL among
 * several stale decoys.
 *
 * IMPORTANT: this callback deliberately avoids ANY named
 * function/arrow binding inside page.evaluate (only inline anonymous
 * arrows passed directly as arguments, e.g. `.map((a) => ({...}))`,
 * and plain for/if control flow) — this codebase's tsx/esbuild
 * `keepNames` transform wraps a named binding in an `__name(fn, ...)`
 * call that then throws `ReferenceError: __name is not defined` when
 * serialized into the page's isolated V8 realm (found and fixed the
 * hard way in the EasyTenders and eTenders adapters — see their
 * playwrightTransport.ts comments for the full story). Writing this
 * adapter's callback the safe way from the start avoids repeating
 * that bug hunt.
 */
export interface PlaywrightTransportConfig {
  baseUrl: string
  /** Year-specific — see types.ts's module comment. Update when the City publishes a new year's page. */
  listingPath: string
  executablePath?: string
  navigationTimeoutMs: number
}

export const DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG: PlaywrightTransportConfig = {
  baseUrl: 'https://www.joburg.org.za',
  listingPath: '/work_/Pages/2026-Tenders/2026-Bid-Proposals.aspx',
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  navigationTimeoutMs: 45_000,
}

export function resolveAndAllowlist(url: string, baseUrl: string): string {
  const absolute = new URL(url, baseUrl).toString()
  if (!isAllowedDocumentUrl(absolute)) {
    throw Object.assign(new Error(`Refusing to fetch a URL outside the City of Johannesburg domain allow-list: ${absolute}`), {
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

async function extractBidProposalRows(page: Page): Promise<RawBidProposalRow[]> {
  return page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll('table tr'))
    const rows: Array<{ referenceNumber: string | null; description: string | null; closingDateText: string | null; documents: Array<{ url: string | null; label: string | null }> }> = []
    for (const tr of trs) {
      const cells = Array.from(tr.querySelectorAll('td'))
      if (cells.length < 3) continue // The header row uses <th>, not <td> — this also skips it.
      const refCell = cells[0]!
      const anchors = Array.from(refCell.querySelectorAll('a[href]'))
      if (anchors.length === 0) continue // No document link at all — nothing usable to identify this row by.
      const referenceNumber = anchors[0]!.textContent?.replace(/\s+/g, ' ').trim() ?? null
      const documents = anchors.map((a) => ({
        url: a.getAttribute('href'),
        label: a.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      }))
      const description = cells[1]!.textContent?.replace(/\s+/g, ' ').trim() ?? null
      const closingDateText = cells[2]!.textContent?.replace(/\s+/g, ' ').trim() ?? null
      rows.push({ referenceNumber, description, closingDateText, documents })
    }
    return rows
  })
}

export function createPlaywrightTransport(config: PlaywrightTransportConfig = DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG): JoburgTransport {
  return {
    async fetchBidProposalsPage(): Promise<RawBidProposalRow[]> {
      return withBrowser(config, async (page) => {
        const target = resolveAndAllowlist(config.listingPath, config.baseUrl)
        await page.goto(target, { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('table', { timeout: config.navigationTimeoutMs }).catch(() => undefined)
        return extractBidProposalRows(page)
      })
    },

    async checkReachable(): Promise<{ reachable: boolean; message: string }> {
      try {
        return await withBrowser(config, async (page) => {
          const target = resolveAndAllowlist(config.listingPath, config.baseUrl)
          const response = await page.goto(target, { waitUntil: 'domcontentloaded' })
          if (!response) {
            return { reachable: false, message: 'No response received from the City of Johannesburg bid-proposals page.' }
          }
          if (!response.ok()) {
            return { reachable: false, message: `City of Johannesburg responded with HTTP ${response.status()}.` }
          }
          return { reachable: true, message: 'City of Johannesburg bid-proposals page responded successfully.' }
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error reaching the City of Johannesburg site.'
        return { reachable: false, message }
      }
    },
  }
}
