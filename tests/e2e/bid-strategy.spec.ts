import { test, expect, type Page } from '@playwright/test'
import { FIXTURE_ME_ADMIN } from './fixtures/documentPipeline.js'

/**
 * Phase 12 §41 E2E flow (mock-driven, same convention as
 * bid-decision.spec.ts): the standalone `/bids` and `/bids/:id`
 * dashboard, entirely mocked at the network level — no real Supabase
 * project or tender data involved. Covers E2E1 (create/list), E2E2
 * (build strategy), E2E3 (evidence gap blocks readiness) and E2E6
 * (outstanding mandatory requirement blocks readiness). E2E4
 * (approval), E2E5 (versioning) and E2E7 (cross-agency security) are
 * covered instead by apps/api/src/lib/bidStrategy/__tests__ and
 * database/src/__tests__/bidStrategy.test.ts (documented in
 * docs/TESTING.md as the deliberate split — DB-level RLS/immutability
 * is not re-provable by a mocked-network E2E test).
 */

const FAKE_ACCESS_TOKEN = 'e2e-fixture-access-token'
const PROJECT_ID = '00000000-0000-4000-8000-b1d5000000e2'
const TENDER_ID = '00000000-0000-4000-8000-tender0000e2'

const FIXTURE_PROJECT = {
  id: PROJECT_ID,
  tender_id: TENDER_ID,
  agency_id: '00000000-0000-4000-8000-agency000e2',
  project_name: 'Bid: Municipal IT Support Tender',
  status: 'STRATEGY',
  bid_decision_run_id: '00000000-0000-4000-8000-decision0e2',
  current_strategy_version: 1,
  owner_user_id: FIXTURE_ME_ADMIN.id,
  target_submission_date: '2026-11-01',
  priority: 'HIGH',
  bid_effort: 'MEDIUM',
  overall_score_snapshot: 78,
}

const FIXTURE_STRATEGY = {
  current: {
    strategy: { id: 'strat-1', version: 1, status: 'DRAFT', objective: "Win this tender by directly addressing the client's stated evaluation criteria.", strategy_summary: 'Generated from 2 evaluation criteria and 1 mandatory requirement(s).' },
    priorities: [{ id: 'p1', priority_class: 'TENDER', title: 'Technical methodology', weight: 30, rank: 1, source_id: 'crit-1' }],
    winThemes: [{ id: 'w1', title: 'Demonstrated strength: Technical methodology', description: 'Evaluation criterion has 2 linked agency evidence record(s).', evidence_status: 'SUPPORTED' }],
    differentiators: [],
  },
  history: [],
}

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

async function mockCommon(page: Page) {
  await page.route('**/api/me', (route) => route.fulfill({ json: FIXTURE_ME_ADMIN }))
  await page.route('**/api/watchlist**', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { rows: [] } }) : route.fulfill({ status: 204, body: '' })))
  await page.route('**/api/saved-filters**', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { rows: [] } }) : route.fulfill({ status: 204, body: '' })))
}

test.describe('Phase 12 — Bid Strategy & Bid Project Intelligence', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithFixtureSession(page)
  })

  test('E2E1 — no bid projects yet renders an honest empty state', async ({ page }) => {
    await mockCommon(page)
    await page.route('**/api/bids', (route) => route.fulfill({ json: { rows: [] } }))

    await page.goto('/bids')
    await expect(page.getByText('No bid projects yet')).toBeVisible()
  })

  test('E2E1 — a created bid project appears in the list', async ({ page }) => {
    await mockCommon(page)
    await page.route('**/api/bids', (route) => route.fulfill({ json: { rows: [FIXTURE_PROJECT] } }))

    await page.goto('/bids')
    await expect(page.getByText(FIXTURE_PROJECT.project_name)).toBeVisible()
    await expect(page.getByText('STRATEGY', { exact: true })).toBeVisible()
  })

  test('E2E2 — opening a bid project shows Strategy tab with win themes and priorities', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}`, (route) => route.fulfill({ json: FIXTURE_PROJECT }))
    await page.route(`**/api/bids/${PROJECT_ID}/strategy`, (route) => route.fulfill({ json: FIXTURE_STRATEGY }))
    await page.route(`**/api/bids/${PROJECT_ID}/readiness`, (route) => route.fulfill({ json: { status: 'READY', blockers: [], warnings: [], completeness: { requirements: 1, evaluationCriteria: 1, evidenceNeeds: 1, tasks: 1, compliance: 1 } } }))

    await page.goto(`/bids/${PROJECT_ID}`)
    await page.getByRole('tab', { name: 'Strategy' }).click()

    await expect(page.getByText('Demonstrated strength: Technical methodology')).toBeVisible()
    await expect(page.getByText('SUPPORTED').first()).toBeVisible()
  })

  test('E2E3/E2E6 — a critical evidence gap and outstanding mandatory requirement keep readiness BLOCKED, never a green percentage', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}`, (route) => route.fulfill({ json: FIXTURE_PROJECT }))
    await page.route(`**/api/bids/${PROJECT_ID}/strategy`, (route) => route.fulfill({ json: FIXTURE_STRATEGY }))
    await page.route(`**/api/bids/${PROJECT_ID}/readiness`, (route) =>
      route.fulfill({
        json: {
          status: 'BLOCKED',
          blockers: [
            { code: 'CRITICAL_EVIDENCE_GAP', message: 'A critical evidence gap remains OPEN.' },
            { code: 'MANDATORY_REQUIREMENT_UNRESOLVED', message: 'Mandatory requirement req-2 is not a confirmed PASS.' },
          ],
          warnings: [],
          completeness: { requirements: 0.9, evaluationCriteria: 1, evidenceNeeds: 0.5, tasks: 1, compliance: 0.9 },
        },
      }),
    )

    await page.goto(`/bids/${PROJECT_ID}`)
    // Phase 15 added a distinct "Submission Readiness" tab whose
    // accessible name otherwise substring-matches this one — pinned to
    // `exact` so this Phase 12 test keeps targeting its own tab.
    await page.getByRole('tab', { name: 'Readiness', exact: true }).click()

    await expect(page.getByText('BLOCKED')).toBeVisible()
    await expect(page.getByText(/critical evidence gap/i)).toBeVisible()
    await expect(page.getByText(/Mandatory requirement/i)).toBeVisible()
  })

  test('the bid strategy dashboard is a distinct view from the Tender Radar', async ({ page }) => {
    await mockCommon(page)
    await page.route('**/api/bids', (route) => route.fulfill({ json: { rows: [FIXTURE_PROJECT] } }))
    await page.goto('/bids')
    await expect(page.getByText('Bid Projects')).toBeVisible()
    await expect(page).not.toHaveURL(/\/tenders/)
  })
})
