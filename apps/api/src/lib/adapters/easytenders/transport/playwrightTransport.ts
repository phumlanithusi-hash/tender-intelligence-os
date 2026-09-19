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
 *
 * REVISED after a real first live run (round 1) found the initial
 * best-effort listing selector (`a[href^="/tenders/"]`) matched only
 * nav/sort/pagination links, never an actual card — the real listing
 * markup was confirmed directly via a diagnostic script
 * (easytendersInspect.ts) against the live site:
 *
 *   div.tender-listing
 *     div.card.tender                      (one per opportunity)
 *       div.card-body
 *         a.text-dark[href][data-id]        <- the real detail link
 *           div.pl-1...
 *             div.font-weight-bold.text-primary   <- organisation
 *             div.pt-1.text-dark.font-size-14     <- description
 *             div.closing-date                    <- "Closing <weekday>, D Mon YYYY H:MMAM/PM"
 *
 * The detail page's field extraction (extractDetailPage) was likewise
 * confirmed against one real detail page (easytendersInspectDetail.ts)
 * — its labels are "Department:", "Bid Description:", "Opening Date:",
 * "Closing Date:", "Briefing Session:", and the tender's own reference
 * number appears as "Request for Bid(Open-Tender): <ref>" (or the
 * equivalent "Request for Quotation(...)"/"Request for Proposal(...)"
 * phrasing) rather than a "Reference Number:" label — with a fallback
 * to the trailing "| <ref>" segment of the page's own <h1> when that
 * line isn't present at all, since both were observed on the one real
 * page checked so far.
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
    const cards = Array.from(document.querySelectorAll('.tender-listing .card.tender'))
    const rows: Array<{ slug: string | null; detailUrl: string | null; organisation: string | null; description: string | null; closingDateText: string | null }> = []

    for (const card of cards) {
      const link = card.querySelector('a.text-dark[href]')
      const href = link?.getAttribute('href') ?? null
      const slug = href ? href.split('/').filter(Boolean).pop() ?? null : null
      const organisation = card.querySelector('.font-weight-bold.text-primary')?.textContent?.trim() ?? null
      const description = card.querySelector('.pt-1.text-dark.font-size-14')?.textContent?.trim() ?? null
      // The site's own text is "Closing <weekday>, D Mon YYYY H:MMAM/PM"
      // — strip the leading "Closing" label so the shared date parser
      // (which expects the date to start the string) can read it.
      const closingRaw = card.querySelector('.closing-date')?.textContent?.replace(/\s+/g, ' ').trim() ?? null
      const closingDateText = closingRaw ? closingRaw.replace(/^Closing\s*/i, '') : null

      rows.push({ slug, detailUrl: href, organisation, description, closingDateText })
    }
    return rows
  })
}

/**
 * Text-label extraction (not CSS-class selectors) for the detail
 * page's fields — confirmed against one real page; see this file's
 * module comment.
 *
 * IMPORTANT: nothing inside the `page.evaluate(...)` callback below
 * may be a NAMED function or a `const`/`let` bound to a function
 * value (an arrow function assigned to a const still counts — a real
 * live run confirmed the `__name` failure persisted even after
 * changing a `function field(...) {}` declaration to `const field =
 * (label) => {...}`). This project's tsx/esbuild toolchain wraps every
 * named function binding with an injected `__name(...)` helper call
 * for name-preservation, but Playwright serializes only the callback's
 * own source text into the browser's isolated realm, where `__name`
 * was never defined — every call failed with `ReferenceError: __name
 * is not defined` (visible directly in `tender_source_errors`).
 * ONLY a truly anonymous inline callback passed straight into a
 * method call (e.g. `.map((a) => ({...}))`, never stored in a named
 * variable) escapes this. To extract several labelled fields without
 * a named helper, the label lists are computed in plain Node.js scope
 * (never serialized, so naming there is irrelevant) and passed in as
 * `page.evaluate`'s second argument; the callback then only uses a
 * plain `for` loop over that data, never a nested function of its own.
 * (eTenders' own transport has the identical `const text = (selector)
 * => ...` pattern in its own `page.evaluate` callback and almost
 * certainly has this same bug — flagged separately, not fixed here.)
 */
const DETAIL_FIELD_LABELS: Record<string, readonly string[]> = {
  organisation: ['Department', 'Organisation', 'Organization'],
  // Not confirmed against a real detail page yet (no dedicated
  // "Category:"/"Province:" label was found on the one page checked)
  // — left null rather than guessed if absent, per this project's
  // non-negotiable rule.
  category: ['Category'],
  province: ['Province'],
  description: ['Bid Description', 'Description'],
  advertisedText: ['Opening Date', 'Published Date', 'Advertised'],
  closingDateText: ['Closing Date'],
  briefingText: ['Briefing Session', 'Briefing'],
}

async function extractDetailPage(page: Page): Promise<Omit<RawDetailPage, 'slug' | 'detailUrl'>> {
  const extracted = await page.evaluate((labelsByField: Record<string, readonly string[]>) => {
    const bodyText = document.body.innerText
    const fields: Record<string, string | null> = {}
    for (const key in labelsByField) {
      let value: string | null = null
      for (const label of labelsByField[key]!) {
        const re = new RegExp(`${label}\\s*:?\\s*([^\\n]+)`, 'i')
        const match = bodyText.match(re)
        if (match) {
          value = match[1]!.trim()
          break
        }
      }
      fields[key] = value
    }

    const rawH1 = document.querySelector('h1')?.textContent?.trim() ?? null
    let title = rawH1
    let tenderNumberFromH1: string | null = null
    if (rawH1 && rawH1.includes('|')) {
      const parts = rawH1.split('|').map((p) => p.trim())
      tenderNumberFromH1 = parts[parts.length - 1] || null
      title = parts.slice(0, -1).join(' | ').trim() || rawH1
    }

    // The tender's own reference appears as "Request for
    // Bid(Open-Tender): <ref>" (or Quotation/Proposal) rather than
    // under a "Reference Number:" label — falls back to the <h1>'s
    // trailing "| <ref>" segment when that line is absent.
    const requestForMatch = bodyText.match(/Request for (?:Bid|Quotation|Proposal)s?\s*\([^)]*\)\s*:\s*([^\n]+)/i)
    const tenderNumber = (requestForMatch ? requestForMatch[1]!.trim() : null) ?? tenderNumberFromH1

    const documents = Array.from(
      document.querySelectorAll('a[href*="documents.easytenders.co.za"], a[href$=".pdf"], a[href$=".doc"], a[href$=".docx"]'),
    ).map((a) => ({
      url: a.getAttribute('href'),
      label: a.textContent?.trim() ?? null,
    }))

    return { title, tenderNumber, fields, documents }
  }, DETAIL_FIELD_LABELS)

  return {
    title: extracted.title,
    tenderNumber: extracted.tenderNumber,
    organisation: extracted.fields.organisation ?? null,
    category: extracted.fields.category ?? null,
    province: extracted.fields.province ?? null,
    description: extracted.fields.description ?? null,
    advertisedText: extracted.fields.advertisedText ?? null,
    closingDateText: extracted.fields.closingDateText ?? null,
    briefingText: extracted.fields.briefingText ?? null,
    documents: extracted.documents as RawDocumentLink[],
  }
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
        await page.waitForSelector('.tender-listing .card.tender', { timeout: config.navigationTimeoutMs }).catch(() => undefined)
        return extractListingRows(page)
      })
    },

    async fetchDetailPage(detailUrl: string, slug: string): Promise<RawDetailPage> {
      return withBrowser(config, async (page) => {
        const target = resolveAndAllowlist(detailUrl, config.baseUrl)
        await page.goto(target, { waitUntil: 'domcontentloaded' })
        // A real live run found `documentsDiscovered: 0` across 500
        // real tenders despite a diagnostic script (which added a
        // fixed wait after navigation) confirming a real detail page
        // does have a document link — the "Documents" tab's content
        // renders asynchronously after `domcontentloaded` fires, so
        // extracting immediately raced it and always lost. This waits
        // for an actual document link to appear (bounded, so a tender
        // that genuinely has none doesn't stall the whole scan).
        await page
          .waitForSelector('a[href*="documents.easytenders.co.za"], a[href$=".pdf"], a[href$=".doc"], a[href$=".docx"]', {
            timeout: 5_000,
          })
          .catch(() => undefined)
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
