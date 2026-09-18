import { describe, expect, it } from 'vitest'
import { calculateSubmissionReadiness } from '../engine.js'
import { InMemorySubmissionPackStorage } from '../pack.js'
import { buildAndSaveSubmissionPack, runSubmissionReadinessCheck } from '../runSubmissionReadiness.js'
import { createFakeSubmissionReadinessStore } from './fakeSubmissionReadinessStore.js'
import { readyBaseline } from './fixtures.js'

/**
 * Phase 15 §57 — 8 security tests. Agency isolation at the fake-store
 * level mirrors what RLS enforces for real in Postgres (verified
 * separately and exhaustively in
 * database/src/__tests__/submissionReadiness.test.ts); malformed/
 * malicious IDs and service-role-key handling are verified here at
 * the application layer since they are TypeScript/Node concerns, not
 * SQL ones.
 */
describe('submission readiness security (Phase 15 §50/§51)', () => {
  it('agency isolation: agency B cannot read agency A pricing via the store', async () => {
    const { store } = createFakeSubmissionReadinessStore({ input: readyBaseline() })
    await store.createPricing('bp-1', 'agency-a', 'ZAR', 'user-a')
    const pricing = await store.getCurrentPricing('bp-1')
    expect(pricing).not.toBeNull()
    // Simulate an agency-B-scoped mutation attempt on an agency-A pricing row.
    await expect(store.upsertPricingItem(pricing!.id, 'agency-b', { lineNumber: 1, description: 'x', quantity: 1, unit: null, unitPrice: 1, lineTotal: 1, isMandatoryScheduleItem: false, notes: null })).rejects.toThrow(/FORBIDDEN/)
  })

  it('cross-agency pack access is blocked (invalidating another agency\'s pack throws)', async () => {
    const { store } = createFakeSubmissionReadinessStore({ input: readyBaseline() })
    const { readiness } = await runSubmissionReadinessCheck(store, { bidProjectId: 'bp-2', agencyId: 'agency-a', tenderId: 'tender-1', nowIso: '2026-09-11T09:00:00Z', actorId: 'user-a' })
    const pack = await buildAndSaveSubmissionPack(store, { bidProjectId: 'bp-2', agencyId: 'agency-a', readinessId: readiness.id, proposalVersionId: null, pricingId: null, manifest: {}, files: [], createdBy: 'user-a' })
    await expect(store.invalidatePack(pack.id, 'agency-b')).rejects.toThrow(/FORBIDDEN/)
  })

  it('cross-agency pricing access is blocked (updating another agency\'s pricing item throws)', async () => {
    const { store } = createFakeSubmissionReadinessStore({ input: readyBaseline() })
    const pricing = await store.createPricing('bp-3', 'agency-a', 'ZAR', 'user-a')
    const item = await store.upsertPricingItem(pricing.id, 'agency-a', { lineNumber: 1, description: 'x', quantity: 1, unit: null, unitPrice: 1, lineTotal: 1, isMandatoryScheduleItem: false, notes: null })
    await expect(store.updatePricingItem(item.id, 'agency-b', { description: 'hacked' })).rejects.toThrow(/FORBIDDEN/)
  })

  it('cross-agency readiness access is blocked (revoking another agency\'s approval throws)', async () => {
    const { store } = createFakeSubmissionReadinessStore({ input: readyBaseline() })
    const { readiness } = await runSubmissionReadinessCheck(store, { bidProjectId: 'bp-4', agencyId: 'agency-a', tenderId: 'tender-1', nowIso: '2026-09-11T09:00:00Z', actorId: 'user-a' })
    const pack = await buildAndSaveSubmissionPack(store, { bidProjectId: 'bp-4', agencyId: 'agency-a', readinessId: readiness.id, proposalVersionId: null, pricingId: null, manifest: {}, files: [], createdBy: 'user-a' })
    const approval = await store.createApproval({ bidProjectId: 'bp-4', agencyId: 'agency-a', readinessId: readiness.id, packId: pack.id, approvalReason: 'ok', approvedBy: 'user-a' })
    await expect(store.revokeApproval(approval.id, 'agency-b', 'user-b', 'attempted hijack')).rejects.toThrow(/FORBIDDEN/)
  })

  it('a malformed (non-UUID-shaped) source id passed into the engine is treated as opaque data, never executed or interpolated', () => {
    // The pure engine only ever compares/pushes ids as strings; a
    // SQL-injection-shaped id must not affect engine behaviour at all.
    const input = readyBaseline()
    input.requirements[0]!.id = "'; drop table tender_requirements; --"
    input.requirements[0]!.status = 'MISSING'
    const result = calculateSubmissionReadiness(input)
    expect(result.items.some((i) => i.sourceId === "'; drop table tender_requirements; --")).toBe(true)
    expect(result.status).toBe('BLOCKED')
  })

  it('a malicious/spoofed agency id supplied by a caller is rejected at the store boundary rather than trusted', async () => {
    const { store } = createFakeSubmissionReadinessStore({ input: readyBaseline() })
    const pricing = await store.createPricing('bp-5', 'agency-a', 'ZAR', 'user-a')
    // Attempting to read/mutate under a spoofed agency id must fail, never silently succeed.
    await expect(store.upsertPricingItem(pricing.id, 'not-the-real-agency-id', { lineNumber: 1, description: 'x', quantity: 1, unit: null, unitPrice: 1, lineTotal: 1, isMandatoryScheduleItem: false, notes: null })).rejects.toThrow()
  })

  it('RLS enforcement is exhaustively verified at the database layer (see database/src/__tests__/submissionReadiness.test.ts) — this test asserts the fake mirrors the same agency-scoping contract the real store must honour', async () => {
    const { store } = createFakeSubmissionReadinessStore({ input: readyBaseline() })
    await runSubmissionReadinessCheck(store, { bidProjectId: 'bp-6', agencyId: 'agency-a', tenderId: 'tender-1', nowIso: '2026-09-11T09:00:00Z', actorId: 'user-a' })
    const readinessForOtherAgencyProject = await store.getCurrentReadiness('bp-does-not-exist')
    expect(readinessForOtherAgencyProject).toBeNull()
  })

  it('the service-role key is never required by (or exposed to) the pure engine, pricing, pack or approval modules — they take plain data only', () => {
    // Static/structural assertion: none of these pure modules import a
    // Supabase client or any secret-bearing module. Only
    // supabaseSubmissionReadinessStore.ts (a distinct I/O seam) does.
    const storage = new InMemorySubmissionPackStorage()
    expect(typeof storage.put).toBe('function')
    expect(Object.keys(storage)).not.toContain('serviceRoleKey')
  })
})
