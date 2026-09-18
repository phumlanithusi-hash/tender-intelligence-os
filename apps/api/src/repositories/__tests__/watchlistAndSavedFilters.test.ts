import { describe, expect, it } from 'vitest'
import { fakeSupabaseClient } from './fakeSupabase.js'
import { listWatchlist, addToWatchlist, removeFromWatchlist } from '../watchlist.js'
import { listSavedFilters, createSavedFilter, deleteSavedFilter } from '../savedFilters.js'

const now = new Date().toISOString()
const agencyId = '77777777-7777-7777-7777-777777777777'
const userId = '88888888-8888-8888-8888-888888888888'
const tenderId = '22222222-2222-2222-2222-222222222222'

describe('watchlist repository', () => {
  it('lists watchlist items', async () => {
    const { client } = fakeSupabaseClient({
      watchlist_items: {
        data: [{ id: '99999999-9999-9999-9999-999999999999', agency_id: agencyId, user_id: userId, tender_id: tenderId, notes: null, created_at: now }],
        error: null,
      },
    })
    const rows = await listWatchlist(client)
    expect(rows).toHaveLength(1)
  })

  it('adds a tender to the watchlist with the caller-supplied agency/user, not a default', async () => {
    const { client, calls } = fakeSupabaseClient({
      watchlist_items: {
        data: { id: '99999999-9999-9999-9999-999999999999', agency_id: agencyId, user_id: userId, tender_id: tenderId, notes: 'watch this one', created_at: now },
        error: null,
      },
    })
    const row = await addToWatchlist(client, { agencyId, userId, tenderId, notes: 'watch this one' })
    expect(row.tender_id).toBe(tenderId)
    const insertCall = calls.find((c) => c.method === 'insert')
    expect(insertCall?.args[0]).toMatchObject({ agency_id: agencyId, user_id: userId, tender_id: tenderId })
  })

  it('propagates a duplicate-watch constraint violation rather than swallowing it', async () => {
    const { client } = fakeSupabaseClient({
      watchlist_items: { data: null, error: { message: 'duplicate key value violates unique constraint' } },
    })
    await expect(addToWatchlist(client, { agencyId, userId, tenderId })).rejects.toMatchObject({
      message: expect.stringContaining('duplicate key'),
    })
  })

  it('removes a tender from the watchlist by tender id', async () => {
    const { client, calls } = fakeSupabaseClient({ watchlist_items: { data: null, error: null } })
    await removeFromWatchlist(client, tenderId)
    expect(calls).toContainEqual({ method: 'delete', args: [] })
    expect(calls).toContainEqual({ method: 'eq', args: ['tender_id', tenderId] })
  })
})

describe('saved filters repository', () => {
  it('lists saved filters', async () => {
    const { client } = fakeSupabaseClient({
      saved_filters: {
        data: [
          {
            id: '99999999-9999-9999-9999-999999999999',
            agency_id: agencyId,
            user_id: userId,
            name: 'Print tenders closing within 14 days',
            filter: { service: 'print', closingWithinDays: 14 },
            created_at: now,
            updated_at: now,
          },
        ],
        error: null,
      },
    })
    const rows = await listSavedFilters(client)
    expect(rows[0]?.name).toBe('Print tenders closing within 14 days')
  })

  it('creates a saved filter carrying the /api/tenders query-parameter shape verbatim', async () => {
    const filter = { province: 'Western Cape', service: '33333333-3333-3333-3333-333333333333' }
    const { client } = fakeSupabaseClient({
      saved_filters: {
        data: { id: '99999999-9999-9999-9999-999999999999', agency_id: agencyId, user_id: userId, name: 'WC Design', filter, created_at: now, updated_at: now },
        error: null,
      },
    })
    const row = await createSavedFilter(client, { agencyId, userId, name: 'WC Design', filter })
    expect(row.filter).toEqual(filter)
  })

  it('deletes a saved filter by id', async () => {
    const { client, calls } = fakeSupabaseClient({ saved_filters: { data: null, error: null } })
    await deleteSavedFilter(client, '99999999-9999-9999-9999-999999999999')
    expect(calls).toContainEqual({ method: 'delete', args: [] })
    expect(calls).toContainEqual({ method: 'eq', args: ['id', '99999999-9999-9999-9999-999999999999'] })
  })
})
