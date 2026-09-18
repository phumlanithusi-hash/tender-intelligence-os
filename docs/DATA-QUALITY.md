# Data Quality (Phase 19)

A deterministic, persisted data-quality system — the completeness
dashboard (spec §17) and the rule-based violation ledger (spec §18).
AI plays no role in either (spec §34 boundary): every number and every
rule is a real, reproducible database check.

## 1. Completeness dashboard

`GET /api/data-quality/completeness` (`apps/api/src/lib/dataQuality/
completeness.ts` — pure; `supabaseDataQualityStore.ts::
getCompletenessDashboard` — the real query layer) returns one row per
domain: TENDER, DOCUMENT, REQUIREMENT, EVALUATION, OUTCOME, EVIDENCE,
SUBMISSION. Each row carries five independent counts —
**KNOWN / UNVERIFIED / UNKNOWN / MISSING / CONFLICTING** — never
collapsed into a single percentage (spec §17 binding constraint,
enforced by a unit test asserting the returned shape has no
`percentage`/`score` field).

| Domain | KNOWN means | Source |
|---|---|---|
| TENDER | has a closing date, past discovery | `tenders` |
| DOCUMENT | extraction_status = EXTRACTED | `tender_documents` |
| REQUIREMENT | mandatory requirement has a real qualification_status | `tender_requirements` |
| EVALUATION | criterion has a recorded weight | `tender_evaluation_criteria` |
| OUTCOME | truth_status = VERIFIED | `tender_outcomes` (+ `outcome_conflicts` for CONFLICTING) |
| EVIDENCE | embedding status = READY | `agency_evidence_embeddings` |
| SUBMISSION | execution status = SUBMITTED | `bid_submission_executions` |

QUALIFICATION and "historical feature completeness" (also named in
spec §17) are intentionally not given their own completeness row this
phase: qualification completeness is already fully addressed by the
existing Qualification Engine's own status vocabulary
(`docs/QUALIFICATION-ENGINE.md`), and historical-feature completeness
is already answered, with the correct data-leakage boundary intact, by
`GET /api/intelligence/readiness` (Phase 18) — duplicating either here
would risk exactly the kind of parallel, potentially-drifting metric
this phase is trying to eliminate. Both are cross-referenced from the
Data Quality page rather than recomputed.

## 2. Violation rules (spec §18)

Nine deterministic rules (`apps/api/src/lib/dataQuality/rules.ts`,
one pure function each, unit-tested independently):

| Rule | Severity | Detects |
|---|---|---|
| `TENDER_MISSING_CLOSING_DATE` | HIGH | A live (not cancelled/withdrawn/awarded) tender with no closing date |
| `TENDER_MISSING_SOURCE_URL` | MEDIUM | A tender with no `tender_source_records` row carrying a source URL |
| `DUPLICATE_TENDER_NUMBER` | CRITICAL | Two or more tenders sharing a `tender_number` |
| `DUPLICATE_SOURCE_RECORD` | HIGH | Two or more `tender_source_records` for the same (source, external id) — defense-in-depth alongside the DB unique constraint |
| `DOCUMENT_MISSING_HASH` | MEDIUM | A document recorded as downloaded with no `file_hash` |
| `REQUIREMENT_WITHOUT_EVIDENCE` | LOW | A mandatory requirement never assessed (qualification_status still UNKNOWN) |
| `OUTCOME_WITHOUT_PROVENANCE` | HIGH | An AWARDED outcome recorded with the weakest (`OTHER`) provenance tier |
| `WINNER_WITHOUT_EVIDENCE` | CRITICAL | A recorded winner name with no linked source document AND no evidence reference |
| `BID_SUBMITTED_WITHOUT_VERIFIED_EVIDENCE` | CRITICAL | A bid marked SUBMITTED/SUBMISSION_REPORTED with no receipt that ever reached VERIFIED |

Every rule takes already-fetched rows and returns violation
candidates — zero I/O, matching this codebase's established
pure-function-plus-store-seam pattern used by every prior engine
(`lib/submissionReadiness/engine.ts`, `lib/bidDecision/*`, etc.).

## 3. Violation lifecycle

`data_quality_violations` (migration
`20260913090000_phase19_production_operations.sql`):

```
(scan detects) → OPEN → { ACKNOWLEDGED | RESOLVED | DISMISSED }
```

- A partial unique index (`rule, entity_type, entity_id`) allows only
  one OPEN violation per real problem — re-running the scan never
  creates a duplicate (spec §14 discipline extended to this action).
- The detected facts (`rule`, `entity_type`, `entity_id`, `detected_at`,
  `agency_id`) are immutable once written — a Postgres trigger rejects
  any attempt to change them; only `status`/`resolution`/`resolved_by`/
  `resolved_at` may ever change (a human closing the item).
- **The scan never auto-resolves a previously-OPEN violation that no
  longer matches a candidate.** This is a deliberate, documented choice:
  auto-closing would mean the system silently decided a real, human-
  facing problem no longer exists — spec §17/§34 keeps that a human
  decision (`POST /api/data-quality/violations/:id/resolve`), never an
  automatic one.
- Every detection, resolution, and dismissal writes an `audit_logs` row
  (`DATA_QUALITY_SCAN_RUN`, `DATA_QUALITY_VIOLATION_DETECTED`,
  `DATA_QUALITY_VIOLATION_RESOLVED`, `DATA_QUALITY_VIOLATION_DISMISSED`).

## 4. Scope and visibility

A violation's `agency_id` is `null` for shared/catalogue-level problems
(a tender-level fact, visible to every authenticated user exactly like
the underlying tender) and set to a specific agency for agency-scoped
ones (e.g. a bid-submission gap). RLS enforces this at the database
layer (`agency_id is null or agency_id = current_agency_id()`); the API
layer additionally filters server-side rather than trusting any
client-supplied scope (spec §24).

## 5. API

| Method | Path | Roles |
|---|---|---|
| POST | `/api/data-quality/scan` | ADMIN, BID_MANAGER |
| GET | `/api/data-quality/violations` | any authenticated role |
| POST | `/api/data-quality/violations/:id/resolve` | ADMIN, BID_MANAGER |
| GET | `/api/data-quality/completeness` | any authenticated role |

## 6. UI

`/data-quality` ("Data Quality" in the Operations nav section): a
completeness table (one row per domain, five columns, no percentage)
and a violations list with severity badges, a status filter, and
inline resolve/dismiss actions gated by role — a VIEWER sees the same
data with no action buttons (server-side role enforcement is the real
boundary regardless, per spec §24, and is exercised in
`apps/api/src/routes/__tests__/dataQuality.test.ts`).

## 7. Testing

- Unit: `apps/api/src/lib/dataQuality/__tests__/rules.test.ts` (15),
  `completeness.test.ts` (2).
- Database: `database/src/__tests__/productionOps.test.ts` covers the
  `data_quality_violations` half of an 11-test file (RLS, service-role-
  only writes, uniqueness, immutability, required-reason CHECK).
- Route: `apps/api/src/routes/__tests__/dataQuality.test.ts` (2).
- E2E: 11 scenarios in `tests/e2e/production-operations.spec.ts`
  (completeness display, violation list, empty state, role-gated scan
  action, scan invocation, resolve, dismiss, filter, resolved-state
  display, severity badge, VIEWER role gating).

## 8. Known limitations

- Nine rules is a deliberately-scoped subset of spec §18's "at
  minimum" list — `evaluation criterion without source` and `proposal
  referencing non-current evidence` were judged lower-value given
  current data volume and were not implemented this phase (documented
  here rather than silently dropped).
- `historical prediction feature containing post-outcome information`
  is not a data-quality *violation* row at all — it is a structural
  impossibility enforced by the `DecisionTimeFeatures` type and
  `assertNoOutcomeLeakage` (Phase 17/18, re-verified by Phase 19's own
  regression tests — see `docs/DECISIONS.md` Phase 19 entry #4).
