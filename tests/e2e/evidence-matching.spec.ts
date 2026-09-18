import { test, expect, type Page } from '@playwright/test'
import { FIXTURE_ME_ADMIN } from './fixtures/documentPipeline.js'

/**
 * Phase 13 §I E2E flow (mock-driven, same convention as
 * bid-strategy.spec.ts): the Evidence Matches tab on the standalone
 * `/bids/:id` dashboard, entirely mocked at the network level — no
 * real Supabase project, OpenAI call, or tender data involved. Covers
 * the full Evidence Needs → Candidate Matches → Approved Evidence →
 * Evidence Gaps flow (7 scenarios). DB-level RLS/immutability and the
 * pure ranking/verification engines are covered instead by
 * apps/api/src/lib/evidenceMatching/__tests__ and
 * database/src/__tests__/evidenceMatching.test.ts — the same
 * deliberate split Phase 12 documented in docs/TESTING.md.
 */

const FAKE_ACCESS_TOKEN = 'e2e-fixture-access-token-p13'
const PROJECT_ID = '00000000-0000-4000-8000-b1d5000000e3'
const TENDER_ID = '00000000-0000-4000-8000-tender0000e3'
const MATCH_ID = '00000000-0000-4000-8000-match00000e3'

const FIXTURE_PROJECT = {
  id: PROJECT_ID,
  tender_id: TENDER_ID,
  agency_id: '00000000-0000-4000-8000-agency000e3',
  project_name: 'Bid: Provincial Facilities Management Tender',
  status: 'STRATEGY',
  bid_decision_run_id: '00000000-0000-4000-8000-decision0e3',
  current_strategy_version: 1,
  owner_user_id: FIXTURE_ME_ADMIN.id,
  target_submission_date: '2026-11-01',
  priority: 'HIGH',
  bid_effort: 'MEDIUM',
  overall_score_snapshot: 71,
}

const CANDIDATE_MATCH = {
  id: MATCH_ID,
  bid_project_id: PROJECT_ID,
  agency_id: FIXTURE_PROJECT.agency_id,
  evidence_need_id: 'need-1',
  candidate_entity_type: 'AGENCY_CASE_STUDY',
  status: 'VERIFIED',
  semantic_score: 0.81,
  rank_factors: { semanticSimilarity: 0.81, typeMatch: 1, recency: 0.9, priorApprovalHistory: 0.5 },
  rationale: 'semantic similarity 81.0%; evidence type matches the need; recency factor 90%; no prior approval/rejection history',
  verification_result: { checks: [{ code: 'AGENCY_MATCH', passed: true, message: 'Candidate evidence belongs to the requesting agency.' }, { code: 'SOURCE_ACTIVE', passed: true, message: 'The underlying evidence source is active.' }] },
  verification_passed: true,
  decided_by: null,
  decided_at: null,
  rejection_reason: null,
  is_current: true,
  is_stale: false,
  created_at: '2026-09-11T00:00:00.000Z',
  updated_at: '2026-09-11T00:00:00.000Z',
}

async function signInWithFixtureSession(page: Page) {
  // NOTE: page.addInitScript serializes this callback and runs it in
  // the BROWSER context — it has no access to Node-side closures, so
  // every value it needs (including FIXTURE_ME_ADMIN's fields) must be
  // passed through the second `arg` parameter, never referenced from
  // the outer module scope directly.
  await page.addInitScript(
    ({ storageKey, accessToken, userId, userEmail }) => {
      const oneHourFromNow = Math.round(Date.now() / 1000) + 3600
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          access_token: accessToken,
          refresh_token: 'e2e-fixture-refresh-token-p13',
          expires_at: oneHourFromNow,
          expires_in: 3600,
          token_type: 'bearer',
          user: { id: userId, email: userEmail, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-01-01T00:00:00.000Z' },
        }),
      )
    },
    { storageKey: 'sb-e2efixture-auth-token', accessToken: FAKE_ACCESS_TOKEN, userId: FIXTURE_ME_ADMIN.id, userEmail: FIXTURE_ME_ADMIN.email },
  )
}

async function mockCommon(page: Page) {
  await page.route('**/api/me', (route) => route.fulfill({ json: FIXTURE_ME_ADMIN }))
  await page.route('**/api/watchlist**', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { rows: [] } }) : route.fulfill({ status: 204, body: '' })))
  await page.route('**/api/saved-filters**', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { rows: [] } }) : route.fulfill({ status: 204, body: '' })))
  await page.route(`**/api/bids/${PROJECT_ID}`, (route) => route.fulfill({ json: FIXTURE_PROJECT }))
  await page.route(`**/api/bids/${PROJECT_ID}/readiness`, (route) => route.fulfill({ json: { status: 'READY', blockers: [], warnings: [], completeness: { requirements: 1, evaluationCriteria: 1, evidenceNeeds: 1, tasks: 1, compliance: 1 } } }))
}

async function openEvidenceMatchesTab(page: Page) {
  await page.goto(`/bids/${PROJECT_ID}`)
  await page.getByRole('tab', { name: 'Evidence Matches' }).click()
}

test.describe('Phase 13 — Evidence Matching & Portfolio Intelligence', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithFixtureSession(page)
  })

  test('E2E1 — Evidence Needs → no candidates yet renders an honest empty state', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/evidence-matches`, (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { rows: [] } }) : route.fulfill({ status: 201, json: { results: [] } })))
    await page.route(`**/api/bids/${PROJECT_ID}/evidence-claims`, (route) => route.fulfill({ json: { rows: [] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/evidence-gaps`, (route) => route.fulfill({ json: { rows: [] } }))

    await openEvidenceMatchesTab(page)
    await expect(page.getByText('No candidate matches yet')).toBeVisible()
  })

  test('E2E2 — generating candidates surfaces a ranked match with semantic score and rationale', async ({ page }) => {
    await mockCommon(page)
    let generated = false
    await page.route(`**/api/bids/${PROJECT_ID}/evidence-matches`, (route) => {
      if (route.request().method() === 'POST') {
        generated = true
        return route.fulfill({ status: 201, json: { results: [{ evidenceNeedId: 'need-1', candidatesCreated: 1, matchIds: [MATCH_ID] }] } })
      }
      return route.fulfill({ json: { rows: generated ? [CANDIDATE_MATCH] : [] } })
    })
    await page.route(`**/api/bids/${PROJECT_ID}/evidence-claims`, (route) => route.fulfill({ json: { rows: [] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/evidence-gaps`, (route) => route.fulfill({ json: { rows: [{ evidenceNeedId: 'need-1', recommendedStatus: 'OPEN', isGap: true, reason: 'No approved evidence claim exists yet.', severity: 'HIGH' }] } }))

    await openEvidenceMatchesTab(page)
    await page.getByRole('button', { name: 'Generate candidate matches' }).click()
    await expect(page.getByText('Semantic score: 81%')).toBeVisible()
    await expect(page.getByText(/semantic similarity 81/i)).toBeVisible()
  })

  test('E2E3 — a candidate never shows as APPROVED/REJECTED before a human decides (AI produces at most VERIFIED)', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/evidence-matches`, (route) => route.fulfill({ json: { rows: [CANDIDATE_MATCH] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/evidence-claims`, (route) => route.fulfill({ json: { rows: [] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/evidence-gaps`, (route) => route.fulfill({ json: { rows: [] } }))

    await openEvidenceMatchesTab(page)
    await expect(page.getByText('VERIFIED')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reject' })).toBeVisible()
  })

  test('E2E4 — approving a candidate calls the approve endpoint and refreshes the list', async ({ page }) => {
    await mockCommon(page)
    let approved = false
    await page.route(`**/api/bids/${PROJECT_ID}/evidence-matches`, (route) => route.fulfill({ json: { rows: [{ ...CANDIDATE_MATCH, status: approved ? 'APPROVED' : 'VERIFIED', decided_by: approved ? FIXTURE_ME_ADMIN.id : null }] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/evidence-matches/${MATCH_ID}/approve`, (route) => {
      approved = true
      return route.fulfill({ json: { ...CANDIDATE_MATCH, status: 'APPROVED' } })
    })
    await page.route(`**/api/bids/${PROJECT_ID}/evidence-claims`, (route) => route.fulfill({ json: { rows: approved ? [{ id: 'claim-1', candidate_entity_type: 'AGENCY_CASE_STUDY', approved_at: '2026-09-11T00:00:00.000Z' }] : [] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/evidence-gaps`, (route) => route.fulfill({ json: { rows: [] } }))

    await openEvidenceMatchesTab(page)
    await page.getByRole('button', { name: 'Approve' }).click()
    await expect(page.getByText('APPROVED', { exact: true })).toBeVisible()
    await expect(page.getByText(/approved evidence/i)).toBeVisible()
  })

  test('E2E5 — rejecting a candidate requires a non-empty reason before the confirm button is enabled', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/evidence-matches`, (route) => route.fulfill({ json: { rows: [CANDIDATE_MATCH] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/evidence-claims`, (route) => route.fulfill({ json: { rows: [] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/evidence-gaps`, (route) => route.fulfill({ json: { rows: [] } }))

    await openEvidenceMatchesTab(page)
    await page.getByRole('button', { name: 'Reject' }).click()
    const confirmButton = page.getByRole('button', { name: 'Confirm reject' })
    await expect(confirmButton).toBeDisabled()
    await page.getByPlaceholder('Rejection reason (required)').fill('Certificate has expired.')
    await expect(confirmButton).toBeEnabled()
  })

  test('E2E6 — the evidence inspector reveals the underlying deterministic verification checks', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/evidence-matches`, (route) => route.fulfill({ json: { rows: [CANDIDATE_MATCH] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/evidence-claims`, (route) => route.fulfill({ json: { rows: [] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/evidence-gaps`, (route) => route.fulfill({ json: { rows: [] } }))

    await openEvidenceMatchesTab(page)
    await page.getByRole('button', { name: 'Inspect underlying evidence' }).click()
    await expect(page.getByText(/Candidate evidence belongs to the requesting agency/)).toBeVisible()
  })

  test('E2E7 — an unresolved evidence gap is surfaced with its severity, feeding back into Phase 12s evidence needs', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/evidence-matches`, (route) => route.fulfill({ json: { rows: [] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/evidence-claims`, (route) => route.fulfill({ json: { rows: [] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/evidence-gaps`, (route) => route.fulfill({ json: { rows: [{ evidenceNeedId: 'need-1', recommendedStatus: 'OPEN', isGap: true, reason: 'No approved evidence claim exists yet.', severity: 'CRITICAL' }] } }))

    await openEvidenceMatchesTab(page)
    await expect(page.getByText('No approved evidence claim exists yet.')).toBeVisible()
    await expect(page.getByText('CRITICAL')).toBeVisible()
  })
})
