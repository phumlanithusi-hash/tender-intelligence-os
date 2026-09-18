import { test, expect, type Page } from '@playwright/test'
import {
  FIXTURE_TENDER_SCORED,
  FIXTURE_TENDER_LIST_ROW,
  FIXTURE_SUMMARY,
  FIXTURE_EXTRACTED_REQUIREMENTS,
  FIXTURE_EVALUATION_CRITERIA,
  FIXTURE_SERVICES,
  FIXTURE_SOURCES,
} from './fixtures/tenders.js'

/**
 * Phase 3 critical-path E2E flow (Phase 3 §25): open /tenders, apply a
 * filter, select a tender, open its detail page, inspect
 * Requirements/Evaluation, and return to the Tender Radar.
 *
 * This test requires apps/web/.env.local to hold a syntactically
 * valid but non-real Supabase URL/anon key (tests/e2e/README.md) —
 * signing in is faked entirely client-side by seeding the exact
 * localStorage shape @supabase/supabase-js reads a session from
 * (`sb-<ref>-auth-token`), so no real Supabase project, network call,
 * or credential is ever involved. Every `/api/*` call is intercepted
 * and answered from the fixtures above — no live tender data, and no
 * real backend needs to be running (Phase 3 §25: "Do not require live
 * tender data for tests").
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
    // Must match apps/web/.env.local's VITE_SUPABASE_URL host label —
    // see the derivation in @supabase/supabase-js's SupabaseClient.js.
    { storageKey: 'sb-e2efixture-auth-token', accessToken: FAKE_ACCESS_TOKEN },
  )
}

async function mockTenderApi(page: Page) {
  await page.route('**/api/tenders/summary', (route) =>
    route.fulfill({ json: FIXTURE_SUMMARY }),
  )

  await page.route('**/api/tenders?**', (route) =>
    route.fulfill({
      json: { rows: [FIXTURE_TENDER_LIST_ROW], page: 1, pageSize: 25, total: 1, totalPages: 1 },
    }),
  )

  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}`, (route) => {
    if (route.request().url().includes(`/api/tenders/${FIXTURE_TENDER_SCORED.id}/`)) {
      return route.fallback()
    }
    return route.fulfill({ json: FIXTURE_TENDER_SCORED })
  })

  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/requirements`, (route) =>
    route.fulfill({ json: { requirements: FIXTURE_EXTRACTED_REQUIREMENTS, conflicts: [] } }),
  )
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/evaluation`, (route) =>
    route.fulfill({ json: { criteria: FIXTURE_EVALUATION_CRITERIA, gates: [], conflicts: [] } }),
  )
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/requirements/runs`, (route) => route.fulfill({ json: [] }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/documents`, (route) =>
    route.fulfill({ json: { rows: [] } }),
  )
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/addenda`, (route) =>
    route.fulfill({ json: { rows: [] } }),
  )
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/briefing`, (route) =>
    route.fulfill({ json: { rows: [] } }),
  )
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/score`, (route) =>
    route.fulfill({ json: { score: null } }),
  )
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/risks`, (route) =>
    route.fulfill({ json: { rows: [] } }),
  )
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/activity`, (route) =>
    route.fulfill({ json: { rows: [] } }),
  )

  await page.route('**/api/services**', (route) => route.fulfill({ json: { rows: FIXTURE_SERVICES } }))
  await page.route('**/api/tender-sources**', (route) => route.fulfill({ json: { rows: FIXTURE_SOURCES } }))
  await page.route('**/api/watchlist**', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { rows: [] } })
    return route.fulfill({ status: 204, body: '' })
  })
  await page.route('**/api/saved-filters**', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { rows: [] } })
    return route.fulfill({ status: 204, body: '' })
  })
}

test.describe('Phase 3 — Tender Radar critical path', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithFixtureSession(page)
    await mockTenderApi(page)
  })

  test('browse, filter, open a tender, and inspect requirements/evaluation', async ({ page }) => {
    await page.goto('/tenders')

    await expect(page.getByRole('heading', { name: 'Tender Radar' })).toBeVisible()
    // KPI strip renders the real fixture summary values, not invented numbers.
    await expect(page.getByText('Open Tenders')).toBeVisible()

    await expect(page.getByText(FIXTURE_TENDER_LIST_ROW.title)).toBeVisible()

    // Apply a filter (Status) — the table re-requests /api/tenders,
    // still answered by the same fixture mock.
    const statusSelect = page.getByLabel('Status')
    await statusSelect.selectOption('OPEN')
    await expect(page.getByText(FIXTURE_TENDER_LIST_ROW.title)).toBeVisible()

    // Select the tender row → detail page.
    await page.getByText(FIXTURE_TENDER_LIST_ROW.title).click()
    await expect(page).toHaveURL(new RegExp(`/tenders/${FIXTURE_TENDER_SCORED.id}$`))
    await expect(page.getByRole('heading', { name: FIXTURE_TENDER_SCORED.title })).toBeVisible()

    // Requirements tab.
    await page.getByRole('tab', { name: 'Requirements' }).click()
    await expect(page.getByText(FIXTURE_EXTRACTED_REQUIREMENTS[0]!.title, { exact: true })).toBeVisible()

    // Evaluation tab.
    await page.getByRole('tab', { name: 'Evaluation' }).click()
    await expect(page.getByText(FIXTURE_EVALUATION_CRITERIA[0]!.name, { exact: true })).toBeVisible()

    // Back to the Tender Radar.
    await page.getByRole('link', { name: /Tender Radar/ }).click()
    await expect(page.getByRole('heading', { name: 'Tender Radar' })).toBeVisible()
  })
})
