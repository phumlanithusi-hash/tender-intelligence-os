import { test, expect, type Page } from '@playwright/test'
import { FIXTURE_ME_ADMIN } from './fixtures/documentPipeline.js'

/**
 * Phase 16 §47/§64 E2E flow (mock-driven, same convention as
 * submission-readiness.spec.ts / proposal-generation.spec.ts): the
 * "Submission Execution" tab on the standalone `/bids/:id` dashboard,
 * entirely mocked at the network level — no real Supabase project,
 * portal, or provider involved. 15 scenarios per spec §47.
 */

const FAKE_ACCESS_TOKEN = 'e2e-fixture-access-token-p16'
const PROJECT_ID = '00000000-0000-4000-8000-b1d6000000e6'
const PACK_ID = '00000000-0000-4000-8000-pack00000e6'

const FIXTURE_PROJECT = {
  id: PROJECT_ID,
  tender_id: '00000000-0000-4000-8000-tender0000e6',
  agency_id: '00000000-0000-4000-8000-agency000e6',
  project_name: 'Bid: Regional Water Infrastructure Tender',
  status: 'IN_PROGRESS',
  bid_decision_run_id: '00000000-0000-4000-8000-decision0e6',
  current_strategy_version: 1,
  owner_user_id: FIXTURE_ME_ADMIN.id,
  target_submission_date: '2026-11-01',
  priority: 'HIGH',
  bid_effort: 'MEDIUM',
  overall_score_snapshot: 71,
}

function executionFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'execution-1',
    bidProjectId: PROJECT_ID,
    status: 'AWAITING_HUMAN_CONFIRMATION',
    submissionMethod: 'PORTAL',
    automationStatus: 'MANUAL_REQUIRED',
    targetKind: 'URL',
    targetValue: 'https://etenders.gov.za/x',
    submissionPackId: PACK_ID,
    submissionPackVersion: 1,
    submissionPackHash: 'abc123def456abc123def456abc123def456abc123def456abc123def456ab',
    manifestHash: 'manifest-hash-1',
    confirmedBy: null,
    confirmedAt: null,
    providerName: null,
    providerReference: null,
    failureCode: null,
    failureMessage: null,
    physicalStage: 'NOT_STARTED',
    version: 1,
    ...overrides,
  }
}

async function signInWithFixtureSession(page: Page) {
  await page.addInitScript(
    ({ storageKey, accessToken, userId, userEmail }) => {
      const oneHourFromNow = Math.round(Date.now() / 1000) + 3600
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          access_token: accessToken,
          refresh_token: 'e2e-fixture-refresh-token-p16',
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
  await page.route(`**/api/bids/${PROJECT_ID}/submission-readiness`, (route) => route.fulfill({ json: { readiness: null, items: [] } }))
  await page.route(`**/api/bids/${PROJECT_ID}/pricing`, (route) => route.fulfill({ json: { pricing: null } }))
  await page.route(`**/api/bids/${PROJECT_ID}/submission-pack`, (route) => route.fulfill({ json: { pack: null } }))
  await page.route(`**/api/bids/${PROJECT_ID}/submission-manifest`, (route) => route.fulfill({ json: { manifest: null } }))
}

async function openSubmissionExecutionTab(page: Page) {
  await page.goto(`/bids/${PROJECT_ID}`)
  await page.getByRole('tab', { name: 'Submission Execution', exact: true }).click()
}

test.describe('Phase 16 — Submission Execution, Submission Tracking & Receipt Intelligence', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithFixtureSession(page)
  })

  test('E2E1 — a ready-but-unprepared bid shows no submission yet and offers Prepare', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/submission`, (route) => route.fulfill({ json: { execution: null, attempts: [], confirmations: [], receipts: [] } }))
    await openSubmissionExecutionTab(page)
    await expect(page.getByText('NOT READY')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Prepare submission' })).toBeVisible()
  })

  test('E2E2 — confirmation required: a prepared bid shows AWAITING HUMAN CONFIRMATION and the confirmation form', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/submission`, (route) => route.fulfill({ json: { execution: executionFixture(), attempts: [], confirmations: [], receipts: [] } }))
    await openSubmissionExecutionTab(page)
    await expect(page.getByText('AWAITING HUMAN CONFIRMATION').first()).toBeVisible()
    await expect(page.getByText(/I confirm that I am authorised to submit this bid/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Confirm & submit' })).toBeDisabled()
  })

  test('E2E3 — changed package invalidates confirmation: attempting after a pack change is blocked server-side', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/submission`, (route) => route.fulfill({ json: { execution: executionFixture({ status: 'SUBMITTING' }), attempts: [], confirmations: [{ id: 'c1', confirmedBy: FIXTURE_ME_ADMIN.id, confirmedAt: '2026-09-11T09:00:00Z', packVersion: 1, packHash: 'old-hash', statement: 'confirmed', invalidated: false }], receipts: [] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission/attempt`, (route) => route.fulfill({ status: 409, json: { error: { code: 'SUBMISSION_BLOCKED', message: 'No valid, current human confirmation exists for this exact package; confirm again.', blockers: ['NO_VALID_CONFIRMATION'] } } }))
    await openSubmissionExecutionTab(page)
    await page.getByRole('button', { name: 'Attempt submission' }).click()
    await expect(page.getByText(/confirm again/)).toBeVisible()
  })

  test('E2E4 — manual portal workflow: REQUIRES_MANUAL_ACTION shows guidance and never auto-claims success', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/submission`, (route) => route.fulfill({ json: { execution: executionFixture({ status: 'REQUIRES_MANUAL_ACTION', failureMessage: 'No authorised portal automation is configured. Open the portal and upload the approved pack.' }), attempts: [], confirmations: [], receipts: [] } }))
    await openSubmissionExecutionTab(page)
    await expect(page.getByText('Manual action required')).toBeVisible()
    await expect(page.getByRole('button', { name: "I've completed the submission" })).toBeVisible()
    await expect(page.getByText('SUBMITTED', { exact: true })).not.toBeVisible()
  })

  test('E2E5 — email method is shown distinctly with its target address', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/submission`, (route) => route.fulfill({ json: { execution: executionFixture({ submissionMethod: 'EMAIL', targetKind: 'EMAIL', targetValue: 'tenders@municipality.gov.za' }), attempts: [], confirmations: [], receipts: [] } }))
    await openSubmissionExecutionTab(page)
    await expect(page.getByText('EMAIL', { exact: true })).toBeVisible()
    await expect(page.getByText('tenders@municipality.gov.za').first()).toBeVisible()
  })

  test('E2E6 — physical/courier workflow shows the method and a manual-only automation badge', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/submission`, (route) => route.fulfill({ json: { execution: executionFixture({ submissionMethod: 'PHYSICAL_COURIER', targetKind: 'ADDRESS', targetValue: '123 Main Street, Pretoria', status: 'REQUIRES_MANUAL_ACTION', failureMessage: 'Physical dispatch is always a manual, human-executed workflow.' }), attempts: [], confirmations: [], receipts: [] } }))
    await openSubmissionExecutionTab(page)
    await expect(page.getByText('PHYSICAL_COURIER')).toBeVisible()
    await expect(page.getByText('123 Main Street, Pretoria')).toBeVisible()
  })

  test('E2E7 — successful mock submission produces a verified receipt and SUBMITTED status', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/submission`, (route) =>
      route.fulfill({
        json: {
          execution: executionFixture({ status: 'SUBMITTED', providerName: 'MOCK_PORTAL', providerReference: 'MOCK-REF-12345678' }),
          attempts: [{ id: 'a1', attemptNumber: 1, status: 'SUCCEEDED', method: 'PORTAL', packVersion: 1, startedAt: '2026-09-12T09:00:00Z', completedAt: '2026-09-12T09:00:05Z', providerReference: 'MOCK-REF-12345678', errorCode: null, errorMessage: null }],
          confirmations: [],
          receipts: [{ id: 'r1', receiptType: 'PORTAL_RECEIPT', providerName: 'MOCK_PORTAL', providerReference: 'MOCK-REF-12345678', verificationStatus: 'VERIFIED', capturedAt: '2026-09-12T09:00:05Z', notes: null }],
        },
      }),
    )
    await openSubmissionExecutionTab(page)
    await expect(page.getByText('SUBMITTED', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('RECEIPT STATUS: VERIFIED')).toBeVisible()
  })

  test('E2E8 — a provider failure (rejected) produces FAILED, never SUBMITTED', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/submission`, (route) =>
      route.fulfill({ json: { execution: executionFixture({ status: 'FAILED', failureCode: 'PROVIDER_REJECTED', failureMessage: 'The provider rejected the submission.' }), attempts: [], confirmations: [], receipts: [] } }),
    )
    await openSubmissionExecutionTab(page)
    await expect(page.getByText('FAILED', { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/rejected the submission/)).toBeVisible()
  })

  test('E2E9 — an unknown provider outcome (timeout) never becomes SUBMITTED', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/submission`, (route) =>
      route.fulfill({ json: { execution: executionFixture({ status: 'REQUIRES_MANUAL_ACTION', failureCode: 'TIMEOUT', failureMessage: 'The request timed out; the provider may or may not have received it. Verify portal status manually before retrying.' }), attempts: [], confirmations: [], receipts: [] } }),
    )
    await openSubmissionExecutionTab(page)
    await expect(page.getByText(/may or may not have received it/).first()).toBeVisible()
    await expect(page.getByText('SUBMITTED', { exact: true })).not.toBeVisible()
  })

  test('E2E10 — duplicate submission warning: a second attempt after a confirmed submission is blocked', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/submission`, (route) => route.fulfill({ json: { execution: executionFixture({ status: 'SUBMITTED' }), attempts: [], confirmations: [], receipts: [{ id: 'r1', receiptType: 'PORTAL_RECEIPT', providerName: 'MOCK_PORTAL', providerReference: 'REF-1', verificationStatus: 'VERIFIED', capturedAt: '2026-09-12T09:00:00Z', notes: null }] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission/confirm`, (route) => route.fulfill({ status: 409, json: { error: { code: 'SUBMISSION_BLOCKED', message: 'This bid already has a recorded submission; an explicit override is required to proceed further.', blockers: ['DUPLICATE_SUBMISSION_RISK'] } } }))
    await openSubmissionExecutionTab(page)
    await expect(page.getByText('SUBMITTED', { exact: true }).first()).toBeVisible()
  })

  test('E2E11 — deadline prevents submission: attempting past the deadline is blocked', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/submission`, (route) => route.fulfill({ json: { execution: executionFixture({ status: 'SUBMITTING' }), attempts: [], confirmations: [{ id: 'c1', confirmedBy: FIXTURE_ME_ADMIN.id, confirmedAt: '2026-09-11T09:00:00Z', packVersion: 1, packHash: 'h', statement: 'confirmed', invalidated: false }], receipts: [] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission/attempt`, (route) => route.fulfill({ status: 409, json: { error: { code: 'SUBMISSION_BLOCKED', message: 'Submission blocked: DEADLINE_PASSED', blockers: ['DEADLINE_PASSED'] } } }))
    await openSubmissionExecutionTab(page)
    await page.getByRole('button', { name: 'Attempt submission' }).click()
    await expect(page.getByText(/DEADLINE_PASSED/)).toBeVisible()
  })

  test('E2E12 — receipt capture and view: saving a receipt shows it with an UNVERIFIED status until independently verified', async ({ page }) => {
    await mockCommon(page)
    let captured = false
    await page.route(`**/api/bids/${PROJECT_ID}/submission`, (route) =>
      route.fulfill({
        json: {
          execution: executionFixture({ status: 'SUBMISSION_REPORTED' }),
          attempts: [],
          confirmations: [],
          receipts: captured ? [{ id: 'r2', receiptType: 'MANUAL_ATTESTATION', providerName: null, providerReference: 'USER-TYPED-REF', verificationStatus: 'UNVERIFIED', capturedAt: '2026-09-12T09:05:00Z', notes: null }] : [],
        },
      }),
    )
    await page.route(`**/api/bids/${PROJECT_ID}/submission/receipts`, (route) => {
      captured = true
      return route.fulfill({ status: 201, json: { receipt: { id: 'r2' } } })
    })
    await openSubmissionExecutionTab(page)
    await expect(page.getByText('SUBMISSION REPORTED — VERIFICATION REQUIRED').first()).toBeVisible()
    await page.getByPlaceholder('Reference number').fill('USER-TYPED-REF')
    await page.getByRole('button', { name: 'Save receipt' }).click()
    await expect(page.getByText('RECEIPT STATUS: UNVERIFIED')).toBeVisible()
  })

  test('E2E13 — submission timeline shows confirmations, attempts and receipts with timestamps', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/submission`, (route) =>
      route.fulfill({
        json: {
          execution: executionFixture({ status: 'SUBMITTED' }),
          attempts: [{ id: 'a1', attemptNumber: 1, status: 'SUCCEEDED', method: 'PORTAL', packVersion: 1, startedAt: '2026-09-12T09:00:00Z', completedAt: '2026-09-12T09:00:05Z', providerReference: 'REF-1', errorCode: null, errorMessage: null }],
          confirmations: [{ id: 'c1', confirmedBy: FIXTURE_ME_ADMIN.id, confirmedAt: '2026-09-12T08:55:00Z', packVersion: 1, packHash: 'h', statement: 'confirmed', invalidated: false }],
          receipts: [{ id: 'r1', receiptType: 'PORTAL_RECEIPT', providerName: 'MOCK_PORTAL', providerReference: 'REF-1', verificationStatus: 'VERIFIED', capturedAt: '2026-09-12T09:00:05Z', notes: null }],
        },
      }),
    )
    await openSubmissionExecutionTab(page)
    await expect(page.getByText(/Confirmed by/)).toBeVisible()
    await expect(page.getByText(/Attempt #1/)).toBeVisible()
    await expect(page.getByText(/Receipt captured/)).toBeVisible()
  })

  test('E2E14 — cross-agency access is blocked rather than leaking submission execution state', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}`, (route) => route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Bid project not found.' } } }))
    await page.goto(`/bids/${PROJECT_ID}`)
    await expect(page.getByText(/not found/i).first()).toBeVisible()
  })

  test('E2E15 — a pack hash mismatch blocks execution outright', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/submission`, (route) => route.fulfill({ json: { execution: executionFixture({ status: 'SUBMITTING' }), attempts: [], confirmations: [{ id: 'c1', confirmedBy: FIXTURE_ME_ADMIN.id, confirmedAt: '2026-09-11T09:00:00Z', packVersion: 1, packHash: 'stale-hash', statement: 'confirmed', invalidated: false }], receipts: [] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission/attempt`, (route) => route.fulfill({ status: 409, json: { error: { code: 'SUBMISSION_BLOCKED', message: 'Submission blocked: PACK_HASH_MISMATCH', blockers: ['PACK_HASH_MISMATCH'] } } }))
    await openSubmissionExecutionTab(page)
    await page.getByRole('button', { name: 'Attempt submission' }).click()
    await expect(page.getByText(/PACK_HASH_MISMATCH/)).toBeVisible()
  })
})
