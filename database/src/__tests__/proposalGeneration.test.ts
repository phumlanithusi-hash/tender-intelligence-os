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
 * Phase 14 — mirrors database/src/__tests__/evidenceMatching.test.ts /
 * bidStrategy.test.ts: RLS agency isolation, service-role-only
 * mutation, DB-enforced immutability of decided/approved rows,
 * required-reason CHECKs, exactly-one-target-style CHECKs, and the
 * cross-agency/cross-tender integrity triggers unique to Phase 14
 * (§34 "database integrity").
 */
describe('proposal generation tables, RLS and integrity (Phase 14)', () => {
  let agencyAId: string
  let agencyBId: string
  let userAId: string
  let userBId: string
  let tenderId: string
  let decisionRunAId: string
  let bidProjectAId: string
  let requirementId: string
  let criterionId: string
  let proposalId: string
  let versionId: string
  let sectionId: string
  let documentAId: string
  let embeddingAId: string
  let matchId: string
  let claimId: string

  beforeAll(async () => {
    const agencyA = await pool.query(`insert into agencies (name) values ('Proposal Test Agency A') returning id`)
    agencyAId = agencyA.rows[0].id
    const agencyB = await pool.query(`insert into agencies (name) values ('Proposal Test Agency B') returning id`)
    agencyBId = agencyB.rows[0].id

    const userA = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userAId = userA.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'propa@example.com')`, [userAId, agencyAId])
    const userB = await pool.query(`insert into auth.users (id) values (gen_random_uuid()) returning id`)
    userBId = userB.rows[0].id
    await pool.query(`insert into users (id, agency_id, role, email) values ($1, $2, 'ADMIN', 'propb@example.com')`, [userBId, agencyBId])

    const tender = await pool.query(`insert into tenders (title) values ('Proposal generation test tender') returning id`)
    tenderId = tender.rows[0].id

    const requirement = await pool.query(`insert into tender_requirements (tender_id, requirement_type, requirement_text, mandatory) values ($1, 'ELIGIBILITY', 'Must hold a valid tax clearance', true) returning id`, [tenderId])
    requirementId = requirement.rows[0].id

    const criterion = await pool.query(`insert into tender_evaluation_criteria (tender_id, criterion, weight) values ($1, 'Technical approach', 40) returning id`, [tenderId])
    criterionId = criterion.rows[0].id

    const policyA = await pool.query(`insert into bid_policies (agency_id, name) values ($1, 'default') returning id`, [agencyAId])
    const policyVersionA = await pool.query(`insert into bid_policy_versions (policy_id, version) values ($1, 1) returning id`, [policyA.rows[0].id])
    const run = await pool.query(
      `insert into bid_decision_runs (tender_id, agency_id, status, bid_policy_version_id, system_decision, final_decision, bid_effort) values ($1, $2, 'COMPLETED', $3, 'BID', 'BID', 'LOW') returning id`,
      [tenderId, agencyAId, policyVersionA.rows[0].id],
    )
    decisionRunAId = run.rows[0].id

    const project = await pool.query(`insert into bid_strategy_projects (tender_id, agency_id, project_name, bid_decision_run_id) values ($1, $2, 'Test bid project', $3) returning id`, [tenderId, agencyAId, decisionRunAId])
    bidProjectAId = project.rows[0].id

    const proposal = await pool.query(`insert into bid_proposals (bid_project_id, tender_id, agency_id) values ($1, $2, $3) returning id`, [bidProjectAId, tenderId, agencyAId])
    proposalId = proposal.rows[0].id

    const version = await pool.query(`insert into bid_proposal_versions (proposal_id, agency_id, version) values ($1, $2, 1) returning id`, [proposalId, agencyAId])
    versionId = version.rows[0].id

    const section = await pool.query(
      `insert into bid_proposal_sections (proposal_version_id, agency_id, section_key, section_type, title) values ($1, $2, 'executive_summary', 'EXECUTIVE_SUMMARY', 'Executive Summary') returning id`,
      [versionId, agencyAId],
    )
    sectionId = section.rows[0].id

    const doc = await pool.query(`insert into agency_documents (agency_id, document_type, lifecycle_status) values ($1, 'CSD_CERTIFICATE', 'VALID') returning id`, [agencyAId])
    documentAId = doc.rows[0].id

    const embedding = await pool.query(
      `insert into agency_evidence_embeddings (agency_id, entity_type, document_evidence_id, status, content_hash, embedding, embedding_model, embedded_at) values ($1, 'AGENCY_DOCUMENT', $2, 'READY', 'hash-1', $3::vector, 'text-embedding-3-small', now()) returning id`,
      [agencyAId, documentAId, `[${Array(1536).fill(0.1).join(',')}]`],
    )
    embeddingAId = embedding.rows[0].id

    const need = await pool.query(`insert into bid_evidence_needs (bid_project_id, source_type, description) values ($1, 'EVALUATION_CRITERION', 'Proof of tax compliance') returning id`, [bidProjectAId])
    const match = await pool.query(
      `insert into bid_evidence_matches (bid_project_id, agency_id, evidence_need_id, candidate_entity_type, candidate_embedding_id, document_evidence_id, status, semantic_score, decided_by, decided_at)
       values ($1, $2, $3, 'AGENCY_DOCUMENT', $4, $5, 'APPROVED', 0.9, $6, now()) returning id`,
      [bidProjectAId, agencyAId, need.rows[0].id, embeddingAId, documentAId, userAId],
    )
    matchId = match.rows[0].id

    const claim = await pool.query(
      `insert into bid_evidence_claims (bid_project_id, agency_id, evidence_need_id, match_id, candidate_entity_type, document_evidence_id, approved_by) values ($1, $2, $3, $4, 'AGENCY_DOCUMENT', $5, $6) returning id`,
      [bidProjectAId, agencyAId, need.rows[0].id, matchId, documentAId, userAId],
    )
    claimId = claim.rows[0].id
  })

  it('agency A can read its own proposal, version and section under RLS', async () => {
    await withUser(userAId, async (c) => {
      expect((await c.query('select id from bid_proposals where id = $1', [proposalId])).rows).toHaveLength(1)
      expect((await c.query('select id from bid_proposal_versions where id = $1', [versionId])).rows).toHaveLength(1)
      expect((await c.query('select id from bid_proposal_sections where id = $1', [sectionId])).rows).toHaveLength(1)
    })
  })

  it('agency B cannot read agency A proposal data (cross-tenant isolation)', async () => {
    await withUser(userBId, async (c) => {
      expect((await c.query('select id from bid_proposals where id = $1', [proposalId])).rows).toHaveLength(0)
      expect((await c.query('select id from bid_proposal_sections where id = $1', [sectionId])).rows).toHaveLength(0)
    })
  })

  it('the authenticated role cannot write proposal tables directly (service-role only)', async () => {
    await withUser(userAId, async (c) => {
      await expect(
        c.query(`insert into bid_proposals (bid_project_id, tender_id, agency_id) values ($1, $2, $3)`, [bidProjectAId, tenderId, agencyAId]),
      ).rejects.toThrow()
    })
  })

  it('only one proposal per bid project is allowed', async () => {
    await expect(pool.query(`insert into bid_proposals (bid_project_id, tender_id, agency_id) values ($1, $2, $3)`, [bidProjectAId, tenderId, agencyAId])).rejects.toThrow()
  })

  it('a section cannot be created under an agency that does not match its proposal (cross-agency guard)', async () => {
    await expect(
      pool.query(`insert into bid_proposal_sections (proposal_version_id, agency_id, section_key, section_type, title) values ($1, $2, 'team', 'TEAM', 'Team')`, [versionId, agencyBId]),
    ).rejects.toThrow()
  })

  it('a requirement link cannot reference a requirement from a different tender', async () => {
    const otherTender = await pool.query(`insert into tenders (title) values ('Other tender') returning id`)
    const otherRequirement = await pool.query(`insert into tender_requirements (tender_id, requirement_type, requirement_text, mandatory) values ($1, 'ELIGIBILITY', 'Other', false) returning id`, [otherTender.rows[0].id])
    await expect(
      pool.query(`insert into bid_proposal_requirement_links (section_id, tender_requirement_id, coverage_status) values ($1, $2, 'COVERED')`, [sectionId, otherRequirement.rows[0].id]),
    ).rejects.toThrow()
  })

  it('a valid requirement link for the same tender is accepted', async () => {
    const link = await pool.query(`insert into bid_proposal_requirement_links (section_id, tender_requirement_id, coverage_status) values ($1, $2, 'COVERED') returning id`, [sectionId, requirementId])
    expect(link.rows).toHaveLength(1)
  })

  it('an evaluation link cannot reference a criterion from a different tender', async () => {
    const otherTender = await pool.query(`insert into tenders (title) values ('Other tender 2') returning id`)
    const otherCriterion = await pool.query(`insert into tender_evaluation_criteria (tender_id, criterion) values ($1, 'Other') returning id`, [otherTender.rows[0].id])
    await expect(
      pool.query(`insert into bid_proposal_evaluation_links (section_id, evaluation_criterion_id, coverage_status) values ($1, $2, 'COVERED')`, [sectionId, otherCriterion.rows[0].id]),
    ).rejects.toThrow()
  })

  it('a valid evaluation link for the same tender is accepted', async () => {
    const link = await pool.query(`insert into bid_proposal_evaluation_links (section_id, evaluation_criterion_id, coverage_status) values ($1, $2, 'PARTIAL') returning id`, [sectionId, criterionId])
    expect(link.rows).toHaveLength(1)
  })

  it('a claim marked SUPPORTED without an evidence_claim_id is rejected (supported-requires-evidence CHECK)', async () => {
    await expect(
      pool.query(`insert into bid_proposal_claims (section_id, claim_text, support_status) values ($1, 'We have delivered 10 similar projects.', 'SUPPORTED')`, [sectionId]),
    ).rejects.toThrow()
  })

  it('a claim citing a cross-agency evidence claim is rejected', async () => {
    // Build a fully independent Agency B evidence claim, then attempt
    // to cite it from Agency A's section — the
    // check_proposal_claim_evidence_agency_matches trigger must block it.
    const policyB = await pool.query(`insert into bid_policies (agency_id, name) values ($1, 'default') returning id`, [agencyBId])
    const policyVersionB = await pool.query(`insert into bid_policy_versions (policy_id, version) values ($1, 1) returning id`, [policyB.rows[0].id])
    const runB = await pool.query(
      `insert into bid_decision_runs (tender_id, agency_id, status, bid_policy_version_id, system_decision, final_decision, bid_effort) values ($1, $2, 'COMPLETED', $3, 'BID', 'BID', 'LOW') returning id`,
      [tenderId, agencyBId, policyVersionB.rows[0].id],
    )
    const projectB = await pool.query(`insert into bid_strategy_projects (tender_id, agency_id, project_name, bid_decision_run_id) values ($1, $2, 'Agency B project', $3) returning id`, [tenderId, agencyBId, runB.rows[0].id])
    const needB = await pool.query(`insert into bid_evidence_needs (bid_project_id, source_type, description) values ($1, 'EVALUATION_CRITERION', 'B need') returning id`, [projectB.rows[0].id])
    const docB = await pool.query(`insert into agency_documents (agency_id, document_type, lifecycle_status) values ($1, 'CSD_CERTIFICATE', 'VALID') returning id`, [agencyBId])
    const embeddingB = await pool.query(
      `insert into agency_evidence_embeddings (agency_id, entity_type, document_evidence_id, status, content_hash, embedding, embedding_model, embedded_at) values ($1, 'AGENCY_DOCUMENT', $2, 'READY', 'hash-b', $3::vector, 'text-embedding-3-small', now()) returning id`,
      [agencyBId, docB.rows[0].id, `[${Array(1536).fill(0.2).join(',')}]`],
    )
    const matchB = await pool.query(
      `insert into bid_evidence_matches (bid_project_id, agency_id, evidence_need_id, candidate_entity_type, candidate_embedding_id, document_evidence_id, status, decided_by, decided_at)
       values ($1, $2, $3, 'AGENCY_DOCUMENT', $4, $5, 'APPROVED', $6, now()) returning id`,
      [projectB.rows[0].id, agencyBId, needB.rows[0].id, embeddingB.rows[0].id, docB.rows[0].id, userBId],
    )
    const claimB = await pool.query(
      `insert into bid_evidence_claims (bid_project_id, agency_id, evidence_need_id, match_id, candidate_entity_type, document_evidence_id, approved_by) values ($1, $2, $3, $4, 'AGENCY_DOCUMENT', $5, $6) returning id`,
      [projectB.rows[0].id, agencyBId, needB.rows[0].id, matchB.rows[0].id, docB.rows[0].id, userBId],
    )

    await expect(
      pool.query(`insert into bid_proposal_claims (section_id, claim_text, support_status, evidence_claim_id) values ($1, 'Cross-agency claim attempt.', 'SUPPORTED', $2)`, [sectionId, claimB.rows[0].id]),
    ).rejects.toThrow(/cross-agency/)
  })

  it('citing agency A own approved evidence claim from an agency A section is accepted', async () => {
    const accepted = await pool.query(`insert into bid_proposal_claims (section_id, claim_text, support_status, evidence_claim_id) values ($1, 'Tax compliant.', 'SUPPORTED', $2) returning id`, [sectionId, claimId])
    expect(accepted.rows).toHaveLength(1)
  })

  it('a claim with only PARTIALLY_SUPPORTED and a real evidence claim is accepted', async () => {
    const claim = await pool.query(`insert into bid_proposal_claims (section_id, claim_text, support_status, evidence_claim_id) values ($1, 'We have some relevant experience.', 'PARTIALLY_SUPPORTED', $2) returning id`, [sectionId, claimId])
    expect(claim.rows).toHaveLength(1)
  })

  it('a review action of REJECTED without a reason is rejected (reject-requires-reason CHECK)', async () => {
    await expect(pool.query(`insert into bid_proposal_reviews (section_id, reviewer_id, action) values ($1, $2, 'REJECTED')`, [sectionId, userAId])).rejects.toThrow()
  })

  it('a review action of REJECTED with a reason is accepted', async () => {
    const review = await pool.query(`insert into bid_proposal_reviews (section_id, reviewer_id, action, reason) values ($1, $2, 'REJECTED', 'Missing named project manager') returning id`, [sectionId, userAId])
    expect(review.rows).toHaveLength(1)
  })

  it('an APPROVED_INTERNAL section has frozen identity fields (title/objective/section_type)', async () => {
    await pool.query(`update bid_proposal_sections set status = 'APPROVED_INTERNAL' where id = $1`, [sectionId])
    await expect(pool.query(`update bid_proposal_sections set title = 'Renamed' where id = $1`, [sectionId])).rejects.toThrow(/frozen/)
  })

  it('blocks under an APPROVED_INTERNAL section cannot be inserted-then-mutated, nor deleted', async () => {
    const block = await pool.query(`insert into bid_proposal_blocks (section_id, block_type, content) values ($1, 'PARAGRAPH', '{"text":"Hello"}'::jsonb) returning id`, [sectionId])
    await expect(pool.query(`update bid_proposal_blocks set content = '{"text":"changed"}'::jsonb where id = $1`, [block.rows[0].id])).rejects.toThrow(/APPROVED_INTERNAL/)
    await expect(pool.query(`delete from bid_proposal_blocks where id = $1`, [block.rows[0].id])).rejects.toThrow(/APPROVED_INTERNAL/)
  })

  it('rejecting the section allows block mutation again', async () => {
    await pool.query(`update bid_proposal_sections set status = 'REJECTED' where id = $1`, [sectionId])
    const block = await pool.query(`select id from bid_proposal_blocks where section_id = $1 limit 1`, [sectionId])
    await expect(pool.query(`update bid_proposal_blocks set content = '{"text":"changed"}'::jsonb where id = $1`, [block.rows[0].id])).resolves.toBeDefined()
  })

  it('a malformed section id is rejected as an invalid UUID, never silently matched', async () => {
    await withUser(userAId, async (c) => {
      await expect(c.query(`select id from bid_proposal_sections where id = $1`, ["'; drop table bid_proposal_sections; --"])).rejects.toThrow()
    })
  })
})
