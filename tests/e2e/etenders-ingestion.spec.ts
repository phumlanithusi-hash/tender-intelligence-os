import { test, expect, type Page } from '@playwright/test'
import {
  FIXTURE_ETENDERS_SOURCE,
  FIXTURE_ETENDERS_SOURCE_SUMMARY,
  FIXTURE_ETENDERS_SCAN,
  FIXTURE_ETENDERS_ERRORS,
  FIXTURE_DISCOVERED_TENDER,
  FIXTURE_DISCOVERED_TENDER_LIST_ROW,
  FIXTURE_DISCOVERED_TENDER_SUMMARY,
  FIXTURE_DISCOVERED_TENDER_DOCUMENTS,
  FIXTURE_ME,
} from './fixtures/etendersIngestion.js'

/**
 * Phase 5 controlled ingestion E2E flow (Phase 5 §29): confirms the
 * Tender Radar and Source Registry UIs correctly display the RESULT
 * of an eTenders ingestion run — a DISCOVERED tender with its
 * discovered documents, and a PARTIAL scan with its recorded error —
 * without ever running a real scan or reaching the live site. Follows
 * the exact fixture/mock pattern of tender-radar.spec.ts and
 * source-registry.spec.ts; every `/api/*` call is intercepted.
 *
 * What this test is protecting: Phase 5 §8/§26/§27 — discovery must
 * never be presented as verification. A tender straight out of
 * ingestion must show status "Discovered", no opportunity score, and
 * its documents as discovered-only (no download link) — this is the
 * one flow only Phase 5 introduces, so it gets its own spec rather
 * than folding into tender-radar.spec.ts's existing scored-tender
 * assertions.
 */

const FAKE_ACCESS_TOKEN = 'e2e-fixture-access-token'

async function signInWithFixtureSession(page: Page) {
  await page.addInitScript(
    ({ storageKey, accessToken }) => {
      const oneHourFromNow = Math.round(Date.now() / 1000) + 3600
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          access_token: accessToken,
          refresh_token: 'e2e-fixture-refresh-token',
          expires_at: oneHourFromNow,
          expires_in: 3600,
          token_type: 'bearer',
          user: {
            id: '00000000-0000-4000-8000-0000000000e2',
            email: 'e2e-fixture@tender-os.test',
            app_metadata: {},
            user_metadata: {},
            aud: 'authenticated',
            created_at: '2026-01-01T00:00:00.000Z',
          },
        }),
      )
    },
    { storageKey: 'sb-e2efixture-auth-token', accessToken: FAKE_ACCESS_TOKEN },
  )
}

async function mockIngestionApi(page: Page) {
  await page.route('**/api/me', (route) => route.fulfill({ json: FIXTURE_ME }))

  // Tender Radar side.
  await page.route('**/api/tenders/summary', (route) => route.fulfill({ json: FIXTURE_DISCOVERED_TENDER_SUMMARY }))
  await page.route('**/api/tenders?**', (route) =>
    route.fulfill({ json: { rows: [FIXTURE_DISCOVERED_TENDER_LIST_ROW], page: 1, pageSize: 25, total: 1, totalPages: 1 } }),
  )
  await page.route(`**/api/tenders/${FIXTURE_DISCOVERED_TENDER.id}`, (route) => {
    if (route.request().url().includes(`/api/tenders/${FIXTURE_DISCOVERED_TENDER.id}/`)) return route.fallback()
    return route.fulfill({ json: FIXTURE_DISCOVERED_TENDER })
  })
  await page.route(`**/api/tenders/${FIXTURE_DISCOVERED_TENDER.id}/documents`, (route) =>
    route.fulfill({ json: { rows: FIXTURE_DISCOVERED_TENDER_DOCUMENTS } }),
  )
  for (const sub of ['requirements', 'evaluation', 'addenda', 'briefing', 'risks', 'activity']) {
    await page.route(`**/api/tenders/${FIXTURE_DISCOVERED_TENDER.id}/${sub}`, (route) =>
      route.fulfill({ json: { rows: [] } }),
    )
  }
  await page.route(`**/api/tenders/${FIXTURE_DISCOVERED_TENDER.id}/score`, (route) =>
    route.fulfill({ json: { score: null } }),
  )
  await page.route('**/api/services**', (route) => route.fulfill({ json: { rows: [] } }))
  await page.route('**/api/tender-sources**', (route) => {
    const url = route.request().url()
    if (url.endsWith('/summary')) return route.fulfill({ json: FIXTURE_ETENDERS_SOURCE_SUMMARY })
    if (url.includes(`/tender-sources/${FIXTURE_ETENDERS_SOURCE.id}/scans`)) {
      return route.fulfill({ json: { rows: [FIXTURE_ETENDERS_SCAN], limit: 20, offset: 0 } })
    }
    if (url.includes(`/tender-sources/${FIXTURE_ETENDERS_SOURCE.id}/errors`)) {
      return route.fulfill({ json: { rows: FIXTURE_ETENDERS_ERRORS, limit: 20, offset: 0 } })
    }
    if (url.endsWith(`/tender-sources/${FIXTURE_ETENDERS_SOURCE.id}`)) {
      return route.fulfill({ json: FIXTURE_ETENDERS_SOURCE })
    }
    return route.fulfill({ json: { rows: [FIXTURE_ETENDERS_SOURCE], limit: 100, offset: 0 } })
  })
  await page.route('**/api/watchlist**', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { rows: [] } })
    return route.fulfill({ status: 204, body: '' })
  })
  await page.route('**/api/saved-filters**', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { rows: [] } })
    return route.fulfill({ status: 204, body: '' })
  })
}

test.describe('Phase 5 — eTenders ingestion result, as displayed (not a live scan)', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithFixtureSession(page)
    await mockIngestionApi(page)
  })

  test('a discovered eTenders tender shows as Discovered, with no opportunity score, and its documents as discovered-only', async ({
    page,
  }) => {
    await page.goto('/tenders')

    await expect(page.getByText(FIXTURE_DISCOVERED_TENDER_LIST_ROW.title)).toBeVisible()
    // The Score column shows "—", never a fabricated number (Phase 5 §26/§27 — no AI classification exists yet).
    await expect(page.getByRole('link', { name: /Open Appointment of a service/ }).getByText('DISCOVERED')).toBeVisible()

    await page.getByText(FIXTURE_DISCOVERED_TENDER_LIST_ROW.title).click()
    await expect(page).toHaveURL(new RegExp(`/tenders/${FIXTURE_DISCOVERED_TENDER.id}$`))

    await page.getByRole('tab', { name: 'Documents' }).click()
    await expect(page.getByText(FIXTURE_DISCOVERED_TENDER_DOCUMENTS[0]!.filename)).toBeVisible()
    // Discovery-only (Phase 5 §17/§18): the document's source URL is known (so "Open" links straight to eTenders'
    // own site, not a locally-stored copy) — the file itself was never downloaded into this system.
    const openLink = page.getByRole('link', { name: 'Open' })
    await expect(openLink).toBeVisible()
    await expect(openLink).toHaveAttribute('href', FIXTURE_DISCOVERED_TENDER_DOCUMENTS[0]!.file_url)
  })

  test('the Source Registry shows eTenders as CONFIGURED (not ACTIVE) with its PARTIAL scan and recorded error', async ({
    page,
  }) => {
    await page.goto('/sources')
    await expect(page.getByText(FIXTURE_ETENDERS_SOURCE.name)).toBeVisible()

    await page.getByText(FIXTURE_ETENDERS_SOURCE.name).click()
    await expect(page).toHaveURL(new RegExp(`/sources/${FIXTURE_ETENDERS_SOURCE.id}$`))

    await page.getByRole('tab', { name: 'Scan History' }).click()
    await expect(page.getByText('PARTIAL')).toBeVisible()

    await page.getByRole('tab', { name: 'Errors' }).click()
    await expect(page.getByText(FIXTURE_ETENDERS_ERRORS[0]!.message)).toBeVisible()
  })
})
