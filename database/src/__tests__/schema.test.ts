import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import { getTestPool, asAuthenticatedUser } from '../testHelpers.js'

const pool = getTestPool()

afterAll(async () => {
  await pool.end()
})

// ---------------------------------------------------------------
// 1. Seed data integrity — runs first, before any other describe
// block inserts fixture rows, so the counts are meaningful (Phase 2
// §26/§30 item 8: "No fake tender records are created by seed scripts").
// ---------------------------------------------------------------
describe('seed data contains no fabricated procurement data', () => {
  it('inserted reference data (provinces, services, tender sources)', async () => {
    const provinces = await pool.query('select count(*)::int as count from provinces')
    const services = await pool.query('select count(*)::int as count from services')
    const sources = await pool.query('select count(*)::int as count from tender_sources')
    expect(provinces.rows[0].count).toBe(9)
    expect(services.rows[0].count).toBeGreaterThanOrEqual(21)
    expect(sources.rows[0].count).toBeGreaterThan(0)
  })

  it('created zero tenders, agencies, requirements, or scores', async () => {
    const tables = ['tenders', 'agencies', 'tender_requirements', 'tender_scores', 'awards', 'competitors']
    for (const table of tables) {
      const result = await pool.query(`select count(*)::int as count from ${table}`)
      expect(result.rows[0].count, `${table} should be empty after seeding`).toBe(0)
    }
  })

  it('recorded sources default to inactive / manual ingestion, never claiming automated coverage', async () => {
    const result = await pool.query(
      'select active, requires_manual_ingestion from tender_sources',
    )
    for (const row of result.rows) {
      expect(row.requires_manual_ingestion).toBe(true)
    }
  })
})

// ---------------------------------------------------------------
// 2. Multi-source tender relationships (Phase 2 §30 items 1-2).
// ---------------------------------------------------------------
describe('a tender can have multiple sources, and a source can have multiple tenders', () => {
  let sourceOneId: string
  let sourceTwoId: string
  let tenderOneId: string
  let tenderTwoId: string

  beforeAll(async () => {
    const s1 = await pool.query(
      `insert into tender_sources (name, base_url, source_type, authority_level)
       values ('Test Source One', 'https://one.example', 'OFFICIAL', 'PRIMARY') returning id`,
    )
    const s2 = await pool.query(
      `insert into tender_sources (name, base_url, source_type, authority_level)
       values ('Test Source Two', 'https://two.example', 'AGGREGATOR', 'SECONDARY') returning id`,
    )
    sourceOneId = s1.rows[0].id
    sourceTwoId = s2.rows[0].id

    const t1 = await pool.query(
      `insert into tenders (title, organisation) values ('Multi-source tender', 'Org A') returning id`,
    )
    const t2 = await pool.query(
      `insert into tenders (title, organisation) values ('Second tender from source one', 'Org B') returning id`,
    )
    tenderOneId = t1.rows[0].id
    tenderTwoId = t2.rows[0].id

    // tender one appears on both sources
    await pool.query(
      `insert into tender_source_records (tender_id, source_id, external_id) values ($1, $2, 'ext-1a')`,
      [tenderOneId, sourceOneId],
    )
    await pool.query(
      `insert into tender_source_records (tender_id, source_id, external_id) values ($1, $2, 'ext-1b')`,
      [tenderOneId, sourceTwoId],
    )
    // source one also discovers a second, distinct tender
    await pool.query(
      `insert into tender_source_records (tender_id, source_id, external_id) values ($1, $2, 'ext-2a')`,
      [tenderTwoId, sourceOneId],
    )
  })

  it('one canonical tender has appearances on two different sources', async () => {
    const result = await pool.query(
      'select source_id from tender_source_records where tender_id = $1',
      [tenderOneId],
    )
    expect(result.rows).toHaveLength(2)
    const sourceIds = result.rows.map((r: { source_id: string }) => r.source_id).sort()
    expect(sourceIds).toEqual([sourceOneId, sourceTwoId].sort())
  })

  it('one source has discovered more than one distinct canonical tender', async () => {
    const result = await pool.query(
      'select distinct tender_id from tender_source_records where source_id = $1',
      [sourceOneId],
    )
    expect(result.rows).toHaveLength(2)
  })
})

// ---------------------------------------------------------------
// 3. Documents, addenda, and requirements (Phase 2 §30 items 3-4).
// ---------------------------------------------------------------
describe('a tender can have many documents and many requirements', () => {
  let tenderId: string
  let docOneId: string
  let docTwoId: string

  beforeAll(async () => {
    const t = await pool.query(
      `insert into tenders (title, organisation) values ('Document-heavy tender', 'Org C') returning id`,
    )
    tenderId = t.rows[0].id

    const d1 = await pool.query(
      `insert into tender_documents (tender_id, document_type, filename, file_hash)
       values ($1, 'TOR', 'terms-of-reference.pdf', 'hash-doc-1') returning id`,
      [tenderId],
    )
    const d2 = await pool.query(
      `insert into tender_documents (tender_id, document_type, filename, file_hash, is_addendum, is_original)
       values ($1, 'ADDENDUM', 'addendum-1.pdf', 'hash-doc-2', true, false) returning id`,
      [tenderId],
    )
    docOneId = d1.rows[0].id
    docTwoId = d2.rows[0].id

    await pool.query(
      `insert into tender_requirements (tender_id, requirement_type, requirement_text, mandatory, source_document_id)
       values ($1, 'CSD', 'Valid CSD registration required', true, $2)`,
      [tenderId, docOneId],
    )
    await pool.query(
      `insert into tender_requirements (tender_id, requirement_type, requirement_text, mandatory, source_document_id)
       values ($1, 'B_BBEE', 'B-BBEE certificate required', true, $2)`,
      [tenderId, docOneId],
    )
    await pool.query(
      `insert into tender_requirements (tender_id, requirement_type, requirement_text, mandatory)
       values ($1, 'TECHNICAL', 'Minimum 5 years experience in government print work', false)`,
      [tenderId],
    )
  })

  it('the tender has two documents, one flagged as an addendum', async () => {
    const result = await pool.query(
      'select is_addendum from tender_documents where tender_id = $1 order by is_addendum',
      [tenderId],
    )
    expect(result.rows).toHaveLength(2)
    expect(result.rows.map((r: { is_addendum: boolean }) => r.is_addendum)).toEqual([false, true])
  })

  it('the tender has three individually-traceable requirements', async () => {
    const result = await pool.query(
      'select requirement_type, source_document_id from tender_requirements where tender_id = $1',
      [tenderId],
    )
    expect(result.rows).toHaveLength(3)
    expect(result.rows.filter((r: { source_document_id: string | null }) => r.source_document_id !== null)).toHaveLength(2)
  })

  it('an addendum record links back to its document and defaults every change flag to false', async () => {
    const result = await pool.query(
      `insert into tender_addenda (tender_id, document_id, addendum_number)
       values ($1, $2, 1) returning deadline_changed, briefing_changed, requirement_changed, evaluation_changed, pricing_changed`,
      [tenderId, docTwoId],
    )
    const row = result.rows[0]
    expect(row).toEqual({
      deadline_changed: false,
      briefing_changed: false,
      requirement_changed: false,
      evaluation_changed: false,
      pricing_changed: false,
    })
  })
})

// ---------------------------------------------------------------
// 4. Evaluation criteria (Phase 2 §30 item 5).
// ---------------------------------------------------------------
describe('a tender can have multiple evaluation criteria with a non-generic weighting', () => {
  let tenderId: string

  beforeAll(async () => {
    const t = await pool.query(
      `insert into tenders (title, organisation) values ('Evaluation tender', 'Org D') returning id`,
    )
    tenderId = t.rows[0].id

    // Deliberately not the generic 80/20 split, to prove the schema
    // does not assume it (Phase 2 §11).
    await pool.query(
      `insert into tender_evaluation_criteria (tender_id, criterion, weight) values
        ($1, 'Functionality', 60),
        ($1, 'Price', 30),
        ($1, 'B-BBEE', 10)`,
      [tenderId],
    )
  })

  it('stores three criteria whose weights are not a generic 80/20 split', async () => {
    const result = await pool.query(
      'select criterion, weight from tender_evaluation_criteria where tender_id = $1 order by weight desc',
      [tenderId],
    )
    expect(result.rows).toHaveLength(3)
    expect(result.rows.map((r: { weight: string }) => Number(r.weight))).toEqual([60, 30, 10])
  })

  it('rejects a weight outside the 0-100 range', async () => {
    await expect(
      pool.query(
        `insert into tender_evaluation_criteria (tender_id, criterion, weight) values ($1, 'Invalid', 150)`,
        [tenderId],
      ),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------
// 5. Opportunity scoring — mandatory failure override (Phase 2 §30 item 7).
// ---------------------------------------------------------------
describe('a mandatory qualification failure overrides the opportunity score', () => {
  let tenderId: string
  let agencyId: string

  beforeAll(async () => {
    const t = await pool.query(
      `insert into tenders (title, organisation) values ('Scored tender', 'Org E') returning id`,
    )
    const a = await pool.query(`insert into agencies (name) values ('Scoring Test Agency') returning id`)
    tenderId = t.rows[0].id
    agencyId = a.rows[0].id
  })

  it('accepts a high numeric total forced to NO_BID when mandatory_failure is true', async () => {
    // Mirrors the master spec §22 worked example: score 94, mandatory
    // accreditation missing -> NO_BID, not a passing classification.
    const result = await pool.query(
      `insert into tender_scores (
         tender_id, agency_id, service_fit, qualification_likelihood, relevant_experience,
         functionality_potential, commercial_value, competition, time_available,
         compliance_risk, strategic_value, total_score, score_class,
         mandatory_failure, mandatory_failure_reason, scoring_version
       ) values ($1, $2, 20, 19, 15, 15, 10, 5, 5, 5, 0, 94, 'NO_BID', true, 'Mandatory accreditation missing', 'v1')
       returning score_class`,
      [tenderId, agencyId],
    )
    expect(result.rows[0].score_class).toBe('NO_BID')
  })

  it('rejects a mandatory failure classified as anything other than NO_BID', async () => {
    await expect(
      pool.query(
        `insert into tender_scores (
           tender_id, agency_id, service_fit, qualification_likelihood, relevant_experience,
           functionality_potential, commercial_value, competition, time_available,
           compliance_risk, strategic_value, total_score, score_class,
           mandatory_failure, mandatory_failure_reason, scoring_version
         ) values ($1, $2, 20, 20, 15, 15, 10, 5, 5, 5, 5, 100, 'PRIORITY_BID', true, 'Missing certificate', 'v1')`,
        [tenderId, agencyId],
      ),
    ).rejects.toThrow()
  })

  it('rejects a mandatory failure with no reason recorded', async () => {
    await expect(
      pool.query(
        `insert into tender_scores (
           tender_id, agency_id, service_fit, qualification_likelihood, relevant_experience,
           functionality_potential, commercial_value, competition, time_available,
           compliance_risk, strategic_value, total_score, score_class,
           mandatory_failure, scoring_version
         ) values ($1, $2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'NO_BID', true, 'v1')`,
        [tenderId, agencyId],
      ),
    ).rejects.toThrow()
  })

  it('accepts a normal, non-mandatory-failure score matching its numeric class', async () => {
    const result = await pool.query(
      `insert into tender_scores (
         tender_id, agency_id, service_fit, qualification_likelihood, relevant_experience,
         functionality_potential, commercial_value, competition, time_available,
         compliance_risk, strategic_value, total_score, score_class,
         mandatory_failure, scoring_version
       ) values ($1, $2, 20, 20, 15, 15, 10, 5, 5, 5, 5, 100, 'PRIORITY_BID', false, 'v1')
       returning score_class`,
      [tenderId, agencyId],
    )
    expect(result.rows[0].score_class).toBe('PRIORITY_BID')
  })
})

// ---------------------------------------------------------------
// 6. Duplicate-prevention constraints (Phase 2 §24/§30).
// ---------------------------------------------------------------
describe('duplicate prevention constraints', () => {
  it('rejects two source records with the same source_id + external_id', async () => {
    const source = await pool.query(
      `insert into tender_sources (name, base_url, source_type, authority_level)
       values ('Dedup Source', 'https://dedup.example', 'OFFICIAL', 'PRIMARY') returning id`,
    )
    const tender = await pool.query(
      `insert into tenders (title, organisation) values ('Dedup tender', 'Org F') returning id`,
    )
    await pool.query(
      `insert into tender_source_records (tender_id, source_id, external_id) values ($1, $2, 'dup-1')`,
      [tender.rows[0].id, source.rows[0].id],
    )
    await expect(
      pool.query(
        `insert into tender_source_records (tender_id, source_id, external_id) values ($1, $2, 'dup-1')`,
        [tender.rows[0].id, source.rows[0].id],
      ),
    ).rejects.toThrow()
  })

  it('rejects two tenders with the same tender_number for the same organisation', async () => {
    await pool.query(
      `insert into tenders (title, organisation, tender_number) values ('First', 'Org G', 'RFQ-001')`,
    )
    await expect(
      pool.query(
        `insert into tenders (title, organisation, tender_number) values ('Duplicate', 'Org G', 'RFQ-001')`,
      ),
    ).rejects.toThrow()
  })

  it('allows the same tender_number to be reused by a different organisation', async () => {
    await pool.query(
      `insert into tenders (title, organisation, tender_number) values ('Reused number, different org', 'Org H', 'RFQ-001')`,
    )
    const result = await pool.query(`select count(*)::int as count from tenders where tender_number = 'RFQ-001'`)
    expect(result.rows[0].count).toBe(2)
  })

  it('rejects two documents with the same file_hash on the same tender', async () => {
    const tender = await pool.query(
      `insert into tenders (title, organisation) values ('Hash dedup tender', 'Org I') returning id`,
    )
    await pool.query(
      `insert into tender_documents (tender_id, filename, file_hash) values ($1, 'a.pdf', 'same-hash')`,
      [tender.rows[0].id],
    )
    await expect(
      pool.query(
        `insert into tender_documents (tender_id, filename, file_hash) values ($1, 'b.pdf', 'same-hash')`,
        [tender.rows[0].id],
      ),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------
// 7. AI cannot mark a requirement PASS without agency evidence (Phase 2 §10).
// ---------------------------------------------------------------
describe('a requirement cannot be marked PASS without linked agency evidence', () => {
  let tenderId: string
  let agencyId: string
  let evidenceId: string

  beforeAll(async () => {
    const t = await pool.query(
      `insert into tenders (title, organisation) values ('Qualification tender', 'Org J') returning id`,
    )
    const a = await pool.query(`insert into agencies (name) values ('Evidence Test Agency') returning id`)
    tenderId = t.rows[0].id
    agencyId = a.rows[0].id

    const cs = await pool.query(
      `insert into agency_case_studies (agency_id, project) values ($1, 'Relevant government project') returning id`,
      [agencyId],
    )
    const ev = await pool.query(
      `insert into agency_evidence (agency_id, evidence_type, case_study_id) values ($1, 'CASE_STUDY', $2) returning id`,
      [agencyId, cs.rows[0].id],
    )
    evidenceId = ev.rows[0].id
  })

  it('rejects PASS with no qualification_evidence_id', async () => {
    await expect(
      pool.query(
        `insert into tender_requirements (tender_id, requirement_type, requirement_text, qualification_status)
         values ($1, 'EXPERIENCE', 'Requires 3 relevant projects', 'PASS')`,
        [tenderId],
      ),
    ).rejects.toThrow()
  })

  it('accepts PASS when a real agency_evidence row is linked', async () => {
    const result = await pool.query(
      `insert into tender_requirements (tender_id, requirement_type, requirement_text, qualification_status, qualification_evidence_id)
       values ($1, 'EXPERIENCE', 'Requires 3 relevant projects', 'PASS', $2)
       returning qualification_status`,
      [tenderId, evidenceId],
    )
    expect(result.rows[0].qualification_status).toBe('PASS')
  })

  it('defaults a new requirement to UNKNOWN, never PASS', async () => {
    const result = await pool.query(
      `insert into tender_requirements (tender_id, requirement_type, requirement_text)
       values ($1, 'FINANCIAL', 'Minimum annual turnover of R2m') returning qualification_status`,
      [tenderId],
    )
    expect(result.rows[0].qualification_status).toBe('UNKNOWN')
  })
})

// ---------------------------------------------------------------
// 8. Agency isolation under RLS (Phase 2 §30 item 6).
// ---------------------------------------------------------------
describe('agency data cannot leak between agencies under RLS', () => {
  let agencyAId: string
  let agencyBId: string
  let userAId: string
  let userBId: string

  beforeAll(async () => {
    const a = await pool.query(`insert into agencies (name) values ('RLS Agency A') returning id`)
    const b = await pool.query(`insert into agencies (name) values ('RLS Agency B') returning id`)
    agencyAId = a.rows[0].id
    agencyBId = b.rows[0].id

    const authA = await pool.query(`insert into auth.users (email) values ('a@example.test') returning id`)
    const authB = await pool.query(`insert into auth.users (email) values ('b@example.test') returning id`)
    userAId = authA.rows[0].id
    userBId = authB.rows[0].id

    await pool.query(`insert into users (id, agency_id, email) values ($1, $2, 'a@example.test')`, [userAId, agencyAId])
    await pool.query(`insert into users (id, agency_id, email) values ($1, $2, 'b@example.test')`, [userBId, agencyBId])

    await pool.query(`insert into agency_case_studies (agency_id, project) values ($1, 'Agency A secret project')`, [agencyAId])
    await pool.query(`insert into agency_case_studies (agency_id, project) values ($1, 'Agency B secret project')`, [agencyBId])
  })

  it('user A sees only Agency A case studies', async () => {
    const client = await pool.connect()
    try {
      const rows = await asAuthenticatedUser(client, userAId, async (c: pg.PoolClient) => {
        const result = await c.query('select project, agency_id from agency_case_studies')
        return result.rows
      })
      expect(rows).toHaveLength(1)
      expect(rows[0].agency_id).toBe(agencyAId)
    } finally {
      client.release()
    }
  })

  it('user B sees only Agency B case studies', async () => {
    const client = await pool.connect()
    try {
      const rows = await asAuthenticatedUser(client, userBId, async (c: pg.PoolClient) => {
        const result = await c.query('select project, agency_id from agency_case_studies')
        return result.rows
      })
      expect(rows).toHaveLength(1)
      expect(rows[0].agency_id).toBe(agencyBId)
    } finally {
      client.release()
    }
  })

  it("user A cannot insert a case study into Agency B", async () => {
    const client = await pool.connect()
    try {
      await expect(
        asAuthenticatedUser(client, userAId, async (c: pg.PoolClient) => {
          await c.query(
            `insert into agency_case_studies (agency_id, project) values ($1, 'Smuggled project')`,
            [agencyBId],
          )
        }),
      ).rejects.toThrow()
    } finally {
      client.release()
    }
  })

  it('the shared tender catalogue remains visible to every authenticated user regardless of agency', async () => {
    const t = await pool.query(`insert into tenders (title, organisation) values ('Shared catalogue tender', 'Org K') returning id`)
    const client = await pool.connect()
    try {
      const rows = await asAuthenticatedUser(client, userAId, async (c: pg.PoolClient) => {
        const result = await c.query('select id from tenders where id = $1', [t.rows[0].id])
        return result.rows
      })
      expect(rows).toHaveLength(1)
    } finally {
      client.release()
    }
  })

  // ---------------------------------------------------------------
  // Phase 3 §15/§16: watchlist and saved filters are per-user, not
  // merely per-agency — user A must not see user B's watchlist or
  // saved filters even within the SAME agency, on top of the
  // ordinary cross-agency isolation every other agency-owned table
  // already gets.
  // ---------------------------------------------------------------
  describe('watchlist and saved filters are isolated per user, not just per agency', () => {
    let userCId: string
    let tenderXId: string

    beforeAll(async () => {
      // A second user in Agency A itself, so this suite proves
      // per-user isolation is real and not an artifact of the
      // cross-agency test fixtures above.
      const authC = await pool.query(`insert into auth.users (email) values ('c@example.test') returning id`)
      userCId = authC.rows[0].id
      await pool.query(`insert into users (id, agency_id, email) values ($1, $2, 'c@example.test')`, [userCId, agencyAId])

      const t = await pool.query(`insert into tenders (title, organisation) values ('Watchlist target tender', 'Org W') returning id`)
      tenderXId = t.rows[0].id

      // Seeded directly as the superuser (bypassing RLS), the same
      // way agency_case_studies is seeded above — asAuthenticatedUser
      // always rolls back its transaction on exit (testHelpers.ts), so
      // it is the right tool for *testing* RLS-scoped queries, not for
      // durably inserting the fixtures those tests read back later.
      await pool.query(
        `insert into watchlist_items (agency_id, user_id, tender_id) values ($1, $2, $3)`,
        [agencyAId, userAId, tenderXId],
      )
      await pool.query(
        `insert into saved_filters (agency_id, user_id, name, filter) values ($1, $2, $3, $4)`,
        [agencyAId, userAId, 'Print tenders closing within 14 days', JSON.stringify({ service: 'print', closingWithinDays: 14 })],
      )
    })

    it('user A sees their own watchlist item', async () => {
      const client = await pool.connect()
      try {
        const rows = await asAuthenticatedUser(client, userAId, async (c: pg.PoolClient) => {
          const result = await c.query('select tender_id from watchlist_items')
          return result.rows
        })
        expect(rows).toHaveLength(1)
        expect(rows[0].tender_id).toBe(tenderXId)
      } finally {
        client.release()
      }
    })

    it("user C (same agency as user A) does not see user A's watchlist item", async () => {
      const client = await pool.connect()
      try {
        const rows = await asAuthenticatedUser(client, userCId, async (c: pg.PoolClient) => {
          const result = await c.query('select tender_id from watchlist_items')
          return result.rows
        })
        expect(rows).toHaveLength(0)
      } finally {
        client.release()
      }
    })

    it("user B (different agency) does not see user A's watchlist item", async () => {
      const client = await pool.connect()
      try {
        const rows = await asAuthenticatedUser(client, userBId, async (c: pg.PoolClient) => {
          const result = await c.query('select tender_id from watchlist_items')
          return result.rows
        })
        expect(rows).toHaveLength(0)
      } finally {
        client.release()
      }
    })

    it('a tender can only be watched once per user (duplicate watch is rejected)', async () => {
      const client = await pool.connect()
      try {
        await expect(
          asAuthenticatedUser(client, userAId, async (c: pg.PoolClient) => {
            await c.query(
              `insert into watchlist_items (agency_id, user_id, tender_id) values ($1, $2, $3)`,
              [agencyAId, userAId, tenderXId],
            )
          }),
        ).rejects.toThrow()
      } finally {
        client.release()
      }
    })

    it("user C (same agency as user A) does not see user A's saved filter", async () => {
      const client = await pool.connect()
      try {
        const rows = await asAuthenticatedUser(client, userCId, async (c: pg.PoolClient) => {
          const result = await c.query('select name from saved_filters')
          return result.rows
        })
        expect(rows).toHaveLength(0)
      } finally {
        client.release()
      }
    })

    it('user A can read back the saved filter definition verbatim', async () => {
      const client = await pool.connect()
      try {
        const rows = await asAuthenticatedUser(client, userAId, async (c: pg.PoolClient) => {
          const result = await c.query('select name, filter from saved_filters')
          return result.rows
        })
        expect(rows).toHaveLength(1)
        expect(rows[0].name).toBe('Print tenders closing within 14 days')
        expect(rows[0].filter).toEqual({ service: 'print', closingWithinDays: 14 })
      } finally {
        client.release()
      }
    })
  })
})

// ---------------------------------------------------------------
// Phase 4 — source registry: scan history and structured errors.
// ---------------------------------------------------------------
describe('tender_source_scans and tender_source_errors (Phase 4 §9/§10)', () => {
  let sourceId: string

  beforeAll(async () => {
    const source = await pool.query(
      `insert into tender_sources (name, base_url, source_type, authority_level)
       values ('Phase 4 Test Source', 'https://phase4.example', 'OFFICIAL', 'PRIMARY') returning id`,
    )
    sourceId = source.rows[0].id
  })

  it('a source can have a scan history row created against it', async () => {
    const result = await pool.query(
      `insert into tender_source_scans (source_id, status, records_discovered, records_processed)
       values ($1, 'SUCCESS', 10, 10) returning id, status`,
      [sourceId],
    )
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].status).toBe('SUCCESS')
  })

  it('rejects a scan referencing a non-existent source (FK enforced)', async () => {
    await expect(
      pool.query(
        `insert into tender_source_scans (source_id, status) values ($1, 'SUCCESS')`,
        ['00000000-0000-4000-8000-000000000000'],
      ),
    ).rejects.toThrow()
  })

  it('rejects negative record counts', async () => {
    await expect(
      pool.query(
        `insert into tender_source_scans (source_id, status, records_discovered) values ($1, 'SUCCESS', -1)`,
        [sourceId],
      ),
    ).rejects.toThrow()
  })

  it('deleting a source cascades to its scan history', async () => {
    const source = await pool.query(
      `insert into tender_sources (name, base_url, source_type, authority_level)
       values ('Phase 4 Cascade Source', 'https://phase4-cascade.example', 'OFFICIAL', 'PRIMARY') returning id`,
    )
    const cascadeSourceId = source.rows[0].id
    await pool.query(`insert into tender_source_scans (source_id, status) values ($1, 'FAILED')`, [cascadeSourceId])
    await pool.query('delete from tender_sources where id = $1', [cascadeSourceId])
    const scans = await pool.query('select id from tender_source_scans where source_id = $1', [cascadeSourceId])
    expect(scans.rows).toHaveLength(0)
  })

  it('a source error can reference both its source and the scan it occurred during', async () => {
    const scan = await pool.query(
      `insert into tender_source_scans (source_id, status) values ($1, 'FAILED') returning id`,
      [sourceId],
    )
    const error = await pool.query(
      `insert into tender_source_errors (source_id, scan_id, error_type, severity, message, retryable)
       values ($1, $2, 'HTTP', 'HIGH', 'Received HTTP 503 from source', true)
       returning id, error_type, scan_id`,
      [sourceId, scan.rows[0].id],
    )
    expect(error.rows[0].error_type).toBe('HTTP')
    expect(error.rows[0].scan_id).toBe(scan.rows[0].id)
  })

  it('a source error can exist without a scan (e.g. a health-check failure)', async () => {
    const error = await pool.query(
      `insert into tender_source_errors (source_id, error_type, severity, message)
       values ($1, 'AUTHENTICATION', 'CRITICAL', 'Health check failed: invalid credentials')
       returning id, scan_id`,
      [sourceId],
    )
    expect(error.rows[0].scan_id).toBeNull()
  })

  it('deleting the referenced scan sets scan_id to null rather than deleting the error (errors are never silently discarded)', async () => {
    const scan = await pool.query(
      `insert into tender_source_scans (source_id, status) values ($1, 'FAILED') returning id`,
      [sourceId],
    )
    const error = await pool.query(
      `insert into tender_source_errors (source_id, scan_id, error_type, severity, message)
       values ($1, $2, 'PARSING', 'MEDIUM', 'Could not parse listing page')
       returning id`,
      [sourceId, scan.rows[0].id],
    )
    await pool.query('delete from tender_source_scans where id = $1', [scan.rows[0].id])
    const result = await pool.query('select scan_id from tender_source_errors where id = $1', [error.rows[0].id])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].scan_id).toBeNull()
  })

  it('rejects an unresolved timestamp before the occurred_at timestamp', async () => {
    await expect(
      pool.query(
        `insert into tender_source_errors (source_id, error_type, message, occurred_at, resolved_at)
         values ($1, 'UNKNOWN', 'test', now(), now() - interval '1 hour')`,
        [sourceId],
      ),
    ).rejects.toThrow()
  })

  it('any authenticated user can read scan history and errors (shared operational transparency, no agency scoping)', async () => {
    const client = await pool.connect()
    try {
      const rows = await asAuthenticatedUser(client, '00000000-0000-4000-8000-0000000000aa', async (c: pg.PoolClient) => {
        const scans = await c.query('select id from tender_source_scans where source_id = $1', [sourceId])
        const errors = await c.query('select id from tender_source_errors where source_id = $1', [sourceId])
        return { scans: scans.rows, errors: errors.rows }
      })
      expect(rows.scans.length).toBeGreaterThan(0)
      expect(rows.errors.length).toBeGreaterThan(0)
    } finally {
      client.release()
    }
  })

  it('an authenticated user cannot write directly to scan history or errors (writes are service-role only)', async () => {
    const client = await pool.connect()
    try {
      await expect(
        asAuthenticatedUser(client, '00000000-0000-4000-8000-0000000000aa', async (c: pg.PoolClient) => {
          await c.query(`insert into tender_source_scans (source_id, status) values ($1, 'SUCCESS')`, [sourceId])
        }),
      ).rejects.toThrow()
    } finally {
      client.release()
    }
  })
})

// ---------------------------------------------------------------
// Phase 4 — tender_sources adapter columns.
// ---------------------------------------------------------------
describe('tender_sources adapter columns (Phase 4 §7)', () => {
  it('every seeded source defaults to NOT_IMPLEMENTED with no adapter key, EXCEPT eTenders (Phase 5 — a real adapter now exists for it, left CONFIGURED not ACTIVE — see docs/DECISIONS.md)', async () => {
    const result = await pool.query('select name, adapter_key, adapter_state from tender_sources')
    for (const row of result.rows) {
      if (row.name === 'eTenders (National Treasury)') {
        expect(row.adapter_key).toBe('etenders')
        expect(row.adapter_state).toBe('CONFIGURED')
        continue
      }
      expect(row.adapter_key).toBeNull()
      expect(row.adapter_state).toBe('NOT_IMPLEMENTED')
    }
  })

  it('eTenders is CONFIGURED, not ACTIVE — an adapter existing in code is not itself a claim of live-validated operation (Phase 5 §21)', async () => {
    const result = await pool.query(
      `select adapter_state from tender_sources where name = 'eTenders (National Treasury)'`,
    )
    expect(result.rows[0].adapter_state).not.toBe('ACTIVE')
    expect(result.rows[0].adapter_state).toBe('CONFIGURED')
  })

  it('adapter_state is constrained to the known enum values', async () => {
    await expect(
      pool.query(
        `insert into tender_sources (name, base_url, source_type, authority_level, adapter_state)
         values ('Bad Adapter State Source', 'https://bad.example', 'OFFICIAL', 'PRIMARY', 'MADE_UP')`,
      ),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------
// Phase 7 §20/§36: AI classification records must never leak across
// agencies, and evidence must never be linkable across tenders.
// ---------------------------------------------------------------
describe('AI classification records are isolated per agency under RLS (Phase 7 §20/§36)', () => {
  let agencyAId: string
  let agencyBId: string
  let userAId: string
  let userBId: string
  let tenderId: string
  let documentId: string
  let versionId: string
  let chunkId: string
  let runAId: string

  beforeAll(async () => {
    const a = await pool.query(`insert into agencies (name) values ('AI RLS Agency A') returning id`)
    const b = await pool.query(`insert into agencies (name) values ('AI RLS Agency B') returning id`)
    agencyAId = a.rows[0].id
    agencyBId = b.rows[0].id

    const authA = await pool.query(`insert into auth.users (email) values ('ai-a@example.test') returning id`)
    const authB = await pool.query(`insert into auth.users (email) values ('ai-b@example.test') returning id`)
    userAId = authA.rows[0].id
    userBId = authB.rows[0].id
    await pool.query(`insert into users (id, agency_id, email) values ($1, $2, 'ai-a@example.test')`, [userAId, agencyAId])
    await pool.query(`insert into users (id, agency_id, email) values ($1, $2, 'ai-b@example.test')`, [userBId, agencyBId])

    const t = await pool.query(`insert into tenders (title, organisation) values ('AI RLS tender', 'Org AI') returning id`)
    tenderId = t.rows[0].id

    const doc = await pool.query(
      `insert into tender_documents (tender_id, filename) values ($1, 'tor.pdf') returning id`,
      [tenderId],
    )
    documentId = doc.rows[0].id

    const version = await pool.query(
      `insert into tender_document_versions (document_id, tender_id, version, filename, detected_file_kind)
       values ($1, $2, 1, 'tor.pdf', 'PDF') returning id`,
      [documentId, tenderId],
    )
    versionId = version.rows[0].id

    const chunk = await pool.query(
      `insert into tender_document_chunks (document_version_id, chunk_index, page_start, page_end, text, char_count, token_estimate)
       values ($1, 0, 1, 1, 'The bidder must provide graphic design services.', 48, 12) returning id`,
      [versionId],
    )
    chunkId = chunk.rows[0].id

    const run = await pool.query(
      `insert into tender_ai_runs (tender_id, agency_id, model, prompt_version)
       values ($1, $2, 'gpt-test', 'TENDER_CLASSIFICATION_PROMPT_V1') returning id`,
      [tenderId, agencyAId],
    )
    runAId = run.rows[0].id
    await pool.query(`insert into tender_ai_runs (tender_id, agency_id, model, prompt_version) values ($1, $2, 'gpt-test', 'TENDER_CLASSIFICATION_PROMPT_V1')`, [
      tenderId,
      agencyBId,
    ])

    const classification = await pool.query(
      `insert into tender_ai_classifications (run_id, tender_id, agency_id, relevance, relevance_truth)
       values ($1, $2, $3, 'RELEVANT', 'INFERENCE') returning id`,
      [runAId, tenderId, agencyAId],
    )
    const claim = await pool.query(
      `insert into tender_ai_claims (run_id, classification_id, claim_type, claim_key, claim_text, truth, evidence_resolved)
       values ($1, $2, 'RELEVANCE', 'relevance', 'RELEVANT', 'INFERENCE', true) returning id`,
      [runAId, classification.rows[0].id],
    )
    await pool.query(
      `insert into tender_ai_evidence (claim_id, document_id, document_version_id, chunk_id, evidence_text)
       values ($1, $2, $3, $4, 'The bidder must provide graphic design services.')`,
      [claim.rows[0].id, documentId, versionId, chunkId],
    )
  })

  it('user A sees Agency A\'s AI run and user B does not', async () => {
    const client = await pool.connect()
    try {
      const asA = await asAuthenticatedUser(client, userAId, async (c: pg.PoolClient) => {
        const result = await c.query('select id from tender_ai_runs where tender_id = $1', [tenderId])
        return result.rows
      })
      expect(asA.map((r) => r.id)).toContain(runAId)

      const asB = await asAuthenticatedUser(client, userBId, async (c: pg.PoolClient) => {
        const result = await c.query('select id from tender_ai_runs where tender_id = $1', [tenderId])
        return result.rows
      })
      expect(asB.map((r) => r.id)).not.toContain(runAId)
    } finally {
      client.release()
    }
  })

  it("user B cannot see Agency A's classification, claims, or evidence", async () => {
    const client = await pool.connect()
    try {
      const rows = await asAuthenticatedUser(client, userBId, async (c: pg.PoolClient) => {
        const classifications = await c.query('select id from tender_ai_classifications where tender_id = $1', [tenderId])
        const claims = await c.query('select id from tender_ai_claims where run_id = $1', [runAId])
        const evidence = await c.query(
          `select e.id from tender_ai_evidence e join tender_ai_claims cl on cl.id = e.claim_id where cl.run_id = $1`,
          [runAId],
        )
        return { classifications: classifications.rows, claims: claims.rows, evidence: evidence.rows }
      })
      expect(rows.classifications).toHaveLength(0)
      expect(rows.claims).toHaveLength(0)
      expect(rows.evidence).toHaveLength(0)
    } finally {
      client.release()
    }
  })

  it('no authenticated-role write policy exists — a browser-scoped client cannot insert an AI run directly', async () => {
    const client = await pool.connect()
    try {
      await expect(
        asAuthenticatedUser(client, userAId, async (c: pg.PoolClient) => {
          await c.query(
            `insert into tender_ai_runs (tender_id, agency_id, model, prompt_version) values ($1, $2, 'gpt-test', 'v1')`,
            [tenderId, agencyAId],
          )
        }),
      ).rejects.toThrow()
    } finally {
      client.release()
    }
  })

  it('the database rejects an AI evidence row referencing a nonexistent chunk (FK enforced, not just app-level)', async () => {
    await expect(
      pool.query(
        `insert into tender_ai_evidence (claim_id, document_id, chunk_id, evidence_text)
         select id, $1, '00000000-0000-0000-0000-000000000000', 'x' from tender_ai_claims limit 1`,
        [documentId],
      ),
    ).rejects.toThrow()
  })

  it('at most one QUEUED/RUNNING run can exist per tender+agency at a time (idempotency guard)', async () => {
    await pool.query(`update tender_ai_runs set status = 'RUNNING' where id = $1`, [runAId])
    await expect(
      pool.query(`insert into tender_ai_runs (tender_id, agency_id, model, prompt_version) values ($1, $2, 'gpt-test', 'v1')`, [
        tenderId,
        agencyAId,
      ]),
    ).rejects.toThrow()
  })
})
