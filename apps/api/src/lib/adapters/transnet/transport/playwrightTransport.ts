/// <reference lib="dom" />
import type { Browser, Page } from 'playwright-core'
import { isAllowedDocumentUrl } from '../allowlist.js'
import type { RawTransnetTender, TransnetTransport } from '../types.js'

export interface PlaywrightTransportConfig {
  baseUrl: string
  executablePath?: string
  navigationTimeoutMs: number
}

export const DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG: PlaywrightTransportConfig = {
  baseUrl: 'https://transnetetenders.azurewebsites.net',
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  navigationTimeoutMs: 45_000,
}

export function resolveAndAllowlist(url: string, baseUrl: string): string {
  const absolute = new URL(url, baseUrl).toString()
  if (!isAllowedDocumentUrl(absolute)) {
    throw Object.assign(new Error(`Refusing to fetch a URL outside the Transnet domain allow-list: ${absolute}`), {
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
 * The JSON endpoint is same-origin to the app page, so this navigates
 * to the app page once (establishing the right origin) and then calls
 * it via an in-page `fetch()` — confirmed live to work with no
 * special headers or auth. Only `GetAdvertisedTenders` (the "Open
 * Tenders" tab) is called — see types.ts's module comment for why
 * `GetOtherAdvertisedTendersCached` (a historical archive, not a
 * second feed of open opportunities) is deliberately never fetched.
 */
export function createPlaywrightTransport(config: PlaywrightTransportConfig = DEFAULT_PLAYWRIGHT_TRANSPORT_CONFIG): TransnetTransport {
  return {
    async fetchAllTenders(): Promise<RawTransnetTender[]> {
      return withBrowser(config, async (page) => {
        const target = resolveAndAllowlist('/Home/AdvertisedTenders', config.baseUrl)
        await page.goto(target, { waitUntil: 'domcontentloaded' })

        const openResult = await page.evaluate(async () => {
          const resp = await fetch('/Home/GetAdvertisedTenders')
          if (!resp.ok) return { success: false, result: [] }
          return resp.json()
        })

        const openRows = Array.isArray((openResult as { result?: unknown[] })?.result) ? (openResult as { result: unknown[] }).result : []
        return openRows as RawTransnetTender[]
      })
    },

    async checkReachable(): Promise<{ reachable: boolean; message: string }> {
      try {
        return await withBrowser(config, async (page) => {
          const target = resolveAndAllowlist('/Home/AdvertisedTenders', config.baseUrl)
          const response = await page.goto(target, { waitUntil: 'domcontentloaded' })
          if (!response) {
            return { reachable: false, message: 'No response received from the Transnet e-Tender system.' }
          }
          if (!response.ok()) {
            return { reachable: false, message: `Transnet e-Tender system responded with HTTP ${response.status()}.` }
          }
          return { reachable: true, message: 'Transnet e-Tender system responded successfully.' }
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error reaching the Transnet e-Tender system.'
        return { reachable: false, message }
      }
    },
  }
}
