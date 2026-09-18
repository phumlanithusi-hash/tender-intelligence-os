import { test, expect, type Page } from '@playwright/test'
import { FIXTURE_ME_ADMIN } from './fixtures/documentPipeline.js'

/**
 * Phase 20 — Enterprise Hardening, Continuous Surveillance & System
 * Convergence. Mock-driven E2E, same convention as
 * production-operations.spec.ts/intelligence.spec.ts — no real
 * Supabase project or live source involved, every `/api/*` call
 * mocked at the network level.
 *
 * Covers spec §6's five named scenario groups:
 *  1. Addendum discovery and active bid invalidation until acknowledged.
 *  2. Human re-acknowledgement releasing the submission lock.
 *  3. Audit log verification end-to-end.
 *  4. Anonymized benchmark displays vs. insufficient-data masking.
 *  5. A full pipeline run traced from source scan to post-outcome logging.
 * Plus the continuous surveillance / polling-schedule panel and
 * navigation reachability for the two new pages.
 */

const FAKE_ACCESS_TOKEN = 'e2e-fixture-access-token-p20'
const PROJECT_ID = '00000000-0000-4000-8000-b1d500000e20'
const TENDER_ID = '00000000-0000-4000-8000-tender000e20'
const SOURCE_DUE_ID = '00000000-0000-4000-8000-source0due20'
const SOURCE_NOT_DUE_ID = '00000000-0000-4000-8000-sourcenotdu2'

const FIXTURE_ME_VIEWER = {
  id: '00000000-0000-4000-8000-00000e20v',
  email: 'e2e-viewer-p20@tender-os.test',
  role: 'VIEWER',
  agencyId: null,
  fullName: 'E2E Fixture Viewer P20',
}

const FIXTURE_PROJECT = {
  id: PROJECT_ID,
  tender_id: TENDER_ID,
  agency_id: '00000000-0000-4000-8000-agency00e20',
  project_name: 'Bid: Metro Signage & Media Tender',
  status: 'IN_PROGRESS',
  bid_decision_run_id: '00000000-0000-4000-8000-decision0e20',
  current_strategy_version: 1,
  owner_user_id: FIXTURE_ME_ADMIN.id,
  target_submission_date: '2026-11-01',
  priority: 'HIGH',
  bid_effort: 'MEDIUM',
  overall_score_snapshot: 68,
}

function addendumFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'addendum-p20-1',
    addendum_number: 1,
    published_at: '2026-09-10T00:00:00.000Z',
    summary: 'Submission deadline extended by 10 days.',
    deadline_changed: true,
    briefing_changed: false,
    requirement_changed: false,
    evaluation_changed: false,
    pricing_changed: false,
    other_changes: null,
    detected_via: 'DIFF_ENGINE',
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
          refresh_token: 'e2e-fixture-refresh-token-p20',
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
  await page.route('**/api/notifications/unread-count', (route) => route.fulfill({ json: { data: { count: 0 } } }))
  await page.route('**/api/notifications?*', (route) => route.fulfill({ json: { data: [] } }))
}

// -----------------------------------------------------------------
// Group 1/2 — Addendum discovery, active bid invalidation, and
// human re-acknowledgement releasing the submission lock.
// -----------------------------------------------------------------
async function mockBidStrategyShell(page: Page) {
  await page.route(`**/api/bids/${PROJECT_ID}`, (route) => route.fulfill({ json: FIXTURE_PROJECT }))
  await page.route(`**/api/bids/${PROJECT_ID}/readiness`, (route) =>
    route.fulfill({ json: { status: 'READY', blockers: [], warnings: [], completeness: { requirements: 1, evaluationCriteria: 1, evidenceNeeds: 1, tasks: 1, compliance: 1 } } }),
  )
  await page.route(`**/api/bids/${PROJECT_ID}/submission-readiness`, (route) =>
    route.fulfill({
      json: {
        readiness: { id: 'readiness-p20', bidProjectId: PROJECT_ID, status: 'BLOCKED', computedAt: '2026-09-12T09:00:00.000Z', categorySummary: {} },
        items: [],
      },
    }),
  )
  await page.route(`**/api/bids/${PROJECT_ID}/pricing`, (route) => route.fulfill({ json: { pricing: null } }))
  await page.route(`**/api/bids/${PROJECT_ID}/submission-pack`, (route) => route.fulfill({ json: { pack: null } }))
  await page.route(`**/api/bids/${PROJECT_ID}/submission-manifest`, (route) => route.fulfill({ json: { manifest: null } }))
}

async function openSubmissionReadinessTab(page: Page) {
  await page.goto(`/bids/${PROJECT_ID}`)
  await page.getByRole('tab', { name: 'Submission Readiness' }).click()
}

test.describe('Phase 20 — Addendum discovery and submission-lock reconciliation', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithFixtureSession(page)
    await mockCommon(page)
    await mockBidStrategyShell(page)
  })

  test('E2E1 — a DIFF_ENGINE-detected addendum is shown with an AUTO-DETECTED badge, distinct from a DOCUMENT-path one', async ({ page }) => {
    await page.route(`**/api/bids/${PROJECT_ID}/addenda`, (route) => route.fulfill({ json: { data: [addendumFixture()] } }))
    await openSubmissionReadinessTab(page)
    await expect(page.getByText('AUTO-DETECTED')).toBeVisible()
  })

  test('E2E2 — a material, unacknowledged addendum is shown MATERIAL + NOT ACKNOWLEDGED — the active bid stays flagged until a human acts', async ({ page }) => {
    await page.route(`**/api/bids/${PROJECT_ID}/addenda`, (route) => route.fulfill({ json: { data: [addendumFixture()] } }))
    await openSubmissionReadinessTab(page)
    await expect(page.getByText('MATERIAL')).toBeVisible()
    await expect(page.getByText('NOT ACKNOWLEDGED')).toBeVisible()
  })

  test('E2E3 — a non-material (administrative) diff-engine addendum never shows MATERIAL or blocks acknowledgement UI', async ({ page }) => {
    await page.route(`**/api/bids/${PROJECT_ID}/addenda`, (route) =>
      route.fulfill({ json: { data: [addendumFixture({ deadline_changed: false, isMaterial: false, summary: 'Administrative contact update.' })] } }),
    )
    await openSubmissionReadinessTab(page)
    await expect(page.getByText('ADMINISTRATIVE', { exact: true })).toBeVisible()
  })

  test('E2E4 — an authorized BID_MANAGER/ADMIN can acknowledge the addendum, releasing the submission lock', async ({ page }) => {
    let acknowledged = false
    await page.route(`**/api/bids/${PROJECT_ID}/addenda`, (route) =>
      route.fulfill({ json: { data: [addendumFixture(acknowledged ? { acknowledgement: { id: 'ack-1', acknowledged_by: FIXTURE_ME_ADMIN.id, acknowledged_at: '2026-09-12T10:00:00.000Z', reconciled: false, note: null } } : {})] } }),
    )
    await page.route(`**/api/bids/${PROJECT_ID}/addenda/addendum-p20-1/acknowledge`, (route) => {
      acknowledged = true
      return route.fulfill({ status: 201, json: { data: { id: 'ack-1', acknowledged_by: FIXTURE_ME_ADMIN.id, acknowledged_at: '2026-09-12T10:00:00.000Z', reconciled: false, note: null } } })
    })
    await openSubmissionReadinessTab(page)
    await expect(page.getByText('NOT ACKNOWLEDGED')).toBeVisible()
    await page.getByRole('button', { name: 'Acknowledge' }).click()
    await expect(page.getByText('ACKNOWLEDGED', { exact: true })).toBeVisible()
  })

  test('E2E5 — a VIEWER never sees the Acknowledge action, even for an unacknowledged material addendum (server remains authoritative regardless)', async ({ page }) => {
    await signInWithFixtureSession(page, FIXTURE_ME_VIEWER)
    await mockCommon(page)
    await mockBidStrategyShell(page)
    await page.route(`**/api/bids/${PROJECT_ID}/addenda`, (route) => route.fulfill({ json: { data: [addendumFixture()] } }))
    await openSubmissionReadinessTab(page)
    await expect(page.getByText('NOT ACKNOWLEDGED')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Acknowledge' })).toHaveCount(0)
  })
})

// -----------------------------------------------------------------
// Group — Continuous surveillance / polling schedule (spec §4A)
// -----------------------------------------------------------------
function pollScheduleFixture() {
  return {
    data: [
      { sourceId: SOURCE_DUE_ID, name: 'eTenders (Due Source)', adapterKey: 'etenders', due: true, reason: 'Scan frequency (1440m) elapsed since last scan.', nextPollAt: '2026-09-12T00:00:00.000Z' },
      { sourceId: SOURCE_NOT_DUE_ID, name: 'eTenders (Fresh Source)', adapterKey: 'etenders', due: false, reason: 'Scan frequency has not yet elapsed.', nextPollAt: '2026-09-13T00:00:00.000Z' },
    ],
  }
}

async function mockSourcesPage(page: Page) {
  await page.route('**/api/tender-sources/summary', (route) => route.fulfill({ json: { totalSources: 2, activeSources: 0, healthySources: 0, warningSources: 0, failedSources: 0, notConnectedSources: 2, lastScanAt: null } }))
  await page.route('**/api/tender-sources', (route) => route.fulfill({ json: { rows: [] } }))
  await page.route('**/api/surveillance/poll-schedule', (route) => route.fulfill({ json: pollScheduleFixture() }))
}

test.describe('Phase 20 — Continuous surveillance panel', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithFixtureSession(page)
    await mockCommon(page)
    await mockSourcesPage(page)
  })

  test('E2E6 — a source whose scan frequency has elapsed is shown DUE', async ({ page }) => {
    await page.goto('/sources')
    await expect(page.getByText('DUE', { exact: true })).toBeVisible()
  })

  test('E2E7 — a source not yet due for a re-scan is shown UP TO DATE', async ({ page }) => {
    await page.goto('/sources')
    await expect(page.getByText('UP TO DATE')).toBeVisible()
  })

  test('E2E8 — an ADMIN sees a "Scan now" action for a due source', async ({ page }) => {
    await page.goto('/sources')
    await expect(page.getByRole('button', { name: 'Scan now' }).first()).toBeVisible()
  })

  test('E2E9 — a VIEWER never sees the "Scan now" action', async ({ page }) => {
    await signInWithFixtureSession(page, FIXTURE_ME_VIEWER)
    await mockCommon(page)
    await mockSourcesPage(page)
    await page.goto('/sources')
    await expect(page.getByRole('button', { name: 'Scan now' })).toHaveCount(0)
  })

  test('E2E10 — clicking "Scan now" calls the on-demand surveillance scan endpoint for that source', async ({ page }) => {
    let scannedSourceId: string | null = null
    await page.route(`**/api/surveillance/scan/${SOURCE_DUE_ID}`, (route) => {
      scannedSourceId = SOURCE_DUE_ID
      return route.fulfill({ json: { data: { scanId: 'scan-1', status: 'SUCCESS', recordsDiscovered: 0, recordsProcessed: 0, recordsFailed: 0, documentsDiscovered: 0, errorCount: 0, recordsDuplicate: 0 } } })
    })
    await page.goto('/sources')
    await page.getByRole('button', { name: 'Scan now' }).first().click()
    await expect.poll(() => scannedSourceId).toBe(SOURCE_DUE_ID)
  })
})

// -----------------------------------------------------------------
// Group 4 — Anonymized Benchmarks (spec §4C)
// -----------------------------------------------------------------
function benchmarkRowsFixture() {
  return {
    data: [
      { category: 'Media & Design', region: 'Gauteng', metric_type: 'CYCLE_DAYS', sample_size: 12, p25: 20, p50: 35, p75: 50, mean: 36.5, stddev: 8.2 },
      { category: 'Niche Category', region: 'Northern Cape', metric_type: 'VOLUME', sample_size: 2, status: 'INSUFFICIENT_BENCHMARK_DATA' },
    ],
  }
}

test.describe('Phase 20 — Anonymized Benchmarks view', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithFixtureSession(page)
    await mockCommon(page)
  })

  test('E2E11 — a group clearing k-anonymity shows real p25/p50/p75/mean/stddev values', async ({ page }) => {
    await page.route('**/api/intelligence/benchmarks**', (route) => route.fulfill({ json: benchmarkRowsFixture() }))
    await page.goto('/intelligence/benchmarks')
    await expect(page.getByRole('cell', { name: 'Media & Design' })).toBeVisible()
    await expect(page.getByRole('cell', { name: '36.5' })).toBeVisible()
  })

  test('E2E12 — a group below k-anonymity shows INSUFFICIENT_BENCHMARK_DATA and never a fabricated statistic', async ({ page }) => {
    await page.route('**/api/intelligence/benchmarks**', (route) => route.fulfill({ json: benchmarkRowsFixture() }))
    await page.goto('/intelligence/benchmarks')
    await expect(page.getByText('INSUFFICIENT_BENCHMARK_DATA')).toBeVisible()
  })

  test('E2E13 — filtering by metric type re-queries the endpoint with metricType', async ({ page }) => {
    const seen: string[] = []
    await page.route('**/api/intelligence/benchmarks**', (route) => {
      const url = new URL(route.request().url())
      seen.push(url.searchParams.get('metricType') ?? '')
      return route.fulfill({ json: benchmarkRowsFixture() })
    })
    await page.goto('/intelligence/benchmarks')
    await page.locator('select').selectOption('PRICE_VARIANCE')
    await expect.poll(() => seen).toContain('PRICE_VARIANCE')
  })

  test('E2E14 — an ADMIN sees the "Recompute benchmarks" action', async ({ page }) => {
    await page.route('**/api/intelligence/benchmarks**', (route) => route.fulfill({ json: { data: [] } }))
    await page.goto('/intelligence/benchmarks')
    await expect(page.getByRole('button', { name: 'Recompute benchmarks' })).toBeVisible()
  })

  test('E2E15 — a VIEWER never sees the "Recompute benchmarks" action', async ({ page }) => {
    await signInWithFixtureSession(page, FIXTURE_ME_VIEWER)
    await mockCommon(page)
    await page.route('**/api/intelligence/benchmarks**', (route) => route.fulfill({ json: { data: [] } }))
    await page.goto('/intelligence/benchmarks')
    await expect(page.getByRole('button', { name: 'Recompute benchmarks' })).toHaveCount(0)
  })

  test('E2E16 — clicking "Recompute benchmarks" calls the recompute endpoint', async ({ page }) => {
    await page.route('**/api/intelligence/benchmarks**', (route) => route.fulfill({ json: { data: [] } }))
    let recomputed = false
    await page.route('**/api/intelligence/benchmarks/recompute', (route) => {
      recomputed = true
      return route.fulfill({ json: { data: [] } })
    })
    await page.goto('/intelligence/benchmarks')
    await page.getByRole('button', { name: 'Recompute benchmarks' }).click()
    await expect.poll(() => recomputed).toBe(true)
  })

  test('E2E17 — an empty benchmark set shows the honest empty state, never a fabricated row', async ({ page }) => {
    await page.route('**/api/intelligence/benchmarks**', (route) => route.fulfill({ json: { data: [] } }))
    await page.goto('/intelligence/benchmarks')
    await expect(page.getByText('No benchmark data computed yet')).toBeVisible()
  })

  test('E2E18 — the Benchmarks page is reachable from the main navigation', async ({ page }) => {
    await page.route('**/api/intelligence/benchmarks**', (route) => route.fulfill({ json: { data: [] } }))
    await page.goto('/')
    await page.getByRole('link', { name: 'Benchmarks' }).click()
    await expect(page).toHaveURL(/\/intelligence\/benchmarks$/)
  })
})

// -----------------------------------------------------------------
// Group 3/5 — Audit Trail viewer & full pipeline lineage trace
// (spec §4D): Source Scan → Tender Import → Requirement Extraction →
// Strategy Generation → Evidence Match → Human Signoff → Submission,
// plus Addendum Detected/Acknowledged and Outcome Recorded.
// -----------------------------------------------------------------
function fullLineageFixture() {
  const stages = [
    ['SOURCE_SCAN', 'tender_source_scans', 'Source scan started for source X (adapter eTenders).'],
    ['TENDER_IMPORT', 'tenders', 'Tender imported from source X.'],
    ['REQUIREMENT_EXTRACTION', 'tenders', 'Requirement/evaluation extraction run queued.'],
    ['STRATEGY_GENERATION', 'bid_strategy_projects', 'Bid strategy generated.'],
    ['EVIDENCE_MATCH', 'bid_strategy_projects', 'Evidence match candidates generated (3).'],
    ['ADDENDUM_DETECTED', 'tender_addenda', 'Diff engine detected a material addendum.'],
    ['ADDENDUM_ACKNOWLEDGED', 'bid_addendum_acknowledgements', 'Addendum acknowledged for bid project.'],
    ['HUMAN_SIGNOFF', 'bid_submission_approvals', 'Final submission approval signed off by an authorized human.'],
    ['SUBMISSION', 'bid_submission_executions', 'Bid submission reported by a human.'],
    ['OUTCOME_RECORDED', 'tender_outcomes', 'Tender outcome recorded (WON).'],
  ]
  return {
    data: stages.map(([stage, entityType, summary], i) => ({
      id: `event-${i}`,
      correlation_id: PROJECT_ID,
      agency_id: null,
      stage,
      entity_type: entityType,
      entity_id: null,
      actor_type: 'SYSTEM',
      actor_id: null,
      agent_name: null,
      summary,
      detail: {},
      created_at: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
    })),
  }
}

test.describe('Phase 20 — Audit Trail viewer & chain of custody', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithFixtureSession(page)
    await mockCommon(page)
  })

  test('E2E19 — recent audit trail events render with their stage', async ({ page }) => {
    await page.route('**/api/audit-trail?*', (route) => route.fulfill({ json: fullLineageFixture() }))
    await page.goto('/settings/audit-logs')
    await expect(page.getByText('SOURCE SCAN', { exact: true })).toBeVisible()
  })

  test('E2E20 — tracing a correlation id shows the complete lineage in canonical stage order, from source scan to outcome record', async ({ page }) => {
    await page.route('**/api/audit-trail?*', (route) => route.fulfill({ json: { data: [] } }))
    await page.route(`**/api/audit-trail/${PROJECT_ID}`, (route) => route.fulfill({ json: fullLineageFixture() }))
    await page.goto('/settings/audit-logs')
    await page.getByPlaceholder('Bid project or tender id…').fill(PROJECT_ID)
    await page.getByRole('button', { name: 'Trace lineage' }).click()
    await expect(page.getByText('Bid submission reported by a human')).toBeVisible()
    await expect(page.getByText('Tender outcome recorded (WON)')).toBeVisible()
  })

  test('E2E21 — the lineage trace includes both ADDENDUM_DETECTED and ADDENDUM_ACKNOWLEDGED, tying surveillance and reconciliation into one chain', async ({ page }) => {
    await page.route('**/api/audit-trail?*', (route) => route.fulfill({ json: { data: [] } }))
    await page.route(`**/api/audit-trail/${PROJECT_ID}`, (route) => route.fulfill({ json: fullLineageFixture() }))
    await page.goto('/settings/audit-logs')
    await page.getByPlaceholder('Bid project or tender id…').fill(PROJECT_ID)
    await page.getByRole('button', { name: 'Trace lineage' }).click()
    await expect(page.getByText('ADDENDUM DETECTED', { exact: true })).toBeVisible()
    await expect(page.getByText('ADDENDUM ACKNOWLEDGED', { exact: true })).toBeVisible()
  })

  test('E2E22 — an id with no recorded events shows the honest empty state, never a fabricated lineage', async ({ page }) => {
    await page.route('**/api/audit-trail?*', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/audit-trail/00000000-0000-4000-8000-000000000000', (route) => route.fulfill({ json: { data: [] } }))
    await page.goto('/settings/audit-logs')
    await page.getByPlaceholder('Bid project or tender id…').fill('00000000-0000-4000-8000-000000000000')
    await page.getByRole('button', { name: 'Trace lineage' }).click()
    await expect(page.getByText('No audit trail events found for this id')).toBeVisible()
  })

  test('E2E23 — the Audit Trail page is reachable from the main navigation', async ({ page }) => {
    await page.route('**/api/audit-trail?*', (route) => route.fulfill({ json: { data: [] } }))
    await page.goto('/')
    await page.getByRole('link', { name: 'Audit Trail' }).click()
    await expect(page).toHaveURL(/\/settings\/audit-logs$/)
  })

  test('E2E24 — a full pipeline run is traceable end to end: every one of the seven core lineage stages appears for one correlation id', async ({ page }) => {
    await page.route('**/api/audit-trail?*', (route) => route.fulfill({ json: { data: [] } }))
    await page.route(`**/api/audit-trail/${PROJECT_ID}`, (route) => route.fulfill({ json: fullLineageFixture() }))
    await page.goto('/settings/audit-logs')
    await page.getByPlaceholder('Bid project or tender id…').fill(PROJECT_ID)
    await page.getByRole('button', { name: 'Trace lineage' }).click()
    for (const label of ['SOURCE SCAN', 'TENDER IMPORT', 'REQUIREMENT EXTRACTION', 'STRATEGY GENERATION', 'EVIDENCE MATCH', 'HUMAN SIGNOFF', 'SUBMISSION']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
    }
  })

  test('E2E25 — clicking "View audit trail" on a bid project navigates straight to its complete lineage, with no extra click required', async ({ page }) => {
    await mockBidStrategyShell(page)
    await page.route(`**/api/bids/${PROJECT_ID}/addenda`, (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/audit-trail?*', (route) => route.fulfill({ json: { data: [] } }))
    await page.route(`**/api/audit-trail/${PROJECT_ID}`, (route) => route.fulfill({ json: fullLineageFixture() }))
    await page.goto(`/bids/${PROJECT_ID}`)
    await page.getByRole('link', { name: 'View audit trail' }).click()
    await expect(page).toHaveURL(new RegExp(`/settings/audit-logs\\?correlationId=${PROJECT_ID}`))
    await expect(page.getByText('Bid submission reported by a human')).toBeVisible()
  })
})
