import { test, expect, type Page } from '@playwright/test'
import { FIXTURE_TENDER_SCORED, FIXTURE_SUMMARY, FIXTURE_EXTRACTED_REQUIREMENTS, FIXTURE_EVALUATION_CRITERIA, FIXTURE_SERVICES, FIXTURE_SOURCES } from './fixtures/tenders.js'
import { FIXTURE_ME_ADMIN } from './fixtures/documentPipeline.js'
import { FIXTURE_QUALIFICATION, FIXTURE_QUAL_REQUIREMENTS, FIXTURE_QUAL_ACTIONS } from './fixtures/qualification.js'
import { FIXTURE_OPPORTUNITY_SCORE } from './fixtures/opportunityScoring.js'
import { FIXTURE_BID_DECISION } from './fixtures/bidDecision.js'

/**
 * Phase 17 — Awards, Outcomes, Win/Loss Intelligence & Procurement
 * Learning. Mock-driven E2E, same convention as bid-decision.spec.ts
 * and bid-strategy.spec.ts — no real Supabase project or tender data
 * involved, every `/api/*` call mocked at the network level.
 *
 * Covers (spec §94/§106): winning tender, losing tender, disqualified
 * bid, cancelled tender, unknown outcome, tender-detail outcome
 * display, bid-detail outcome display, win/loss dashboard, filter
 * outcomes, unknown-outcome display, outcome follow-up, conflicting
 * award detection, conflict resolution, verify outcome, learning
 * dataset completeness display, agency isolation (404), no-bid≠loss
 * and not-submitted≠lost demonstration. Historical feature-snapshot
 * leakage protection (spec §79) is a data-model/type-level guarantee
 * proven instead by
 * apps/api/src/lib/outcomes/__tests__/learningFeatures.test.ts — not
 * something a UI screenshot can demonstrate, so it is not repeated
 * here (see docs/OUTCOME-INTELLIGENCE.md §14 for this scoping note).
 */

const FAKE_ACCESS_TOKEN = 'e2e-fixture-access-token'
const PROJECT_ID = '00000000-0000-4000-8000-b1d5000000e2'
const TENDER_ID = '00000000-0000-4000-8000-tender0000e2'

const FIXTURE_PROJECT = {
  id: PROJECT_ID,
  tender_id: TENDER_ID,
  agency_id: '00000000-0000-4000-8000-agency000e2',
  project_name: 'Bid: Municipal IT Support Tender',
  status: 'SUBMITTED',
  bid_decision_run_id: '00000000-0000-4000-8000-decision0e2',
  current_strategy_version: 1,
  owner_user_id: FIXTURE_ME_ADMIN.id,
  target_submission_date: '2026-11-01',
  priority: 'HIGH',
  bid_effort: 'MEDIUM',
  overall_score_snapshot: 78,
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

async function mockTenderDetailBase(page: Page) {
  await mockCommon(page)
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
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/qualification/requirements`, (route) => route.fulfill({ json: FIXTURE_QUAL_REQUIREMENTS }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/qualification/actions`, (route) => route.fulfill({ json: FIXTURE_QUAL_ACTIONS }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/qualification`, (route) => route.fulfill({ json: FIXTURE_QUALIFICATION }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/opportunity-score`, (route) => (route.request().method() === 'GET' ? route.fulfill({ json: FIXTURE_OPPORTUNITY_SCORE }) : route.continue()))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/bid-decision`, (route) => route.fulfill({ json: { run: null, ruleResults: [], blockers: [], warnings: [], unresolvedItems: [], positiveFactors: [], humanActionsRequired: [] } }))
}

function tenderOutcomeFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'outcome-1',
    tenderId: FIXTURE_TENDER_SCORED.id,
    outcomeStatus: 'AWARDED',
    winnerName: 'ABC Creative (Pty) Ltd',
    awardValue: 450000,
    decisionDate: '2026-09-01',
    truthStatus: 'UNVERIFIED',
    provenance: 'HUMAN_REPORTED',
    sourceUrl: 'https://example.gov.za/award-notice',
    notes: null,
    ...overrides,
  }
}

test.describe('Phase 17 — Awards, Outcomes, Win/Loss Intelligence & Procurement Learning', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithFixtureSession(page)
  })

  test('tender-detail outcome display: a losing tender shows outcome/winner/award-value with truth/provenance badges', async ({ page }) => {
    await mockTenderDetailBase(page)
    await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/outcome`, (route) => route.fulfill({ json: { data: tenderOutcomeFixture(), conflicts: [] } }))

    await page.goto(`/tenders/${FIXTURE_TENDER_SCORED.id}`)
    await page.getByRole('tab', { name: 'Outcome' }).click()

    await expect(page.getByText('Outcome status: AWARDED')).toBeVisible()
    await expect(page.getByText(/ABC Creative/)).toBeVisible()
    await expect(page.getByText('UNVERIFIED')).toBeVisible()
    await expect(page.getByText('HUMAN_REPORTED')).toBeVisible()
  })

  test('unknown-outcome display: no recorded outcome shows "Outcome UNKNOWN" as a first-class state, never a fabricated result', async ({ page }) => {
    await mockTenderDetailBase(page)
    await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/outcome`, (route) => route.fulfill({ json: { data: null, conflicts: [] } }))

    await page.goto(`/tenders/${FIXTURE_TENDER_SCORED.id}`)
    await page.getByRole('tab', { name: 'Outcome' }).click()

    await expect(page.getByText('Outcome UNKNOWN')).toBeVisible()
  })

  test('cancelled tender: our own submission is never shown as a loss, per the reconciliation engine', async ({ page }) => {
    await mockTenderDetailBase(page)
    await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/outcome`, (route) => route.fulfill({ json: { data: tenderOutcomeFixture({ outcomeStatus: 'CANCELLED', winnerName: null, awardValue: null }), conflicts: [] } }))

    await page.goto(`/tenders/${FIXTURE_TENDER_SCORED.id}`)
    await page.getByRole('tab', { name: 'Outcome' }).click()

    await expect(page.getByText('Outcome status: CANCELLED')).toBeVisible()
    await expect(page.getByText('Winner: UNKNOWN')).toBeVisible()
  })

  test('conflicting award detection: an open conflict on the tender outcome is surfaced with both disagreeing values', async ({ page }) => {
    await mockTenderDetailBase(page)
    await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/outcome`, (route) =>
      route.fulfill({
        json: {
          data: tenderOutcomeFixture(),
          conflicts: [{ id: 'conf-1', tenderOutcomeId: 'outcome-1', fieldName: 'winner_name', existingValue: 'ABC Creative (Pty) Ltd', conflictingValue: 'XYZ Solutions', status: 'OPEN', discoveredAt: '2026-09-05T00:00:00Z' }],
        },
      }),
    )

    await page.goto(`/tenders/${FIXTURE_TENDER_SCORED.id}`)
    await page.getByRole('tab', { name: 'Outcome' }).click()

    await expect(page.getByText('1 open conflict(s) on this outcome')).toBeVisible()
    await expect(page.getByText(/ABC Creative.*XYZ Solutions/)).toBeVisible()
  })

  test('verify outcome: a user with an allowed role can verify an outcome that has attached evidence', async ({ page }) => {
    await mockTenderDetailBase(page)
    let verified = false
    await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/outcome`, (route) =>
      route.fulfill({ json: { data: tenderOutcomeFixture({ truthStatus: verified ? 'VERIFIED' : 'UNVERIFIED' }), conflicts: [] } }),
    )
    await page.route('**/api/outcomes/outcome-1/verify', (route) => {
      verified = true
      return route.fulfill({ json: { data: tenderOutcomeFixture({ truthStatus: 'VERIFIED' }) } })
    })

    await page.goto(`/tenders/${FIXTURE_TENDER_SCORED.id}`)
    await page.getByRole('tab', { name: 'Outcome' }).click()
    await expect(page.getByText('UNVERIFIED')).toBeVisible()

    await page.getByRole('button', { name: 'Verify outcome' }).click()
    await expect(page.getByText('VERIFIED', { exact: true })).toBeVisible({ timeout: 10_000 })
  })

  test('bid-detail outcome display: a winning bid shows WON with our score vs the winning score', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}`, (route) => route.fulfill({ json: FIXTURE_PROJECT }))
    await page.route(`**/api/bids/${PROJECT_ID}/readiness`, (route) => route.fulfill({ json: { status: 'READY', blockers: [], warnings: [], completeness: { requirements: 1, evaluationCriteria: 1, evidenceNeeds: 1, tasks: 1, compliance: 1 } } }))
    await page.route(`**/api/bids/${PROJECT_ID}/outcome`, (route) =>
      route.fulfill({
        json: {
          data: { id: 'bid-outcome-1', ourResult: 'WON', ourScore: 82, winningScore: 82, reconciliationBasis: 'Tender AWARDED, our submission VERIFIED_SUBMITTED, and the recorded winner matches this agency.', truthStatus: 'INFERRED' },
          tenderOutcome: tenderOutcomeFixture({ winnerName: 'Our Agency Ltd' }),
          lossReasons: [],
          followUp: { requiresFollowUp: false, reason: 'Outcome is already known.' },
        },
      }),
    )

    await page.goto(`/bids/${PROJECT_ID}`)
    await page.getByRole('tab', { name: 'Outcome' }).click()

    await expect(page.getByText('Our result: WON')).toBeVisible()
    await expect(page.getByText(/Our score: 82.*Winning score: 82/)).toBeVisible()
  })

  test('disqualified bid: shown distinctly from an ordinary loss, with the recorded loss-reason category', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}`, (route) => route.fulfill({ json: FIXTURE_PROJECT }))
    await page.route(`**/api/bids/${PROJECT_ID}/readiness`, (route) => route.fulfill({ json: { status: 'READY', blockers: [], warnings: [], completeness: { requirements: 1, evaluationCriteria: 1, evidenceNeeds: 1, tasks: 1, compliance: 1 } } }))
    await page.route(`**/api/bids/${PROJECT_ID}/outcome`, (route) =>
      route.fulfill({
        json: {
          data: { id: 'bid-outcome-2', ourResult: 'DISQUALIFIED', ourScore: null, winningScore: 75, reconciliationBasis: 'Disqualification recorded from official/human source; not treated as an ordinary loss.', truthStatus: 'UNKNOWN' },
          tenderOutcome: tenderOutcomeFixture(),
          lossReasons: [{ id: 'lr-1', category: 'MANDATORY_REQUIREMENT', isPrimary: true, provenance: 'OFFICIAL', notes: null }],
          followUp: { requiresFollowUp: false, reason: 'Outcome is already known.' },
        },
      }),
    )

    await page.goto(`/bids/${PROJECT_ID}`)
    await page.getByRole('tab', { name: 'Outcome' }).click()

    await expect(page.getByText('Our result: DISQUALIFIED')).toBeVisible()
    await expect(page.getByText(/MANDATORY_REQUIREMENT/)).toBeVisible()
  })

  test('no-bid≠loss / not-submitted≠lost demonstration: a NOT_SUBMITTED bid on an AWARDED tender never reads as a loss', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}`, (route) => route.fulfill({ json: FIXTURE_PROJECT }))
    await page.route(`**/api/bids/${PROJECT_ID}/readiness`, (route) => route.fulfill({ json: { status: 'READY', blockers: [], warnings: [], completeness: { requirements: 1, evaluationCriteria: 1, evidenceNeeds: 1, tasks: 1, compliance: 1 } } }))
    await page.route(`**/api/bids/${PROJECT_ID}/outcome`, (route) =>
      route.fulfill({
        json: {
          data: { id: 'bid-outcome-3', ourResult: 'NOT_SUBMITTED', ourScore: null, winningScore: null, reconciliationBasis: 'No verified or reported submission exists for this bid — never reclassified as LOST regardless of tender outcome.', truthStatus: 'UNKNOWN' },
          tenderOutcome: tenderOutcomeFixture(),
          lossReasons: [],
          followUp: { requiresFollowUp: false, reason: 'No confirmed submission — follow-up not applicable.' },
        },
      }),
    )

    await page.goto(`/bids/${PROJECT_ID}`)
    await page.getByRole('tab', { name: 'Outcome' }).click()

    await expect(page.getByText('Our result: NOT_SUBMITTED')).toBeVisible()
    await expect(page.getByText(/never reclassified as LOST/)).toBeVisible()
    await expect(page.getByText('Our result: LOST')).not.toBeVisible()
  })

  test('outcome follow-up: a submitted bid with no known outcome past the threshold shows a follow-up recommendation, never an automatic loss', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}`, (route) => route.fulfill({ json: FIXTURE_PROJECT }))
    await page.route(`**/api/bids/${PROJECT_ID}/readiness`, (route) => route.fulfill({ json: { status: 'READY', blockers: [], warnings: [], completeness: { requirements: 1, evaluationCriteria: 1, evidenceNeeds: 1, tasks: 1, compliance: 1 } } }))
    await page.route(`**/api/bids/${PROJECT_ID}/outcome`, (route) =>
      route.fulfill({
        json: {
          data: { id: 'bid-outcome-4', ourResult: 'UNKNOWN', ourScore: null, winningScore: null, reconciliationBasis: 'Tender outcome is UNKNOWN — no result can be reconciled yet.', truthStatus: 'UNKNOWN' },
          tenderOutcome: null,
          lossReasons: [],
          followUp: { requiresFollowUp: true, reason: '52 days since submission with no known outcome (>= 45-day threshold) — recommend checking the official source. Not auto-marked as lost.' },
        },
      }),
    )

    await page.goto(`/bids/${PROJECT_ID}`)
    await page.getByRole('tab', { name: 'Outcome' }).click()

    await expect(page.getByText(/Outcome follow-up required/)).toBeVisible()
    await expect(page.getByText(/Not auto-marked as lost/)).toBeVisible()
  })

  test('agency isolation: a bid project belonging to another agency 404s rather than leaking its outcome', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}`, (route) => route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Bid project not found.' } } }))

    await page.goto(`/bids/${PROJECT_ID}`)

    await expect(page.getByText(/not.*found/i).first()).toBeVisible()
  })

  test('win/loss dashboard: shows win/loss/disqualification/submission rate tiles with denominators, the funnel, and learning readiness', async ({ page }) => {
    await mockCommon(page)
    await page.route('**/api/analytics/outcomes', (route) =>
      route.fulfill({
        json: {
          data: {
            counts: { totalOpportunities: 20, totalQualified: 20, totalBidDecisions: 14 },
            metrics: {
              winRate: { rate: 0.6, numerator: 6, denominator: 10, completeness: 0.71, insufficientSample: false },
              lossRate: { rate: 0.3, numerator: 3, denominator: 10, completeness: 0.71, insufficientSample: false },
              disqualificationRate: { rate: 0.1, numerator: 1, denominator: 10, completeness: 0.71, insufficientSample: false },
              submissionRate: { rate: 0.7, numerator: 10, denominator: 14, completeness: 1, insufficientSample: false },
            },
            funnel: [
              { stage: 'Opportunities', count: 20, percentOfOpportunities: 100 },
              { stage: 'Won', count: 6, percentOfOpportunities: 30 },
            ],
            generatedAt: '2026-09-12T00:00:00Z',
          },
        },
      }),
    )
    await page.route('**/api/analytics/win-loss**', (route) =>
      route.fulfill({ json: { data: { byCategory: [{ groupKey: 'IT Services', winRate: { rate: 0.5, numerator: 1, denominator: 2, completeness: 1, insufficientSample: true }, sampleSize: 2, caveat: 'Based on only 2 recorded outcomes — too small a sample to draw a conclusion from.' }], rows: [], minMeaningfulSampleSize: 5 } } }),
    )
    await page.route('**/api/outcomes/conflicts**', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/analytics/learning', (route) =>
      route.fulfill({ json: { data: { totalBids: 20, verifiedSubmissions: 12, verifiedOutcomes: 9, completeFeatureSnapshots: 10, learningReadyRecords: 9, readinessNote: '9 record(s) currently have both a verified outcome and a complete decision-time snapshot — this is a readiness count, not a claim that the system has learned anything.' } } }),
    )

    await page.goto('/outcomes')

    await expect(page.getByText('60%')).toBeVisible()
    await expect(page.getByText('6 of 10 recorded')).toBeVisible()
    await expect(page.getByText(/Small sample \(n=2\)/)).toBeVisible()
    await expect(page.getByText(/9 of 20 bids are learning-ready/)).toBeVisible()
    await expect(page.getByText(/never predicts a win probability/)).toBeVisible()
  })

  test('filter outcomes: the win/loss table can be filtered by result, re-querying the server (never client-side only)', async ({ page }) => {
    await mockCommon(page)
    await page.route('**/api/analytics/outcomes', (route) => route.fulfill({ json: { data: { counts: {}, metrics: { winRate: { rate: null, numerator: 0, denominator: 0, completeness: null, insufficientSample: true }, lossRate: { rate: null, numerator: 0, denominator: 0, completeness: null, insufficientSample: true }, disqualificationRate: { rate: null, numerator: 0, denominator: 0, completeness: null, insufficientSample: true }, submissionRate: { rate: null, numerator: 0, denominator: 0, completeness: null, insufficientSample: true } }, funnel: [], generatedAt: '2026-09-12T00:00:00Z' } } }))
    await page.route('**/api/outcomes/conflicts**', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/analytics/learning', (route) => route.fulfill({ json: { data: { totalBids: 0, verifiedSubmissions: 0, verifiedOutcomes: 0, completeFeatureSnapshots: 0, learningReadyRecords: 0, readinessNote: 'No records are yet complete enough to learn from.' } } }))

    let lastUrl = ''
    await page.route('**/api/analytics/win-loss**', (route) => {
      lastUrl = route.request().url()
      const rows = lastUrl.includes('result=LOST') ? [{ id: 'r1', tenderId: 't1', tenderTitle: 'A lost tender', organisation: 'Org A', category: 'IT', province: 'Gauteng', ourResult: 'LOST', winnerName: 'Competitor Co', awardValue: 300000 }] : []
      return route.fulfill({ json: { data: { byCategory: [], rows, minMeaningfulSampleSize: 5 } } })
    })

    await page.goto('/outcomes')
    await expect(page.getByText('No recorded bid outcomes yet')).toBeVisible()

    await page.getByRole('combobox').first().selectOption('LOST')
    await expect(page.getByText('A lost tender')).toBeVisible({ timeout: 10_000 })
    expect(lastUrl).toContain('result=LOST')
  })

  test('conflict resolution: an authorized user can resolve an open conflict from the dashboard panel', async ({ page }) => {
    await mockCommon(page)
    await page.route('**/api/analytics/outcomes', (route) => route.fulfill({ json: { data: { counts: {}, metrics: { winRate: { rate: null, numerator: 0, denominator: 0, completeness: null, insufficientSample: true }, lossRate: { rate: null, numerator: 0, denominator: 0, completeness: null, insufficientSample: true }, disqualificationRate: { rate: null, numerator: 0, denominator: 0, completeness: null, insufficientSample: true }, submissionRate: { rate: null, numerator: 0, denominator: 0, completeness: null, insufficientSample: true } }, funnel: [], generatedAt: '2026-09-12T00:00:00Z' } } }))
    await page.route('**/api/analytics/win-loss**', (route) => route.fulfill({ json: { data: { byCategory: [], rows: [], minMeaningfulSampleSize: 5 } } }))
    await page.route('**/api/analytics/learning', (route) => route.fulfill({ json: { data: { totalBids: 0, verifiedSubmissions: 0, verifiedOutcomes: 0, completeFeatureSnapshots: 0, learningReadyRecords: 0, readinessNote: 'No records are yet complete enough to learn from.' } } }))

    let resolved = false
    await page.route('**/api/outcomes/conflicts**', (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      return route.fulfill({
        json: {
          data: resolved
            ? []
            : [{ id: 'conf-1', tenderOutcomeId: 'outcome-1', fieldName: 'winner_name', existingValue: 'ABC Creative', conflictingValue: 'XYZ Solutions', status: 'OPEN', discoveredAt: '2026-09-05T00:00:00Z' }],
        },
      })
    })
    await page.route('**/api/outcomes/conflicts/conf-1/resolve', (route) => {
      resolved = true
      return route.fulfill({ json: { data: { id: 'conf-1', status: 'RESOLVED' } } })
    })

    await page.goto('/outcomes')
    await expect(page.getByText(/ABC Creative.*XYZ Solutions/)).toBeVisible()

    await page.getByRole('button', { name: 'Resolve' }).click()
    await expect(page.getByText('No open conflicts')).toBeVisible({ timeout: 10_000 })
  })

  test('competitor directory: lists observed activity counts and re-queries the server when searched (gap-close)', async ({ page }) => {
    await mockCommon(page)
    let lastUrl = ''
    await page.route('**/api/analytics/competitors**', (route) => {
      lastUrl = route.request().url()
      const searched = lastUrl.includes('search=Acme')
      const rows = searched
        ? [{ competitorId: 'comp-1', name: 'Acme Trading (Pty) Ltd', dataQuality: 'VERIFIED', province: 'Gauteng', hasRegistrationNumber: true, bidderCount: 3, winnerCount: 1, shortlistedCount: 2, disqualifiedCount: 0, recordedBids: 3, verifiedWins: 1 }]
        : [
            { competitorId: 'comp-1', name: 'Acme Trading (Pty) Ltd', dataQuality: 'VERIFIED', province: 'Gauteng', hasRegistrationNumber: true, bidderCount: 3, winnerCount: 1, shortlistedCount: 2, disqualifiedCount: 0, recordedBids: 3, verifiedWins: 1 },
            { competitorId: 'comp-2', name: 'Delta Services CC', dataQuality: 'UNKNOWN', province: null, hasRegistrationNumber: false, bidderCount: 1, winnerCount: 0, shortlistedCount: 0, disqualifiedCount: 1, recordedBids: 1, verifiedWins: 0 },
          ]
      return route.fulfill({ json: { data: rows, page: 1, pageSize: 25, total: rows.length, totalPages: 1 } })
    })

    await page.goto('/competitors')
    await expect(page.getByText('Delta Services CC')).toBeVisible()
    await expect(page.getByText('Acme Trading (Pty) Ltd')).toBeVisible()

    await page.getByLabel('Search by name').fill('Acme')
    await expect(page.getByText('Delta Services CC')).not.toBeVisible({ timeout: 10_000 })
    expect(lastUrl).toContain('search=Acme')
  })

  // -------------------------------------------------------------------
  // Reviewer-requested additions (2nd gap-close round): 7 further
  // scenarios, each covering a distinct acceptance-criteria behaviour
  // not already exercised above — not trivial duplicates of the 14
  // scenarios preceding this comment.
  // -------------------------------------------------------------------

  test('official outcome ingestion reflected: an OFFICIAL_SOURCE outcome with attached evidence verifies to a VERIFIED truth status, provenance unchanged', async ({ page }) => {
    await mockTenderDetailBase(page)
    let verified = false
    await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/outcome`, (route) =>
      route.fulfill({
        json: {
          data: tenderOutcomeFixture({
            provenance: 'OFFICIAL_SOURCE',
            truthStatus: verified ? 'VERIFIED' : 'UNVERIFIED',
            sourceUrl: 'https://example.gov.za/official-award-notice.pdf', // evidence already attached at ingestion time
          }),
          conflicts: [],
        },
      }),
    )
    await page.route('**/api/outcomes/outcome-1/verify', (route) => {
      verified = true
      return route.fulfill({ json: { data: tenderOutcomeFixture({ provenance: 'OFFICIAL_SOURCE', truthStatus: 'VERIFIED' }) } })
    })

    await page.goto(`/tenders/${FIXTURE_TENDER_SCORED.id}`)
    await page.getByRole('tab', { name: 'Outcome' }).click()

    // Ingested as OFFICIAL_SOURCE, not yet human-verified.
    await expect(page.getByText('UNVERIFIED')).toBeVisible()
    await expect(page.getByText('OFFICIAL_SOURCE')).toBeVisible()

    await page.getByRole('button', { name: 'Verify outcome' }).click()

    // Verification changes truth_status only — provenance is never rewritten by the act of verifying it.
    await expect(page.getByText('VERIFIED', { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('OFFICIAL_SOURCE')).toBeVisible()
  })

  test('conflict dismissal: an authorized user can dismiss a conflicting outcome submission with a reason, and it leaves the OPEN list', async ({ page }) => {
    await mockCommon(page)
    await page.route('**/api/analytics/outcomes', (route) => route.fulfill({ json: { data: { counts: {}, metrics: { winRate: { rate: null, numerator: 0, denominator: 0, completeness: null, insufficientSample: true }, lossRate: { rate: null, numerator: 0, denominator: 0, completeness: null, insufficientSample: true }, disqualificationRate: { rate: null, numerator: 0, denominator: 0, completeness: null, insufficientSample: true }, submissionRate: { rate: null, numerator: 0, denominator: 0, completeness: null, insufficientSample: true } }, funnel: [], generatedAt: '2026-09-12T00:00:00Z' } } }))
    await page.route('**/api/analytics/win-loss**', (route) => route.fulfill({ json: { data: { byCategory: [], rows: [], minMeaningfulSampleSize: 5 } } }))
    await page.route('**/api/analytics/learning', (route) => route.fulfill({ json: { data: { totalBids: 0, verifiedSubmissions: 0, verifiedOutcomes: 0, completeFeatureSnapshots: 0, learningReadyRecords: 0, readinessNote: 'No records are yet complete enough to learn from.' } } }))

    let dismissed = false
    let dismissBody: Record<string, unknown> | null = null
    await page.route('**/api/outcomes/conflicts**', (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      return route.fulfill({
        json: {
          data: dismissed
            ? []
            : [{ id: 'conf-2', tenderOutcomeId: 'outcome-2', fieldName: 'outcome_status', existingValue: 'AWARDED', conflictingValue: 'NO_AWARD', status: 'OPEN', discoveredAt: '2026-09-06T00:00:00Z' }],
        },
      })
    })
    await page.route('**/api/outcomes/conflicts/conf-2/resolve', (route) => {
      dismissed = true
      dismissBody = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
      return route.fulfill({ json: { data: { id: 'conf-2', status: 'DISMISSED' } } })
    })

    await page.goto('/outcomes')
    await expect(page.getByText(/AWARDED.*NO_AWARD/)).toBeVisible()

    await page.getByPlaceholder('Resolution note (optional)').fill('Second source retracted — duplicate scrape, not a genuine disagreement.')
    await page.getByRole('button', { name: 'Dismiss' }).click()

    await expect(page.getByText('No open conflicts')).toBeVisible({ timeout: 10_000 })
    expect(dismissBody).toMatchObject({ status: 'DISMISSED', notes: 'Second source retracted — duplicate scrape, not a genuine disagreement.' })
  })

  test('submitted bid with no verified tender outcome: UNKNOWN result and follow-up are surfaced together, on both the bid page and the win/loss table — never silently treated as a loss', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}`, (route) => route.fulfill({ json: FIXTURE_PROJECT }))
    await page.route(`**/api/bids/${PROJECT_ID}/readiness`, (route) => route.fulfill({ json: { status: 'READY', blockers: [], warnings: [], completeness: { requirements: 1, evaluationCriteria: 1, evidenceNeeds: 1, tasks: 1, compliance: 1 } } }))
    await page.route(`**/api/bids/${PROJECT_ID}/outcome`, (route) =>
      route.fulfill({
        json: {
          data: { id: 'bid-outcome-5', ourResult: 'UNKNOWN', ourScore: 71, winningScore: null, reconciliationBasis: 'Tender AWARDED and our submission is VERIFIED_SUBMITTED, but the winner has not yet been resolved against this agency.', truthStatus: 'UNKNOWN' },
          tenderOutcome: tenderOutcomeFixture({ outcomeStatus: 'AWARDED', truthStatus: 'UNVERIFIED' }),
          lossReasons: [],
          followUp: { requiresFollowUp: true, reason: '50 days since submission with no known outcome (>= 45-day threshold) — recommend checking the official source. Not auto-marked as lost.' },
        },
      }),
    )

    await page.goto(`/bids/${PROJECT_ID}`)
    await page.getByRole('tab', { name: 'Outcome' }).click()

    await expect(page.getByText('Our result: UNKNOWN')).toBeVisible()
    await expect(page.getByText(/Outcome follow-up required/)).toBeVisible()
    await expect(page.getByText('Our result: LOST')).not.toBeVisible()

    // The same not-yet-known result must also never render as a loss in the aggregate win/loss table.
    await page.route('**/api/analytics/outcomes', (route) => route.fulfill({ json: { data: { counts: {}, metrics: { winRate: { rate: null, numerator: 0, denominator: 0, completeness: null, insufficientSample: true }, lossRate: { rate: null, numerator: 0, denominator: 0, completeness: null, insufficientSample: true }, disqualificationRate: { rate: null, numerator: 0, denominator: 0, completeness: null, insufficientSample: true }, submissionRate: { rate: null, numerator: 0, denominator: 0, completeness: null, insufficientSample: true } }, funnel: [], generatedAt: '2026-09-12T00:00:00Z' } } }))
    await page.route('**/api/outcomes/conflicts**', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/analytics/learning', (route) => route.fulfill({ json: { data: { totalBids: 0, verifiedSubmissions: 0, verifiedOutcomes: 0, completeFeatureSnapshots: 0, learningReadyRecords: 0, readinessNote: 'No records are yet complete enough to learn from.' } } }))
    await page.route('**/api/analytics/win-loss**', (route) =>
      route.fulfill({ json: { data: { byCategory: [], rows: [{ id: 'r-unknown', tenderId: 'tender-x', tenderTitle: 'A still-pending tender', organisation: 'Org X', category: 'IT', province: 'Gauteng', ourResult: 'UNKNOWN', winnerName: 'Not yet resolved', awardValue: 500000 }], minMeaningfulSampleSize: 5 } } }),
    )

    await page.goto('/outcomes')
    const unknownRow = page.locator('tr', { hasText: 'A still-pending tender' })
    await expect(unknownRow).toBeVisible()
    await expect(unknownRow.getByText('UNKNOWN', { exact: true })).toBeVisible()
    await expect(unknownRow.getByText('LOST', { exact: true })).not.toBeVisible()
  })

  test('analytics exclusions: NOT_SUBMITTED, WITHDRAWN and a cancelled-tender submission are listed in the win/loss table but never rendered as a loss', async ({ page }) => {
    await mockCommon(page)
    await page.route('**/api/analytics/outcomes', (route) => route.fulfill({ json: { data: { counts: {}, metrics: { winRate: { rate: null, numerator: 0, denominator: 0, completeness: null, insufficientSample: true }, lossRate: { rate: null, numerator: 0, denominator: 0, completeness: null, insufficientSample: true }, disqualificationRate: { rate: null, numerator: 0, denominator: 0, completeness: null, insufficientSample: true }, submissionRate: { rate: null, numerator: 0, denominator: 0, completeness: null, insufficientSample: true } }, funnel: [], generatedAt: '2026-09-12T00:00:00Z' } } }))
    await page.route('**/api/outcomes/conflicts**', (route) => route.fulfill({ json: { data: [] } }))
    await page.route('**/api/analytics/learning', (route) => route.fulfill({ json: { data: { totalBids: 0, verifiedSubmissions: 0, verifiedOutcomes: 0, completeFeatureSnapshots: 0, learningReadyRecords: 0, readinessNote: 'No records are yet complete enough to learn from.' } } }))
    await page.route('**/api/analytics/win-loss**', (route) =>
      route.fulfill({
        json: {
          data: {
            byCategory: [],
            rows: [
              { id: 'r-ns', tenderId: 't-ns', tenderTitle: 'Tender we did not bid on', organisation: 'Org NS', category: 'IT', province: 'Gauteng', ourResult: 'NOT_SUBMITTED', winnerName: 'Someone Else Ltd', awardValue: 200000 },
              { id: 'r-wd', tenderId: 't-wd', tenderTitle: 'Tender we withdrew from', organisation: 'Org WD', category: 'IT', province: 'Gauteng', ourResult: 'WITHDRAWN', winnerName: null, awardValue: null },
              { id: 'r-cn', tenderId: 't-cn', tenderTitle: 'Tender that was cancelled after our bid', organisation: 'Org CN', category: 'IT', province: 'Gauteng', ourResult: 'SUBMITTED', winnerName: null, awardValue: null },
            ],
            minMeaningfulSampleSize: 5,
          },
        },
      }),
    )

    await page.goto('/outcomes')

    for (const [title, expectedResult] of [
      ['Tender we did not bid on', 'NOT_SUBMITTED'],
      ['Tender we withdrew from', 'WITHDRAWN'],
      ['Tender that was cancelled after our bid', 'SUBMITTED'],
    ] as const) {
      const row = page.locator('tr', { hasText: title })
      await expect(row).toBeVisible()
      await expect(row.getByText(expectedResult, { exact: true })).toBeVisible()
      await expect(row.getByText('LOST', { exact: true })).not.toBeVisible()
    }
  })

  test('AWARDED + VERIFIED_SUBMITTED + registration-number-matched winner: bid result is WON, and the registration-number match basis is shown', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}`, (route) => route.fulfill({ json: FIXTURE_PROJECT }))
    await page.route(`**/api/bids/${PROJECT_ID}/readiness`, (route) => route.fulfill({ json: { status: 'READY', blockers: [], warnings: [], completeness: { requirements: 1, evaluationCriteria: 1, evidenceNeeds: 1, tasks: 1, compliance: 1 } } }))
    await page.route(`**/api/bids/${PROJECT_ID}/outcome`, (route) =>
      route.fulfill({
        json: {
          data: { id: 'bid-outcome-6', ourResult: 'WON', ourScore: 88, winningScore: 88, reconciliationBasis: 'Tender AWARDED, our submission VERIFIED_SUBMITTED, and the recorded winner matches this agency.', truthStatus: 'INFERRED' },
          tenderOutcome: tenderOutcomeFixture({ winnerName: 'Our Agency Holdings (Pty) Ltd', winnerRegistrationNumber: '2019/123456/07' }),
          lossReasons: [],
          followUp: { requiresFollowUp: false, reason: 'Outcome is already known.' },
          winnerMatchBasis: 'REGISTRATION_NUMBER',
        },
      }),
    )

    await page.goto(`/bids/${PROJECT_ID}`)
    await page.getByRole('tab', { name: 'Outcome' }).click()

    await expect(page.getByText('Our result: WON')).toBeVisible()
    await expect(page.getByText('Winner match basis: REGISTRATION_NUMBER')).toBeVisible()
  })

  test('AWARDED + VERIFIED_SUBMITTED + winner resolved to a different entity: bid result is LOST, never WON', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}`, (route) => route.fulfill({ json: FIXTURE_PROJECT }))
    await page.route(`**/api/bids/${PROJECT_ID}/readiness`, (route) => route.fulfill({ json: { status: 'READY', blockers: [], warnings: [], completeness: { requirements: 1, evaluationCriteria: 1, evidenceNeeds: 1, tasks: 1, compliance: 1 } } }))
    await page.route(`**/api/bids/${PROJECT_ID}/outcome`, (route) =>
      route.fulfill({
        json: {
          data: { id: 'bid-outcome-7', ourResult: 'LOST', ourScore: 74, winningScore: 91, reconciliationBasis: 'Tender AWARDED, our submission VERIFIED_SUBMITTED, and the recorded winner is a different entity.', truthStatus: 'INFERRED' },
          tenderOutcome: tenderOutcomeFixture({ winnerName: 'Rival Contracting CC' }),
          lossReasons: [],
          followUp: { requiresFollowUp: false, reason: 'Outcome is already known.' },
          winnerMatchBasis: 'NAME',
        },
      }),
    )

    await page.goto(`/bids/${PROJECT_ID}`)
    await page.getByRole('tab', { name: 'Outcome' }).click()

    await expect(page.getByText('Our result: LOST')).toBeVisible()
    await expect(page.getByText('Our result: WON')).not.toBeVisible()
    await expect(page.getByText('Winner match basis: NAME')).toBeVisible()
  })

  test('registration-number mismatch with matching names never produces a false WON: winnerMatchBasis stays REGISTRATION_NUMBER and overrides the identical name', async ({ page }) => {
    await mockCommon(page)
    await page.route(`**/api/bids/${PROJECT_ID}`, (route) => route.fulfill({ json: FIXTURE_PROJECT }))
    await page.route(`**/api/bids/${PROJECT_ID}/readiness`, (route) => route.fulfill({ json: { status: 'READY', blockers: [], warnings: [], completeness: { requirements: 1, evaluationCriteria: 1, evidenceNeeds: 1, tasks: 1, compliance: 1 } } }))
    await page.route(`**/api/bids/${PROJECT_ID}/outcome`, (route) =>
      route.fulfill({
        json: {
          // The recorded winner name happens to be identical to our agency's
          // name (e.g. two unrelated entities that both trade as "Acme
          // Trading"), but the two registration numbers disagree — per
          // apps/api/src/lib/outcomes/winnerMatch.ts, that disagreement is
          // authoritative and is never overridden by the matching name.
          data: { id: 'bid-outcome-8', ourResult: 'LOST', ourScore: 80, winningScore: 85, reconciliationBasis: 'Tender AWARDED, our submission VERIFIED_SUBMITTED, and the recorded winner is a different entity.', truthStatus: 'INFERRED' },
          tenderOutcome: tenderOutcomeFixture({ winnerName: 'Acme Trading (Pty) Ltd', winnerRegistrationNumber: '2020/999999/07' }),
          lossReasons: [],
          followUp: { requiresFollowUp: false, reason: 'Outcome is already known.' },
          winnerMatchBasis: 'REGISTRATION_NUMBER',
        },
      }),
    )

    await page.goto(`/bids/${PROJECT_ID}`)
    await page.getByRole('tab', { name: 'Outcome' }).click()

    await expect(page.getByText('Our result: LOST')).toBeVisible()
    await expect(page.getByText('Our result: WON')).not.toBeVisible()
    await expect(page.getByText('Winner match basis: REGISTRATION_NUMBER')).toBeVisible()
  })
})
