# Build Plan — Tender Intelligence OS

Status: Phase 0. This document sequences the 21 phases from `CLAUDE_BUILD_EXECUTION.md` against the architecture in this `docs/` set, states the explicit stop conditions, and details Phase 1 to the level needed for approval.

> **Note (as of Phase 16, 2026-09-12):** the phase *numbering* below is this document's original Phase-0
> planning sequence and diverged from the actual as-built phase sequence starting around Phase 11 (extra
> phases — Bid/No-Bid Intelligence, Evidence Matching, Submission Readiness, Submission Execution — were
> inserted as the product's real requirements were discovered). "Phase 16" in this document's own numbering
> refers to a planned "Red Team" phase that has not been built; the as-built "Phase 16" (Submission
> Execution, Submission Tracking & Receipt Intelligence, described in `docs/SUBMISSION-EXECUTION.md`) is an
> unrelated, later unit of work. This document is left otherwise unmodified — it is a historical planning
> artifact, not a live phase tracker; `docs/DECISIONS.md` and `docs/TESTING.md` are the accurate as-built
> phase-by-phase record.

## 1. Repository state

Confirmed greenfield: no existing repository, code, database, or configuration. "Inspect the repository" (build execution §2) is therefore a documented no-op for this round. From Phase 1 onward, every subsequent phase begins with an actual inspection of what the prior phase produced — this is not optional and this document does not substitute for it later.

## 2. Phase sequence and hard stop conditions

The dependency order from build execution §45 is adopted as-is: Foundation → Database → Dashboard → Source Registry → Scraping → Documents → Classification → Requirements → Evaluation → Scoring → Agency Knowledge → Portfolio Matching → Bid Strategy → Bid Workspace → Proposal Generation → Red Team → Compliance → Addenda → Notifications → Awards → Competitors → Analytics.

Hard stop conditions (build execution §46, §19) — work does **not** proceed past these without explicit approval:

- **Stop after Phase 1** (Foundation) — this document's scope. Approval requested at the end of this response.
- **Stop after Phase 3** (Tender Dashboard).
- **Stop after Phase 5** (eTenders ingestion).
- **Stop after Phase 10** (Opportunity Scoring) — this is the "Tender Radar" MVP checkpoint (spec §45, build execution §19). The product must be useful here without any AI-generated proposal content.
- **Stop after Phase 16** (Red Team).

Within a phase, the execution template (build execution §48) is followed for every unit of work: PHASE / OBJECTIVE / FILES TO CHANGE / FILES TO CREATE / DEPENDENCIES / RISKS / IMPLEMENTATION / TESTS / RESULT / KNOWN ISSUES / NEXT PHASE. Every phase closes with `lint`, `typecheck`, `test`, `build` all passing before being reported as done (build execution §37) — see TESTING.md.

## 3. Phase 1 — Project Foundation (detailed)

### Objective
A clean, production-shaped application shell: no scrapers, no AI, no proposal generation, no analytics — explicitly excluded per build execution §5.

### Files to change
None — greenfield, nothing exists to change.

### Files to create (representative, not exhaustive)
```
package.json                          # workspace root
pnpm-workspace.yaml (or npm workspaces config)
tsconfig.base.json
.eslintrc.cjs / eslint.config.js
.prettierrc
.env.example
.gitignore
apps/web/                             # Vite + React + TS + Tailwind + shadcn/ui
  src/main.tsx, App.tsx
  src/layouts/AppShell.tsx
  src/pages/{Dashboard,Tenders,TenderDetail,Opportunities,Watchlist,
             Bids,BidDetail,BidStrategy,BidCompliance,BidDocuments,
             Agency,AgencyCapabilities,AgencyPortfolio,AgencyTeam,
             AgencyDocuments,Analytics,Competitors,Sources,Settings}.tsx
  src/lib/{apiClient.ts, supabaseClient.ts, queryClient.ts}
  src/components/ui/ (shadcn primitives)
  src/hooks/ (placeholder resource hooks with loading/empty/error/success states)
apps/api/
  src/server.ts (Fastify or Express bootstrap — see open decision)
  src/routes/health.ts               # GET /api/health
  src/middleware/{auth.ts, errorHandler.ts, rateLimit.ts}
  src/lib/supabaseAdmin.ts
shared/types/                         # placeholder domain types
shared/schemas/                       # placeholder Zod schemas
shared/constants/
shared/utilities/
tests/                                 # Vitest config + first smoke tests
tests/e2e/                             # Playwright config + one smoke test (app loads, nav works)
docs/DECISIONS.md                      # engineering-assumption log, per build execution §43
```

### Dependencies
Supabase project (URL + anon key + service role key) must exist before auth wiring can be tested end-to-end — this is an external prerequisite, not something Claude provisions unilaterally, since it involves an external service and credentials (build execution §43 escalation criteria: "external service selection").

### Risks
- Choosing Fastify vs Express is an architectural decision with downstream effects on the whole `apps/api` layer — flagged for approval rather than assumed (see §5 below).
- Choosing a package manager/workspace tool (npm workspaces vs pnpm) affects CI scripts; pnpm is recommended for speed and disk efficiency but either is workable.
- shadcn/ui requires a one-time CLI init that writes component files into the repo (not a runtime dependency) — this is expected and intentional, not scope creep.

### Implementation approach
1. Scaffold workspace root and shared packages first (types/schemas before anything consumes them).
2. Scaffold `apps/api` with only a health endpoint and auth middleware skeleton — proves environment variables and Supabase auth wiring work without needing any domain schema yet.
3. Scaffold `apps/web` with routing for every route in spec §9 rendering a typed empty-state placeholder page, plus the app shell/nav — proves the full route map exists before any page has real content, so navigation can be reviewed against the spec immediately.
4. Wire Supabase Auth on the frontend (login/session) against the real Supabase project, calling the `/api/health` endpoint with the session token to prove the auth boundary works end-to-end.
5. Add `lint`, `typecheck`, `test`, `build` scripts at the workspace root, fanning out to each package.
6. Add one Vitest unit test per package (smoke-level) and one Playwright E2E test (app loads, primary nav links navigate, health check succeeds).

### Tests (Phase 1 acceptance — build execution §6)
- App starts (`npm run dev` / built preview).
- Every route in §9 resolves without a runtime error (empty-state page acceptable).
- Navigation between routes works.
- Authentication foundation works (can sign in via Supabase Auth; unauthenticated access to protected routes redirects).
- Environment variables load correctly in both `apps/web` (public vars only) and `apps/api` (server-only secrets never bundled into the frontend build — verified by inspecting the built `apps/web` bundle for absence of the service role key).
- `GET /api/health` returns 200 with a body indicating DB/auth connectivity.
- `lint`, `typecheck`, `test`, `build` all pass.

### Known issues / explicit non-goals for Phase 1
No scrapers, AI agents, database schema (beyond Supabase connection), or analytics — by design (build execution §5).

### Next phase
Phase 2 — Database (schema in DATABASE.md), gated on this report being approved.

## 4. Decision log discipline

Per build execution §43, any requirement gap encountered during implementation that does **not** materially affect security, architecture, data integrity, procurement compliance, major cost, or external service selection is resolved with a documented reasonable assumption in `docs/DECISIONS.md`, not a blocking question. Anything that does affect those areas is raised explicitly — as this document already does in §5 below — rather than assumed silently.

## 5. Open decisions requiring explicit approval (raised now, before Phase 1 code)

1. **API framework**: Fastify (recommended, see ARCHITECTURE.md §5) vs Express.
2. **Package manager / workspace tool**: pnpm workspaces (recommended) vs npm workspaces vs Turborepo on top of either.
3. **Embedding model and vector dimension** for `pgvector` (affects DATABASE.md schema; only needed by Phase 6/11, but the column width decision is cheaper to make once).
4. **Supabase project provisioning**: who creates the Supabase project and supplies credentials — this cannot be assumed or fabricated, and Phase 1's auth acceptance test cannot run without it.
5. **Client-side data-fetching library** for `apps/web` (TanStack Query recommended for cache/retry/loading-state ergonomics that Phase 1's "loading/empty/error/success everywhere" requirement depends on).

None of these block writing this documentation set, but items 1, 2 and 4 block starting Phase 1 implementation; items 3 and 5 can default to the recommended option unless overridden, and will be recorded in `docs/DECISIONS.md` accordingly if no objection is raised.

## Phase 20 note

This document only ever detailed Phase 1 (§3) — no later phase's scope was ever spelled out here, so there
is no conflict between this file and the Phase 20 spec actually executed. See `CLAUDE_BUILD_EXECUTION.md`'s
end-of-file note and `docs/DECISIONS.md`'s Phase 20 section for the numbering conflict that *was* found (in
`CLAUDE_BUILD_EXECUTION.md` §29) and how it was resolved.
