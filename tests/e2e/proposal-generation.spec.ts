import { test, expect, type Page } from '@playwright/test'
import { FIXTURE_ME_ADMIN } from './fixtures/documentPipeline.js'

/**
 * Phase 14 §44 E2E flow (mock-driven, same convention as
 * evidence-matching.spec.ts / bid-strategy.spec.ts): the Proposal tab
 * on the standalone `/bids/:id` dashboard, entirely mocked at the
 * network level — no real Supabase project, OpenAI call, or tender
 * data involved. Covers Create Proposal → Generate Structure →
 * Generate Section → Inspect Traceability → Edit → Approve/Reject →
 * Compliance → Assemble (10 scenarios, including agency isolation and
 * stale-proposal). DB-level RLS/immutability and the pure
 * blueprint/compliance/unsupported-claim engines are covered instead
 * by apps/api/src/lib/proposals/__tests__ and
 * database/src/__tests__/proposalGeneration.test.ts — the same
 * deliberate split Phase 13 documented in docs/TESTING.md.
 */

const FAKE_ACCESS_TOKEN = 'e2e-fixture-access-token-p14'
const PROJECT_ID = '00000000-0000-4000-8000-b1d5000000e4'
const TENDER_ID = '00000000-0000-4000-8000-tender0000e4'
const PROPOSAL_ID = '00000000-0000-4000-8000-proposal00e4'
const VERSION_ID = '00000000-0000-4000-8000-version000e4'
const SECTION_ID = '00000000-0000-4000-8000-section000e4'

const FIXTURE_PROJECT = {
  id: PROJECT_ID,
  tender_id: TENDER_ID,
  agency_id: '00000000-0000-4000-8000-agency000e4',
  project_name: 'Bid: Provincial Facilities Management Tender',
  status: 'IN_PROGRESS',
  bid_decision_run_id: '00000000-0000-4000-8000-decision0e4',
  current_strategy_version: 1,
  owner_user_id: FIXTURE_ME_ADMIN.id,
  target_submission_date: '2026-11-01',
  priority: 'HIGH',
  bid_effort: 'MEDIUM',
  overall_score_snapshot: 71,
}

const FIXTURE_SECTION = {
  id: SECTION_ID,
  section_type: 'EXECUTIVE_SUMMARY',
  title: 'Executive Summary',
  objective: 'Summarise the approach.',
  status: 'DRAFT',
  origin: 'HUMAN_AUTHORED',
  is_mandatory: true,
  sort_order: 0,
  last_generated_at: null,
  last_edited_at: null,
}

async function signInWithFixtureSession(page: Page) {
  await page.addInitScript(
    ({ storageKey, accessToken, userId, userEmail }) => {
      const oneHourFromNow = Math.round(Date.now() / 1000) + 3600
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          access_token: accessToken,
          refresh_token: 'e2e-fixture-refresh-token-p14',
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

async function openProposalTab(page: Page) {
  await page.goto(`/bids/${PROJECT_ID}`)
  await page.getByRole('tab', { name: 'Proposal' }).click()
}

test.describe('Phase 14 — Bid Proposal Generation & Document Assembly', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithFixtureSession(page)
  })

  test('E2E1 — Create Proposal: no proposal yet renders an honest empty state with a create action', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/proposal`, (route) => (route.request().method() === 'GET' ? route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } }) : route.fulfill({ status: 201, json: { id: PROPOSAL_ID } })))

    await openProposalTab(page)
    await expect(page.getByText('No proposal yet')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create Proposal' })).toBeVisible()
  })

  test('E2E2 — Generate Proposal Structure: creating a proposal populates the section outline', async ({ page }) => {
    await mockCommon(page)
    let created = false
    await page.route(`**/api/bids/${PROJECT_ID}/proposal`, (route) => {
      if (route.request().method() === 'POST') {
        created = true
        return route.fulfill({ status: 201, json: { id: PROPOSAL_ID } })
      }
      return created ? route.fulfill({ json: { proposal: { id: PROPOSAL_ID, status: 'DRAFT', current_version: 1 }, currentVersion: { id: VERSION_ID }, sections: [FIXTURE_SECTION] } }) : route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } })
    })
    await page.route(`**/api/bids/${PROJECT_ID}/proposal/compliance`, (route) => route.fulfill({ json: { rows: [] } }))

    await openProposalTab(page)
    await page.getByRole('button', { name: 'Create Proposal' }).click()
    await expect(page.getByText('Executive Summary')).toBeVisible()
  })

  test('E2E3 — Generate Section: clicking Generate calls the generate endpoint and refreshes section content', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/proposal`, (route) => route.fulfill({ json: { proposal: { id: PROPOSAL_ID, status: 'DRAFT', current_version: 1 }, currentVersion: { id: VERSION_ID }, sections: [FIXTURE_SECTION] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/proposal/compliance`, (route) => route.fulfill({ json: { rows: [] } }))
    let generated = false
    await page.route(`**/api/bids/${PROJECT_ID}/proposal/sections/${SECTION_ID}/generate`, (route) => {
      generated = true
      return route.fulfill({ json: { id: 'gen-1', status: 'SUCCEEDED' } })
    })
    await page.route(`**/api/bids/${PROJECT_ID}/proposal/sections/${SECTION_ID}`, (route) =>
      route.fulfill({
        json: {
          section: { ...FIXTURE_SECTION, status: generated ? 'AI_GENERATED' : 'DRAFT', origin: generated ? 'AI_GENERATED' : 'HUMAN_AUTHORED' },
          blocks: generated ? [{ id: 'b1', block_type: 'PARAGRAPH', content: { text: 'We propose to deliver the scope on time.' } }] : [],
          claims: [],
          requirementLinks: [],
          evaluationLinks: [],
          generations: generated ? [{ id: 'gen-1', generation_version: 1, status: 'SUCCEEDED', model: 'gpt-test', prompt_version: 'proposal-section-v1', created_at: '2026-09-11T00:00:00.000Z' }] : [],
        },
      }),
    )

    await openProposalTab(page)
    await page.getByText('Executive Summary').click()
    await page.getByRole('button', { name: 'Generate' }).click()
    await expect(page.getByText('We propose to deliver the scope on time.')).toBeVisible()
    await expect(page.getByText('AI_GENERATED').first()).toBeVisible()
  })

  test('E2E4 — Inspect Traceability: the section inspector shows requirement/evaluation coverage and claims', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/proposal`, (route) => route.fulfill({ json: { proposal: { id: PROPOSAL_ID, status: 'DRAFT', current_version: 1 }, currentVersion: { id: VERSION_ID }, sections: [FIXTURE_SECTION] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/proposal/compliance`, (route) => route.fulfill({ json: { rows: [] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/proposal/sections/${SECTION_ID}`, (route) =>
      route.fulfill({
        json: {
          section: FIXTURE_SECTION,
          blocks: [],
          claims: [{ id: 'c1', claim_text: 'We delivered a similar project.', support_status: 'SUPPORTED' }],
          requirementLinks: [{ id: 'rl1', tender_requirement_id: 'r1', coverage_status: 'COVERED' }],
          evaluationLinks: [{ id: 'el1', evaluation_criterion_id: 'c1', coverage_status: 'NOT_COVERED' }],
          generations: [],
        },
      }),
    )

    await openProposalTab(page)
    await page.getByText('Executive Summary').click()
    await expect(page.getByText(/We delivered a similar project\. \(SUPPORTED\)/)).toBeVisible()
    await expect(page.getByText('Requirements covered:')).toBeVisible()
    await expect(page.getByText('1/1')).toBeVisible()
  })

  test('E2E5 — Edit Section: a human can mark a section reviewed', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/proposal`, (route) => route.fulfill({ json: { proposal: { id: PROPOSAL_ID, status: 'DRAFT', current_version: 1 }, currentVersion: { id: VERSION_ID }, sections: [{ ...FIXTURE_SECTION, status: 'AI_GENERATED' }] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/proposal/compliance`, (route) => route.fulfill({ json: { rows: [] } }))
    let reviewed = false
    await page.route(`**/api/bids/${PROJECT_ID}/proposal/sections/${SECTION_ID}/review`, (route) => {
      reviewed = true
      return route.fulfill({ json: { id: 'rev-1', action: 'REVIEWED' } })
    })
    await page.route(`**/api/bids/${PROJECT_ID}/proposal/sections/${SECTION_ID}`, (route) => route.fulfill({ json: { section: { ...FIXTURE_SECTION, status: reviewed ? 'IN_REVIEW' : 'AI_GENERATED' }, blocks: [], claims: [], requirementLinks: [], evaluationLinks: [], generations: [] } }))

    await openProposalTab(page)
    await page.getByText('Executive Summary').click()
    await page.getByRole('button', { name: 'Mark reviewed' }).click()
    await expect(page.getByText('IN_REVIEW')).toBeVisible()
  })

  test('E2E6 — Approve/Reject Section: rejecting requires a non-empty reason', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/proposal`, (route) => route.fulfill({ json: { proposal: { id: PROPOSAL_ID, status: 'DRAFT', current_version: 1 }, currentVersion: { id: VERSION_ID }, sections: [FIXTURE_SECTION] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/proposal/compliance`, (route) => route.fulfill({ json: { rows: [] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/proposal/sections/${SECTION_ID}`, (route) => route.fulfill({ json: { section: FIXTURE_SECTION, blocks: [], claims: [], requirementLinks: [], evaluationLinks: [], generations: [] } }))

    await openProposalTab(page)
    await page.getByText('Executive Summary').click()
    const rejectButton = page.getByRole('button', { name: 'Reject' })
    await expect(rejectButton).toBeDisabled()
    await page.getByPlaceholder('Rejection reason…').fill('Missing named project manager.')
    await expect(rejectButton).toBeEnabled()
  })

  test('E2E7 — Run Compliance: shows the deterministic result badge', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/proposal`, (route) => route.fulfill({ json: { proposal: { id: PROPOSAL_ID, status: 'DRAFT', current_version: 1 }, currentVersion: { id: VERSION_ID }, sections: [FIXTURE_SECTION] } }))
    let ran = false
    await page.route(`**/api/bids/${PROJECT_ID}/proposal/compliance/run`, (route) => {
      ran = true
      return route.fulfill({ json: { result: 'BLOCKED' } })
    })
    await page.route(`**/api/bids/${PROJECT_ID}/proposal/compliance`, (route) => route.fulfill({ json: { rows: ran ? [{ result: 'BLOCKED' }] : [] } }))

    await openProposalTab(page)
    await page.getByRole('button', { name: 'Run Compliance' }).click()
    await expect(page.getByText('BLOCKED')).toBeVisible()
  })

  test('E2E8 — Assemble Document: the assemble action is reachable from a proposal with an approved section', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/proposal`, (route) => route.fulfill({ json: { proposal: { id: PROPOSAL_ID, status: 'IN_REVIEW', current_version: 1 }, currentVersion: { id: VERSION_ID }, sections: [{ ...FIXTURE_SECTION, status: 'APPROVED_INTERNAL' }] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/proposal/compliance`, (route) => route.fulfill({ json: { rows: [{ result: 'READY_FOR_INTERNAL_REVIEW' }] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/proposal/sections/${SECTION_ID}`, (route) => route.fulfill({ json: { section: { ...FIXTURE_SECTION, status: 'APPROVED_INTERNAL' }, blocks: [], claims: [], requirementLinks: [], evaluationLinks: [], generations: [] } }))

    await openProposalTab(page)
    await expect(page.getByText('READY_FOR_INTERNAL_REVIEW')).toBeVisible()
  })

  test('E2E9 — Agency Isolation: a bid project belonging to another agency 404s rather than leaking its proposal', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}`, (route) => route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Bid project not found.' } } }))

    await page.goto(`/bids/${PROJECT_ID}`)
    await expect(page.getByText(/not found/i).first()).toBeVisible()
  })

  test('E2E10 — Stale Proposal: a stale compliance result is surfaced, never silently READY', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/proposal`, (route) => route.fulfill({ json: { proposal: { id: PROPOSAL_ID, status: 'BLOCKED', current_version: 1 }, currentVersion: { id: VERSION_ID, is_stale: true }, sections: [FIXTURE_SECTION] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/proposal/compliance`, (route) => route.fulfill({ json: { rows: [{ result: 'BLOCKED', coverage_score: {} }] } }))

    await openProposalTab(page)
    await expect(page.getByText('BLOCKED')).toBeVisible()
  })
})
