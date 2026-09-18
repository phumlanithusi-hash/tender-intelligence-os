import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Minimal fake of the slice of the supabase-js query builder these
 * repositories actually use. Not a general mock of supabase-js — just
 * enough surface to unit-test repository logic (row parsing, filter
 * wiring, error propagation) without a live database. RLS itself is
 * exercised for real against Postgres in
 * database/src/__tests__/schema.test.ts, not here — supabase-js talks
 * to a PostgREST endpoint this sandbox does not run, so RLS cannot be
 * exercised through this client at all; these tests only prove a
 * repository builds the query it should.
 */
export interface FakeResult {
  data: unknown
  error: { message: string } | null
  count?: number | null
}

export interface RecordedCall {
  method: string
  args: unknown[]
}

/**
 * Returns both the fake client and a `calls` array recording every
 * chained method call made against `.from(table)`, in order — so a
 * test can assert "the repository actually filtered on this column"
 * without re-implementing PostgREST's own filtering semantics.
 */
export function fakeSupabaseClient(table: Record<string, FakeResult>): {
  client: SupabaseClient
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []

  const client = {
    from(name: string) {
      const result: FakeResult = table[name] ?? { data: null, error: { message: `no fixture for ${name}` } }
      const record = (method: string, args: unknown[]) => {
        calls.push({ method, args })
        return builder
      }
      const builder = {
        select: (...args: unknown[]) => record('select', args),
        eq: (...args: unknown[]) => record('eq', args),
        in: (...args: unknown[]) => record('in', args),
        lte: (...args: unknown[]) => record('lte', args),
        gte: (...args: unknown[]) => record('gte', args),
        not: (...args: unknown[]) => record('not', args),
        or: (...args: unknown[]) => record('or', args),
        order: (...args: unknown[]) => record('order', args),
        limit: (...args: unknown[]) => record('limit', args),
        insert: (...args: unknown[]) => record('insert', args),
        update: (...args: unknown[]) => record('update', args),
        delete: (...args: unknown[]) => record('delete', args),
        range: (...args: unknown[]) => {
          calls.push({ method: 'range', args })
          return Promise.resolve(result)
        },
        maybeSingle: () => {
          calls.push({ method: 'maybeSingle', args: [] })
          return Promise.resolve(result)
        },
        single: () => {
          calls.push({ method: 'single', args: [] })
          return Promise.resolve(result)
        },
        then: (
          onFulfilled: (value: FakeResult) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => Promise.resolve(result).then(onFulfilled, onRejected),
      }
      return builder
    },
  }
  return { client: client as unknown as SupabaseClient, calls }
}
