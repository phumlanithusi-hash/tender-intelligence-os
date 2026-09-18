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

/** A deterministic 1536-dim vector literal so pgvector similarity queries are exercisable without a live OpenAI call. */
function vectorLiteral(fill: number): string {
  return `[${Array(1536).fill(fill).join(',')}]`
}

/**
 * Phase 13 §D/§11/§F — mirrors database/src/__tests__/bidStrategy.test.ts:
 * RLS agency isolation, service-role-only mutation, DB-enforced
 * decided-match immutability, the rejection-requires-reason CHECK, the
 * exactly-one-target CHECKs, and the agency-scoped
 * match_agency_evidence_embeddings() vector function.
 */
describe('evidence matching tables, RLS and vector search (Phase 13)', () => {
  let agencyAId: string
  let agencyBId: string
  let userAId: string
  let userBId: string
  let tenderId: string
  let decisionRunAId: string
  let bidProjectAId: string
  let needAId: string
  let documentAId: string
  let embeddingAId: string
  let matchAId: string

  beforeAll(async () => {
    const agencyA = await pool.query(`insert into agencies (name) values ('Evidence Matching Test Agency A') returning id`)
    agencyAId = agencyA.rows[0].id
    const agencyB = await pool.query(`insert into agencies (name) values ('Evidence Matching Test Agency B') returning id`)
    agencyBId = agencyB.rows[0].id

    const userA = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userAId = userA.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'ema@example.com')`, [userAId, agencyAId])
    const userB = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userBId = userB.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'emb@example.com')`, [userBId, agencyBId])

    const tender = await pool.query(`insert into tenders (title) values ('Evidence matching test tender') returning id`)
    tenderId = tender.rows[0].id

    const policyA = await pool.query(`insert into bid_policies (agency_id, name) values ($1, 'default') returning id`, [agencyAId])
    const policyVersionA = await pool.query(`insert into bid_policy_versions (policy_id, version) values ($1, 1) returning id`, [policyA.rows[0].id])
    const run = await pool.query(
      `insert into bid_decision_runs (tender_id, agency_id, status, bid_policy_version_id, system_decision, final_decision, bid_effort) values ($1, $2, 'COMPLETED', $3, 'BID', 'BID', 'LOW') returning id`,
      [tenderId, agencyAId, policyVersionA.rows[0].id],
    )
    decisionRunAId = run.rows[0].id

    const project = await pool.query(`insert into bid_strategy_projects (tender_id, agency_id, project_name, bid_decision_run_id) values ($1, $2, 'Test bid project', $3) returning id`, [tenderId, agencyAId, decisionRunAId])
    bidProjectAId = project.rows[0].id

    const need = await pool.query(`insert into bid_evidence_needs (bid_project_id, source_type, description) values ($1, 'EVALUATION_CRITERION', 'Proof of prior graphic design experience') returning id`, [bidProjectAId])
    needAId = need.rows[0].id

    const doc = await pool.query(`insert into agency_documents (agency_id, document_type, lifecycle_status) values ($1, 'CSD_CERTIFICATE', 'VALID') returning id`, [agencyAId])
    documentAId = doc.rows[0].id

    const embedding = await pool.query(
      `insert into agency_evidence_embeddings (agency_id, entity_type, document_evidence_id, status, content_hash, embedding, embedding_model, embedded_at) values ($1, 'AGENCY_DOCUMENT', $2, 'READY', 'hash-1', $3::vector, 'text-embedding-3-small', now()) returning id`,
      [agencyAId, documentAId, vectorLiteral(0.1)],
    )
    embeddingAId = embedding.rows[0].id

    const match = await pool.query(
      `insert into bid_evidence_matches (bid_project_id, agency_id, evidence_need_id, candidate_entity_type, candidate_embedding_id, document_evidence_id, status, semantic_score)
       values ($1, $2, $3, 'AGENCY_DOCUMENT', $4, $5, 'CANDIDATE', 0.82) returning id`,
      [bidProjectAId, agencyAId, needAId, embeddingAId, documentAId],
    )
    matchAId = match.rows[0].id
  })

  it('agency A can read its own embeddings and matches under RLS', async () => {
    await withUser(userAId, async (c) => {
      expect((await c.query('select id from agency_evidence_embeddings where id = $1', [embeddingAId])).rows).toHaveLength(1)
      expect((await c.query('select id from bid_evidence_matches where id = $1', [matchAId])).rows).toHaveLength(1)
    })
  })

  it('agency B cannot read agency A embeddings or matches (cross-tenant isolation)', async () => {
    await withUser(userBId, async (c) => {
      expect((await c.query('select id from agency_evidence_embeddings where id = $1', [embeddingAId])).rows).toHaveLength(0)
      expect((await c.query('select id from bid_evidence_matches where id = $1', [matchAId])).rows).toHaveLength(0)
    })
  })

  it('the authenticated role cannot write evidence matching tables directly (service-role only)', async () => {
    await withUser(userAId, async (c) => {
      await expect(c.query(`insert into bid_evidence_matches (bid_project_id, agency_id, evidence_need_id, candidate_entity_type, document_evidence_id) values ($1, $2, $3, 'AGENCY_DOCUMENT', $4)`, [bidProjectAId, agencyAId, needAId, documentAId])).rejects.toThrow()
    })
  })

  it('match_agency_evidence_embeddings() only ever returns rows for the requested agency (never a cross-tenant scan)', async () => {
    const otherDoc = await pool.query(`insert into agency_documents (agency_id, document_type, lifecycle_status) values ($1, 'CSD_CERTIFICATE', 'VALID') returning id`, [agencyBId])
    await pool.query(`insert into agency_evidence_embeddings (agency_id, entity_type, document_evidence_id, status, content_hash, embedding, embedding_model, embedded_at) values ($1, 'AGENCY_DOCUMENT', $2, 'READY', 'hash-b', $3::vector, 'text-embedding-3-small', now())`, [
      agencyBId,
      otherDoc.rows[0].id,
      vectorLiteral(0.1),
    ])

    const resultForA = await pool.query(`select document_evidence_id, similarity from match_agency_evidence_embeddings($1, $2::vector, 10)`, [agencyAId, vectorLiteral(0.1)])
    expect(resultForA.rows.map((r) => r.document_evidence_id)).toEqual([documentAId])
    expect(Number(resultForA.rows[0].similarity)).toBeCloseTo(1, 5)

    const resultForB = await pool.query(`select document_evidence_id from match_agency_evidence_embeddings($1, $2::vector, 10)`, [agencyBId, vectorLiteral(0.1)])
    expect(resultForB.rows.map((r) => r.document_evidence_id)).toEqual([otherDoc.rows[0].id])
  })

  it('an embedding row cannot be READY with a null vector (vector-matches-status CHECK)', async () => {
    await expect(pool.query(`insert into agency_evidence_embeddings (agency_id, entity_type, document_evidence_id, status) values ($1, 'AGENCY_DOCUMENT', $2, 'READY')`, [agencyAId, documentAId])).rejects.toThrow()
  })

  it('a match cannot target more than one (or zero) evidence entities (exactly-one-target CHECK)', async () => {
    await expect(
      pool.query(`insert into bid_evidence_matches (bid_project_id, agency_id, evidence_need_id, candidate_entity_type, document_evidence_id, certificate_evidence_id) values ($1, $2, $3, 'AGENCY_DOCUMENT', $4, $4)`, [bidProjectAId, agencyAId, needAId, documentAId]),
    ).rejects.toThrow()
  })

  it('a REJECTED match cannot be written without a rejection reason (mirrors bid_questions answer/answer_source CHECK)', async () => {
    await expect(
      pool.query(`insert into bid_evidence_matches (bid_project_id, agency_id, evidence_need_id, candidate_entity_type, document_evidence_id, status, decided_by, decided_at) values ($1, $2, $3, 'AGENCY_DOCUMENT', $4, 'REJECTED', $5, now())`, [
        bidProjectAId,
        agencyAId,
        needAId,
        documentAId,
        userAId,
      ]),
    ).rejects.toThrow()
  })

  it('an APPROVED match is immutable at the DB level once decided', async () => {
    await pool.query(`update bid_evidence_matches set status = 'APPROVED', decided_by = $2, decided_at = now() where id = $1`, [matchAId, userAId])
    await expect(pool.query(`update bid_evidence_matches set semantic_score = 0.99 where id = $1`, [matchAId])).rejects.toThrow(/immutable/)
  })

  it('superseding a decided match (a fresh re-evaluation row, old row -> SUPERSEDED/not current) is allowed', async () => {
    const superseded = await pool.query(`update bid_evidence_matches set status = 'SUPERSEDED', is_current = false where id = $1 returning status, is_current`, [matchAId])
    expect(superseded.rows[0].status).toBe('SUPERSEDED')
    expect(superseded.rows[0].is_current).toBe(false)

    const fresh = await pool.query(
      `insert into bid_evidence_matches (bid_project_id, agency_id, evidence_need_id, candidate_entity_type, document_evidence_id, status, supersedes_match_id) values ($1, $2, $3, 'AGENCY_DOCUMENT', $4, 'CANDIDATE', $5) returning id`,
      [bidProjectAId, agencyAId, needAId, documentAId, matchAId],
    )
    expect(fresh.rows).toHaveLength(1)
  })

  it('an approved claim can be inserted for the decided match, and a second active claim for the same need is rejected (active-per-need unique index)', async () => {
    const claim = await pool.query(`insert into bid_evidence_claims (bid_project_id, agency_id, evidence_need_id, match_id, candidate_entity_type, document_evidence_id, approved_by) values ($1, $2, $3, $4, 'AGENCY_DOCUMENT', $5, $6) returning id`, [
      bidProjectAId,
      agencyAId,
      needAId,
      matchAId,
      documentAId,
      userAId,
    ])
    expect(claim.rows).toHaveLength(1)

    await expect(
      pool.query(`insert into bid_evidence_claims (bid_project_id, agency_id, evidence_need_id, match_id, candidate_entity_type, document_evidence_id, approved_by) values ($1, $2, $3, $4, 'AGENCY_DOCUMENT', $5, $6)`, [
        bidProjectAId,
        agencyAId,
        needAId,
        matchAId,
        documentAId,
        userAId,
      ]),
    ).rejects.toThrow()
  })

  it('a revoked claim frees the need up for a new active claim', async () => {
    await pool.query(`update bid_evidence_claims set revoked_at = now(), revoked_by = $2, revoked_reason = 'test revoke' where evidence_need_id = $1`, [needAId, userAId])
    const claim = await pool.query(`insert into bid_evidence_claims (bid_project_id, agency_id, evidence_need_id, match_id, candidate_entity_type, document_evidence_id, approved_by) values ($1, $2, $3, $4, 'AGENCY_DOCUMENT', $5, $6) returning id`, [
      bidProjectAId,
      agencyAId,
      needAId,
      matchAId,
      documentAId,
      userAId,
    ])
    expect(claim.rows).toHaveLength(1)
  })

  it('a revoked claim cannot be written without a revoked_reason', async () => {
    await expect(
      pool.query(`insert into bid_evidence_claims (bid_project_id, agency_id, evidence_need_id, match_id, candidate_entity_type, document_evidence_id, approved_by, revoked_at) values ($1, $2, $3, $4, 'AGENCY_DOCUMENT', $5, $6, now())`, [
        bidProjectAId,
        agencyAId,
        needAId,
        matchAId,
        documentAId,
        userAId,
      ]),
    ).rejects.toThrow()
  })

  it('a malformed embedding id is rejected as an invalid UUID, never silently matched', async () => {
    await withUser(userAId, async (c) => {
      await expect(c.query(`select id from agency_evidence_embeddings where id = $1`, ["'; drop table agency_evidence_embeddings; --"])).rejects.toThrow()
    })
  })
})
