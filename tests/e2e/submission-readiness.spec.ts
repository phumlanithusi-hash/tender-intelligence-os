import { test, expect, type Page } from '@playwright/test'
import { FIXTURE_ME_ADMIN } from './fixtures/documentPipeline.js'

/**
 * Phase 15 §58 E2E flow (mock-driven, same convention as
 * proposal-generation.spec.ts / bid-strategy.spec.ts): the Submission
 * Readiness tab on the standalone `/bids/:id` dashboard, entirely
 * mocked at the network level — no real Supabase project or portal
 * involved. 12 scenarios covering the full intended flow (§64):
 * Dashboard → Resolve Blocker → Pricing Entry/Validation → Mandatory
 * Document Checklist → Addendum Reconciliation → Pack Creation →
 * Manifest Inspection → Final Approval → Agency Isolation → Deadline
 * Passed → Changed Package Invalidates Approval. The deterministic
 * engine itself and DB-level RLS/immutability are covered instead by
 * apps/api/src/lib/submissionReadiness/__tests__ and
 * database/src/__tests__/submissionReadiness.test.ts — the same
 * deliberate split every prior phase's E2E suite documents.
 */

const FAKE_ACCESS_TOKEN = 'e2e-fixture-access-token-p15'
const PROJECT_ID = '00000000-0000-4000-8000-b1d5000000e5'
const TENDER_ID = '00000000-0000-4000-8000-tender0000e5'
const READINESS_ID = '00000000-0000-4000-8000-readiness0e5'
const PACK_ID = '00000000-0000-4000-8000-pack00000e5'

const FIXTURE_PROJECT = {
  id: PROJECT_ID,
  tender_id: TENDER_ID,
  agency_id: '00000000-0000-4000-8000-agency000e5',
  project_name: 'Bid: Municipal Roads Maintenance Tender',
  status: 'IN_PROGRESS',
  bid_decision_run_id: '00000000-0000-4000-8000-decision0e5',
  current_strategy_version: 1,
  owner_user_id: FIXTURE_ME_ADMIN.id,
  target_submission_date: '2026-11-01',
  priority: 'HIGH',
  bid_effort: 'MEDIUM',
  overall_score_snapshot: 71,
}

function readinessFixture(overrides: { status?: string; items?: Array<Record<string, unknown>> } = {}) {
  return {
    readiness: {
      id: READINESS_ID,
      bidProjectId: PROJECT_ID,
      status: overrides.status ?? 'BLOCKED',
      computedAt: '2026-09-11T09:00:00.000Z',
      categorySummary: { MANDATORY_REQUIREMENTS: { blockers: overrides.status === 'BLOCKED' ? 1 : 0, warnings: 0, info: 0 } },
    },
    items: overrides.items ?? [{ id: 'item-1', category: 'MANDATORY_REQUIREMENTS', severity: 'BLOCKER', code: 'MANDATORY_REQUIREMENT_UNRESOLVED', message: 'Tax clearance certificate is missing.', sourceType: 'TENDER_REQUIREMENT', sourceId: 'req-1', resolved: false }],
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
          refresh_token: 'e2e-fixture-refresh-token-p15',
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
  // Phase 19 §12 — the Submission Readiness tab now also renders an
  // Addenda card; no addenda for this fixture tender keeps every
  // pre-existing assertion in this file unaffected.
  await page.route(`**/api/bids/${PROJECT_ID}/addenda`, (route) => route.fulfill({ json: { data: [] } }))
}

async function openSubmissionReadinessTab(page: Page) {
  await page.goto(`/bids/${PROJECT_ID}`)
  await page.getByRole('tab', { name: 'Submission Readiness' }).click()
}

test.describe('Phase 15 — Final Bid Compliance, Submission Readiness & Submission Pack', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithFixtureSession(page)
  })

  test('E2E1 — Submission Readiness Dashboard: shows overall status and category summary', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/submission-readiness`, (route) => route.fulfill({ json: readinessFixture() }))
    await page.route(`**/api/bids/${PROJECT_ID}/pricing`, (route) => route.fulfill({ json: { pricing: null } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-pack`, (route) => route.fulfill({ json: { pack: null } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-manifest`, (route) => route.fulfill({ json: { manifest: null } }))

    await openSubmissionReadinessTab(page)
    await expect(page.getByText('BLOCKED').first()).toBeVisible()
    await expect(page.getByText('MANDATORY REQUIREMENTS').first()).toBeVisible()
  })

  test('E2E2 — Resolve Mandatory Blocker: re-running the check after a fix clears the blocker', async ({ page }) => {
    await mockCommon(page)
    let checked = false
    await page.route(`**/api/bids/${PROJECT_ID}/submission-readiness`, (route) => route.fulfill({ json: checked ? readinessFixture({ status: 'READY_TO_SUBMIT', items: [] }) : readinessFixture() }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-readiness/check`, (route) => {
      checked = true
      return route.fulfill({ status: 201, json: { readiness: readinessFixture({ status: 'READY_TO_SUBMIT', items: [] }).readiness, result: { status: 'READY_TO_SUBMIT' }, items: [] } })
    })
    await page.route(`**/api/bids/${PROJECT_ID}/pricing`, (route) => route.fulfill({ json: { pricing: null } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-pack`, (route) => route.fulfill({ json: { pack: null } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-manifest`, (route) => route.fulfill({ json: { manifest: null } }))

    await openSubmissionReadinessTab(page)
    await expect(page.getByText('No blockers.')).not.toBeVisible()
    await page.getByRole('button', { name: 'Re-run check' }).click()
    await expect(page.getByText('READY TO SUBMIT').first()).toBeVisible()
    await expect(page.getByText('No blockers.')).toBeVisible()
  })

  test('E2E3 — Pricing Entry: adding a pricing line calls the create endpoint', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/submission-readiness`, (route) => route.fulfill({ json: readinessFixture() }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-pack`, (route) => route.fulfill({ json: { pack: null } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-manifest`, (route) => route.fulfill({ json: { manifest: null } }))
    let itemAdded = false
    await page.route(`**/api/bids/${PROJECT_ID}/pricing`, (route) => route.fulfill({ json: { pricing: itemAdded ? { id: 'pricing-1', currency: 'ZAR', items: [{ id: 'item-1', description: 'Project management', quantity: 1, unitPrice: 50000, lineTotal: 50000 }] } : null } }))
    await page.route(`**/api/bids/${PROJECT_ID}/pricing/items`, (route) => {
      itemAdded = true
      return route.fulfill({ status: 201, json: { id: 'item-1' } })
    })

    await openSubmissionReadinessTab(page)
    await page.getByPlaceholder('Description').fill('Project management')
    await page.getByPlaceholder('Qty').fill('1')
    await page.getByPlaceholder('Unit price').fill('50000')
    await page.getByRole('button', { name: 'Add line' }).click()
    await expect(page.getByText('Project management')).toBeVisible()
  })

  test('E2E4 — Pricing Validation: an arithmetic-mismatch blocker is surfaced in the blocker panel', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/submission-readiness`, (route) =>
      route.fulfill({
        json: readinessFixture({ items: [{ id: 'item-2', category: 'PRICING', severity: 'BLOCKER', code: 'PRICING_ARITHMETIC_MISMATCH', message: 'Pricing line "Project management" total does not match quantity × unit price.', sourceType: 'PRICING_ITEM', sourceId: 'item-1', resolved: false }] }),
      }),
    )
    await page.route(`**/api/bids/${PROJECT_ID}/pricing`, (route) => route.fulfill({ json: { pricing: null } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-pack`, (route) => route.fulfill({ json: { pack: null } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-manifest`, (route) => route.fulfill({ json: { manifest: null } }))

    await openSubmissionReadinessTab(page)
    await expect(page.getByText(/does not match quantity/)).toBeVisible()
  })

  test('E2E5 — Mandatory Document Checklist: a missing mandatory document blocker is shown with its category', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/submission-readiness`, (route) =>
      route.fulfill({ json: readinessFixture({ items: [{ id: 'item-3', category: 'MANDATORY_DOCUMENTS', severity: 'BLOCKER', code: 'MANDATORY_DOCUMENT_MISSING_OR_INVALID', message: 'Required document "B-BBEE certificate" is missing.', sourceType: 'AGENCY_DOCUMENT', sourceId: 'doc-1', resolved: false }] }) }),
    )
    await page.route(`**/api/bids/${PROJECT_ID}/pricing`, (route) => route.fulfill({ json: { pricing: null } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-pack`, (route) => route.fulfill({ json: { pack: null } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-manifest`, (route) => route.fulfill({ json: { manifest: null } }))

    await openSubmissionReadinessTab(page)
    await expect(page.getByText('MANDATORY DOCUMENTS')).toBeVisible()
    await expect(page.getByText(/B-BBEE certificate/)).toBeVisible()
  })

  test('E2E6 — Addendum Reconciliation: an unreconciled material addendum blocker is shown', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/submission-readiness`, (route) =>
      route.fulfill({ json: readinessFixture({ items: [{ id: 'item-4', category: 'ADDENDA', severity: 'BLOCKER', code: 'MATERIAL_ADDENDUM_UNRECONCILED', message: 'Addendum 1 is material and has not been reconciled.', sourceType: 'TENDER_ADDENDUM', sourceId: 'add-1', resolved: false }] }) }),
    )
    await page.route(`**/api/bids/${PROJECT_ID}/pricing`, (route) => route.fulfill({ json: { pricing: null } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-pack`, (route) => route.fulfill({ json: { pack: null } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-manifest`, (route) => route.fulfill({ json: { manifest: null } }))

    await openSubmissionReadinessTab(page)
    await expect(page.getByText(/Addendum 1 is material/)).toBeVisible()
  })

  test('E2E7 — Submission Pack Creation: building a pack calls the create endpoint and shows the new version', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/submission-readiness`, (route) => route.fulfill({ json: readinessFixture({ status: 'READY_TO_SUBMIT', items: [] }) }))
    await page.route(`**/api/bids/${PROJECT_ID}/pricing`, (route) => route.fulfill({ json: { pricing: null } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-manifest`, (route) => route.fulfill({ json: { manifest: null } }))
    let built = false
    await page.route(`**/api/bids/${PROJECT_ID}/submission-pack`, (route) => {
      if (route.request().method() === 'POST') {
        built = true
        return route.fulfill({ status: 201, json: { id: PACK_ID, version: 1, status: 'CURRENT', files: [{ id: 'f1', fileName: 'proposal.pdf', sha256: 'abc123def456', sizeBytes: 1024 }] } })
      }
      return route.fulfill({ json: { pack: built ? { id: PACK_ID, version: 1, status: 'CURRENT', files: [{ id: 'f1', fileName: 'proposal.pdf', sha256: 'abc123def456', sizeBytes: 1024 }] } : null } })
    })

    await openSubmissionReadinessTab(page)
    await page.getByRole('button', { name: 'Build submission pack' }).click()
    await expect(page.getByText('proposal.pdf')).toBeVisible()
  })

  test('E2E8 — Manifest Inspection: the manifest JSON is viewable', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/submission-readiness`, (route) => route.fulfill({ json: readinessFixture({ status: 'READY_TO_SUBMIT', items: [] }) }))
    await page.route(`**/api/bids/${PROJECT_ID}/pricing`, (route) => route.fulfill({ json: { pricing: null } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-pack`, (route) => route.fulfill({ json: { pack: null } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-manifest`, (route) => route.fulfill({ json: { manifest: { overallStatus: 'READY_TO_SUBMIT', documents: [] } } }))

    await openSubmissionReadinessTab(page)
    await page.getByText('Manifest JSON').click()
    await expect(page.getByText(/"overallStatus": "READY_TO_SUBMIT"/)).toBeVisible()
  })

  test('E2E9 — Final Approval: approving a READY_TO_SUBMIT package shows the human-submission notice, never an automatic submission', async ({ page }) => {
    await mockCommon(page)
    let approved = false
    await page.route(`**/api/bids/${PROJECT_ID}/submission-readiness`, (route) => route.fulfill({ json: readinessFixture({ status: approved ? 'APPROVED_FOR_SUBMISSION' : 'READY_TO_SUBMIT', items: [] }) }))
    await page.route(`**/api/bids/${PROJECT_ID}/pricing`, (route) => route.fulfill({ json: { pricing: null } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-pack`, (route) => route.fulfill({ json: { pack: { id: PACK_ID, version: 1, status: 'CURRENT', files: [] } } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-manifest`, (route) => route.fulfill({ json: { manifest: null } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-approval`, (route) => {
      approved = true
      return route.fulfill({ status: 201, json: { approval: { id: 'approval-1' }, message: 'READY FOR HUMAN SUBMISSION' } })
    })

    await openSubmissionReadinessTab(page)
    await expect(page.getByText('READY FOR HUMAN SUBMISSION.')).toBeVisible()
    await page.getByPlaceholder('Approval reason / confirmation…').fill('Reviewed and confirmed complete.')
    await page.getByRole('button', { name: 'Approve for submission' }).click()
    await expect(page.getByText(/APPROVED FOR HUMAN SUBMISSION — this system has not submitted anything/)).toBeVisible()
  })

  test('E2E10 — Agency Isolation: a bid project belonging to another agency 404s rather than leaking submission readiness', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}`, (route) => route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Bid project not found.' } } }))

    await page.goto(`/bids/${PROJECT_ID}`)
    await expect(page.getByText(/not found/i).first()).toBeVisible()
  })

  test('E2E11 — Deadline Passed: a passed-deadline blocker is always shown regardless of everything else', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/submission-readiness`, (route) =>
      route.fulfill({ json: readinessFixture({ items: [{ id: 'item-5', category: 'DEADLINE', severity: 'BLOCKER', code: 'SUBMISSION_DEADLINE_PASSED', message: 'The tender submission deadline has passed.', sourceType: null, sourceId: null, resolved: false }] }) }),
    )
    await page.route(`**/api/bids/${PROJECT_ID}/pricing`, (route) => route.fulfill({ json: { pricing: null } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-pack`, (route) => route.fulfill({ json: { pack: null } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-manifest`, (route) => route.fulfill({ json: { manifest: null } }))

    await openSubmissionReadinessTab(page)
    await expect(page.getByText('The tender submission deadline has passed.')).toBeVisible()
  })

  test('E2E12 — Changed Package Invalidates Approval: a REQUIRES_REVIEW status after a package change withholds the approve button', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}/submission-readiness`, (route) => route.fulfill({ json: readinessFixture({ status: 'REQUIRES_REVIEW', items: [{ id: 'item-6', category: 'PROPOSAL', severity: 'WARNING', code: 'PROPOSAL_NOT_CURRENT_VERSION', message: 'The proposal version being checked is not the current version.', sourceType: 'PROPOSAL_VERSION', sourceId: 'v1', resolved: false }] }) }),
    )
    await page.route(`**/api/bids/${PROJECT_ID}/pricing`, (route) => route.fulfill({ json: { pricing: null } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-pack`, (route) => route.fulfill({ json: { pack: { id: PACK_ID, version: 2, status: 'CURRENT', files: [] } } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-manifest`, (route) => route.fulfill({ json: { manifest: null } }))

    await openSubmissionReadinessTab(page)
    await expect(page.getByRole('button', { name: 'Approve for submission' })).toHaveCount(0)
  })
})
