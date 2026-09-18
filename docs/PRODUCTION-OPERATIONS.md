# Production Operations (Phase 19)

Phase 19 — Production Integration, Data Completeness & Intelligence
Operations. This document is the operational reference for what
actually runs, what is live, what is mocked/manual, and what remains
an external-dependency limitation, as of this phase.

## 1. Scope discipline

Per the Phase 19 spec's own instruction, this phase inspected the
existing repository first rather than assuming a fresh roadmap. Two
real production-readiness gaps were found and closed:

1. **Addenda acknowledgement** (spec §12) — `tender_addenda` (Phase 2)
   recorded *what* changed; nothing recorded whether a specific bid
   team had acknowledged it. `supabaseSubmissionReadinessStore.ts`
   hard-coded every addendum's acknowledgement state to `false`
   (documented Known Limitation, `docs/DECISIONS.md` #1). Closed with
   a new agency-scoped, immutable `bid_addendum_acknowledgements`
   table and `POST /api/bids/:id/addenda/:addendumId/acknowledge`.
2. **Data quality** (spec §17/§18) — no persisted, rule-based
   data-quality ledger existed anywhere. Closed with a new
   `data_quality_violations` table, nine deterministic rules
   (`apps/api/src/lib/dataQuality/rules.ts`), a completeness dashboard,
   and `/api/data-quality/*`.
3. **Operational health** (spec §16) — no single endpoint aggregated
   source/document/AI/outcome/job/storage health. Closed with
   `GET /api/ops/health` (`apps/api/src/lib/ops/*`), a live aggregation
   over tables every prior phase already built — never a fabricated
   "all green" banner.

Everything else audited in this phase (real Supabase Storage for tender
documents, source registry operational fields, outcome
provenance/reconciliation, document versioning/hashing, historical
data-leakage boundary) was found to already exist from Phases 4–18 and
is reused, not rebuilt. One inaccurate code comment was found and
corrected (see §6).

## 2. Real Supabase Storage — already implemented, re-verified

`apps/api/src/lib/documents/storage.ts::createSupabaseDocumentStorage`
is the real, production Supabase Storage adapter (private bucket,
service-role-only upload/download, signed URLs for browser access) and
is already wired into the document-ingestion pipeline
(`routes/tenderDocuments.ts`). This was not mocked before Phase 19 and
required no new implementation. What remains unavailable is *live
validation against a real Supabase project* — this sandbox has no
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` configured, so the adapter's
correctness is proven by its DB-column integration (storage_path/
file_hash round-tripping through `tender_documents`) and by code
review, not by an actual bucket upload in this environment. This is
reported honestly, not claimed as LIVE.

A second, unrelated storage seam
(`lib/submissionReadiness/pack.ts::SubmissionPackStoragePort`/
`InMemorySubmissionPackStorage`) was found to carry a comment claiming
it was wired into production Supabase Storage. That was false — no
`createSupabaseSubmissionPackStorage` exists anywhere, and the port is
only ever instantiated in tests. In practice this turned out not to be
a gap: a Submission Pack never re-uploads bytes into a second bucket —
it only references the `storage_path` of files already uploaded through
the real document-storage adapter above, or through
`bid_proposal_documents`. The comment has been corrected in place; the
port remains a tested, documented seam for a future phase that needs to
store pack-specific bytes that don't already exist as a document row
(e.g. a generated ZIP).

## 3. Source operations

The Phase 4 source-registry operational model (`tender_sources` +
`tender_source_scans` + `tender_source_errors`,
`apps/api/src/repositories/tenderSource*.ts`) already exposes every
field spec §7 asks for: adapter key/state, enabled/disabled, last/next
scan, scan duration, records discovered/imported/updated, duplicates,
failures, retry count, last success, last error, health status. Phase
19 adds nothing new here — it is surfaced again, alongside every other
domain, in the new aggregate `GET /api/ops/health` (§4) and the
Production Health page.

**eTenders live validation**: `api.openai.com` and `etenders.gov.za`
remain blocked by this sandbox's egress proxy (re-verified this phase
with a live network probe attempt — both time out / are rejected by
the proxy). Per the binding instruction carried into this phase:

> **eTenders LIVE VALIDATION: NOT AVAILABLE IN CURRENT ENVIRONMENT**

The fixture/manual transport (`apps/api/src/lib/adapters/etenders/*`,
exercised by `pnpm etenders:smoke`/`pnpm etenders:scan` against fixture
HTML) is retained unchanged; nothing here claims a live scan succeeded.

## 4. Operational health dashboard (spec §16)

`GET /api/ops/health` (`apps/api/src/lib/ops/health.ts` — pure
aggregator, zero I/O; `apps/api/src/lib/ops/supabaseOpsHealthStore.ts`
— the real query layer) returns, from real rows only:

- **Sources**: total/active/healthy/warning/failed/not-connected, last
  scan timestamp (from `tender_sources`/`tender_source_scans`).
- **Documents**: queued/processing/completed/failed/requires-review
  (from `tender_documents.extraction_status`). "Processing" is always
  0 today — no distinct in-flight extraction state exists because the
  pipeline runs synchronously in-request (§5), so nothing is ever
  observed mid-flight by a separate reader; this is stated in the UI
  and code comments, not silently hidden.
- **AI**: total/failed/requires-review runs (`tender_ai_runs`),
  embedding failures (`agency_evidence_embeddings` where
  `status = 'FAILED'`).
- **Outcomes**: verified/unknown counts (`tender_outcomes.truth_status`),
  open conflicts (`outcome_conflicts`), requires-follow-up
  (`UNVERIFIED`).
- **Jobs**: queued/running/failed `tender_source_scans` rows — the
  closest real analogue to "jobs in flight" (see §5; never mislabelled
  as a generic queue).
- **Storage**: documents with vs. without a `storage_path`.

The UI (`/ops`, "Production Health") never shows a single green "OK"
badge — every number is its own tile, and a stale/failed value is
never hidden behind an aggregate. No secret, credential, or connection
string is ever included in this payload (verified by
`apps/api/src/lib/ops/__tests__/health.test.ts`).

## 5. Background jobs & queues (spec §14)

**Audit result: no BullMQ/Redis queue exists anywhere in this
codebase, re-verified this phase** (`grep -r bullmq`/`ioredis` across
`apps/api` returns nothing outside comments). This is the same
carried-forward architectural decision documented since Phase 6/16:
every ingest/processing/submission stage is a plain, synchronous
function call inside the HTTP request or CLI script that triggers it
(the "fire-and-forget seam" pattern — a pure stage function plus a
route-level invocation, ready for a future worker to call instead of
the route handler doing it inline).

Duplicate-prevention already exists at the correct layer for every
case spec §14 names, enforced by real DB constraints rather than
job-queue deduplication:

| Entity | Duplicate-prevention mechanism |
|---|---|
| Tenders | `tender_documents_tender_hash_unique` prevents re-storing an identical document twice; `tender_source_records` unique per (source, external id) |
| Documents | content-hash uniqueness (above) plus version increment on a genuine change |
| Embeddings | `agency_evidence_embeddings` one row per (agency, entity, chunk) |
| Outcome records | `tender_outcomes_one_current_per_tender` partial unique index; corrections insert a new versioned row, never overwrite |
| Notifications | `notifications_dedup_key_unique` (partial unique index on `dedup_key`) — every builder in `lib/notifications/build.ts` derives a deterministic key from the fact it represents, so re-running a detector (or a retried request) never creates a duplicate row |
| Submission attempts | `lib/submissions/idempotency.ts` — documented as a local dedup aid only, never a claim that a real portal is itself idempotent (Phase 16 Known Limitation, unchanged) |
| Proposal versions | version increment, immutable once superseded |
| Phase 19 additions | `bid_addendum_acknowledgements_unique` (one ack per bid project + addendum); `data_quality_violations_open_unique` (one OPEN violation per rule + entity) — both partial/plain unique indexes, both re-verified by dedicated DB tests |

No new queue infrastructure (BullMQ, Kafka, etc.) was introduced —
per the spec's own "do not overbuild" instruction, and because the
existing seam pattern already gives a future worker a clean place to
attach without a schema change.

## 6. Documentation corrections made this phase

- `apps/api/src/lib/submissionReadiness/pack.ts` — removed an
  inaccurate claim that a real Supabase Storage adapter was wired for
  submission packs (see §2).

## 7. What Phase 19 did **not** attempt

Per the spec's explicit "do not overbuild" instruction and the
priority ranking in §5 of the spec, the following were consciously
left as-is this phase (all pre-existing, carried-forward limitations,
not new ones):

- Live eTenders/OpenAI validation (external network dependency, §3).
- A real EMAIL delivery channel for notifications — the extended
  `notifications` table's `channel` column already models `IN_APP` vs
  `EMAIL`, but every notification this phase creates uses `IN_APP`
  only (spec §15's 10 triggers are satisfied via the in-app inbox); no
  outbound email/SMTP dependency was introduced, consistent with "do
  not overbuild" and this sandbox's network constraints.
- Structured forms/signature extraction beyond the Phase 15
  best-effort `tender_requirements`-derived checklist (still real, but
  unchanged this phase — no additional structured extraction table was
  judged worth the schema risk against the actual data volume observed).
- Any model-governance or scoring/bid-decision/pricing rule change
  (explicitly forbidden by spec §35/§38).

See `docs/INTEGRATION-STATUS.md` for the full per-integration status
table and `docs/DATA-QUALITY.md` for the data-quality system in detail.

## 8. Gap-closing round — notifications, observability, API reliability, source operations, outcome/document evidence

The first Phase 19 pass under-delivered against several spec sections.
This section documents the concrete work done to close each one,
replacing prior assertions with file/test citations.

### 8.1 Notifications (spec §15) — now a real, wired system

The pre-existing (Phase 2) `notifications` table was completely
unreferenced by any application code (confirmed by a repo-wide grep
before starting). It is now real:

- **Migration**: `database/migrations/20260913100000_notifications_v2.sql`
  adds the 9 missing event-type enum values, `entity_type`/`entity_id`
  (generic entity link), `bid_strategy_project_id`, `dismissed_at`
  (dismiss, distinct from read), and a `dedup_key` with a partial
  unique index — plus the RLS tightening described in
  `docs/SECURITY.md`'s gap-closing audit.
- **Library**: `apps/api/src/lib/notifications/{types,build,
  supabaseNotificationStore,fanout,check}.ts` — pure builders per
  trigger (unit-tested,
  `apps/api/src/lib/notifications/__tests__/build.test.ts`, 9 tests),
  an idempotent-by-dedup-key store, a shared fan-out helper, and the
  on-demand check for time-based/derived triggers.
- **API**: `apps/api/src/routes/notifications.ts` — list, unread-count,
  read, dismiss, and an on-demand `check` action (route-tested,
  `apps/api/src/routes/__tests__/notifications.test.ts`, 10 tests).
- **UI**: `apps/web/src/components/notifications/NotificationBell.tsx`
  — a header bell with an unread badge and a dismissible inbox panel,
  wired into `AppShell` so it's reachable from every page (E2E-tested,
  `tests/e2e/production-operations.spec.ts`'s "Notification bell"
  describe block, 7 scenarios).
- **Real trigger wiring** — 4 of the 10 triggers fire from the actual
  code point where the fact is detected, not just from the on-demand
  check:
  - `OUTCOME_DETECTED` — `routes/outcomes.ts`'s `POST /api/outcomes`,
    right after `store.createTenderOutcome`.
  - `OUTCOME_CONFLICT` — the same route's conflict-detection branch,
    and `POST /api/outcomes/:id/conflicts`.
  - `OUTCOME_REQUIRES_REVIEW` — `GET /api/bids/:id/outcome`, when the
    tender is AWARDED but reconciliation still could not resolve OUR
    result (never auto-resolved — a human still decides).
  - `DOCUMENT_PROCESSING_FAILED` — `routes/tenderDocuments.ts`'s
    download and reprocess actions, whenever `processDocument`/
    `reprocessDocumentVersion` returns `success: false`.
- **On-demand check** (`POST /api/notifications/check`, mirroring the
  data-quality scan's "no scheduler exists — check on demand" pattern
  rather than introducing BullMQ/Redis) covers the remaining 6:
  `NEW_RELEVANT_TENDER` (a scoped category/province match against the
  caller's own saved filters — `saved_filters.filter` is a client-replay
  query shape, not a server-side relevance DSL, so a full
  relevance-matching engine was out of scope), `TENDER_UPDATED`,
  `BRIEFING_DEADLINE`, `TENDER_DEADLINE`, `SUBMISSION_OUTCOME_UNKNOWN`
  (reuses the existing `evaluateOutcomeFollowUp` verbatim — never a
  parallel reimplementation), and `ADDENDUM_DETECTED`.
- **Honest limitation, not glossed over**: `ADDENDUM_DETECTED` is
  scanned for by the on-demand check, but confirmed by repo-wide grep
  that no code path anywhere inserts into `tender_addenda` — addendum
  *ingestion* was never implemented as a live feature in any prior
  phase (a pre-existing Phase 2/6 gap). The moment a future phase
  wires real addendum ingestion, this notification starts firing with
  no further change needed here.
- Distinct from `audit_logs` throughout: `audit_logs` is never read
  back by a user or exposed as "read"/"dismissed" — the new
  `notifications` table is the only user-facing surface, and nothing
  in this round duplicates audit-log writes as notifications or vice
  versa.

### 8.2 Observability (spec §23)

A structured pino logger already existed
(`apps/api/src/lib/logger.ts`) with a redact list covering
`Authorization` headers, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`,
`APIFY_TOKEN`, and any `*.password`/`*.token`/`*.apiKey`/
`*.serviceRoleKey` field — re-verified by reading the file; no change
was needed there. What was missing was consistent use of it with the
specific fields spec §23 names. Added
`apps/api/src/lib/observability/requestLog.ts` (`logOperation`/
`withOperationLog`, unit-tested,
`apps/api/src/lib/observability/__tests__/requestLog.test.ts`, 4
tests) emitting `requestId, agencyId, userId, entityId, operation,
status, durationMs` and — on failure — an `errorClass` (never the raw
error object, so no accidental secret-shaped field ever gets logged;
timestamp is pino's own, added automatically). Wired into the two
highest-value existing outcome-ingestion endpoints
(`routes/outcomes.ts`'s `POST /api/outcomes` and `GET
/api/bids/:id/outcome`) and the new `POST /api/notifications/check`.
Submission execution (`routes/submissionExecution.ts`) already had a
`logger.error` call from an earlier phase — left as-is (not rewritten)
since it wasn't the focus of a real defect, but is named here as a
candidate for the same `logOperation` treatment in a future round.

### 8.3 API reliability audit (spec §24)

Audited `routes/outcomes.ts`, `routes/submissionExecution.ts`,
`routes/proposals.ts`, and `routes/intelligence.ts` for auth,
authorization, validation, pagination, idempotency, and transaction
safety, with particular attention to whether any of them trust a
frontend-supplied agency id/role/verification/approval/submission/
outcome/score/readiness status.

- **Auth/authorization**: every route file registers `requireAuth` as
  a preHandler hook and resolves `agencyId` exclusively from
  `request.user.agencyId` (server-verified via the Supabase JWT in
  `middleware/auth.js`) — confirmed by grep across all four files: not
  one reads `agencyId`/`role` from `request.body` or `request.query`.
  `GET /api/bids/:id/outcome` additionally cross-checks the loaded
  `bid_strategy_projects.agency_id` against the caller's own agency
  and 404s (not 403, to avoid confirming the record's existence to an
  unauthorized caller) on mismatch — the same IDOR-prevention pattern
  as `routes/submissionReadiness.ts::loadOwnedProject`.
  Role-gated mutations (`OUTCOME_MANAGE_ROLES`, `OUTCOME_VERIFY_ROLES`)
  are enforced via `requireRole`, never a client-supplied role flag.
- **Verification/approval/score/readiness status**: `POST
  /api/outcomes/:id/verify` computes its own evidence-presence check
  server-side (422 without `sourceUrl`/`sourceDocumentId`/
  `sourceEvidenceRef`) rather than accepting a client `verified: true`
  flag. `GET /api/bids/:id/outcome` computes `ourResult` via the pure
  `reconcileBidResult` function from server-loaded
  `outcomeStatus`/`submissionStatus`/`weAreWinner` — the client cannot
  supply or override the result. Submission readiness/scores are
  likewise always server-computed (unchanged from Phase 15/9,
  re-verified by reading `routes/submissionReadiness.ts` and
  `routes/opportunityScoring.ts`).
- **Validation**: every mutating route parses its body through a zod
  schema (`createOutcomeBody`, `conflictBody`, `lossReasonBody`, etc.)
  and returns 400 on failure — no route trusts an unvalidated body
  shape.
- **Pagination**: `GET /api/outcomes` and the proposals/intelligence
  list endpoints all take a bounded `limit` (zod `.max(100)` or
  equivalent) — none allow an unbounded full-table read.
- **Idempotency**: `bid_addendum_acknowledgements` and the new
  `notifications` table both handle a unique-constraint race by
  reading back the existing row rather than erroring (see
  `repositories/tenderAddenda.ts::acknowledgeAddendum` and
  `lib/notifications/supabaseNotificationStore.ts::create`); genuine
  submission-portal idempotency remains a documented, unresolved
  external-system limitation (`lib/submissions/idempotency.ts`'s own
  doc-comment, Phase 16, unchanged — no portal can be made idempotent
  from this side).
- **Transaction safety**: no multi-statement, non-atomic sequence was
  found doing a partial write that could leave inconsistent state
  across a failure in the four audited route files — each mutation is
  a single insert/update, or (in `POST /api/outcomes`'s conflict +
  create sequence) an intentional two-step append-only sequence where
  a conflict row and a new outcome version are each independently
  valid on their own, never require the other to exist.
- **No issue required a fix in this audit** beyond the notifications
  RLS tightening already covered in §8.1/`docs/SECURITY.md` — the
  audited routes already followed the established server-authoritative
  pattern from earlier phases.

### 8.4 Production source operations (spec §7) — field-by-field evidence

Every field spec §7 names, checked against the actual schema rather
than asserted:

| Spec §7 field | Where it lives |
|---|---|
| Adapter | `tender_sources.adapter_key` (code-registry key) + `adapter_state` enum |
| Enabled/disabled | `tender_sources.active` (+ `adapter_state` for the adapter's own operational state) |
| Last scan | `tender_sources.last_scan_at` |
| Next scan | Computed in `apps/api/src/lib/sourceSchedule.ts` from `last_scan_at + scan_frequency` — deliberately not a stored column (documented in `20260911100000_source_registry.sql`, to avoid two places it can drift) |
| Scan duration | `tender_source_scans.completed_at - started_at` per scan row |
| Records discovered/imported/updated | `tender_source_scans.records_discovered` / `records_processed` |
| Duplicates | **Was missing** — added `tender_source_scans.records_duplicate` (migration `20260913100000_notifications_v2.sql`) and wired it in `lib/ingestion/scanRunner.ts` to count discovered items that already had a `source_records` row (a re-confirmation, not a new import) |
| Failures | `tender_source_scans.records_failed` / `error_count`; `tender_source_errors` for structured per-error detail |
| Retry count | **Was missing** — added `tender_source_scans.retry_count` (same migration); currently always 0 in practice because no automatic retry loop exists yet in `scanRunner.ts` (each record failure is recorded once, not retried) — the column exists so a future retry policy has somewhere real to write, never fabricated as non-zero today |
| Last successful scan | `tender_sources.last_success_at` |
| Last error | `tender_sources.last_failure_at` + `tender_source_errors.message` (most recent row per source) |
| Health status | `tender_sources.health_status` |

Both new columns are additive to a table (`tender_source_scans`) that
is still empty in every environment (no live scanning exists yet, per
the Phase 4/5 binding constraint against live network access in this
sandbox) — a zero-risk schema change, proven safe by the full
ingestion-pipeline integration test suite
(`apps/api/src/lib/ingestion/__tests__/ingestion.integration.test.ts`,
all passing against the updated schema) plus a dedicated unit
assertion in `scanRunner.test.ts`'s existing suite.

### 8.5 Outcome ingestion (spec §9) and document versioning (spec §13) — evidence, not assertion

**Outcome ingestion** (spec §9 — source/provenance/discovery-time/
content-hash/truth-status/verification-status preservation):
`tender_outcomes` carries `source_url`, `source_document_id`,
`source_evidence_ref`, `provenance`, `truth_status`,
`recorded_by`/`recorded_at`, `verified_by`/`verified_at` — all
populated by `routes/outcomes.ts` from the request and never
defaulted to a stronger status than warranted (`truthStatus:
'UNVERIFIED'` on every create; `VERIFIED` only reachable via `POST
.../verify`, which is evidence-gated). A correction never overwrites:
`tender_outcomes_one_current_per_tender` plus `supersedes_id`/
`version` mean every prior fact stays in the table
(`database/src/__tests__/outcomes.test.ts`: "a superseding outcome
version can be recorded once the old one is marked not-current" and
"only one current tender outcome per tender"). Cross-agency isolation
is proven (`"agency B cannot read agency A bid outcome"`), and
`truth_status VERIFIED requires a verified_by/verified_at pair` is a
DB-enforced CHECK, not merely application discipline.

**Document versioning** (spec §13 — discovered → downloaded → hashed
→ versioned → extracted → analysed, no overwrite): the pipeline
(`lib/documents/pipeline.ts::processDocument`) hashes every download
(`sha256Hex`), checks `getVersionByHash` before creating a new version
row (`is_original`/`version`/`previous_version_id` chain), and never
mutates an existing version's stored file or extracted content in
place. Proven, not asserted, by
`apps/api/src/lib/documents/__tests__/pipeline.integration.test.ts`:
"is idempotent: processing the same document twice never duplicates
versions, pages, sections, or chunks", "creates a new version for a
revised document while the original remains available (Phase 6 §7)",
and "reprocesses a stored version, rebuilding chunks without
duplicating rows". No extension to either area was needed — both
already satisfy their spec section in full, and this round's changes
(the 4 new notification trigger wire-ups) touch only the routes
around these facts, never the fact-recording logic itself.
