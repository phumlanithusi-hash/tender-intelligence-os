import { test, expect, type Page } from '@playwright/test'
import {
  FIXTURE_SOURCE,
  FIXTURE_SOURCE_SUMMARY,
  FIXTURE_SOURCE_SCANS,
  FIXTURE_SOURCE_ERRORS,
  FIXTURE_ME,
} from './fixtures/sources.js'

/**
 * Phase 4 critical-path E2E flow (Phase 4 §26): open /sources, select
 * a source, inspect its health and scan history, and return to the
 * source list. Runs against the same fixture-auth dev server as
 * tests/e2e/tender-radar.spec.ts (tests/e2e/playwright.config.ts's
 * `chromium-fixture-auth` project, :5174) — sign-in is faked
 * client-side the same way, and every `/api/*` call is intercepted
 * and answered from tests/e2e/fixtures/sources.ts. No real source is
 * ever scanned (Phase 4 §26: "No real scraping").
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

async function mockSourceRegistryApi(page: Page) {
  await page.route('**/api/me', (route) => route.fulfill({ json: FIXTURE_ME }))

  await page.route('**/api/tender-sources/summary', (route) => route.fulfill({ json: FIXTURE_SOURCE_SUMMARY }))

  await page.route('**/api/tender-sources?**', (route) => {
    if (route.request().url().includes('/summary')) return route.fallback()
    return route.fulfill({ json: { rows: [FIXTURE_SOURCE], limit: 100, offset: 0 } })
  })

  await page.route(`**/api/tender-sources/${FIXTURE_SOURCE.id}`, (route) => {
    if (route.request().url().includes(`/api/tender-sources/${FIXTURE_SOURCE.id}/`)) return route.fallback()
    return route.fulfill({ json: FIXTURE_SOURCE })
  })
  await page.route(`**/api/tender-sources/${FIXTURE_SOURCE.id}/scans**`, (route) =>
    route.fulfill({ json: { rows: FIXTURE_SOURCE_SCANS, limit: 20, offset: 0 } }),
  )
  await page.route(`**/api/tender-sources/${FIXTURE_SOURCE.id}/errors**`, (route) =>
    route.fulfill({ json: { rows: FIXTURE_SOURCE_ERRORS, limit: 20, offset: 0 } }),
  )
}

test.describe('Phase 4 — Source Registry critical path', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithFixtureSession(page)
    await mockSourceRegistryApi(page)
  })

  test('browse sources, open a source, inspect health and scan history, and return', async ({ page }) => {
    await page.goto('/sources')

    await expect(page.getByRole('heading', { name: 'Source Registry' })).toBeVisible()
    // Summary renders the real fixture counts.
    await expect(page.getByText('Total Sources')).toBeVisible()
    await expect(page.getByText(FIXTURE_SOURCE.name)).toBeVisible()

    // Select the source → detail page.
    await page.getByText(FIXTURE_SOURCE.name).click()
    await expect(page).toHaveURL(new RegExp(`/sources/${FIXTURE_SOURCE.id}$`))
    await expect(page.getByRole('heading', { name: FIXTURE_SOURCE.name })).toBeVisible()

    // Health tab.
    await page.getByRole('tab', { name: 'Health' }).click()
    await expect(page.getByText('Current status')).toBeVisible()

    // Scan History tab.
    await page.getByRole('tab', { name: 'Scan History' }).click()
    await expect(page.getByText('SUCCESS')).toBeVisible()

    // Back to the Source Registry.
    await page.getByRole('link', { name: /Source Registry/ }).click()
    await expect(page.getByRole('heading', { name: 'Source Registry' })).toBeVisible()
  })
})
