import { defineConfig, devices } from '@playwright/test'

const chromiumLaunchOptions = {
  // This session's sandbox ships a pre-installed Chromium at a
  // revision that may not match the pinned @playwright/test
  // version's expected download build — point at it directly rather
  // than fetching a browser binary over the network.
  executablePath: '/opt/pw-browsers/chromium',
}

/**
 * E2E coverage across phases (docs/TESTING.md §4). Two independent
 * dev-server instances run side by side, deliberately with different
 * environments:
 *
 * - :5173 — no apps/web/.env.local, so Supabase is unconfigured. This
 *   is app-shell.spec.ts's target (Phase 1): it asserts the honest
 *   "not configured" state.
 * - :5174 — started with a syntactically valid but entirely fake
 *   Supabase URL/anon key, injected as env vars for this process only
 *   (no .env.local is written, so :5173 is unaffected). This is
 *   tender-radar.spec.ts's target (Phase 3): it fakes sign-in by
 *   seeding localStorage with the session shape
 *   @supabase/supabase-js expects (tests/e2e/tender-radar.spec.ts,
 *   tests/e2e/source-registry.spec.ts,
 *   tests/e2e/etenders-ingestion.spec.ts,
 *   tests/e2e/document-pipeline.spec.ts), then mocks every `/api/*`
 *   call from tests/e2e/fixtures/*.ts — no real Supabase project,
 *   live tender data, or real source scan is ever involved (Phase 3
 *   §25, Phase 4 §26, Phase 5 §29).
 */
export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @tender-os/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
      cwd: '../..',
    },
    {
      command: 'pnpm --filter @tender-os/web dev -- --port 5174',
      url: 'http://localhost:5174',
      reuseExistingServer: true,
      timeout: 60_000,
      cwd: '../..',
      env: {
        VITE_SUPABASE_URL: 'https://e2efixture.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'e2e-fixture-anon-key-not-a-real-secret',
        VITE_API_BASE_URL: 'http://localhost:4000',
      },
    },
  ],
  projects: [
    {
      name: 'chromium',
      testMatch: /app-shell\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
        launchOptions: chromiumLaunchOptions,
      },
    },
    {
      name: 'chromium-fixture-auth',
      testMatch: /(tender-radar|source-registry|etenders-ingestion|document-pipeline|ai-classification|qualification|requirement-evaluation|opportunity-scoring|bid-decision|bid-strategy|evidence-matching|proposal-generation|submission-readiness|submission-execution|outcomes|intelligence|production-operations|phase20-surveillance)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5174',
        launchOptions: chromiumLaunchOptions,
      },
    },
  ],
})
