import { test, expect, type Page } from '@playwright/test'
import { FIXTURE_TENDER_SCORED, FIXTURE_SUMMARY, FIXTURE_EXTRACTED_REQUIREMENTS, FIXTURE_EVALUATION_CRITERIA, FIXTURE_SERVICES, FIXTURE_SOURCES } from './fixtures/tenders.js'
import { FIXTURE_ME_ADMIN } from './fixtures/documentPipeline.js'
import { FIXTURE_QUALIFICATION, FIXTURE_QUAL_REQUIREMENTS, FIXTURE_QUAL_ACTIONS } from './fixtures/qualification.js'
import { FIXTURE_OPPORTUNITY_SCORE, FIXTURE_OPPORTUNITY_SCORE_BLOCKED } from './fixtures/opportunityScoring.js'

/**
 * Phase 10 §39-§45 E2E flow: open tender -> open the Scoring Engine tab
 * -> compute score -> overall score + decision signal + data
 * completeness appear, with the "not a prediction of winning" disclaimer
 * -> breakdown bars per dimension -> "why this score" reveals drivers,
 * risks and unknowns as separate lists -> a BLOCKED run shows the hard
 * gate prominently. `/api/tenders/:id/opportunity-score*` is mocked
 * entirely at the network level, same convention as qualification.spec.ts.
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
          user: { id: '00000000-0000-4000-8000-0000000000e2', email: 'e2e-fixture@tender-os.test', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-01-01T00:00:00.000Z' },
        }),
      )
    },
    { storageKey: 'sb-e2efixture-auth-token', accessToken: FAKE_ACCESS_TOKEN },
  )
}

async function mockApi(page: Page, { scored, blocked }: { scored: boolean; blocked?: boolean }) {
  let hasScore = scored
  const scoreFixture = blocked ? FIXTURE_OPPORTUNITY_SCORE_BLOCKED : FIXTURE_OPPORTUNITY_SCORE

  await page.route('**/api/me', (route) => route.fulfill({ json: FIXTURE_ME_ADMIN }))
  await page.route('**/api/tenders/summary', (route) => route.fulfill({ json: FIXTURE_SUMMARY }))
  await page.route('**/api/tenders?**', (route) => route.fulfill({ json: { rows: [], page: 1, pageSize: 25, total: 0, totalPages: 1 } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}`, (route) => (route.request().method() === 'GET' ? route.fulfill({ json: FIXTURE_TENDER_SCORED }) : route.continue()))
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

  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/qualification/requirements`, (route) => route.fulfill({ json: FIXTURE_QUAL_REQUIREMENTS }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/qualification/actions`, (route) => route.fulfill({ json: FIXTURE_QUAL_ACTIONS }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/qualification`, (route) => route.fulfill({ json: FIXTURE_QUALIFICATION }))

  // --- Phase 10 opportunity scoring routes -----------------------------
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/opportunity-score`, (route) => {
    if (route.request().method() === 'POST') {
      hasScore = true
      return route.fulfill({ json: { runId: scoreFixture.run.id, reused: false, overallScore: scoreFixture.run.overallScore, decisionSignal: scoreFixture.run.decisionSignal } })
    }
    if (!hasScore) return route.fulfill({ json: { run: null, components: [], drivers: [], risks: [], gates: [], unknowns: [] } })
    return route.fulfill({ json: scoreFixture })
  })
}

test.describe('Phase 10 — Evaluation & Opportunity Scoring Engine', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithFixtureSession(page)
  })

  test('open tender -> open Scoring Engine tab -> compute -> score, decision signal, completeness, breakdown, why-this-score all appear', async ({ page }) => {
    await mockApi(page, { scored: false })

    await page.goto(`/tenders/${FIXTURE_TENDER_SCORED.id}`)
    await page.getByRole('tab', { name: 'Scoring Engine' }).click()

    await expect(page.getByText('No opportunity score has been computed for this tender yet.')).toBeVisible()

    await page.getByRole('button', { name: 'Compute score' }).click()

    await expect(page.getByText('82/100')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('High Priority')).toBeVisible()
    await expect(page.getByText('Data completeness: 90%')).toBeVisible()
    await expect(page.getByText(/This is an internal opportunity score\. It is not a prediction of winning/)).toBeVisible()

    // No fake precision anywhere on this tab (Phase 10 §44) — the only
    // permitted mention of "win probability" is the disclaimer's own
    // explicit negation ("...not a prediction of winning, a win
    // probability..."), never a value/percentage attached to it.
    await expect(page.getByText(/win probability[:\s]*\d/i)).toHaveCount(0)
    await expect(page.getByText(/chance of success/i)).toHaveCount(0)
    await expect(page.getByText(/AI confidence/i)).toHaveCount(0)

    // Score breakdown shows every dimension, including the UNKNOWN one distinctly.
    await expect(page.getByText(/Requirement Coverage \(weight/)).toBeVisible()
    await expect(page.getByText(/Strategic Fit \(weight/)).toBeVisible()

    // Why this score — drivers/risks/unknowns as separate lists.
    await page.getByRole('button', { name: 'Why is this score what it is?' }).click()
    await expect(page.getByText('All mandatory qualification requirements currently satisfied.')).toBeVisible()
    await expect(page.getByText('Agency strategic profile is not recorded.').first()).toBeVisible()
  })

  test('a BLOCKED score shows the hard gate prominently, not buried under the score', async ({ page }) => {
    await mockApi(page, { scored: true, blocked: true })

    await page.goto(`/tenders/${FIXTURE_TENDER_SCORED.id}`)
    await page.getByRole('tab', { name: 'Scoring Engine' }).click()

    await expect(page.getByText('BLOCKED').first()).toBeVisible()
    await expect(page.getByText(/MANDATORY QUALIFICATION FAILURE/).first()).toBeVisible()
    await expect(page.getByText('Overall qualification status is NOT_ELIGIBLE.').first()).toBeVisible()
  })

  test('the legacy "Opportunity Score" tab and the new "Scoring Engine" tab coexist without colliding', async ({ page }) => {
    await mockApi(page, { scored: true })
    await page.goto(`/tenders/${FIXTURE_TENDER_SCORED.id}`)
    await expect(page.getByRole('tab', { name: 'Opportunity Score' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Scoring Engine' })).toBeVisible()
  })
})
