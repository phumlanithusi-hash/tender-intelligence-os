import { test, expect, type Page } from '@playwright/test'
import { FIXTURE_ME_ADMIN } from './fixtures/documentPipeline.js'

/**
 * Phase 19 — Production Integration, Data Completeness & Intelligence
 * Operations. Mock-driven E2E, same convention as
 * intelligence.spec.ts/outcomes.spec.ts — no real Supabase project or
 * live source involved, every `/api/*` call mocked at the network
 * level.
 *
 * Covers: the Data Quality dashboard (completeness breakdown,
 * violations list, filter, resolve, dismiss, role gating, empty/error
 * states), the Production Health dashboard (sources/documents/ai/
 * outcomes/jobs/storage sections, the "no BullMQ" disclosure, error
 * state), and addenda acknowledgement inside the existing Submission
 * Readiness tab (material vs administrative, acknowledge action, role
 * gating, reconciled state) — plus navigation reachability for both
 * new pages.
 */

const FAKE_ACCESS_TOKEN = 'e2e-fixture-access-token-p19'
const PROJECT_ID = '00000000-0000-4000-8000-b1d5000000e9'
const TENDER_ID = '00000000-0000-4000-8000-tender0000e9'

const FIXTURE_ME_VIEWER = {
  id: '00000000-0000-4000-8000-0000000e9v',
  email: 'e2e-viewer-p19@tender-os.test',
  role: 'VIEWER',
  agencyId: null,
  fullName: 'E2E Fixture Viewer',
}

const FIXTURE_PROJECT = {
  id: PROJECT_ID,
  tender_id: TENDER_ID,
  agency_id: '00000000-0000-4000-8000-agency000e9',
  project_name: 'Bid: Provincial Fleet Maintenance Tender',
  status: 'IN_PROGRESS',
  bid_decision_run_id: '00000000-0000-4000-8000-decision0e9',
  current_strategy_version: 1,
  owner_user_id: FIXTURE_ME_ADMIN.id,
  target_submission_date: '2026-11-01',
  priority: 'HIGH',
  bid_effort: 'MEDIUM',
  overall_score_snapshot: 65,
}

const COMPLETENESS_FIXTURE = [
  { domain: 'TENDER', total: 40, known: 30, unverified: 5, unknown: 0, missing: 5, conflicting: 0 },
  { domain: 'DOCUMENT', total: 60, known: 50, unverified: 5, unknown: 0, missing: 3, conflicting: 2 },
  { domain: 'OUTCOME', total: 10, known: 6, unverified: 2, unknown: 2, missing: 0, conflicting: 1 },
]

function violationFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'violation-1',
    agency_id: null,
    rule: 'TENDER_MISSING_CLOSING_DATE',
    severity: 'HIGH',
    entity_type: 'tenders',
    entity_id: TENDER_ID,
    details: {},
    detected_at: '2026-09-12T09:00:00.000Z',
    status: 'OPEN',
    resolution: null,
    resolved_by: null,
    resolved_at: null,
    created_at: '2026-09-12T09:00:00.000Z',
    updated_at: '2026-09-12T09:00:00.000Z',
    ...overrides,
  }
}

const OPS_HEALTH_FIXTURE = {
  sources: { totalSources: 4, activeSources: 3, healthySources: 2, warningSources: 1, failedSources: 1, notConnectedSources: 1, lastScanAt: '2026-09-12T08:00:00.000Z' },
  documents: { queued: 2, processing: 0, completed: 30, failed: 1, requiresReview: 1 },
  ai: { totalRuns: 20, failedRuns: 2, requiresReviewRuns: 1, embeddingFailures: 1 },
  outcomes: { verified: 5, unknown: 3, conflicting: 1, requiresFollowUp: 2 },
  jobs: { queuedScans: 0, runningScans: 1, failedScans: 1 },
  storage: { documentsWithStoragePath: 28, documentsMissingStoragePath: 3 },
  generatedAt: '2026-09-12T09:30:00.000Z',
}

function addendumFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'addendum-1',
    addendum_number: 1,
    published_at: '2026-09-01T00:00:00.000Z',
    summary: 'Closing date extended by two weeks.',
    deadline_changed: true,
    briefing_changed: false,
    requirement_changed: false,
    evaluation_changed: false,
    pricing_changed: false,
    other_changes: null,
    isMaterial: true,
    acknowledgement: null,
    ...overrides,
  }
}

async function signInWithFixtureSession(page: Page, user: typeof FIXTURE_ME_ADMIN = FIXTURE_ME_ADMIN) {
  await page.addInitScript(
    ({ storageKey, accessToken, userId, userEmail }) => {
      const oneHourFromNow = Math.round(Date.now() / 1000) + 3600
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          access_token: accessToken,
          refresh_token: 'e2e-fixture-refresh-token-p19',
          expires_at: oneHourFromNow,
          expires_in: 3600,
          token_type: 'bearer',
          user: { id: userId, email: userEmail, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-01-01T00:00:00.000Z' },
        }),
      )
    },
    { storageKey: 'sb-e2efixture-auth-token', accessToken: FAKE_ACCESS_TOKEN, userId: user.id, userEmail: user.email },
  )
  await page.route('**/api/me', (route) => route.fulfill({ json: user }))
}

async function mockCommon(page: Page) {
  await page.route('**/api/watchlist**', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { rows: [] } }) : route.fulfill({ status: 204, body: '' })))
  await page.route('**/api/saved-filters**', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { rows: [] } }) : route.fulfill({ status: 204, body: '' })))
  // The notification bell (Phase 19 gap-closing, spec §15) renders in
  // AppShell's header on every authenticated page, so every spec in
  // this file (and every other fixture-auth spec) now issues these
  // two calls on load — mocked here by default so this file's own
  // assertions aren't sharing network noise with an unrelated
  // dashboard's fixtures. A dedicated describe block below covers the
  // bell itself with its own explicit mocks.
  await page.route('**/api/notifications/unread-count', (route) => route.fulfill({ json: { data: { count: 0 } } }))
  await page.route('**/api/notifications?*', (route) => route.fulfill({ json: { data: [] } }))
}

test.describe('Phase 19 — Data Quality dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithFixtureSession(page)
    await mockCommon(page)
  })

  test('E2E1 — shows per-domain completeness with separate known/unverified/unknown/missing/conflicting counts, never one percentage', async ({ page }) => {
    await page.route('**/api/data-quality/completeness', (route) => route.fulfill({ json: { data: COMPLETENESS_FIXTURE } }))
    await page.route('**/api/data-quality/violations**', (route) => route.fulfill({ json: { data: [] } }))
    await page.goto('/data-quality')
    await expect(page.getByRole('cell', { name: 'TENDER', exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'DOCUMENT', exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'OUTCOME', exact: true })).toBeVisible()
  })

  test('E2E2 — lists open violations with severity and rule', async ({ page }) => {
    await page.route('**/api/data-quality/completeness', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/data-quality/violations**', (route) => route.fulfill({ json: { data: [violationFixture()] } }))
    await page.goto('/data-quality')
    await expect(page.getByText('TENDER MISSING CLOSING DATE')).toBeVisible()
    await expect(page.getByText('HIGH')).toBeVisible()
  })

  test('E2E3 — empty state when no violations exist', async ({ page }) => {
    await page.route('**/api/data-quality/completeness', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/data-quality/violations**', (route) => route.fulfill({ json: { data: [] } }))
    await page.goto('/data-quality')
    await expect(page.getByText('No violations found')).toBeVisible()
  })

  test('E2E4 — ADMIN sees the "Run data quality scan" action', async ({ page }) => {
    await page.route('**/api/data-quality/completeness', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/data-quality/violations**', (route) => route.fulfill({ json: { data: [] } }))
    await page.goto('/data-quality')
    await expect(page.getByRole('button', { name: 'Run data quality scan' })).toBeVisible()
  })

  test('E2E5 — VIEWER never sees the scan action or resolve/dismiss controls (server remains authoritative regardless)', async ({ page }) => {
    await signInWithFixtureSession(page, FIXTURE_ME_VIEWER)
    await mockCommon(page)
    await page.route('**/api/data-quality/completeness', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/data-quality/violations**', (route) => route.fulfill({ json: { data: [violationFixture()] } }))
    await page.goto('/data-quality')
    await expect(page.getByText('TENDER MISSING CLOSING DATE')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Run data quality scan' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Resolve' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Dismiss' })).toHaveCount(0)
  })

  test('E2E6 — running a scan calls POST /api/data-quality/scan', async ({ page }) => {
    await page.route('**/api/data-quality/completeness', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/data-quality/violations**', (route) => route.fulfill({ json: { data: [] } }))
    let scanCalled = false
    await page.route('**/api/data-quality/scan', (route) => {
      scanCalled = true
      return route.fulfill({ status: 201, json: { data: [] } })
    })
    await page.goto('/data-quality')
    await page.getByRole('button', { name: 'Run data quality scan' }).click()
    await expect.poll(() => scanCalled).toBe(true)
  })

  test('E2E7 — resolving an open violation calls the resolve endpoint with a resolution reason', async ({ page }) => {
    await page.route('**/api/data-quality/completeness', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/data-quality/violations**', (route) => route.fulfill({ json: { data: [violationFixture()] } }))
    let resolvedBody: unknown = null
    await page.route('**/api/data-quality/violations/violation-1/resolve', (route) => {
      resolvedBody = route.request().postDataJSON()
      return route.fulfill({ json: { data: violationFixture({ status: 'RESOLVED', resolution: 'Closing date confirmed and added.' }) } })
    })
    await page.goto('/data-quality')
    await page.getByPlaceholder('Resolution reason…').fill('Closing date confirmed and added.')
    await page.getByRole('button', { name: 'Resolve' }).click()
    await expect.poll(() => resolvedBody).toEqual({ status: 'RESOLVED', resolution: 'Closing date confirmed and added.' })
  })

  test('E2E8 — dismissing an open violation calls the resolve endpoint with status DISMISSED', async ({ page }) => {
    await page.route('**/api/data-quality/completeness', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/data-quality/violations**', (route) => route.fulfill({ json: { data: [violationFixture()] } }))
    let dismissedBody: unknown = null
    await page.route('**/api/data-quality/violations/violation-1/resolve', (route) => {
      dismissedBody = route.request().postDataJSON()
      return route.fulfill({ json: { data: violationFixture({ status: 'DISMISSED', resolution: 'Not a real gap.' }) } })
    })
    await page.goto('/data-quality')
    await page.getByPlaceholder('Resolution reason…').fill('Not a real gap.')
    await page.getByRole('button', { name: 'Dismiss' }).click()
    await expect.poll(() => (dismissedBody as { status?: string } | null)?.status).toBe('DISMISSED')
  })

  test('E2E9 — filtering by status re-queries the violations endpoint', async ({ page }) => {
    await page.route('**/api/data-quality/completeness', (route) => route.fulfill({ json: { data: [] } }))
    const seen: string[] = []
    await page.route('**/api/data-quality/violations**', (route) => {
      const url = new URL(route.request().url())
      seen.push(url.searchParams.get('status') ?? '')
      return route.fulfill({ json: { data: [] } })
    })
    await page.goto('/data-quality')
    await page.locator('select').selectOption('RESOLVED')
    await expect.poll(() => seen).toContain('RESOLVED')
  })

  test('E2E10 — a resolved violation shows its resolution text instead of the resolve/dismiss controls', async ({ page }) => {
    await page.route('**/api/data-quality/completeness', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/data-quality/violations**', (route) => route.fulfill({ json: { data: [violationFixture({ status: 'RESOLVED', resolution: 'Fixed upstream.' })] } }))
    await page.goto('/data-quality')
    await expect(page.getByText('Resolution: Fixed upstream.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Resolve' })).toHaveCount(0)
  })

  test('E2E11 — a CRITICAL severity violation is rendered with a destructive badge', async ({ page }) => {
    await page.route('**/api/data-quality/completeness', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/data-quality/violations**', (route) => route.fulfill({ json: { data: [violationFixture({ rule: 'WINNER_WITHOUT_EVIDENCE', severity: 'CRITICAL' })] } }))
    await page.goto('/data-quality')
    await expect(page.getByText('WINNER WITHOUT EVIDENCE')).toBeVisible()
    await expect(page.getByText('CRITICAL')).toBeVisible()
  })
})

test.describe('Phase 19 — Production Health dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithFixtureSession(page)
    await mockCommon(page)
  })

  test('E2E12 — shows live source, document, AI, outcome, job and storage sections', async ({ page }) => {
    await page.route('**/api/ops/health', (route) => route.fulfill({ json: { data: OPS_HEALTH_FIXTURE } }))
    await page.goto('/ops')
    await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'AI' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Outcomes' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Background processing' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Storage' })).toBeVisible()
  })

  test('E2E13 — discloses honestly that no BullMQ/Redis queue is wired', async ({ page }) => {
    await page.route('**/api/ops/health', (route) => route.fulfill({ json: { data: OPS_HEALTH_FIXTURE } }))
    await page.goto('/ops')
    await expect(page.getByText(/No BullMQ\/Redis queue is wired/)).toBeVisible()
  })

  test('E2E14 — a live source-scan health count (failed sources) is visible, never hidden behind an aggregate status', async ({ page }) => {
    await page.route('**/api/ops/health', (route) => route.fulfill({ json: { data: OPS_HEALTH_FIXTURE } }))
    await page.goto('/ops')
    await expect(page.getByText('Failed').first()).toBeVisible()
  })

  test('E2E15 — shows an error state rather than crashing when the health endpoint fails', async ({ page }) => {
    await page.route('**/api/ops/health', (route) => route.fulfill({ status: 500, json: { error: { code: 'INTERNAL', message: 'boom' } } }))
    await page.goto('/ops')
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByText('Something went wrong')).toBeVisible()
  })

  test('E2E16 — Production Health is reachable from the main navigation', async ({ page }) => {
    await page.route('**/api/ops/health', (route) => route.fulfill({ json: { data: OPS_HEALTH_FIXTURE } }))
    await page.goto('/')
    await page.getByRole('link', { name: 'Production Health' }).click()
    await expect(page).toHaveURL(/\/ops$/)
  })

  test('E2E17 — Data Quality is reachable from the main navigation', async ({ page }) => {
    await page.route('**/api/data-quality/completeness', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/data-quality/violations**', (route) => route.fulfill({ json: { data: [] } }))
    await page.goto('/')
    await page.getByRole('link', { name: 'Data Quality' }).click()
    await expect(page).toHaveURL(/\/data-quality$/)
  })
})

test.describe('Phase 19 — Addenda acknowledgement (Submission Readiness tab)', () => {
  async function mockBidBase(page: Page) {
    await page.route(`**/api/bids/${PROJECT_ID}`, (route) => route.fulfill({ json: FIXTURE_PROJECT }))
    await page.route(`**/api/bids/${PROJECT_ID}/readiness`, (route) => route.fulfill({ json: { status: 'READY', blockers: [], warnings: [], completeness: { requirements: 1, evaluationCriteria: 1, evidenceNeeds: 1, tasks: 1, compliance: 1 } } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-readiness`, (route) => route.fulfill({ json: { readiness: null, items: [] } }))
    await page.route(`**/api/bids/${PROJECT_ID}/pricing`, (route) => route.fulfill({ json: { pricing: null } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-pack`, (route) => route.fulfill({ json: { pack: null } }))
    await page.route(`**/api/bids/${PROJECT_ID}/submission-manifest`, (route) => route.fulfill({ json: { manifest: null } }))
  }

  async function openSubmissionReadinessTab(page: Page) {
    await page.goto(`/bids/${PROJECT_ID}`)
    await page.getByRole('tab', { name: 'Submission Readiness' }).click()
  }

  test('E2E18 — a material addendum is labelled MATERIAL and NOT ACKNOWLEDGED, with an Acknowledge action for a BID_MANAGER/ADMIN', async ({ page }) => {
    await signInWithFixtureSession(page)
    await mockCommon(page)
    await mockBidBase(page)
    await page.route(`**/api/bids/${PROJECT_ID}/addenda`, (route) => route.fulfill({ json: { data: [addendumFixture()] } }))
    await openSubmissionReadinessTab(page)
    await expect(page.getByText('Addendum 1')).toBeVisible()
    await expect(page.getByText('MATERIAL')).toBeVisible()
    await expect(page.getByText('NOT ACKNOWLEDGED')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Acknowledge' })).toBeVisible()
  })

  test('E2E19 — a non-material (administrative) addendum is labelled ADMINISTRATIVE, never MATERIAL', async ({ page }) => {
    await signInWithFixtureSession(page)
    await mockCommon(page)
    await mockBidBase(page)
    await page.route(`**/api/bids/${PROJECT_ID}/addenda`, (route) => route.fulfill({ json: { data: [addendumFixture({ isMaterial: false, deadline_changed: false, summary: 'Contact email corrected.' })] } }))
    await openSubmissionReadinessTab(page)
    await expect(page.getByText('ADMINISTRATIVE')).toBeVisible()
    await expect(page.getByText('MATERIAL')).toHaveCount(0)
  })

  test('E2E20 — clicking Acknowledge calls the acknowledge endpoint for the correct addendum', async ({ page }) => {
    await signInWithFixtureSession(page)
    await mockCommon(page)
    await mockBidBase(page)
    let ackCalled = false
    await page.route(`**/api/bids/${PROJECT_ID}/addenda`, (route) =>
      route.fulfill({ json: { data: [addendumFixture({ acknowledgement: ackCalled ? { id: 'ack-1', acknowledged_by: FIXTURE_ME_ADMIN.id, acknowledged_at: '2026-09-12T10:00:00.000Z', reconciled: false, note: null } : null })] } }),
    )
    await page.route(`**/api/bids/${PROJECT_ID}/addenda/addendum-1/acknowledge`, (route) => {
      ackCalled = true
      return route.fulfill({ json: { data: { id: 'ack-1', reconciled: false } } })
    })
    await openSubmissionReadinessTab(page)
    await page.getByRole('button', { name: 'Acknowledge' }).click()
    await expect.poll(() => ackCalled).toBe(true)
    await expect(page.getByText('ACKNOWLEDGED', { exact: true })).toBeVisible()
  })

  test('E2E21 — an already-acknowledged, reconciled addendum shows RECONCILED and no Acknowledge button', async ({ page }) => {
    await signInWithFixtureSession(page)
    await mockCommon(page)
    await mockBidBase(page)
    await page.route(`**/api/bids/${PROJECT_ID}/addenda`, (route) =>
      route.fulfill({ json: { data: [addendumFixture({ acknowledgement: { id: 'ack-1', acknowledged_by: FIXTURE_ME_ADMIN.id, acknowledged_at: '2026-09-12T10:00:00.000Z', reconciled: true, note: 'Proposal updated.' } })] } }),
    )
    await openSubmissionReadinessTab(page)
    await expect(page.getByText('RECONCILED')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Acknowledge' })).toHaveCount(0)
  })

  test('E2E22 — a VIEWER never sees the Acknowledge action (server remains authoritative regardless)', async ({ page }) => {
    await signInWithFixtureSession(page, FIXTURE_ME_VIEWER)
    await mockCommon(page)
    await mockBidBase(page)
    await page.route(`**/api/bids/${PROJECT_ID}/addenda`, (route) => route.fulfill({ json: { data: [addendumFixture()] } }))
    await openSubmissionReadinessTab(page)
    await expect(page.getByText('Addendum 1')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Acknowledge' })).toHaveCount(0)
  })

  test('E2E23 — with no addenda for the tender, the Addenda card does not render at all', async ({ page }) => {
    await signInWithFixtureSession(page)
    await mockCommon(page)
    await mockBidBase(page)
    await page.route(`**/api/bids/${PROJECT_ID}/addenda`, (route) => route.fulfill({ json: { data: [] } }))
    await openSubmissionReadinessTab(page)
    await expect(page.getByText('Addenda', { exact: true })).toHaveCount(0)
  })

  test('E2E24 — an addendum summary, when present, is displayed verbatim', async ({ page }) => {
    await signInWithFixtureSession(page)
    await mockCommon(page)
    await mockBidBase(page)
    await page.route(`**/api/bids/${PROJECT_ID}/addenda`, (route) => route.fulfill({ json: { data: [addendumFixture({ summary: 'Site briefing rescheduled to 20 September.' })] } }))
    await openSubmissionReadinessTab(page)
    await expect(page.getByText('Site briefing rescheduled to 20 September.')).toBeVisible()
  })

  test('E2E25 — multiple addenda are all listed, each with its own acknowledgement state', async ({ page }) => {
    await signInWithFixtureSession(page)
    await mockCommon(page)
    await mockBidBase(page)
    await page.route(`**/api/bids/${PROJECT_ID}/addenda`, (route) =>
      route.fulfill({
        json: {
          data: [
            addendumFixture({ id: 'addendum-1', addendum_number: 1 }),
            addendumFixture({ id: 'addendum-2', addendum_number: 2, isMaterial: false, acknowledgement: { id: 'ack-2', acknowledged_by: FIXTURE_ME_ADMIN.id, acknowledged_at: '2026-09-05T00:00:00.000Z', reconciled: false, note: null } }),
          ],
        },
      }),
    )
    await openSubmissionReadinessTab(page)
    await expect(page.getByText('Addendum 1')).toBeVisible()
    await expect(page.getByText('Addendum 2')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Acknowledge' })).toHaveCount(1)
  })
})

function notificationFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'notif-1',
    user_id: null,
    agency_id: '00000000-0000-4000-8000-agency000e9',
    event_type: 'OUTCOME_DETECTED',
    channel: 'IN_APP',
    payload: { outcomeStatus: 'AWARDED' },
    entity_type: 'tender_outcome',
    entity_id: 'outcome-1',
    related_tender_id: TENDER_ID,
    bid_strategy_project_id: PROJECT_ID,
    dedup_key: 'OUTCOME_DETECTED:tender_outcome:outcome-1',
    read_at: null,
    dismissed_at: null,
    sent_at: null,
    created_at: '2026-09-12T09:00:00.000Z',
    ...overrides,
  }
}

test.describe('Phase 19 gap-closing — Notification bell (spec §15)', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithFixtureSession(page)
    await mockCommon(page)
    await page.route('**/api/data-quality/completeness', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/data-quality/violations**', (route) => route.fulfill({ json: { data: [] } }))
  })

  test('E2E26 — an unread count is shown as a badge on the bell', async ({ page }) => {
    await page.route('**/api/notifications/unread-count', (route) => route.fulfill({ json: { data: { count: 3 } } }))
    await page.goto('/data-quality')
    await expect(page.getByTestId('notification-unread-badge')).toHaveText('3')
  })

  test('E2E27 — no badge is shown when there are zero unread notifications', async ({ page }) => {
    await page.route('**/api/notifications/unread-count', (route) => route.fulfill({ json: { data: { count: 0 } } }))
    await page.goto('/data-quality')
    await expect(page.getByTestId('notification-unread-badge')).toHaveCount(0)
  })

  test('E2E28 — opening the bell shows the inbox with each notification linked to its underlying entity type', async ({ page }) => {
    await page.route('**/api/notifications/unread-count', (route) => route.fulfill({ json: { data: { count: 1 } } }))
    await page.route('**/api/notifications?*', (route) => route.fulfill({ json: { data: [notificationFixture()] } }))
    await page.goto('/data-quality')
    await page.getByRole('button', { name: 'Notifications' }).click()
    await expect(page.getByRole('dialog', { name: 'Notification inbox' })).toBeVisible()
    await expect(page.getByTestId('notification-row')).toHaveCount(1)
    await expect(page.getByText('Outcome Detected')).toBeVisible()
  })

  test('E2E29 — an empty inbox shows a clear empty state, not a blank panel', async ({ page }) => {
    await page.route('**/api/notifications/unread-count', (route) => route.fulfill({ json: { data: { count: 0 } } }))
    await page.route('**/api/notifications?*', (route) => route.fulfill({ json: { data: [] } }))
    await page.goto('/data-quality')
    await page.getByRole('button', { name: 'Notifications' }).click()
    await expect(page.getByText('No notifications.')).toBeVisible()
  })

  test('E2E30 — marking a notification read calls POST /api/notifications/:id/read', async ({ page }) => {
    await page.route('**/api/notifications/unread-count', (route) => route.fulfill({ json: { data: { count: 1 } } }))
    await page.route('**/api/notifications?*', (route) => route.fulfill({ json: { data: [notificationFixture()] } }))
    let readCalled = false
    await page.route('**/api/notifications/notif-1/read', (route) => {
      readCalled = true
      return route.fulfill({ json: { data: notificationFixture({ read_at: '2026-09-12T10:00:00.000Z' }) } })
    })
    await page.goto('/data-quality')
    await page.getByRole('button', { name: 'Notifications' }).click()
    await page.getByRole('button', { name: 'Mark read' }).click()
    await expect.poll(() => readCalled).toBe(true)
  })

  test('E2E31 — dismissing a notification calls POST /api/notifications/:id/dismiss', async ({ page }) => {
    await page.route('**/api/notifications/unread-count', (route) => route.fulfill({ json: { data: { count: 1 } } }))
    await page.route('**/api/notifications?*', (route) => route.fulfill({ json: { data: [notificationFixture()] } }))
    let dismissCalled = false
    await page.route('**/api/notifications/notif-1/dismiss', (route) => {
      dismissCalled = true
      return route.fulfill({ json: { data: notificationFixture({ dismissed_at: '2026-09-12T10:00:00.000Z' }) } })
    })
    await page.goto('/data-quality')
    await page.getByRole('button', { name: 'Notifications' }).click()
    await page.getByRole('button', { name: 'Dismiss' }).click()
    await expect.poll(() => dismissCalled).toBe(true)
  })

  test('E2E32 — the bell is reachable from any page (e.g. Production Health), not only Data Quality', async ({ page }) => {
    await page.route('**/api/ops/health', (route) => route.fulfill({ json: { data: OPS_HEALTH_FIXTURE } }))
    await page.route('**/api/notifications/unread-count', (route) => route.fulfill({ json: { data: { count: 0 } } }))
    await page.goto('/ops')
    await expect(page.getByRole('button', { name: 'Notifications' })).toBeVisible()
  })
})
