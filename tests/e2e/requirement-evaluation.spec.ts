import { test, expect, type Page } from '@playwright/test'
import { FIXTURE_TENDER_SCORED, FIXTURE_SUMMARY, FIXTURE_SERVICES, FIXTURE_SOURCES } from './fixtures/tenders.js'
import { FIXTURE_ME_ADMIN } from './fixtures/documentPipeline.js'
import {
  FIXTURE_EXTRACTED_REQUIREMENTS_LIST,
  FIXTURE_REQUIREMENT_CONFLICTS_LIST,
  FIXTURE_EVALUATION_CRITERIA_LIST,
  FIXTURE_EVALUATION_GATES,
  FIXTURE_EVALUATION_CONFLICTS_LIST,
  FIXTURE_EXTRACTION_RUN,
} from './fixtures/requirementEvaluation.js'

/**
 * Phase 9 §39 E2E flow: open tender -> open Requirements -> trigger
 * extraction -> hierarchical requirements + disqualification risk +
 * evidence appear -> open Evaluation -> criteria table + points appear ->
 * evidence inspectable -> human review can be recorded on both tabs. The
 * `/api/tenders/:id/requirements*` and `/api/tenders/:id/evaluation*`
 * routes are mocked entirely at the network level — no live OpenAI call
 * is involved, same convention as ai-classification.spec.ts and
 * qualification.spec.ts.
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

async function mockApi(page: Page, { extracted }: { extracted: boolean }) {
  let hasExtracted = extracted
  let reviewed = false

  await page.route('**/api/me', (route) => route.fulfill({ json: FIXTURE_ME_ADMIN }))
  await page.route('**/api/tenders/summary', (route) => route.fulfill({ json: FIXTURE_SUMMARY }))
  await page.route('**/api/tenders?**', (route) => route.fulfill({ json: { rows: [], page: 1, pageSize: 25, total: 0, totalPages: 1 } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}`, (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: FIXTURE_TENDER_SCORED })
    return route.continue()
  })
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/documents`, (route) => route.fulfill({ json: { rows: [] } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/addenda`, (route) => route.fulfill({ json: { rows: [] } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/briefing`, (route) => route.fulfill({ json: { rows: [] } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/score`, (route) => route.fulfill({ json: { score: null } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/risks`, (route) => route.fulfill({ json: { rows: [] } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/activity`, (route) => route.fulfill({ json: { rows: [] } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/ai/classification`, (route) => route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'none yet' } } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/ai/runs`, (route) => route.fulfill({ json: [] }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/qualification`, (route) => route.fulfill({ json: { run: null, results: [] } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/qualification/requirements`, (route) => route.fulfill({ json: [] }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/qualification/actions`, (route) => route.fulfill({ json: [] }))
  await page.route('**/api/services**', (route) => route.fulfill({ json: { rows: FIXTURE_SERVICES } }))
  await page.route('**/api/tender-sources**', (route) => route.fulfill({ json: { rows: FIXTURE_SOURCES } }))
  await page.route('**/api/watchlist**', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { rows: [] } }) : route.fulfill({ status: 204, body: '' })))
  await page.route('**/api/saved-filters**', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { rows: [] } }) : route.fulfill({ status: 204, body: '' })))

  // --- Phase 9 requirement/evaluation routes -------------------------------------------------
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/requirements/runs`, (route) => route.fulfill({ json: hasExtracted ? [FIXTURE_EXTRACTION_RUN] : [] }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/requirements/extract`, (route) => {
    hasExtracted = true
    return route.fulfill({ status: 202, json: { status: 'QUEUED', tenderId: FIXTURE_TENDER_SCORED.id } })
  })
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/requirements/*/review`, (route) => {
    reviewed = true
    return route.fulfill({ status: 201, json: { id: '00000000-0000-4000-8000-0000000000f9' } })
  })
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/requirements`, (route) => {
    if (!hasExtracted) return route.fulfill({ json: { requirements: [], conflicts: [] } })
    void reviewed
    return route.fulfill({ json: { requirements: FIXTURE_EXTRACTED_REQUIREMENTS_LIST, conflicts: FIXTURE_REQUIREMENT_CONFLICTS_LIST } })
  })
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/evaluation/criteria/*/review`, (route) => route.fulfill({ status: 201, json: { id: '00000000-0000-4000-8000-0000000000fa' } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/evaluation`, (route) => {
    if (!hasExtracted) return route.fulfill({ json: { criteria: [], gates: [], conflicts: [] } })
    return route.fulfill({ json: { criteria: FIXTURE_EVALUATION_CRITERIA_LIST, gates: FIXTURE_EVALUATION_GATES, conflicts: FIXTURE_EVALUATION_CONFLICTS_LIST } })
  })
}

test.describe('Phase 9 — Requirement & Evaluation Extraction', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithFixtureSession(page)
  })

  test('open tender -> open Requirements -> extract -> hierarchy + disqualification risk + evidence appear -> Evaluation shows points -> reviews recorded', async ({ page }) => {
    await mockApi(page, { extracted: false })

    await page.goto(`/tenders/${FIXTURE_TENDER_SCORED.id}`)
    await page.getByRole('tab', { name: 'Requirements' }).click()

    await expect(page.getByText('No structured requirements match this filter.')).toBeVisible()

    await page.getByRole('button', { name: 'Extract requirements' }).click()

    // Hierarchical requirements appear — parent and indented child.
    await expect(page.getByText('3. FUNCTIONALITY')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Company Experience (fixture)')).toBeVisible()

    // Disqualification risk is shown as a severity flag, never a qualification decision.
    await expect(page.getByText('Disqualification risk', { exact: true })).toBeVisible()

    // Evidence can be inspected.
    await page.getByRole('button', { name: /View evidence/ }).first().click()
    await expect(page.getByText(/Page 6/)).toBeVisible()

    // Filter by category.
    await page.getByRole('button', { name: 'QUALIFICATION' }).click()
    await expect(page.getByText('Company Experience (fixture)')).toBeVisible()
    await expect(page.getByText('3. FUNCTIONALITY')).not.toBeVisible()
    await page.getByRole('button', { name: 'ALL' }).click()

    // Record a review on the requirement.
    await page.getByRole('button', { name: 'Record review' }).first().click()
    await page.getByPlaceholder('Decision / note').fill('Confirmed against the TOR — mandatory qualification requirement.')
    await page.getByRole('button', { name: 'Submit review' }).click()
    await expect(page.getByText('Record human review decision')).not.toBeVisible()

    // Evaluation tab: points extracted exactly as stated, never invented.
    await page.getByRole('tab', { name: 'Evaluation' }).click()
    await expect(page.getByText('Company Experience (fixture)')).toBeVisible()
    await expect(page.getByText('20')).toBeVisible()

    // Record a review on the criterion.
    await page.getByRole('button', { name: 'Record review' }).first().click()
    await page.getByPlaceholder('Decision / note').fill('Points confirmed against Annexure B.')
    await page.getByRole('button', { name: 'Submit review' }).click()
    await expect(page.getByText('Record human review decision')).not.toBeVisible()
  })

  test('an already-extracted tender shows the latest run and Re-extract directly', async ({ page }) => {
    await mockApi(page, { extracted: true })

    await page.goto(`/tenders/${FIXTURE_TENDER_SCORED.id}`)
    await page.getByRole('tab', { name: 'Requirements' }).click()

    await expect(page.getByRole('button', { name: 'Re-extract' })).toBeVisible()
    await expect(page.getByText('Company Experience (fixture)')).toBeVisible()
  })
})
