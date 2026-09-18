import pg from 'pg'

export function getTestPool(): pg.Pool {
  const connectionString =
    process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/tender_intelligence_test'
  return new pg.Pool({ connectionString })
}

/**
 * Runs `fn` inside a transaction impersonating the given user under
 * RLS (Postgres role `authenticated`, with `auth.uid()` resolving to
 * `userId` via the local auth shim — database/scripts/local-only-auth-shim.sql).
 * Always rolls back afterwards so tests never leave fixture-adjacent
 * writes behind, and so a test can freely attempt writes RLS should
 * reject without polluting later tests.
 */
export async function asAuthenticatedUser<T>(
  client: pg.PoolClient,
  userId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  await client.query('begin')
  try {
    await client.query('set local role authenticated')
    await client.query('select set_config($1, $2, true)', ['request.jwt.claim.sub', userId])
    return await fn(client)
  } finally {
    await client.query('rollback')
  }
}
