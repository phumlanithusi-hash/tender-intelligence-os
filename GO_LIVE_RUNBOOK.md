# Tender Intelligence OS — Go-Live Runbook

**Purpose:** Phases 1–20 built and tested the full application inside a sandboxed development environment with no internet access to any real external system (no live Supabase project, no live eTenders, no live OpenAI). Every "LIVE" claim in the codebase's own documentation is scoped to *this sandbox's local Postgres instance and test fixtures*. This runbook is the ordered checklist for taking the system from "fully built and tested in isolation" to "actually running against real infrastructure with real data." Nothing below is code work — it is provisioning, decision-making, and verification.

Each step names what to do, why it's blocking, and what "done" looks like. Work top to bottom — later steps depend on earlier ones.

---

## Step 1 — Provision a real Supabase project

**Why this is first:** every other step needs a real database to write to. Right now `SUPABASE_URL` is unset everywhere; the 37 existing migrations have only ever been applied to a local, disposable Postgres instance inside the sandbox.

What to do:
1. Create a Supabase project (supabase.com) — decide now whether this is a single production project or you want a separate staging project first (recommended: staging first, since 37 migrations have never been applied outside this sandbox).
2. From Project Settings → API, collect three values: the project URL, the `anon` public key, and the `service_role` key.
3. From Project Settings → Storage, create the private bucket(s) the document-storage adapter expects (check `apps/api/src/lib/documents/storage.ts` for the exact bucket name it's configured to write to — the code path is real, it just needs a real bucket to point at).
4. Run the full migration set against this real project (`database/migrations/`, 37 files as of Phase 20) using Supabase's migration tooling or `psql` directly, in order, and confirm all apply cleanly — this has been proven against local Postgres 208/208 times but never against Supabase's own hosted Postgres, which has its own extensions and defaults.
5. Run the full RLS test suite against the real project, not just local Postgres, to confirm agency isolation holds identically.

**Done when:** you have a real `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`, all 37 migrations are applied, and the database test suite passes against that project.

**Where these values go:** `apps/api/.env` (server-side: URL, anon key, service role key — the service role key must never leave this file, never reach the browser, never be prefixed `VITE_`) and `apps/web/.env.local` (browser-side: URL + anon key only, prefixed `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`).

---

## Step 2 — Decide where the app actually runs

**Why this matters:** this sandbox's outbound network is proxied and blocks `etenders.gov.za` and `api.openai.com` outright. That is a property of *this development environment*, not of the code. Wherever you deploy for real needs unrestricted (or explicitly allow-listed) egress to both.

What to decide:
1. Hosting for `apps/api` (the Fastify server) — a VM, a container platform, or a PaaS. It needs to reach Supabase, OpenAI, and eTenders/other tender sources over the open internet.
2. Hosting for `apps/web` (the Vite/React frontend) — typically a static host or CDN, since it's a client-side app talking to the API over HTTPS.
3. Whether you're deploying to a single environment first (recommended: yes — don't stand up production and staging simultaneously) or a staging/production split.
4. Domain and TLS for both the API and the frontend.

**Done when:** you have a real, internet-reachable URL for the API and can `curl` `etenders.gov.za` and `api.openai.com` successfully *from that environment* (not from here).

---

## Step 3 — Get real API credentials and confirm they're never exposed

What to do:
1. Obtain a real `OPENAI_API_KEY` and confirm `OPENAI_EMBEDDING_MODEL` matches what the account has access to.
2. If eTenders scraping goes through a third-party service (check `docs/SCRAPING-ARCHITECTURE.md` and `apps/api/.env.example` — the codebase references an `APIFY_TOKEN` for scraping infrastructure), obtain that credential too.
3. Set `NODE_ENV=production` and a real `CORS_ORIGIN` (the deployed frontend's actual origin, not `localhost`).
4. Before going further, re-run the Phase 19/21 security checklist from `docs/SECURITY.md` against this real deployment specifically: confirm the service-role key isn't in any client bundle, isn't logged anywhere (check actual log output, not just the code that claims to redact it), and isn't returned in any API error response.

**Done when:** the API server boots in the real environment with all required environment variables present (there is startup validation for this — confirm it actually refuses to boot on a missing required secret rather than silently limping along), and a manual check confirms no secret appears in browser devtools, server logs, or error responses.

---

## Step 4 — Run the first real eTenders validation

**Why this is the single most-repeated open item across every phase's limitation audit:** from Phase 8 onward, every completion report has listed "eTenders adapter not live validated" as `BLOCKED BY EXTERNAL DEPENDENCY`, honestly, because this sandbox cannot reach the site. This is the first point in the project where that can actually change.

What to do:
1. With real network access, run the eTenders adapter's `discover()`, `fetchDetails()`, `fetchDocuments()`, and `healthCheck()` against the live site, per `docs/SCRAPING-ARCHITECTURE.md`.
2. Validate specifically: listing discovery, tender detail retrieval, document discovery and download, pagination, date filtering, duplicate handling, amendment/addendum handling, and rate-limit/retry behavior under real conditions — the same checklist Phase 19's spec asked for and that this sandbox could not perform.
3. Confirm the adapter respects `robots.txt`, the site's terms of service, and never attempts to bypass CAPTCHA or anti-bot controls (this is a hard legal/ethical boundary, not just a testing nicety — see `docs/SCRAPING-ARCHITECTURE.md` §3).
4. If eTenders blocks or rate-limits the adapter in ways the code doesn't yet handle gracefully, that's real information the sandbox literally could not produce — file it as a genuine bug, not a "limitation."
5. Update `docs/INTEGRATION-STATUS.md`'s eTenders row from `UNAVAILABLE IN CURRENT ENVIRONMENT` to `LIVE` (or document exactly what still doesn't work).

**Done when:** at least one real, end-to-end scan has pulled real tenders from the real eTenders site into the real database, and you can see them in the app.

---

## Step 5 — Run the first real AI validation

What to do:
1. With a real `OPENAI_API_KEY` and real network access, run `pnpm ai:smoke` (referenced throughout Phases 7–19 as the one code path that would call the real API) against the classification, requirement-extraction, and embedding pipelines.
2. Confirm token costs and latency are what you expect at whatever tender volume Step 4 produced — this is the first point where "AI run monitoring" (built in Phase 19's operational health dashboard) has real numbers to show instead of zeros.
3. Spot-check a handful of real classification/extraction outputs against the actual tender documents by hand — the automated tests only ever validated against fixtures the team wrote, not real, messy government tender language.

**Done when:** real tender documents flow through classification, requirement extraction, and evidence embedding, and the numbers on the Phase 19 operational health dashboard reflect real usage.

---

## Step 6 — Let real data accumulate before touching predictive intelligence

**Why this is a step and not an afterthought:** the Phase 18 predictive engine is deliberately, correctly stuck at `INSUFFICIENT_DATA` — it requires roughly 30+ real (non-fixture) outcome records with adequate class balance before it will even attempt training, per its own governance rules. No amount of further coding changes this; only real bid outcomes over real time do.

What to do:
1. Use the system for real: let it discover real tenders, run real qualification/scoring, and — critically — record real bid outcomes (win/loss/no-bid/withdrawn) through the Phase 17 outcome ledger as they actually happen.
2. Resist the temptation to seed the outcome ledger with synthetic or backfilled "example" data to get the predictive engine unstuck faster — every phase from 17 onward built explicit safeguards against exactly this, and bypassing them here would poison the one dataset the whole predictive layer depends on being real.
3. Periodically check `docs/PREDICTIVE-INTELLIGENCE.md`'s readiness thresholds against the real dataset size — the system will tell you honestly when it's ready.

**Done when:** enough real outcomes exist that the readiness check moves off `INSUFFICIENT_DATA` on its own — at which point Phase 18's existing model-training and calibration machinery (already built and tested) can be pointed at real data for the first time.

---

## Step 7 — Operational readiness for real users

What to do:
1. Confirm the Phase 19 operational health dashboard (`/ops`) and data-quality dashboard (`/data-quality`) are being checked regularly by someone — they were built to be looked at, not just to exist.
2. Decide on alerting: nothing in the current build pages anyone when a source starts failing or a background check turns up violations; that's a deliberate scope boundary from Phase 19 ("do not overbuild"), not an oversight, but it means a human process needs to fill the gap now.
3. Set up basic backup/disaster-recovery for the real Supabase project (point-in-time recovery, or scheduled dumps) — this was documented as a consideration in Phase 19's docs but was never something a sandboxed environment could actually configure.
4. Walk through the Phase 20 audit trail viewer (`/settings/audit-logs`) with a real bid end-to-end once one exists, to confirm the chain-of-custody story actually reads clearly to a human, not just to a test assertion.

**Done when:** someone other than the system itself is watching it, and there's a real answer to "what happens if the database is lost tomorrow."

---

## Step 8 — A second set of eyes on security

Twenty phases of self-review by the same build process is not the same as an external security review. Once there's something real to attack (a live URL, a real database, real credentials), it's worth having someone who didn't build the system attempt to break the tenant-isolation boundaries, the RLS policies, and the signed-URL/storage-access paths specifically — those are the areas every phase's own audit could only test against its own assumptions.

---

## What NOT to do

- Do not fabricate outcome data, tender data, or AI validation results to make dashboards look populated before real data exists — every phase of this build enforced that rule against itself, and it applies just as much now.
- Do not relax the predictive engine's `INSUFFICIENT_DATA` threshold to make it "work" sooner.
- Do not skip Step 1's migration dry-run against the real Supabase project — a schema that applied cleanly to local Postgres 37 times is not proof it will behave identically against Supabase-hosted Postgres.
- Do not deploy with a service-role key in any environment variable reachable by the frontend build.

---

*This document reflects the system as built through Phase 20 (`PHASE 20 COMPLETE — GREEN WITH LIMITATIONS`). It is a planning document, not a completion report — none of its steps have been executed from this environment, since none of them are things this sandbox can do.*
