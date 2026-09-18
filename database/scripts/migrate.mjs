#!/usr/bin/env node
// Applies every SQL file in database/migrations/ not yet recorded in
// schema_migrations, in filename (timestamp) order. See
// database/README.md for the full explanation of local vs. Supabase
// application of these same files.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.join(__dirname, '..', 'migrations')
const shimPath = path.join(__dirname, 'local-only-auth-shim.sql')

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is required (e.g. postgres://postgres:postgres@127.0.0.1:5432/dbname)')
  process.exit(1)
}

// 'local' (default): apply the local-only auth/RLS-role shim first, so
// migrations referencing auth.users / auth.uid() work against a plain
// Postgres instance. 'supabase': skip it — a real Supabase project
// already provides that surface, and applying the shim there would
// conflict with it.
const target = process.env.MIGRATE_TARGET ?? 'local'

const client = new pg.Client({ connectionString })

async function main() {
  await client.connect()

  await client.query(`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `)

  if (target === 'local') {
    console.log('[migrate] target=local — applying local-only auth/RLS-role shim')
    await client.query(readFileSync(shimPath, 'utf8'))
  }

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const { rows: applied } = await client.query('select filename from schema_migrations')
  const appliedSet = new Set(applied.map((r) => r.filename))

  let appliedCount = 0
  for (const file of files) {
    if (appliedSet.has(file)) continue
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8')
    console.log(`[migrate] applying ${file}`)
    await client.query('begin')
    try {
      await client.query(sql)
      await client.query('insert into schema_migrations (filename) values ($1)', [file])
      await client.query('commit')
      appliedCount++
    } catch (err) {
      await client.query('rollback')
      console.error(`[migrate] FAILED on ${file}:`, err.message)
      await client.end()
      process.exit(1)
    }
  }

  console.log(`[migrate] done — ${appliedCount} migration(s) applied, ${files.length} total on disk`)
  await client.end()
}

main().catch((err) => {
  console.error('[migrate] unexpected error:', err)
  process.exit(1)
})
