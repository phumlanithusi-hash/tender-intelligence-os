import { test, expect, type Page } from '@playwright/test'
import {
  FIXTURE_TENDER_SCORED,
  FIXTURE_SUMMARY,
  FIXTURE_EXTRACTED_REQUIREMENTS,
  FIXTURE_EVALUATION_CRITERIA,
  FIXTURE_SERVICES,
  FIXTURE_SOURCES,
} from './fixtures/tenders.js'
import { FIXTURE_ME_ADMIN } from './fixtures/documentPipeline.js'
import { FIXTURE_QUEUED_RUN, FIXTURE_COMPLETED_RUN, FIXTURE_CLASSIFICATION } from './fixtures/aiClassification.js'

/**
 * Phase 7 §37 E2E flow: open a tender, open AI Classification, trigger
 * a run, see it appear, see the result become available with
 * relevance/services/summary, and open evidence to see its source
 * page/section/chunk provenance. The AI provider is mocked entirely
 * at the `/api/tenders/:id/ai/*` network boundary — no real OpenAI
 * call or backend is involved, same convention as
 * document-pipeline.spec.ts.
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

async function mockApi(page: Page, { classifyReturnsQueued }: { classifyReturnsQueued: boolean }) {
  let classified = false
  let triggered = false

  await page.route('**/api/me', (route) => route.fulfill({ json: FIXTURE_ME_ADMIN }))
  await page.route('**/api/tenders/summary', (route) => route.fulfill({ json: FIXTURE_SUMMARY }))
  await page.route('**/api/tenders?**', (route) =>
    route.fulfill({ json: { rows: [], page: 1, pageSize: 25, total: 0, totalPages: 1 } }),
  )
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}`, (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: FIXTURE_TENDER_SCORED })
    return route.continue()
  })
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/requirements`, (route) =>
    route.fulfill({ json: { requirements: FIXTURE_EXTRACTED_REQUIREMENTS, conflicts: [] } }),
  )
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/evaluation`, (route) =>
    route.fulfill({ json: { criteria: FIXTURE_EVALUATION_CRITERIA, gates: [], conflicts: [] } }),
  )
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/requirements/runs`, (route) => route.fulfill({ json: [] }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/documents`, (route) => route.fulfill({ json: { rows: [] } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/addenda`, (route) => route.fulfill({ json: { rows: [] } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/briefing`, (route) => route.fulfill({ json: { rows: [] } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/score`, (route) => route.fulfill({ json: { score: null } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/risks`, (route) => route.fulfill({ json: { rows: [] } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/activity`, (route) => route.fulfill({ json: { rows: [] } }))
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

  // --- Phase 7 AI routes -------------------------------------------------
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/ai/classification`, (route) => {
    if (!classified) return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'none yet' } } })
    return route.fulfill({ json: FIXTURE_CLASSIFICATION })
  })
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/ai/runs`, (route) => {
    if (!triggered) return route.fulfill({ json: [] })
    return route.fulfill({ json: classified ? [FIXTURE_COMPLETED_RUN] : [FIXTURE_QUEUED_RUN] })
  })
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/ai/classify`, (route) => {
    triggered = true
    if (classifyReturnsQueued) {
      // Simulate the run completing shortly after being queued.
      setTimeout(() => {
        classified = true
      }, 500)
    } else {
      classified = true
    }
    return route.fulfill({ status: 202, json: { status: 'QUEUED', tenderId: FIXTURE_TENDER_SCORED.id } })
  })
}

test.describe('Phase 7 — AI Discovery & Classification', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithFixtureSession(page)
  })

  test('open tender -> trigger classification -> run appears -> result becomes available with evidence', async ({ page }) => {
    await mockApi(page, { classifyReturnsQueued: true })

    await page.goto(`/tenders/${FIXTURE_TENDER_SCORED.id}`)
    await page.getByRole('tab', { name: 'AI Classification' }).click()

    await expect(page.getByText('No AI classification exists for this tender yet.')).toBeVisible()

    await page.getByRole('button', { name: 'Classify with AI' }).click()

    // The run appears and the button reflects the in-flight state.
    await expect(page.getByRole('button', { name: 'Run in progress…' })).toBeVisible()

    // Polling picks up the completed run + classification (Phase 7 §32).
    await expect(page.getByText('RELEVANT')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Graphic Design (88%)')).toBeVisible()
    await expect(page.getByText(/appointment of a service provider/)).toBeVisible()

    // Evidence expands to show provenance and the canonical stored text.
    await page.getByRole('button', { name: /View evidence/ }).first().click()
    await expect(page.getByText(/Page 14/)).toBeVisible()
    await expect(page.getByText(/corporate brochures and annual reports/)).toBeVisible()
  })

  test('an already-classified tender shows the current result directly, with truth states visible', async ({ page }) => {
    await mockApi(page, { classifyReturnsQueued: false })
    await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/ai/classification`, (route) =>
      route.fulfill({ json: FIXTURE_CLASSIFICATION }),
    )

    await page.goto(`/tenders/${FIXTURE_TENDER_SCORED.id}`)
    await page.getByRole('tab', { name: 'AI Classification' }).click()

    await expect(page.getByRole('button', { name: 'Reclassify' })).toBeVisible()
    await expect(page.getByText('Inference').first()).toBeVisible()
    await expect(page.getByText('Fact').first()).toBeVisible()
  })
})
