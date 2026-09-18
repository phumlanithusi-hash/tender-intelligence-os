import { test, expect, type Page } from '@playwright/test'
import { FIXTURE_TENDER_SCORED, FIXTURE_SUMMARY, FIXTURE_EXTRACTED_REQUIREMENTS, FIXTURE_EVALUATION_CRITERIA, FIXTURE_SERVICES, FIXTURE_SOURCES } from './fixtures/tenders.js'
import { FIXTURE_ME_ADMIN } from './fixtures/documentPipeline.js'
import { FIXTURE_QUALIFICATION, FIXTURE_QUAL_REQUIREMENTS, FIXTURE_QUAL_ACTIONS, FIXTURE_QUAL_RUN } from './fixtures/qualification.js'

/**
 * Phase 8 §39 E2E flow: open tender -> open Qualification -> requirements
 * appear -> evaluate qualification -> mandatory PASS/FAIL/UNKNOWN/
 * REQUIRES_ACTION states appear -> overall qualification state appears ->
 * actions appear -> evidence can be inspected -> human review can be
 * recorded. The `/api/tenders/:id/qualification*` routes are mocked
 * entirely at the network level — no live OpenAI call is involved (the
 * qualification engine itself has no external network dependency at
 * all), same convention as ai-classification.spec.ts.
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

async function mockApi(page: Page, { evaluated }: { evaluated: boolean }) {
  let hasRun = evaluated
  let reviewed = false

  await page.route('**/api/me', (route) => route.fulfill({ json: FIXTURE_ME_ADMIN }))
  await page.route('**/api/tenders/summary', (route) => route.fulfill({ json: FIXTURE_SUMMARY }))
  await page.route('**/api/tenders?**', (route) => route.fulfill({ json: { rows: [], page: 1, pageSize: 25, total: 0, totalPages: 1 } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}`, (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: FIXTURE_TENDER_SCORED })
    return route.continue()
  })
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/requirements`, (route) => route.fulfill({ json: { requirements: FIXTURE_EXTRACTED_REQUIREMENTS, conflicts: [] } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/evaluation`, (route) => route.fulfill({ json: { criteria: FIXTURE_EVALUATION_CRITERIA, gates: [], conflicts: [] } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/requirements/runs`, (route) => route.fulfill({ json: [] }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/documents`, (route) => route.fulfill({ json: { rows: [] } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/addenda`, (route) => route.fulfill({ json: { rows: [] } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/briefing`, (route) => route.fulfill({ json: { rows: [] } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/score`, (route) => route.fulfill({ json: { score: null } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/risks`, (route) => route.fulfill({ json: { rows: [] } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/activity`, (route) => route.fulfill({ json: { rows: [] } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/ai/classification`, (route) => route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'none yet' } } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/ai/runs`, (route) => route.fulfill({ json: [] }))
  await page.route('**/api/services**', (route) => route.fulfill({ json: { rows: FIXTURE_SERVICES } }))
  await page.route('**/api/tender-sources**', (route) => route.fulfill({ json: { rows: FIXTURE_SOURCES } }))
  await page.route('**/api/watchlist**', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { rows: [] } }) : route.fulfill({ status: 204, body: '' })))
  await page.route('**/api/saved-filters**', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { rows: [] } }) : route.fulfill({ status: 204, body: '' })))

  // --- Phase 8 qualification routes -------------------------------------------------
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/qualification/requirements`, (route) => route.fulfill({ json: FIXTURE_QUAL_REQUIREMENTS }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/qualification/actions`, (route) => route.fulfill({ json: hasRun ? FIXTURE_QUAL_ACTIONS : [] }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/qualification/evaluate`, (route) => {
    hasRun = true
    return route.fulfill({ json: { runId: FIXTURE_QUAL_RUN.id, overallStatus: FIXTURE_QUAL_RUN.overallStatus } })
  })
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/qualification/review`, (route) => {
    reviewed = true
    return route.fulfill({ status: 201, json: { id: '00000000-0000-4000-8000-0000000000c9' } })
  })
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/qualification`, (route) => {
    if (!hasRun) return route.fulfill({ json: { run: null, results: [] } })
    void reviewed
    return route.fulfill({ json: FIXTURE_QUALIFICATION })
  })
}

test.describe('Phase 8 — Qualification & Compliance Intelligence', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithFixtureSession(page)
  })

  test('open tender -> open Qualification -> requirements appear -> evaluate -> states + overall status + actions appear -> evidence inspectable -> review recorded', async ({ page }) => {
    await mockApi(page, { evaluated: false })

    await page.goto(`/tenders/${FIXTURE_TENDER_SCORED.id}`)
    await page.getByRole('tab', { name: 'Qualification' }).click()

    // Requirements table appears even before an evaluation has run.
    await expect(page.getByText('Bidders must be registered on the Central Supplier Database.')).toBeVisible()
    await expect(page.getByText('Qualification has not been evaluated yet.')).toBeVisible()

    await page.getByRole('button', { name: 'Evaluate qualification' }).click()

    // Overall status (worded as "no mandatory blocker found" style / ACTION_REQUIRED) appears.
    await expect(page.getByText('Action required').first()).toBeVisible({ timeout: 10_000 })

    // Per-requirement states appear — REQUIRES_ACTION for CSD, UNKNOWN for the preferential B-BBEE item.
    await expect(page.getByText('Action required').nth(1)).toBeVisible()
    await expect(page.getByText('Unknown').first()).toBeVisible()

    // No mandatory blocker in this fixture, so the "MANDATORY BLOCKER" banner must NOT appear —
    // REQUIRES_ACTION must never be presented as a mandatory failure.
    await expect(page.getByText(/MANDATORY BLOCKER/)).toHaveCount(0)

    // Outstanding action appears.
    await expect(page.getByText('Register on the Central Supplier Database (CSD).')).toBeVisible()

    // Evidence can be inspected.
    await page.getByRole('button', { name: /View evidence/ }).first().click()
    await expect(page.getByText(/Page 3/)).toBeVisible()
    await expect(page.getByText(/at the time of submission/)).toBeVisible()

    // Human review can be recorded.
    await page.getByRole('button', { name: 'Record review' }).first().click()
    await page.getByPlaceholder('Decision / note').fill('Confirmed with agency ops team — CSD registration in progress.')
    await page.getByRole('button', { name: 'Submit review' }).click()
    await expect(page.getByText('Record human review decision')).not.toBeVisible()
  })

  test('an already-evaluated tender shows the current run directly', async ({ page }) => {
    await mockApi(page, { evaluated: true })

    await page.goto(`/tenders/${FIXTURE_TENDER_SCORED.id}`)
    await page.getByRole('tab', { name: 'Qualification' }).click()

    await expect(page.getByRole('button', { name: 'Re-evaluate' })).toBeVisible()
    await expect(page.getByText('Action required').first()).toBeVisible()
  })
})
