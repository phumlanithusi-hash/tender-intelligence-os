import { test, expect, type Page } from '@playwright/test'
import {
  FIXTURE_TENDER_SCORED,
  FIXTURE_TENDER_LIST_ROW,
  FIXTURE_SUMMARY,
  FIXTURE_EXTRACTED_REQUIREMENTS,
  FIXTURE_EVALUATION_CRITERIA,
  FIXTURE_SERVICES,
  FIXTURE_SOURCES,
} from './fixtures/tenders.js'
import {
  FIXTURE_DOCUMENT,
  FIXTURE_DOCUMENT_ID,
  FIXTURE_VERSION,
  FIXTURE_PROCESSING,
  FIXTURE_PAGES,
  FIXTURE_SECTIONS,
  FIXTURE_ME_ADMIN,
} from './fixtures/documentPipeline.js'

/**
 * Phase 6 critical-path E2E flow: open a tender, go to its Documents
 * tab, expand a processed document, and confirm the evidence viewer
 * shows extracted text with an explicit provenance line (Phase 6
 * §27/§28: "Never display extracted text without provenance"). Same
 * fixture/mock convention as tender-radar.spec.ts — no real backend,
 * Supabase project, or live document is involved.
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
          user: {
            id: '00000000-0000-4000-8000-0000000000e2',
            email: 'e2e-fixture@tender-os.test',
            app_metadata: {},
            user_metadata: {},
            aud: 'authenticated',
            created_at: '2026-01-01T00:00:00.000Z',
          },
        }),
      )
    },
    { storageKey: 'sb-e2efixture-auth-token', accessToken: FAKE_ACCESS_TOKEN },
  )
}

async function mockApi(page: Page) {
  await page.route('**/api/me', (route) => route.fulfill({ json: FIXTURE_ME_ADMIN }))
  await page.route('**/api/tenders/summary', (route) => route.fulfill({ json: FIXTURE_SUMMARY }))
  await page.route('**/api/tenders?**', (route) =>
    route.fulfill({ json: { rows: [FIXTURE_TENDER_LIST_ROW], page: 1, pageSize: 25, total: 1, totalPages: 1 } }),
  )
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}`, (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: FIXTURE_TENDER_SCORED })
    return route.continue()
  })
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/requirements`, (route) =>
    route.fulfill({ json: { requirements: FIXTURE_EXTRACTED_REQUIREMENTS, conflicts: [] } }),
  )
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/evaluation`, (route) =>
    route.fulfill({ json: { criteria: FIXTURE_EVALUATION_CRITERIA, gates: [], conflicts: [] } }),
  )
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/requirements/runs`, (route) => route.fulfill({ json: [] }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/documents`, (route) =>
    route.fulfill({ json: { rows: [FIXTURE_DOCUMENT] } }),
  )
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/documents/${FIXTURE_DOCUMENT_ID}`, (route) =>
    route.fulfill({
      json: { document: FIXTURE_DOCUMENT, versions: [FIXTURE_VERSION], currentVersion: FIXTURE_VERSION, processing: FIXTURE_PROCESSING },
    }),
  )
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/documents/${FIXTURE_DOCUMENT_ID}/pages`, (route) =>
    route.fulfill({ json: FIXTURE_PAGES }),
  )
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/documents/${FIXTURE_DOCUMENT_ID}/sections`, (route) =>
    route.fulfill({ json: FIXTURE_SECTIONS }),
  )
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/addenda`, (route) => route.fulfill({ json: { rows: [] } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/briefing`, (route) => route.fulfill({ json: { rows: [] } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/score`, (route) => route.fulfill({ json: { score: null } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/risks`, (route) => route.fulfill({ json: { rows: [] } }))
  await page.route(`**/api/tenders/${FIXTURE_TENDER_SCORED.id}/activity`, (route) => route.fulfill({ json: { rows: [] } }))
  await page.route('**/api/services**', (route) => route.fulfill({ json: { rows: FIXTURE_SERVICES } }))
  await page.route('**/api/tender-sources**', (route) => route.fulfill({ json: { rows: FIXTURE_SOURCES } }))
  await page.route('**/api/watchlist**', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { rows: [] } })
    return route.fulfill({ status: 204, body: '' })
  })
  await page.route('**/api/saved-filters**', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { rows: [] } })
    return route.fulfill({ status: 204, body: '' })
  })
}

test.describe('Phase 6 — document evidence pipeline UI', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithFixtureSession(page)
    await mockApi(page)
  })

  test('shows processing status and evidence with explicit page/section provenance, never bare text', async ({ page }) => {
    await page.goto(`/tenders/${FIXTURE_TENDER_SCORED.id}`)
    await page.getByRole('tab', { name: 'Documents' }).click()

    await expect(page.getByText(FIXTURE_DOCUMENT.filename)).toBeVisible()
    await page.getByRole('button', { name: 'View', exact: true }).click()

    // The document's fine-grained processing state (Phase 6 §2) is shown, not just the coarse extraction_status.
    await expect(page.getByText('READY FOR ANALYSIS')).toBeVisible()

    await page.getByRole('button', { name: 'View evidence' }).click()

    // Provenance is always shown alongside extracted text (Phase 6 §28).
    await expect(page.getByText(/Tender Document · Page 1 · Section 1/)).toBeVisible()
    await expect(page.getByText(/Synthetic fixture RFP text/)).toBeVisible()
  })

  test('an ADMIN sees the Reprocess action for an already-downloaded document', async ({ page }) => {
    await page.goto(`/tenders/${FIXTURE_TENDER_SCORED.id}`)
    await page.getByRole('tab', { name: 'Documents' }).click()
    await page.getByRole('button', { name: 'View', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Reprocess' })).toBeEnabled()
  })
})
