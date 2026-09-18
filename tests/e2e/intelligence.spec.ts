import { test, expect, type Page } from '@playwright/test'
import {
  FIXTURE_ME_ADMIN,
  MODEL_ID,
  DATASET_ID,
  VERSION_ID,
  BID_PROJECT_ID,
  OTHER_AGENCY_BID_PROJECT_ID,
  FIXTURE_READINESS_INSUFFICIENT,
  FIXTURE_READINESS_READY,
  FIXTURE_READINESS_LEAKAGE,
  FIXTURE_DATASET,
  FIXTURE_MODEL,
  FIXTURE_VERSION_EXPERIMENTAL,
  FIXTURE_VERSION_EVALUATED,
  FIXTURE_VERSION_CALIBRATED,
  FIXTURE_VERSION_CANDIDATE,
  FIXTURE_VERSION_PRODUCTION,
  FIXTURE_VERSION_RETIRED,
  FIXTURE_VERSION_FAILED,
  FIXTURE_EVALUATIONS,
  FIXTURE_EVALUATIONS_POOR_MODEL,
  FIXTURE_CALIBRATIONS,
  FIXTURE_CARD,
  FIXTURE_PREDICTION_SUCCESS,
  FIXTURE_PREDICTION_ABSTAIN,
  FIXTURE_SCORE_CALIBRATION,
  FIXTURE_SEGMENTS,
} from './fixtures/intelligence.js'

/**
 * Phase 18 — Predictive Procurement Intelligence, Calibration &
 * Decision Support. Mock-driven E2E, same convention as
 * outcomes.spec.ts and bid-decision.spec.ts — no real Supabase project
 * or trained model involved, every `/api/*` call mocked at the network
 * level. Every fixture in ./fixtures/intelligence.ts is synthetic and
 * clearly test-only (spec §33/§39) — never presented as real
 * production training data.
 */

const FAKE_ACCESS_TOKEN = 'e2e-fixture-access-token'

async function signInWithFixtureSession(page: Page) {
  await page.addInitScript(
    ({ storageKey, accessToken, userId, userEmail }) => {
      const oneHourFromNow = Math.round(Date.now() / 1000) + 3600
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          access_token: accessToken,
          refresh_token: 'e2e-fixture-refresh-token',
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

async function mockMe(page: Page) {
  await page.route('**/api/me', (route) => route.fulfill({ json: FIXTURE_ME_ADMIN }))
}

async function mockModelsList(page: Page) {
  await page.route('**/api/intelligence/models', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { data: [FIXTURE_MODEL] } }) : route.continue()))
}

async function mockDatasetsList(page: Page, datasets = [FIXTURE_DATASET]) {
  await page.route('**/api/intelligence/datasets', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { data: datasets } }) : route.continue()))
}

test.describe('Phase 18 — Predictive Procurement Intelligence, Calibration & Decision Support', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithFixtureSession(page)
    await mockMe(page)
  })

  test('model readiness: INSUFFICIENT_DATA is displayed as an honest, expected system state', async ({ page }) => {
    await page.route('**/api/intelligence/readiness', (route) => route.fulfill({ json: { data: FIXTURE_READINESS_INSUFFICIENT } }))
    await mockDatasetsList(page, [])
    await page.goto('/intelligence')
    await expect(page.getByTestId('eligibility-state')).toHaveText('INSUFFICIENT_DATA')
    await expect(page.getByText(/NOT ENOUGH VERIFIED DATA/i)).toBeVisible()
    await expect(page.getByText(/minimum of 30/)).toBeVisible()
  })

  test('dataset readiness: a READY_FOR_TRAINING dataset shows full sample/class-balance/completeness/temporal-coverage detail', async ({ page }) => {
    await page.route('**/api/intelligence/readiness', (route) => route.fulfill({ json: { data: FIXTURE_READINESS_READY } }))
    await mockDatasetsList(page, [])
    await page.goto('/intelligence')
    await expect(page.getByTestId('eligibility-state')).toHaveText('READY_FOR_TRAINING')
    await expect(page.getByTestId('readiness-verified')).toHaveText('60')
    await expect(page.getByText('30 / 30')).toBeVisible() // class balance
  })

  test('leakage warning: LEAKAGE_DETECTED is surfaced distinctly and never presented as a trainable state', async ({ page }) => {
    await page.route('**/api/intelligence/readiness', (route) => route.fulfill({ json: { data: FIXTURE_READINESS_LEAKAGE } }))
    await mockDatasetsList(page, [])
    await page.goto('/intelligence')
    await expect(page.getByTestId('eligibility-state')).toHaveText('LEAKAGE_DETECTED')
    await expect(page.getByText(/future relative to the dataset generation time/)).toBeVisible()
  })

  test('an operator can snapshot the live readiness state as a new dataset version', async ({ page }) => {
    await page.route('**/api/intelligence/readiness', (route) => route.fulfill({ json: { data: FIXTURE_READINESS_READY } }))
    let created = false
    await page.route('**/api/intelligence/datasets', (route) => {
      if (route.request().method() === 'POST') {
        created = true
        return route.fulfill({ status: 201, json: { data: FIXTURE_DATASET } })
      }
      return route.fulfill({ json: { data: created ? [FIXTURE_DATASET] : [] } })
    })
    await page.goto('/intelligence')
    await page.getByRole('button', { name: /Snapshot this as a new dataset version/i }).click()
    await expect(page.getByText('v1', { exact: false }).first()).toBeVisible()
    expect(created).toBe(true)
  })

  test('dataset version history lists prior snapshots with their eligibility state, and flags a test fixture', async ({ page }) => {
    await page.route('**/api/intelligence/readiness', (route) => route.fulfill({ json: { data: FIXTURE_READINESS_READY } }))
    await mockDatasetsList(page)
    await page.goto('/intelligence')
    await expect(page.getByText('TEST FIXTURE')).toBeVisible()
  })

  test('score calibration: Opportunity Score bands show observed win rate, verified sample counts, and a small-sample caveat', async ({ page }) => {
    await page.route('**/api/intelligence/score-calibration', (route) => route.fulfill({ json: { data: FIXTURE_SCORE_CALIBRATION } }))
    await page.route('**/api/intelligence/segments', (route) => route.fulfill({ json: { data: FIXTURE_SEGMENTS } }))
    await page.goto('/intelligence')
    await page.getByRole('tab', { name: 'Score Calibration' }).click()
    await expect(page.getByText('80% observed win rate')).toBeVisible()
    await expect(page.getByText(/too small a sample/).first()).toBeVisible()
  })

  test('performance by segment: a thin segment is caveated, never presented as a strategic conclusion', async ({ page }) => {
    await page.route('**/api/intelligence/score-calibration', (route) => route.fulfill({ json: { data: FIXTURE_SCORE_CALIBRATION } }))
    await page.route('**/api/intelligence/segments', (route) => route.fulfill({ json: { data: FIXTURE_SEGMENTS } }))
    await page.goto('/intelligence')
    await page.getByRole('tab', { name: 'Score Calibration' }).click()
    await expect(page.getByText('RARE_CATEGORY')).toBeVisible()
    await expect(page.getByText(/too small a sample/).last()).toBeVisible()
  })

  test('model registry: create a new model', async ({ page }) => {
    let models = [] as Array<typeof FIXTURE_MODEL>
    await page.route('**/api/intelligence/models', (route) => {
      if (route.request().method() === 'POST') {
        models = [FIXTURE_MODEL]
        return route.fulfill({ status: 201, json: { data: FIXTURE_MODEL } })
      }
      return route.fulfill({ json: { data: models } })
    })
    await page.goto('/intelligence')
    await page.getByRole('tab', { name: 'Model Registry & Performance' }).click()
    await page.getByPlaceholder('New model name').fill('Win Likelihood Model')
    await page.getByRole('button', { name: 'Create model' }).click()
    await expect(page.getByRole('button', { name: 'Win Likelihood Model' })).toBeVisible()
  })

  test('model registry: create a new model version and it starts EXPERIMENTAL', async ({ page }) => {
    await mockModelsList(page)
    await mockDatasetsList(page)
    await page.route(`**/api/intelligence/models/${MODEL_ID}`, (route) => route.fulfill({ json: { data: FIXTURE_MODEL, versions: [FIXTURE_VERSION_EXPERIMENTAL] } }))
    await page.route(`**/api/intelligence/models/${MODEL_ID}/versions`, (route) => route.fulfill({ status: 201, json: { data: FIXTURE_VERSION_EXPERIMENTAL } }))
    await page.route(`**/api/intelligence/versions/${VERSION_ID}`, (route) =>
      route.fulfill({ json: { data: FIXTURE_VERSION_EXPERIMENTAL, evaluations: [], calibrations: [], card: null, promotions: [], trainingRuns: [] } }),
    )
    await page.goto('/intelligence')
    await page.getByRole('tab', { name: 'Model Registry & Performance' }).click()
    await page.getByRole('button', { name: 'Win Likelihood Model' }).click()
    await expect(page.getByTestId('version-status')).toHaveText('EXPERIMENTAL')
  })

  test('create model training run: baselines are computed even when a version starts EXPERIMENTAL', async ({ page }) => {
    let trained = false
    await mockModelsList(page)
    await mockDatasetsList(page)
    await page.route(`**/api/intelligence/models/${MODEL_ID}`, (route) => route.fulfill({ json: { data: FIXTURE_MODEL, versions: [FIXTURE_VERSION_EXPERIMENTAL] } }))
    await page.route(`**/api/intelligence/versions/${VERSION_ID}`, (route) =>
      route.fulfill({
        json: trained
          ? { data: FIXTURE_VERSION_EVALUATED, evaluations: FIXTURE_EVALUATIONS, calibrations: [], card: null, promotions: [], trainingRuns: [{ status: 'COMPLETED' }] }
          : { data: FIXTURE_VERSION_EXPERIMENTAL, evaluations: [], calibrations: [], card: null, promotions: [], trainingRuns: [] },
      }),
    )
    await page.route(`**/api/intelligence/versions/${VERSION_ID}/train`, (route) => {
      trained = true
      return route.fulfill({ json: { data: { status: 'COMPLETED' } } })
    })
    await page.goto('/intelligence')
    await page.getByRole('tab', { name: 'Model Registry & Performance' }).click()
    await page.getByRole('button', { name: 'Win Likelihood Model' }).click()
    await page.getByRole('button', { name: 'Train' }).click()
    await expect(page.getByTestId('evaluation-metrics')).toContainText('Baseline (prevalence) AUC: 0.500')
  })

  test('evaluate model / display evaluation metrics: AUC, PR-AUC, precision, recall, F1, Brier are all shown with sample size', async ({ page }) => {
    await mockModelsList(page)
    await page.route(`**/api/intelligence/models/${MODEL_ID}`, (route) => route.fulfill({ json: { data: FIXTURE_MODEL, versions: [FIXTURE_VERSION_EVALUATED] } }))
    await page.route(`**/api/intelligence/versions/${VERSION_ID}`, (route) =>
      route.fulfill({ json: { data: FIXTURE_VERSION_EVALUATED, evaluations: FIXTURE_EVALUATIONS, calibrations: [], card: null, promotions: [], trainingRuns: [] } }),
    )
    await page.goto('/intelligence')
    await page.getByRole('tab', { name: 'Model Registry & Performance' }).click()
    await page.getByRole('button', { name: 'Win Likelihood Model' }).click()
    const metrics = page.getByTestId('evaluation-metrics')
    await expect(metrics).toContainText('Model AUC: 0.780 (n=12)')
    await expect(metrics).toContainText('PR-AUC: 0.650')
    await expect(metrics).toContainText('Precision: 0.70')
    await expect(metrics).toContainText('Recall: 0.60')
    await expect(metrics).toContainText('F1: 0.65')
    await expect(metrics).toContainText('Brier: 0.180')
  })

  test('display calibration metrics: calibration error, Brier score and sample size are shown for the latest calibration version', async ({ page }) => {
    await mockModelsList(page)
    await page.route(`**/api/intelligence/models/${MODEL_ID}`, (route) => route.fulfill({ json: { data: FIXTURE_MODEL, versions: [FIXTURE_VERSION_CALIBRATED] } }))
    await page.route(`**/api/intelligence/versions/${VERSION_ID}`, (route) =>
      route.fulfill({ json: { data: FIXTURE_VERSION_CALIBRATED, evaluations: FIXTURE_EVALUATIONS, calibrations: FIXTURE_CALIBRATIONS, card: null, promotions: [], trainingRuns: [] } }),
    )
    await page.goto('/intelligence')
    await page.getByRole('tab', { name: 'Model Registry & Performance' }).click()
    await page.getByRole('button', { name: 'Win Likelihood Model' }).click()
    await expect(page.getByTestId('calibration-metrics')).toContainText('Calibration v1: mean error 0.060, Brier 0.180 (n=12)')
  })

  test('a CALIBRATED version can be marked a production candidate (model card created)', async ({ page }) => {
    let candidated = false
    await mockModelsList(page)
    await page.route(`**/api/intelligence/models/${MODEL_ID}`, (route) => route.fulfill({ json: { data: FIXTURE_MODEL, versions: [FIXTURE_VERSION_CALIBRATED] } }))
    await page.route(`**/api/intelligence/versions/${VERSION_ID}/candidate`, (route) => {
      candidated = true
      return route.fulfill({ json: { data: FIXTURE_CARD } })
    })
    await page.route(`**/api/intelligence/versions/${VERSION_ID}`, (route) =>
      route.fulfill({
        json: candidated
          ? { data: FIXTURE_VERSION_CANDIDATE, evaluations: FIXTURE_EVALUATIONS, calibrations: FIXTURE_CALIBRATIONS, card: FIXTURE_CARD, promotions: [], trainingRuns: [] }
          : { data: FIXTURE_VERSION_CALIBRATED, evaluations: FIXTURE_EVALUATIONS, calibrations: FIXTURE_CALIBRATIONS, card: null, promotions: [], trainingRuns: [] },
      }),
    )
    await page.goto('/intelligence')
    await page.getByRole('tab', { name: 'Model Registry & Performance' }).click()
    await page.getByRole('button', { name: 'Win Likelihood Model' }).click()
    await page.getByRole('button', { name: 'Mark as production candidate' }).click()
    await expect(page.getByTestId('version-status')).toHaveText('PRODUCTION_CANDIDATE')
  })

  test('approve model candidate / promote model to production: requires a rationale and moves the version to PRODUCTION', async ({ page }) => {
    let approved = false
    await mockModelsList(page)
    await page.route(`**/api/intelligence/models/${MODEL_ID}`, (route) => route.fulfill({ json: { data: FIXTURE_MODEL, versions: [FIXTURE_VERSION_CANDIDATE] } }))
    await page.route(`**/api/intelligence/versions/${VERSION_ID}/approve`, (route) => {
      approved = true
      return route.fulfill({ json: { data: { status: 'PRODUCTION' } } })
    })
    await page.route(`**/api/intelligence/versions/${VERSION_ID}`, (route) =>
      route.fulfill({
        json: approved
          ? { data: FIXTURE_VERSION_PRODUCTION, evaluations: FIXTURE_EVALUATIONS, calibrations: FIXTURE_CALIBRATIONS, card: FIXTURE_CARD, promotions: [], trainingRuns: [] }
          : { data: FIXTURE_VERSION_CANDIDATE, evaluations: FIXTURE_EVALUATIONS, calibrations: FIXTURE_CALIBRATIONS, card: FIXTURE_CARD, promotions: [], trainingRuns: [] },
      }),
    )
    await page.goto('/intelligence')
    await page.getByRole('tab', { name: 'Model Registry & Performance' }).click()
    await page.getByRole('button', { name: 'Win Likelihood Model' }).click()
    await expect(page.getByRole('button', { name: 'Approve for production' })).toBeDisabled()
    await page.getByPlaceholder('Approval/rejection rationale').fill('Beats both baselines by a meaningful margin, calibration acceptable, model card complete.')
    await page.getByRole('button', { name: 'Approve for production' }).click()
    await expect(page.getByTestId('version-status')).toHaveText('PRODUCTION')
  })

  test('reject model for insufficient performance: a candidate that does not beat the baselines is rejected to FAILED', async ({ page }) => {
    let rejected = false
    await mockModelsList(page)
    await page.route(`**/api/intelligence/models/${MODEL_ID}`, (route) => route.fulfill({ json: { data: FIXTURE_MODEL, versions: [FIXTURE_VERSION_CANDIDATE] } }))
    await page.route(`**/api/intelligence/versions/${VERSION_ID}/reject`, (route) => {
      rejected = true
      return route.fulfill({ json: { data: { status: 'FAILED' } } })
    })
    await page.route(`**/api/intelligence/versions/${VERSION_ID}`, (route) =>
      route.fulfill({
        json: rejected
          ? { data: FIXTURE_VERSION_FAILED, evaluations: FIXTURE_EVALUATIONS_POOR_MODEL, calibrations: [], card: FIXTURE_CARD, promotions: [], trainingRuns: [] }
          : { data: FIXTURE_VERSION_CANDIDATE, evaluations: FIXTURE_EVALUATIONS_POOR_MODEL, calibrations: [], card: FIXTURE_CARD, promotions: [], trainingRuns: [] },
      }),
    )
    await page.goto('/intelligence')
    await page.getByRole('tab', { name: 'Model Registry & Performance' }).click()
    await page.getByRole('button', { name: 'Win Likelihood Model' }).click()
    await page.getByPlaceholder('Approval/rejection rationale').fill('AUC does not clear the baseline margin required by spec §7/§43.')
    await page.getByRole('button', { name: 'Reject' }).click()
    await expect(page.getByTestId('version-status')).toHaveText('FAILED')
    await expect(page.getByText(/will never be promoted/)).toBeVisible()
  })

  test('display model version: version number, sample counts and training/test periods are all shown', async ({ page }) => {
    await mockModelsList(page)
    await page.route(`**/api/intelligence/models/${MODEL_ID}`, (route) => route.fulfill({ json: { data: FIXTURE_MODEL, versions: [FIXTURE_VERSION_PRODUCTION] } }))
    await page.route(`**/api/intelligence/versions/${VERSION_ID}`, (route) =>
      route.fulfill({ json: { data: FIXTURE_VERSION_PRODUCTION, evaluations: FIXTURE_EVALUATIONS, calibrations: FIXTURE_CALIBRATIONS, card: FIXTURE_CARD, promotions: [], trainingRuns: [] } }),
    )
    await page.goto('/intelligence')
    await page.getByRole('tab', { name: 'Model Registry & Performance' }).click()
    await page.getByRole('button', { name: 'Win Likelihood Model' }).click()
    await expect(page.getByTestId('version-number')).toHaveText('v1')
    await expect(page.getByText('Sample: 36')).toBeVisible()
    await expect(page.getByText('WON: 18')).toBeVisible()
  })

  test('retire a production model: requires a reason and the version becomes RETIRED', async ({ page }) => {
    let retired = false
    await mockModelsList(page)
    await page.route(`**/api/intelligence/models/${MODEL_ID}`, (route) => route.fulfill({ json: { data: FIXTURE_MODEL, versions: [FIXTURE_VERSION_PRODUCTION] } }))
    await page.route(`**/api/intelligence/versions/${VERSION_ID}/retire`, (route) => {
      retired = true
      return route.fulfill({ json: { data: { status: 'RETIRED' } } })
    })
    await page.route(`**/api/intelligence/versions/${VERSION_ID}`, (route) =>
      route.fulfill({
        json: retired
          ? { data: FIXTURE_VERSION_RETIRED, evaluations: FIXTURE_EVALUATIONS, calibrations: FIXTURE_CALIBRATIONS, card: FIXTURE_CARD, promotions: [], trainingRuns: [] }
          : { data: FIXTURE_VERSION_PRODUCTION, evaluations: FIXTURE_EVALUATIONS, calibrations: FIXTURE_CALIBRATIONS, card: FIXTURE_CARD, promotions: [], trainingRuns: [] },
      }),
    )
    await page.goto('/intelligence')
    await page.getByRole('tab', { name: 'Model Registry & Performance' }).click()
    await page.getByRole('button', { name: 'Win Likelihood Model' }).click()
    await page.getByPlaceholder('Retirement reason').fill('Superseded by a newer, better-calibrated version.')
    await page.getByRole('button', { name: 'Retire model' }).click()
    await expect(page.getByTestId('version-status')).toHaveText('RETIRED')
    await expect(page.getByText('Retired: Superseded by a newer, better-calibrated version.')).toBeVisible()
  })

  test('generate a prediction: a PRODUCTION-eligible model returns a predicted probability with model version and timestamp', async ({ page }) => {
    await mockModelsList(page)
    await page.route('**/api/intelligence/predictions', (route) => route.fulfill({ json: FIXTURE_PREDICTION_SUCCESS }))
    await page.goto('/intelligence')
    await page.getByRole('tab', { name: 'Prediction' }).click()
    await page.getByPlaceholder('Bid project ID').fill(BID_PROJECT_ID)
    await page.locator('select').selectOption(MODEL_ID)
    await page.getByRole('button', { name: 'Get prediction' }).click()
    await expect(page.getByTestId('predicted-probability')).toHaveText('68%')
    await expect(page.getByText(/Model version: v1/)).toBeVisible()
  })

  test('display prediction explanation: associative language, top features and the decision-support disclaimer are shown', async ({ page }) => {
    await mockModelsList(page)
    await page.route('**/api/intelligence/predictions', (route) => route.fulfill({ json: FIXTURE_PREDICTION_SUCCESS }))
    await page.goto('/intelligence')
    await page.getByRole('tab', { name: 'Prediction' }).click()
    await page.getByPlaceholder('Bid project ID').fill(BID_PROJECT_ID)
    await page.locator('select').selectOption(MODEL_ID)
    await page.getByRole('button', { name: 'Get prediction' }).click()
    const explanation = page.getByTestId('prediction-explanation')
    await expect(explanation).toContainText('associated with a stronger outcome')
    await expect(explanation).toContainText('This is decision support, not a procurement decision.')
  })

  test('trigger prediction abstention: insufficient verified outcomes produces an explicit abstention, never a fabricated probability', async ({ page }) => {
    await mockModelsList(page)
    await page.route('**/api/intelligence/predictions', (route) => route.fulfill({ json: FIXTURE_PREDICTION_ABSTAIN }))
    await page.goto('/intelligence')
    await page.getByRole('tab', { name: 'Prediction' }).click()
    await page.getByPlaceholder('Bid project ID').fill(BID_PROJECT_ID)
    await page.locator('select').selectOption(MODEL_ID)
    await page.getByRole('button', { name: 'Get prediction' }).click()
    await expect(page.getByText('PREDICTION ABSTAINED')).toBeVisible()
    await expect(page.getByText('Reason: INSUFFICIENT_VERIFIED_OUTCOMES')).toBeVisible()
    await expect(page.getByText(/not a system failure/)).toBeVisible()
    await expect(page.getByTestId('predicted-probability')).toHaveCount(0)
  })

  test('agency isolation: a bid project belonging to another agency is refused (404) rather than leaking a prediction', async ({ page }) => {
    await mockModelsList(page)
    await page.route('**/api/intelligence/predictions', (route) => route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Bid project not found.' } } }))
    await page.goto('/intelligence')
    await page.getByRole('tab', { name: 'Prediction' }).click()
    await page.getByPlaceholder('Bid project ID').fill(OTHER_AGENCY_BID_PROJECT_ID)
    await page.locator('select').selectOption(MODEL_ID)
    await page.getByRole('button', { name: 'Get prediction' }).click()
    await expect(page.getByTestId('prediction-error')).toContainText(/not found/i)
  })

  test('historical prediction immutability: a past prediction is rendered read-only, with no edit affordance ever offered', async ({ page }) => {
    await mockModelsList(page)
    await page.route('**/api/intelligence/predictions', (route) => route.fulfill({ json: FIXTURE_PREDICTION_SUCCESS }))
    await page.goto('/intelligence')
    await page.getByRole('tab', { name: 'Prediction' }).click()
    await page.getByPlaceholder('Bid project ID').fill(BID_PROJECT_ID)
    await page.locator('select').selectOption(MODEL_ID)
    await page.getByRole('button', { name: 'Get prediction' }).click()
    await expect(page.getByTestId('prediction-result')).toBeVisible()
    // No edit/delete control is ever rendered on a prediction result — a
    // prediction is a historical fact (spec §24), never mutated from the UI.
    await expect(page.getByTestId('prediction-result').getByRole('button', { name: /edit|delete/i })).toHaveCount(0)
  })

  test('post-outcome data cannot influence a historical prediction: the prediction still shows the model version it was actually made with, even after that model is later retired', async ({ page }) => {
    await mockModelsList(page)
    // The prediction fixture is frozen at model_version_label "v1" —
    // this test asserts the displayed label is exactly the one the
    // prediction was made with, never re-derived from whatever the
    // model's CURRENT (now-retired) status happens to be.
    await page.route('**/api/intelligence/predictions', (route) => route.fulfill({ json: FIXTURE_PREDICTION_SUCCESS }))
    await page.route(`**/api/intelligence/models/${MODEL_ID}`, (route) => route.fulfill({ json: { data: FIXTURE_MODEL, versions: [FIXTURE_VERSION_RETIRED] } }))
    await page.goto('/intelligence')
    await page.getByRole('tab', { name: 'Prediction' }).click()
    await page.getByPlaceholder('Bid project ID').fill(BID_PROJECT_ID)
    await page.locator('select').selectOption(MODEL_ID)
    await page.getByRole('button', { name: 'Get prediction' }).click()
    await expect(page.getByText(/Model version: v1/)).toBeVisible()
  })

  test('learning tab links out to the existing Outcomes dashboard rather than duplicating it', async ({ page }) => {
    await page.goto('/intelligence')
    await page.getByRole('tab', { name: 'Historical Learning' }).click()
    await expect(page.getByRole('link', { name: 'Outcomes dashboard' })).toHaveAttribute('href', '/outcomes')
  })

  test('the Intelligence area is reachable from the primary navigation', async ({ page }) => {
    await page.route('**/api/intelligence/readiness', (route) => route.fulfill({ json: { data: FIXTURE_READINESS_INSUFFICIENT } }))
    await mockDatasetsList(page, [])
    await page.goto('/')
    await page.getByRole('link', { name: 'Intelligence' }).click()
    await expect(page).toHaveURL(/\/intelligence$/)
    await expect(page.getByRole('heading', { name: 'Predictive Intelligence' })).toBeVisible()
  })
})
