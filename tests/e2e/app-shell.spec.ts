import { test, expect } from '@playwright/test'

/**
 * Phase 1 acceptance test (build execution §6): app starts, routes
 * resolve, navigation works. Full coverage of every route in spec §9
 * accumulates phase by phase (docs/TESTING.md §4) — this file is the
 * Phase 1 slice, not the final critical-path E2E.
 *
 * This test run has no apps/web/.env.local, so Supabase is
 * unconfigured — the correct Phase 1 behavior is an explicit "not
 * configured" state rather than a crash or a silent redirect loop
 * (docs/DECISIONS.md 2026-09-10). The /login screen itself is
 * verified separately since it renders regardless of configuration.
 */
test.describe('Phase 1 — application shell', () => {
  test('home route renders the shell and reports auth is not configured', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Authentication is not configured')).toBeVisible()
  })

  test('the login screen renders directly', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByText('Authentication is not configured')).toBeVisible()
  })

  test('an unknown nested route does not crash the app', async ({ page }) => {
    await page.goto('/tenders/does-not-exist')
    await expect(page.locator('body')).toBeVisible()
    const hasError = await page.getByText('The application hit an unexpected error').isVisible().catch(() => false)
    expect(hasError).toBe(false)
  })
})
