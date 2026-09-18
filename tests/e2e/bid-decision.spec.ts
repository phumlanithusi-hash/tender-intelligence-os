import { test, expect, type Page } from '@playwright/test'
import { FIXTURE_TENDER_SCORED, FIXTURE_SUMMARY, FIXTURE_EXTRACTED_REQUIREMENTS, FIXTURE_EVALUATION_CRITERIA, FIXTURE_SERVICES, FIXTURE_SOURCES } from './fixtures/tenders.js'
import { FIXTURE_ME_ADMIN } from './fixtures/documentPipeline.js'
import { FIXTURE_QUALIFICATION, FIXTURE_QUAL_REQUIREMENTS, FIXTURE_QUAL_ACTIONS } from './fixtures/qualification.js'
import { FIXTURE_OPPORTUNITY_SCORE } from './fixtures/opportunityScoring.js'
import { FIXTURE_BID_DECISION, FIXTURE_BID_DECISION_BLOCKED, FIXTURE_BID_DECISION_REVIEW } from './fixtures/bidDecision.js'

/**
 * Phase 11 §47-§54 E2E flow: open tender -> open the Bid Decision tab
 * -> evaluate -> decision badge + explanation appear, distinct from the
 * Scoring Engine tab -> a NO_BID run shows blockers prominently first
 * -> a REVIEW run shows the action-required checklist ->
 * `/api/tenders/:id/bid-decision*` is mocked entirely at the network
 * level, same convention as opportunity-scoring.spec.ts.
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

async function mockApi(page: Page, { evaluated, fixture }: { evaluated: boolean; fixture: typeof FIXTURE_BID_DECISION }) {
  let hasDecision = evaluated
  let overrideState: { humanDecision: string; finalDecision: string; overrideReason: string } | null = null

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
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/opportunity-score`, (route) => (route.request().method() === 'GET' ? route.fulfill({ json: FIXTURE_OPPORTUNITY_SCORE }) : route.continue()))

  // --- Phase 11 bid-decision routes ------------------------------------
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/bid-decision/evaluate`, (route) => {
    hasDecision = true
    return route.fulfill({ json: { runId: fixture.run.id, reused: false, decision: fixture.run.finalDecision } })
  })
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/bid-decision/override`, (route) => {
    const body = route.request().postDataJSON() as { decision: string; reason: string }
    overrideState = { humanDecision: body.decision, finalDecision: body.decision, overrideReason: body.reason }
    return route.fulfill({ json: { run: { ...fixture.run, ...overrideState } } })
  })
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/bid-decision`, (route) => {
    if (!hasDecision) return route.fulfill({ json: { run: null, ruleResults: [], blockers: [], warnings: [], unresolvedItems: [], positiveFactors: [], humanActionsRequired: [] } })
    return route.fulfill({ json: { ...fixture, run: { ...fixture.run, ...overrideState } } })
  })
}

test.describe('Phase 11 — Bid/No-Bid Intelligence Engine', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithFixtureSession(page)
  })

  test('open tender -> open Bid Decision tab -> evaluate -> decision, effort, and explanation all appear', async ({ page }) => {
    await mockApi(page, { evaluated: false, fixture: FIXTURE_BID_DECISION })

    await page.goto(`/tenders/${FIXTURE_TENDER_SCORED.id}`)
    await page.getByRole('tab', { name: 'Bid Decision' }).click()

    await expect(page.getByText('No bid decision has been computed for this tender yet.')).toBeVisible()

    await page.getByRole('button', { name: 'Evaluate bid decision' }).click()

    await expect(page.getByText('BID', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('MEDIUM').first()).toBeVisible()
    await expect(page.getByText(/satisfies the configured agency bid policy/)).toBeVisible()
  })

  test('a NO_BID decision (confirmed mandatory failure) shows the blocker prominently, first', async ({ page }) => {
    await mockApi(page, { evaluated: true, fixture: FIXTURE_BID_DECISION_BLOCKED })

    await page.goto(`/tenders/${FIXTURE_TENDER_SCORED.id}`)
    await page.getByRole('tab', { name: 'Bid Decision' }).click()

    await expect(page.getByText('NO-BID').first()).toBeVisible()
    await expect(page.getByText('BLOCKERS')).toBeVisible()
    await expect(page.getByText(/qualification not eligible/i).first()).toBeVisible()
  })

  test('a REVIEW decision shows an action-required checklist', async ({ page }) => {
    await mockApi(page, { evaluated: true, fixture: FIXTURE_BID_DECISION_REVIEW })

    await page.goto(`/tenders/${FIXTURE_TENDER_SCORED.id}`)
    await page.getByRole('tab', { name: 'Bid Decision' }).click()

    await expect(page.getByText('REVIEW', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('ACTION REQUIRED', { exact: true })).toBeVisible()
    await expect(page.getByText('Tender estimated value is not available.').first()).toBeVisible()
  })

  test('override: system decision remains visible alongside the human override and final decision', async ({ page }) => {
    await mockApi(page, { evaluated: true, fixture: FIXTURE_BID_DECISION_BLOCKED })

    await page.goto(`/tenders/${FIXTURE_TENDER_SCORED.id}`)
    await page.getByRole('tab', { name: 'Bid Decision' }).click()

    await page.getByRole('button', { name: 'Override this decision' }).click()
    await page.getByLabel('New decision').selectOption('BID')
    await page.getByLabel('Reason (required)').fill('Strategic client acquisition opportunity approved by executive team.')
    await page.getByRole('button', { name: 'Confirm override' }).click()

    await expect(page.getByText('System decision')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Human decision')).toBeVisible()
    await expect(page.getByText('Final decision')).toBeVisible()
  })

  test('the "Bid Decision" tab and the Phase 10 "Scoring Engine" tab coexist without colliding', async ({ page }) => {
    await mockApi(page, { evaluated: true, fixture: FIXTURE_BID_DECISION })
    await page.goto(`/tenders/${FIXTURE_TENDER_SCORED.id}`)
    await expect(page.getByRole('tab', { name: 'Scoring Engine' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Bid Decision' })).toBeVisible()
  })
})
