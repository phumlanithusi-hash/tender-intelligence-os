# Integration Status (Phase 19)

A single, honest reference for every external/production integration
in this system, re-verified as of Phase 19. Status vocabulary:
**LIVE** (actually exercised against a real external system in this
environment), **CONFIGURED** (the real production code path exists
and is wired, but this environment cannot reach the external
dependency to prove it end-to-end), **MOCK** (a test-only fake stands
in and is never used in the production wiring), **MANUAL** (a human
step, by design — never automated), **UNAVAILABLE**/**BLOCKED**
(cannot run here at all).

| Integration | Status | Notes |
|---|---|---|
| Supabase Postgres (all tables, RLS) | **LIVE** in this sandbox's local Postgres instance for testing; **CONFIGURED** for a real Supabase project | Every migration applies cleanly; 208/208 database tests pass against a real Postgres 16 instance. No live *Supabase-hosted* project is connected in this environment (`SUPABASE_URL` unset) — the DB layer itself is not a Supabase-specific mock, it is real Postgres + real SQL. |
| Supabase Storage (tender documents) | **CONFIGURED** | `createSupabaseDocumentStorage` is the real adapter, wired in `routes/tenderDocuments.ts`. Not **LIVE** because no real Supabase project/bucket is reachable here — see `docs/PRODUCTION-OPERATIONS.md` §2. |
| Supabase Storage (submission packs) | **MOCK-ONLY SEAM** | `SubmissionPackStoragePort`/`InMemorySubmissionPackStorage` exist for tests only; production packs reference already-stored document paths instead (no separate bucket needed — see §2 above). Corrected an inaccurate comment this phase that claimed otherwise. |
| Supabase Auth / RLS (`current_agency_id()`) | **LIVE** (locally) | Exercised by every RLS test in `database/src/__tests__/*`, including the 11 new Phase 19 tests. |
| eTenders adapter | **UNAVAILABLE IN CURRENT ENVIRONMENT** | `etenders.gov.za` is blocked by this sandbox's egress proxy — re-verified this phase. Fixture/manual transport retained; no live scan claimed. |
| OpenAI (classification, requirement extraction, embeddings) | **UNAVAILABLE IN CURRENT ENVIRONMENT** | `api.openai.com` is blocked by this sandbox's egress proxy — re-verified this phase (unchanged from Phases 7-18). All AI-dependent unit tests use the `OpenAiClient` port fake (`lib/ai/testing.ts`); `pnpm ai:smoke` remains the only code path that would call the real API, and only with a real key configured. |
| Background jobs (BullMQ/Redis) | **NOT IMPLEMENTED** (by design, this phase re-verified rather than adding) | No queue library is a dependency anywhere in `apps/api`. The fire-and-forget seam pattern (pure stage function + route-level invocation) is the intentional attachment point for a future worker. |
| Email delivery | **NOT IMPLEMENTED** | No email-sending library/integration exists. `bid_submission_executions`'s EMAIL method records the target address for a human to use; nothing sends on the system's behalf. |
| Portal submission automation | **MANUAL / MOCK-ONLY** | Real portal/email/API adapters resolve to `MANUAL_REQUIRED`/`REQUIRES_MANUAL_ACTION` in production by construction (Phase 16); six mock adapters exist for tests only, never wired into the production registry. |
| Notifications (in-app) | **LIVE** | Gap-closing round: the pre-existing but unreferenced `notifications` table is now a real inbox — `routes/notifications.ts`, `NotificationBell` UI, 4 of 10 triggers wired at real detection points, 6 covered by an on-demand check. See `docs/PRODUCTION-OPERATIONS.md` §8.1. Distinct from and in addition to `audit_logs`, which separately gained `ADDENDUM_ACKNOWLEDGED`/`DATA_QUALITY_*` event types this phase. |
| Notifications (email channel) | **NOT IMPLEMENTED** | The `channel` column models `IN_APP`/`EMAIL`; only `IN_APP` is ever written. No SMTP/email-provider dependency was introduced (no live network to any such provider in this sandbox regardless). |
| Operational health dashboard | **LIVE** | `GET /api/ops/health` computes every figure from real rows in this environment's own database at request time — see `docs/PRODUCTION-OPERATIONS.md` §4. |
| Data quality scan | **LIVE** | `POST /api/data-quality/scan` runs the nine deterministic rules against real rows and persists real violations — proven by the 11 new database tests and 2 route tests. |
| Predictive intelligence model | **INSUFFICIENT_DATA** (unchanged) | See `docs/PREDICTIVE-INTELLIGENCE.md` §22-23 and this report's §17. Phase 19 introduced no change to this status. |
| Continuous ingestion diff engine (`lib/surveillance/diffEngine.ts`) | **LIVE** | Real structural-diff logic, wired directly into `lib/ingestion/scanRunner.ts`'s existing re-scan path (the exact gap `lib/notifications/check.ts` documented as missing since Phase 2/6/19). Proven against a real Postgres instance by `apps/api/src/lib/ingestion/__tests__/ingestion.integration.test.ts`, which now asserts a `tender_addenda` row is actually created on a re-scan with a changed closing date. |
| ADDENDUM_DETECTED notification | **LIVE** (finally activated) | `lib/notifications/check.ts` always scanned `tender_addenda` for this trigger; this phase is the first to ever populate that table from a live code path, so the trigger now genuinely fires. |
| Polling scheduler (`lib/surveillance/schedule.ts`, `POST /api/surveillance/scan/:sourceId`) | **CONFIGURED, not ACTIVE** | Real, tested cadence-selection logic and a real on-demand scan-trigger endpoint exist; no live background scheduler runs (no BullMQ/Redis in this codebase, re-verified this phase) and the only registered adapter (eTenders) is kept at `adapter_state = 'CONFIGURED'` for the same egress-blocked reason as every prior phase — `selectSourcesDueForPoll` and the scan endpoint are a real seam a future queue/deployment would call, not a live poller. |
| Anonymized industry benchmarks (`lib/benchmarks/*`) | **LIVE** | `POST /api/intelligence/benchmarks/recompute` aggregates real `tender_outcomes`/`tenders` rows with a real k-anonymity floor (>= 5 distinct entities) enforced in both the pure aggregator and a DB CHECK constraint; proven by 9 unit tests and the DB constraint tests. |
| Unified audit trail (`audit_trail_events`) | **LIVE** | Real writes at 8 route-level lineage stages (SOURCE_SCAN, TENDER_IMPORT, REQUIREMENT_EXTRACTION, STRATEGY_GENERATION, EVIDENCE_MATCH, HUMAN_SIGNOFF, SUBMISSION, ADDENDUM_DETECTED, ADDENDUM_ACKNOWLEDGED, OUTCOME_RECORDED — all 10 stages), append-only and immutable at the DB layer, viewable at `/settings/audit-logs`. |

## Reproducing the "LIVE" claims above

Every "LIVE" status in this table was proven, in this exact session,
by actually running the thing:

```
service postgresql start
cd database && TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/tender_intelligence_test pnpm test
# -> 14 test files, 208 tests passed
```

No status in this table is asserted without either (a) a passing
automated test run in this environment, or (b) an explicit, honest
"blocked by this sandbox's network policy" note.
