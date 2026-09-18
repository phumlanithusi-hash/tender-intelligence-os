#!/usr/bin/env node
// Drops and recreates the database named in DATABASE_URL, connecting
// via the `postgres` maintenance database (a database cannot drop
// itself). Used to give the test suite a clean, fully-isolated
// database on every run.
import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const url = new URL(connectionString)
const dbName = url.pathname.replace(/^\//, '')
if (!dbName) {
  console.error('DATABASE_URL must include a database name')
  process.exit(1)
}

const maintenanceUrl = new URL(connectionString)
maintenanceUrl.pathname = '/postgres'

const client = new pg.Client({ connectionString: maintenanceUrl.toString() })

async function main() {
  await client.connect()
  await client.query(
    `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
    [dbName],
  )
  await client.query(`drop database if exists "${dbName}"`)
  await client.query(`create database "${dbName}"`)
  console.log(`[reset] recreated database "${dbName}"`)
  await client.end()
}

main().catch((err) => {
  console.error('[reset] unexpected error:', err)
  process.exit(1)
})
