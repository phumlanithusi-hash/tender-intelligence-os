#!/usr/bin/env node
// Orchestrates the full test cycle: reset -> migrate -> seed -> vitest.
// Each run gets a fully clean database, so tests never depend on
// leftover state from a previous run.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

const testDbUrl =
  process.env.TEST_DATABASE_URL ??
  'postgres://postgres:postgres@127.0.0.1:5432/tender_intelligence_test'

const env = { ...process.env, DATABASE_URL: testDbUrl }

function run(script) {
  const result = spawnSync('node', [path.join(root, 'scripts', script)], {
    env,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    console.error(`[run-tests] step failed: ${script}`)
    process.exit(result.status ?? 1)
  }
}

console.log(`[run-tests] using ${testDbUrl}`)
run('reset.mjs')
run('migrate.mjs')
run('seed.mjs')

const vitest = spawnSync('pnpm', ['exec', 'vitest', 'run'], {
  cwd: root,
  env,
  stdio: 'inherit',
})
process.exit(vitest.status ?? 1)
