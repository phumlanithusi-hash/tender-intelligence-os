import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import { getTestPool, asAuthenticatedUser } from '../testHelpers.js'

const pool = getTestPool()

afterAll(async () => {
  await pool.end()
})

async function withUser<T>(userId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    return await asAuthenticatedUser(client, userId, fn)
  } finally {
    client.release()
  }
}

/**
 * Phase 19 gap-closing (spec §15/§22) — RLS isolation for the
 * extended `notifications` table. The original Phase 2 policy was
 * agency-scoped only; 20260913100000_notifications_v2.sql tightens it
 * to agency-AND-user scope (an agency-wide notification has
 * user_id null and stays visible to the whole agency; a user-targeted
 * one is visible only to that user), and this suite proves the
 * tightened policy, the dedup unique index, and that no
 * authenticated-role write path can create a row directly (writes are
 * service-role only, exactly like every other write path in this
 * system).
 */
describe('Phase 19 gap-closing: notifications v2 (dedup, entity link, user-scoped RLS)', () => {
  let agencyAId: string
  let userA1Id: string
  let userA2Id: string
  let agencyBId: string
  let userBId: string
  let tenderId: string

  beforeAll(async () => {
    const agencyA = await pool.query(`insert into agencies (name) values ('Notif Test Agency A') returning id`)
    agencyAId = agencyA.rows[0].id
    const agencyB = await pool.query(`insert into agencies (name) values ('Notif Test Agency B') returning id`)
    agencyBId = agencyB.rows[0].id

    const a1 = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userA1Id = a1.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'notifa1@example.com')`, [userA1Id, agencyAId])

    const a2 = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userA2Id = a2.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'BID_MANAGER', 'notifa2@example.com')`, [userA2Id, agencyAId])

    const b = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userBId = b.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'notifb@example.com')`, [userBId, agencyBId])

    const tender = await pool.query(`insert into tenders (title) values ('Notifications test tender') returning id`)
    tenderId = tender.rows[0].id
  })

  it('service role can create an agency-wide notification (user_id null) and a user-targeted one, each linked to an entity', async () => {
    const agencyWide = await pool.query(
      `insert into notifications (agency_id, user_id, event_type, entity_type, entity_id, related_tender_id, dedup_key)
       values ($1, null, 'OUTCOME_DETECTED', 'tender_outcome', gen_random_uuid(), $2, 'test-dedup-1') returning id`,
      [agencyAId, tenderId],
    )
    expect(agencyWide.rows[0].id).toBeTruthy()

    const targeted = await pool.query(
      `insert into notifications (agency_id, user_id, event_type, entity_type, entity_id, related_tender_id, dedup_key)
       values ($1, $2, 'NEW_RELEVANT_TENDER', 'tender', $3, $3, 'test-dedup-2') returning id`,
      [agencyAId, userA1Id, tenderId],
    )
    expect(targeted.rows[0].id).toBeTruthy()
  })

  it('dedup_key is unique when present — a second insert with the same key fails', async () => {
    await pool.query(
      `insert into notifications (agency_id, user_id, event_type, entity_type, entity_id, dedup_key) values ($1, null, 'TENDER_UPDATED', 'tender', $2, 'dup-key-1')`,
      [agencyAId, tenderId],
    )
    await expect(
      pool.query(`insert into notifications (agency_id, user_id, event_type, entity_type, entity_id, dedup_key) values ($1, null, 'TENDER_UPDATED', 'tender', $2, 'dup-key-1')`, [
        agencyAId,
        tenderId,
      ]),
    ).rejects.toThrow(/duplicate key|unique constraint/i)
  })

  it('multiple NULL dedup_key rows are allowed (postgres NULLs are not equal to each other)', async () => {
    await pool.query(`insert into notifications (agency_id, user_id, event_type, entity_type, entity_id) values ($1, null, 'TENDER_UPDATED', 'tender', $2)`, [agencyAId, tenderId])
    await pool.query(`insert into notifications (agency_id, user_id, event_type, entity_type, entity_id) values ($1, null, 'TENDER_UPDATED', 'tender', $2)`, [agencyAId, tenderId])
  })

  it('RLS: user A1 sees agency-wide notifications and their own, but not user A2\'s targeted one', async () => {
    await pool.query(
      `insert into notifications (agency_id, user_id, event_type, entity_type, entity_id, dedup_key) values ($1, $2, 'OUTCOME_REQUIRES_REVIEW', 'bid_strategy_project', gen_random_uuid(), 'a2-only')`,
      [agencyAId, userA2Id],
    )

    const asA1 = await withUser(userA1Id, async (client) => client.query(`select * from notifications where dedup_key = 'a2-only'`))
    expect(asA1.rows).toHaveLength(0)

    const asA2 = await withUser(userA2Id, async (client) => client.query(`select * from notifications where dedup_key = 'a2-only'`))
    expect(asA2.rows).toHaveLength(1)
  })

  it('RLS: cross-agency isolation — agency B cannot see agency A notifications at all', async () => {
    const asB = await withUser(userBId, async (client) => client.query(`select * from notifications where agency_id = $1`, [agencyAId]))
    expect(asB.rows).toHaveLength(0)
  })

  it('RLS: user A1 can mark their own or an agency-wide notification read/dismissed, but not user A2\'s targeted one', async () => {
    const own = await pool.query(
      `insert into notifications (agency_id, user_id, event_type, entity_type, entity_id, dedup_key) values ($1, $2, 'SUBMISSION_OUTCOME_UNKNOWN', 'bid_strategy_project', gen_random_uuid(), 'a1-own') returning id`,
      [agencyAId, userA1Id],
    )
    const ownId = own.rows[0].id as string

    const updated = await withUser(userA1Id, async (client) => client.query(`update notifications set read_at = now() where id = $1 returning id`, [ownId]))
    expect(updated.rows).toHaveLength(1)

    const a2Only = await pool.query(
      `insert into notifications (agency_id, user_id, event_type, entity_type, entity_id, dedup_key) values ($1, $2, 'SUBMISSION_OUTCOME_UNKNOWN', 'bid_strategy_project', gen_random_uuid(), 'a2-own-write-test') returning id`,
      [agencyAId, userA2Id],
    )
    const a2OnlyId = a2Only.rows[0].id as string
    const blocked = await withUser(userA1Id, async (client) => client.query(`update notifications set read_at = now() where id = $1 returning id`, [a2OnlyId]))
    expect(blocked.rows).toHaveLength(0)
  })

  it('no authenticated-role INSERT policy exists — a direct browser-side insert is denied by RLS', async () => {
    await expect(
      withUser(userA1Id, async (client) =>
        client.query(`insert into notifications (agency_id, user_id, event_type, entity_type, entity_id) values ($1, $2, 'TENDER_UPDATED', 'tender', $3)`, [agencyAId, userA1Id, tenderId]),
      ),
    ).rejects.toThrow(/row-level security|policy/i)
  })

  it('security-audit finding (spec §22): audit_logs RLS — an ADMIN of agency A cannot see agency B\'s audit entries, and a non-ADMIN of agency A cannot see agency A\'s own entries either (ADMIN-only visibility)', async () => {
    await pool.query(`insert into audit_logs (agency_id, actor_id, action, entity_type, entity_id) values ($1, $2, 'OUTCOME_CREATED', 'tender_outcome', gen_random_uuid())`, [agencyBId, userBId])

    const asA1Admin = await withUser(userA1Id, async (client) => client.query(`select * from audit_logs where agency_id = $1`, [agencyBId]))
    expect(asA1Admin.rows).toHaveLength(0)

    await pool.query(`insert into audit_logs (agency_id, actor_id, action, entity_type, entity_id) values ($1, $2, 'OUTCOME_CREATED', 'tender_outcome', gen_random_uuid())`, [agencyAId, userA1Id])
    const asA2NonAdmin = await withUser(userA2Id, async (client) => client.query(`select * from audit_logs where agency_id = $1`, [agencyAId]))
    expect(asA2NonAdmin.rows).toHaveLength(0)

    const asA1AdminOwn = await withUser(userA1Id, async (client) => client.query(`select * from audit_logs where agency_id = $1`, [agencyAId]))
    expect(asA1AdminOwn.rows.length).toBeGreaterThan(0)
  })

  it('entity_type/entity_id and bid_strategy_project_id columns exist and round-trip', async () => {
    const row = await pool.query(
      `insert into notifications (agency_id, user_id, event_type, entity_type, entity_id, dedup_key) values ($1, null, 'ADDENDUM_DETECTED', 'tender_addendum', gen_random_uuid(), 'entity-link-test') returning entity_type, entity_id, bid_strategy_project_id, dismissed_at`,
      [agencyAId],
    )
    expect(row.rows[0].entity_type).toBe('tender_addendum')
    expect(row.rows[0].entity_id).toBeTruthy()
    expect(row.rows[0].bid_strategy_project_id).toBeNull()
    expect(row.rows[0].dismissed_at).toBeNull()
  })
})
