#!/usr/bin/env node
// Applies every SQL file in database/seeds/ — reference data only
// (geography, service taxonomy, tender source registry). Every seed
// file uses ON CONFLICT DO NOTHING, so this is safe to re-run.
// Deliberately does NOT track "applied" state the way migrate.mjs
// does — reference data is meant to be idempotently reconciled, not
// versioned like schema changes.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const seedsDir = path.join(__dirname, '..', 'seeds')

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const client = new pg.Client({ connectionString })

async function main() {
  await client.connect()

  const files = readdirSync(seedsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    const sql = readFileSync(path.join(seedsDir, file), 'utf8')
    console.log(`[seed] applying ${file}`)
    await client.query(sql)
  }

  console.log(`[seed] done — ${files.length} seed file(s) applied`)
  await client.end()
}

main().catch((err) => {
  console.error('[seed] unexpected error:', err)
  process.exit(1)
})
