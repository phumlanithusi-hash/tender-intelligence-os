# Architecture — Tender Intelligence OS

Status: Phase 0 (pre-implementation) design document
Scope: system-wide architecture. See DATABASE.md, AI-ARCHITECTURE.md, SCRAPING-ARCHITECTURE.md, SECURITY.md and TESTING.md for subsystem detail.

## 0. Repository state at time of writing

This is a **greenfield project**. There is no existing repository, package.json, source tree, environment configuration, database, routes, components or tests to inspect or reuse (confirmed with the product owner on 2026-09-10). Every statement below is therefore a *proposal* to be approved before Phase 1 begins, not a description of something already running. Where the build execution instructions ask Claude to "inspect the repository," that step is a documented no-op for this project until Phase 1 creates the first files — from that point on, every later phase must actually re-inspect what Phase 1..N-1 produced before extending it.

## 1. Product framing

Tender Intelligence OS is a procurement intelligence system with AI-assisted components, not an AI product with procurement flavor. The architecture exists to serve nine priorities, in this order, whenever a trade-off appears: accuracy, procurement compliance, traceability, evidence, reliability, security, maintainability, explainability, human review — with automation last. Concretely, this means:

- Every non-deterministic (AI-derived) value in the system carries a provenance label (`FACT` / `INFERENCE` / `RECOMMENDATION`, or `VERIFIED` / `INFERRED` / `UNVERIFIED` / `UNKNOWN` for data fields — see AI-ARCHITECTURE.md §2). The UI and API never erase this label; it travels with the value.
- Scoring and compliance gating are deterministic application code. AI supplies evidence and candidate values; it never writes a final score or a READY/BLOCKED state directly.
- Nothing is deleted; state changes are appended to history tables so any decision can be reconstructed later (audit requirement, see SECURITY.md).

## 2. High-level system diagram

```mermaid
flowchart LR
  subgraph Sources["External Tender Sources"]
    ET[eTenders Portal]
    TR[National Treasury]
    MUN[Municipalities / SOEs]
    AGG[Aggregators]
  end

  subgraph Scraping["Scraping Layer"]
    SA[Source Adapters]
    DW[Discovery Workers]
    HM[Health Monitor]
  end

  subgraph Docs["Document Processing"]
    DL[Download + Hash]
    EX[Extraction: PDF/DOCX/XLSX/PPTX/HTML]
    OCR[OCR]
    CH[Chunk + Embed]
  end

  subgraph Data["Database (Postgres / Supabase)"]
    TDB[(Tenders + Requirements + Evaluation)]
    ADB[(Agency Knowledge Base)]
    VDB[(pgvector embeddings)]
    AUD[(Audit Log)]
  end

  subgraph AI["AI Agent Layer"]
    CLS[Classification Agent]
    REQ[Requirement Agent]
    EVAL[Evaluation Agent]
    SCORE[Scoring support]
    STRAT[Strategy Agent]
    PORT[Portfolio Matcher]
    WRITE[Bid Writer]
    RED[Red Team Agent]
    COMP[Compliance Agent]
  end

  subgraph App["Application Layer (deterministic)"]
    SCORER[Opportunity Scoring Engine]
    QUAL[Qualification Engine]
    COMPLY[Compliance Gate]
    API[REST API]
  end

  subgraph Web["Frontend (React/Vite)"]
    DASH[Dashboard]
    TENDER[Tender Detail]
    BID[Bid Workspace]
  end

  Sources --> SA --> DW --> TDB
  DW --> HM
  DW --> DL --> EX --> OCR --> CH --> VDB
  TDB --> CLS --> TDB
  Docs --> REQ --> TDB
  Docs --> EVAL --> TDB
  TDB --> SCORER --> TDB
  ADB --> PORT
  TDB --> QUAL --> TDB
  STRAT --> TDB
  WRITE --> TDB
  RED --> TDB
  COMP --> COMPLY --> TDB
  TDB --> API --> Web
  ADB --> API
  API --> AUD
```

## 3. Monorepo layout

The spec's project structure (§41) is adopted with minor, justified adjustments for buildability with npm/pnpm workspaces:

```
tender-intelligence/
├── apps/
│   ├── web/                 # React + Vite + TS frontend
│   └── api/                 # Node + TS REST API (Express or Fastify — see §5)
├── agents/                  # One package per AI agent, each with its own schema + prompt + tests
│   ├── discovery/
│   ├── classifier/
│   ├── qualification/
│   ├── requirement/
│   ├── evaluation/
│   ├── scoring/             # deterministic support code lives here even though scoring itself is app-layer
│   ├── strategy/
│   ├── portfolio/
│   ├── writer/
│   ├── redteam/
│   └── compliance/
├── scrapers/
│   ├── etenders/
│   ├── treasury/
│   ├── easytenders/
│   ├── municipalities/
│   ├── soe/
│   └── generic/             # base classes + shared adapter contract
├── workers/
│   ├── scraping/
│   ├── documents/
│   ├── embeddings/
│   ├── analysis/
│   └── notifications/
├── documents/
│   ├── extraction/
│   ├── generation/
│   └── templates/
├── database/
│   ├── migrations/
│   └── seeds/               # clearly labelled DEVELOPMENT DATA only
├── shared/
│   ├── types/                # generated DB types + hand-written domain types
│   ├── schemas/               # Zod schemas — single source of truth for validation
│   ├── constants/
│   └── utilities/
├── tests/
│   └── e2e/
├── infrastructure/
└── docs/
```

Rationale for keeping `agents/`, `scrapers/`, `workers/` as top-level packages rather than folding them into `apps/api`: the spec explicitly forbids one giant AI prompt and one undifferentiated scraper implementation (§15, §20). Separate packages force separate input/output schemas, separate tests, and independent versioning, and make it structurally impossible for the API layer to accidentally let an agent write directly to a procurement record without going through the deterministic layer.

`shared/schemas` is the single source of truth for Zod validation, imported by both `apps/api` and `agents/*`, so an agent's output schema and the API's persistence schema cannot silently drift apart.

## 4. Frontend architecture

React + Vite + TypeScript + Tailwind CSS + shadcn/ui, as specified. Structure inside `apps/web/src`:

- `pages/` — one file per route in §9 of the spec (`/`, `/tenders`, `/tenders/:id`, `/opportunities`, `/watchlist`, `/bids`, `/bids/:id`, `/bids/:id/strategy`, `/bids/:id/compliance`, `/bids/:id/documents`, `/agency/*`, `/analytics`, `/competitors`, `/sources`, `/settings`).
- `layouts/` — app shell (nav + header + content region), bid-workspace three-pane layout (left: sections, centre: editor, right: AI assistant — spec §23/Phase 14).
- `components/` — presentational and composite UI, organized by domain (`tenders/`, `bids/`, `agency/`, `sources/`) not by type, so a component and its tests/stories stay together.
- `hooks/` — data-fetching hooks wrapping the typed API client; one hook per resource, each exposing loading/empty/error/success explicitly (spec §10 requires all four states everywhere).
- `lib/` — API client, query client (TanStack Query recommended for cache + retry + stale-state handling — see open decision in BUILD-PLAN.md), formatting utilities.
- `types/` — re-exports from `shared/types` plus view-model types that are UI-only.

Visual direction (spec §10/§36): dense information hierarchy, real tables (not card grids) for tender lists, muted borders instead of shadows, status conveyed by labelled badges not color alone (accessibility + colorblind users, and because color-only status is unauditable in a screenshot/export), no decorative gradients or animation. Financial/procurement software register (Bloomberg Terminal / Linear / Notion), not a marketing SaaS register.

## 5. Backend architecture

Node.js + TypeScript REST API. Recommendation: **Fastify** over Express — first-class TypeScript support, built-in JSON schema validation hooks that pair naturally with Zod via `fastify-type-provider-zod`, and materially better throughput for a service that will proxy large document payloads. This is a Phase 1 decision that materially affects architecture, so it is flagged for explicit approval rather than assumed (see open decisions list in BUILD-PLAN.md) — Express remains an acceptable fallback if there is an organizational preference.

Layering inside `apps/api`:

- `routes/` — thin HTTP handlers mapping to the endpoints in spec §40. No business logic here.
- `controllers/` — request/response shaping, calls into services.
- `services/` — business logic (e.g. `ScoringService`, `QualificationService`, `ComplianceGateService`). This is where deterministic rules specified in the master spec (opportunity scoring formula, qualification statuses, compliance READY/BLOCKED gate) live in code, independent of any AI agent.
- `repositories/` — one per aggregate root, sole owners of SQL/Supabase client calls. No other layer talks to the database directly. This is what makes RLS and audit logging enforceable in one place.
- `jobs/` — BullMQ job definitions dispatched to `workers/*` packages for anything long-running (scraping, extraction, embedding, notification fan-out) so the request/response cycle never blocks on them.
- `middleware/` — auth (Supabase JWT verification), RBAC enforcement, request validation (Zod), structured error handling, rate limiting.

Background processing: Redis + BullMQ, one queue per workload type (`scrape`, `extract`, `embed`, `classify`, `notify`) so a slow OCR job cannot starve tender discovery, and so each queue can have its own concurrency and retry policy.

## 6. Data flow ownership boundaries

To keep the fabrication rule enforceable in code rather than only in prompts, three boundaries are hard rules from Phase 1 onward:

1. **Only repositories write to the database.** Agents and workers never hold a database client; they return typed, validated output objects that a service layer persists.
2. **Only the deterministic scoring/qualification/compliance services write `tender_scores` outcomes, qualification statuses, and compliance READY/BLOCKED state.** AI agents write to their own evidence/recommendation columns or tables; they cannot set the field a human decision or a downstream gate depends on.
3. **Nothing overwrites a previous value in place for anything that affects a procurement decision.** Score recalculation, compliance re-checks, and requirement re-extraction append new rows to a `*_history` table (spec §12 already requires `tender_status_history`; the same pattern is extended to scores and compliance checks — detailed in DATABASE.md).

## 7. Environment configuration

Environment variables are the only permitted channel for secrets (OpenAI key, Supabase service role key, scraper credentials, SMTP credentials). `apps/api` loads them server-side only; `apps/web` receives only the public Supabase URL and anon key via Vite's `VITE_`-prefixed env vars, which are safe to ship to the browser by Supabase's own design (RLS is the real boundary, not key secrecy). A `.env.example` is created in Phase 1 enumerating every variable with a placeholder and a one-line comment on where to obtain it; `.env` is gitignored from the first commit.

## 8. What Phase 1 will and will not touch

Phase 1 (Project Foundation) creates the monorepo skeleton, the frontend shell with routing and empty-state pages for every route in §9, the API skeleton with a health endpoint, Supabase client wiring, shared types/schemas packages, and CI-equivalent scripts (`lint`, `typecheck`, `test`, `build`). It does not create scrapers, AI agents, or the database schema itself beyond the minimum Supabase project connection needed to prove auth works end to end — full schema is Phase 2, by explicit stop-condition in the build execution instructions (§46). This document will be revisited and updated once Phase 1 actually exists, so that Phase 2 planning starts from a real inspection rather than this proposal.

## 9. Phase 4 as-built: Source Registry layer

Extends §5's backend layering with the pieces Phase 4 actually added, none of which change the layering rules in §5/§6:

- **`apps/api/src/lib/adapters/`** — the adapter contract (`types.ts`), the in-process adapter registry (`registry.ts`: register/lookup by key, never a source-specific `if` anywhere else in the codebase), and the registration entry point (`index.ts`, imported once from `app.ts`; registers nothing in Phase 4 — see `docs/SCRAPING-ARCHITECTURE.md` §11.1). This is the concrete home for the `jobs/`/`workers/*` integration §5 describes conceptually — Phase 5's eTenders worker will call into an adapter looked up here, not embed its own logic in a route or service.
- **`apps/api/src/lib/sourceHealth.ts`** — the deterministic health/scheduling calculation (`docs/SCRAPING-ARCHITECTURE.md` §11.2), a pure function with no database or network access, unit-tested directly.
- **`apps/api/src/lib/requireRole.ts`** — the first general-purpose RBAC guard in the codebase (beyond RLS itself), used by every Source Registry mutating route. §6's ownership-boundary rules extend naturally here: `repositories/tenderSources.ts`'s `updateTenderSourceState` is the only function that writes to `tender_sources`, and it is only ever called from a route that has already checked `requireRole`.
- **New repositories** (`tenderSourceScans.ts`, `tenderSourceErrors.ts`, `tenderSourceSummary.ts`), following the existing one-repository-per-aggregate-root rule from §5.
- **`GET /api/me`** (`routes/me.ts`) — the caller's own resolved profile, added so the frontend can decide which admin actions to *show* without duplicating role logic; the server still re-checks on every mutating request regardless of what the UI displays.

No change to §6's data-flow ownership boundaries, §7's environment/secrets model, or the RLS model in `docs/DATABASE.md` §5 — Phase 4 adds new tables and columns that follow the exact same patterns.

## 10. Phase 6 as-built: document ingestion & evidence pipeline

Full detail in `docs/DOCUMENT-INGESTION.md`. In terms of this document's layering
rules: `apps/api/src/lib/documents/*` is a new backend layer sitting between
`routes/tenderDocuments.ts` and the database — a `DocumentPipelineStore` interface
(§5's ownership-boundary pattern, extended: only this store writes
`tender_document_versions/processing/pages/sections/chunks`) with a
Supabase-backed production implementation and a raw-`pg` test implementation, for the
same PostgREST-unavailable-in-this-sandbox reason Phase 5's `IngestionStore` exists.
`apps/api/src/lib/security/urlSafety.ts` is a new shared module generalising Phase 5's
domain-allowlist SSRF defence with real DNS-resolution/private-network checks, used by
the document downloader; Phase 5's own `allowlist.ts` is untouched. No BullMQ queue
was introduced (§7's `REDIS_URL` env var remains an unused placeholder) — the pipeline
is built as composable, idempotent stage functions a future worker will call
unchanged (`docs/DOCUMENT-INGESTION.md` §9). No AI classification, embeddings, or
semantic search exist yet, per this phase's explicit scope boundary.

## 11. Phase 7 as-built: AI Discovery & Classification

Full detail in `docs/AI-DISCOVERY-CLASSIFICATION.md`. In terms of this document's
layering rules: `apps/api/src/lib/ai/*` is a new backend layer sitting between
`routes/tenderAi.ts` and both the database and the OpenAI provider — an `AiStore`
port (same ownership-boundary pattern as `DocumentPipelineStore`/`IngestionStore`)
with a Supabase-backed production implementation, and a separate `OpenAiClient` port
with a real SDK-backed implementation and a fully-scriptable fake used by every
non-smoke test. The AI layer never has write access to any Phase 2–6 table — it only
persists its own `tender_ai_*` tables — and the deterministic tender/document record
remains authoritative even when an AI claim disagrees with it (surfaced as a
`tender_ai_conflicts` row, never auto-applied). No BullMQ queue was introduced (same
finding as Phase 6, re-verified); the AI run is a composable, idempotent stage
function (`execution/runAgent.ts`) a future worker will call unchanged. No
qualification, scoring, bid/no-bid, embeddings/semantic search, portfolio matching,
bid writing, or autonomous submission exist yet, per this phase's explicit scope
boundary.

## Phase 8 — Qualification & Compliance Intelligence

Full detail in `docs/QUALIFICATION-ENGINE.md`. Adds `apps/api/src/lib/qualification/` — a new, pure,
deterministic rule-engine layer (no database, no network, fully unit-testable) sitting between
`routes/tenderQualification.ts` and the database via a `QualificationStore` port (same
interface/Supabase-impl/test-fake pattern as `AiStore`/`DocumentPipelineStore`). A second AI agent,
`QualificationInterpretationAgent` (`apps/api/src/lib/ai/agents/qualification/`), reuses Phase 7's
client/execution/evidence infrastructure rather than a parallel pipeline, and structurally cannot emit a
qualification decision (its output schema has no PASS/FAIL/UNKNOWN/REQUIRES_ACTION field). Qualification
extends the existing Phase 2 `tender_requirements`/agency-evidence schema rather than duplicating it. Still
no scoring, bid/no-bid, embeddings/semantic search, portfolio matching, bid writing, red-teaming, or
autonomous submission — none of Phase 8 builds toward them.

## Phase 9 — Requirement & Evaluation Extraction

Full detail in `docs/REQUIREMENT-EVALUATION-EXTRACTION.md`. Adds a third AI agent,
`RequirementExtractionAgent` (`apps/api/src/lib/ai/agents/extraction/`), reusing Phase 7/8's
client/execution/evidence infrastructure unchanged rather than a parallel pipeline. Unlike
Qualification (agency-scoped), extraction is tender-scoped — requirements and evaluation criteria are
properties of the tender's own document set, not any one agency's relationship to it — so
`tender_ai_runs.agency_id` was relaxed to nullable and given a dedicated shared-catalogue RLS policy
plus a new partial unique index guarding one active extraction run per tender. `apps/api/src/lib/ai/execution/
runRequirementEvaluationExtraction.ts` is the orchestrator: it never invents a weight, threshold, or
formula (unspecified fields persist as `null`/`UNKNOWN`), it re-resolves every claimed evidence chunk
server-side exactly like Phase 7/8 (never trusting model-echoed text), it only persists a genuine
`CONFLICT` row when both disagreeing sides independently resolve to real evidence, and every requirement/
criterion is append-only versioned (`version`/`supersededBy`/`supersededAt`) rather than overwritten on
re-extraction. Requirements and evaluation criteria both support a hierarchy (`parentRequirementId`/
`parentCriterionId`) for tenders with nested clause structure. Still no scoring, bid/no-bid, embeddings/
semantic search, portfolio matching, bid writing, red-teaming, autonomous submission, or any qualification
decision-making — Phase 9 extracts structured requirements/criteria only, it does not evaluate a bidder
against them (that remains Phase 8's job, unchanged) and does not compute any score.

## Phase 10 — Evaluation & Opportunity Scoring Engine

Full detail in `docs/SCORING-ENGINE.md`. Adds `apps/api/src/lib/scoring/` — a pure, deterministic,
zero-network scoring engine (mirrors `lib/qualification/`'s pure-function discipline exactly) sitting
between `routes/tenderScoring.ts` and the database via a `ScoringStore` port (same
interface/Supabase-impl/test-fake pattern as `QualificationStore`/`AiStore`). It consumes Phase 8's
qualification result and Phase 9's requirements/evaluation criteria/gates as-is — it never re-implements
either engine — plus agency evidence and a new, minimal, explicit evaluation-criterion↔agency-evidence
link table. Six independently-`KNOWN`/`UNKNOWN` dimensions (Qualification, Requirement Coverage,
Evaluation Fit, Evidence Strength, Commercial Fit, Strategic Fit) combine into a data-completeness-aware
overall score and one of six DECISION SIGNALS — never `BID`/`NO_BID`, that judgment is explicitly
deferred to Phase 11. A five-gate hard-gate layer (mandatory qualification/requirement failure, deadline
passed, compulsory briefing failure, critical compliance failure) always overrides the numeric score.
Scoring runs are append-only, versioned, and idempotent (an unchanged input + configuration reuses the
current run rather than duplicating it), with a staleness flag computed at read time from an
input-snapshot comparison. This phase's own internal weighting configuration is deliberately kept
structurally and conceptually separate from both Phase 9's tender-evaluation weights and the
pre-existing, unrelated Phase 3 legacy score/risk feature — see `docs/DECISIONS.md`. Still no
embeddings/semantic search/portfolio matching/win probability/bid strategy/proposal generation anywhere
in this phase.

## Phase 11 — Bid/No-Bid Intelligence Engine

Full detail in `docs/BID-NO-BID-ENGINE.md`. Adds `apps/api/src/lib/bidDecision/` — a second pure,
deterministic, zero-network engine sitting alongside `lib/scoring/` and mirroring its exact
types.ts/pure-evaluator/store-port/Supabase-impl/test-fake discipline. It consumes Phase 10's own
`evaluateOpportunity(...)` output directly (never re-deriving a score) plus Phase 8 qualification, Phase 9
requirement/evaluation-criteria counts (for a deterministic bid-effort formula), and Phase 9's evaluation
conflicts, combining them with a new, agency-owned, versioned **bid policy** (`bid_policies`/
`bid_policy_versions` — deliberately a separate namespace from any tender-side rule table) through an
explicit, configured decision-precedence order to produce exactly one of `BID`/`NO_BID`/`REVIEW`. A hard
gate (reused from Phase 10's own gate computation) always overrides a high opportunity score. Every rule
is evaluated every run and returned in full, never just the first triggered one. A human (`ADMIN`/
`BID_MANAGER`) may override the system decision without ever mutating it — both are stored side by side,
with `final_decision` and an override-reason `CHECK` constraint enforced at the database level. Decision
runs are append-only/versioned/staleness-aware exactly like Phase 10's scoring runs. Still no bid document
generation, proposal copy, portfolio matching, embeddings/semantic search, competitor intelligence, or
machine-learning win probability anywhere in this phase — the recommendation is a pure rule-engine output,
never an AI opinion.

## Phase 12 — Bid Strategy & Bid Project Intelligence

Full detail in `docs/BID-STRATEGY-ENGINE.md`. Adds `apps/api/src/lib/bidStrategy/` (a third pure,
deterministic engine family alongside `lib/scoring/` and `lib/bidDecision/`: `types.ts`, `buildStrategy.ts`
(the pure `buildBidStrategy` generator), `readiness.ts` (the pure `calculateBidReadiness` function),
`projectGate.ts` (the pure NO_BID→409 create-gate), `milestones.ts` (the pure AT_RISK/MISSED rule),
`staleness.ts` (re-exports Phase 10's `isSnapshotStale`), and `supabaseBidStrategyStore.ts` (the only
I/O-performing module, service-role writes + input assembly). `apps/api/src/repositories/bidStrategy.ts`
mirrors `repositories/tenderBidDecision.ts`'s read-via-caller's-RLS-client-vs-write-via-service-role split.
`apps/api/src/routes/bidStrategy.ts` registers the full `/api/tenders/:id/bid-project` + `/api/bids...`
surface (§36). `apps/web/src/components/bids/BidStrategyDashboard.tsx` + `hooks/useBidStrategy.ts` implement
the standalone `/bids`/`/bids/:id` dashboard (distinct from the Tender Radar and from the per-tender
Phase 10/11 tabs), reusing the existing badge/tab/card visual language.

The data flow is exactly Phase 8→9→10→11→[Bid Project→Bid Strategy→Evaluation Strategy→Requirement
Plan→Evidence Needs→Workstreams→Tasks/Milestones→Readiness]→Phase 13+ (§43): a Bid Project can only be
created from a Phase 11 final decision of BID (or an authorized REVIEW, or NO_BID subsequently
human-overridden to BID — never automatically from NO_BID, enforced by the pure `canCreateBidProject` gate
returning HTTP 409 otherwise); `buildBidStrategy` then consumes Phase 8 qualification, Phase 9 requirements
and evaluation criteria (plus Phase 10's evaluation-criterion↔agency-evidence link table, read-only) to
deterministically produce win themes, priorities, evaluation strategy, requirement plans, evidence needs,
risks, assumptions and workstreams — never inventing a weight, requirement, or piece of evidence that isn't
already in the database. `calculateBidReadiness` then folds all of that plus tasks into a status
(READY/BLOCKED/REVIEW) where hard blockers always override completeness, never a percentage-only score.
Still no final proposal writing, executive summary generation, full bid document generation, LLM-generated
answers, semantic search/embeddings, case-study matching, automatic portfolio selection, competitor
intelligence, pricing strategy, or win probability anywhere in this phase — every generated item is either
directly traceable to a real requirement/criterion/evidence row or explicitly HUMAN_DEFINED.

## Phase 13 — Evidence Matching & Portfolio Intelligence

Full detail in `docs/EVIDENCE-MATCHING.md`. Continues the pure-function + port + real-store + fake-store
pattern established since Phase 5/6: `apps/api/src/lib/evidenceMatching/rankEvidenceCandidates.ts` and
`verifyEvidenceCandidate.ts` are pure, zero-I/O functions (mirroring `lib/bidStrategy/buildStrategy.ts` and
`lib/bidDecision/evaluateBidDecision.ts` exactly); `supabaseEvidenceMatchingStore.ts` is the only place
that touches Supabase or the OpenAI embeddings API. `embedAgencyEvidence.ts` is a new architectural role
this phase introduces: an explicit, idempotent I/O *seam* function — not pure, but deliberately shaped so a
future BullMQ worker (still not wired into this codebase) could call it unchanged as a job processor.

`apps/api/src/routes/evidenceMatching.ts` registers `/api/bids/:id/evidence-matches...`,
`/evidence-claims`, and `/evidence-gaps` — reads go through the caller's own RLS-scoped client (agency
ownership checked via the existing `repositories/bidStrategy.ts#getBidProject`), every mutation
(candidate generation, approve, reject) runs against the privileged service-role client only after role +
ownership are checked. `apps/web/src/components/bids/BidStrategyDashboard.tsx` gains an "Evidence Matches"
tab and `hooks/useEvidenceMatching.ts` — reusing the exact badge/tab/card visual language every prior
phase's UI additions used, never a new design system.

The data flow is Phase 12's evidence needs → [embed agency evidence → retrieve (pgvector, agency-scoped) →
rank (pure) → verify (pure, independent of ranking) → human approve/reject → claim] → feedback into Phase
12's own `bid_evidence_needs.status` (never a parallel evidence-needs model). This is the first phase
permitted to use embeddings/pgvector/semantic search anywhere in the system — Phases 1-12 deliberately had
no semantic retrieval at all. AI/semantic similarity here can only ever retrieve and rank candidates, or
assist structural interpretation up to `VERIFIED` at most; it never itself decides, verifies, or approves —
`APPROVED`/`REJECTED` are exclusively human-actioned end states, enforced both by the pure verification
function's return type and by a DB-level immutability trigger on decided rows.

## Phase 14 — Bid Proposal Generation & Document Assembly

Full detail in `docs/PROPOSAL-GENERATION.md`. Continues the pure-function + port + real-store pattern:
`lib/proposals/blueprint.ts`, `compliance.ts`, `unsupportedClaims.ts`, `coverageScore.ts` and `staleness.ts`
are pure, zero-I/O engines; `lib/ai/execution/runProposalGeneration.ts` is the AI orchestration seam
(prompt → model → schema validation → independent evidence/requirement/evaluation re-verification), calling
`lib/ai/agents/proposalSection/agent.ts`; `lib/proposals/supabaseProposalStore.ts` is the only place that
touches Supabase. `lib/proposals/documentAssembly.ts` is a pure buffer builder (`docx`/`pdf-lib`) for the
internal DOCX/PDF export. `apps/api/src/routes/proposals.ts` registers
`/api/bids/:id/proposal...`/`sections...`/`compliance...`/`claims`/`generations`/`assemble`.
`apps/web/src/components/bids/BidStrategyDashboard.tsx` gains a "Proposal" tab (outline + section
inspector) and `hooks/useProposal.ts`.

Data flow: Phase 12 approved strategy + Phase 13 approved evidence + Phase 8/9 requirements/evaluation
criteria → blueprint (pure) → per-section AI generation (structured, evidence-grounded, independently
re-verified) → deterministic compliance engine → human review/approve/reject → internal document assembly.
Only Phase 13 `APPROVED` (non-revoked, non-stale) evidence claims are ever authoritative; AI/semantic
scoring never itself approves content, decides compliance, or changes Bid/No-Bid — those remain exclusively
human/deterministic. No proposal status implies SUBMITTED; nothing in this phase talks to a procurement
portal or email transport.

## Phase 15 — Final Bid Compliance, Submission Readiness & Submission Pack

Full detail in `docs/SUBMISSION-READINESS.md`. The final deterministic layer after Phase 14:
`lib/submissionReadiness/engine.ts` (`calculateSubmissionReadiness`) is a pure, zero-I/O compliance engine
across 16 categories with `BLOCKED > REQUIRES_REVIEW > READY_TO_SUBMIT` precedence, mirroring
`lib/proposals/compliance.ts`/`lib/bidStrategy/readiness.ts` exactly; `deadline.ts`, `pricing.ts`,
`approval.ts` and `staleness.ts` (reusing `isSnapshotStale`) are further pure modules; `pack.ts` computes
SHA-256 file hashes and assembles the submission manifest, with a deterministic `SubmissionPackStoragePort`
abstraction (real Supabase Storage wiring is a documented limitation, same root cause as Phase 14's);
`supabaseSubmissionReadinessStore.ts` is the only I/O seam, aggregating Phase 8-14 data into the engine's
input shape. `apps/api/src/routes/submissionReadiness.ts` registers
`/api/bids/:id/submission-readiness...`/`pricing...`/`submission-pack...`/`submission-manifest`/
`submission-approval...`. `apps/web/src/components/bids/BidStrategyDashboard.tsx` gains a "Submission
Readiness" tab.

Data flow: Phase 12 strategy + Phase 13 approved evidence + Phase 14 proposal/compliance + a new Phase 15
pricing schedule + tender documents/certificates/briefings/addenda/deadline → the final compliance engine →
an immutable readiness snapshot → a versioned, hash-verified submission pack + manifest → human final
approval (`APPROVED_FOR_SUBMISSION`, never `SUBMITTED`). Phase 15 never changes Qualification, Opportunity
Score, Bid/No-Bid, Bid Strategy, or Approved Evidence, and never itself submits, uploads, or emails anything
to an external system — every UI surface says "READY FOR HUMAN SUBMISSION" / "APPROVED FOR HUMAN
SUBMISSION" explicitly.

### Phase 16 — Submission Execution, Submission Tracking & Receipt Intelligence

Full detail in `docs/SUBMISSION-EXECUTION.md`. Continues from Phase 15's `APPROVED_FOR_SUBMISSION` state
through a new deterministic engine, `apps/api/src/lib/submissions/*`: `stateMachine.ts`
(`resolveSubmissionExecutionStatus`, 10-state precedence-ordered machine), `resolver.ts` (deterministic
submission-method detection, no AI), `deadline.ts` (submission-facing urgency thresholds distinct from
Phase 15's), `validation.ts` (the pre-submission preflight gate), `confirmation.ts` (pack/readiness
staleness re-check before every attempt), `retry.ts`, `receipts.ts`, `duplicateProtection.ts`,
`attachmentIntegrity.ts`, `targetSecurity.ts`, `errorClassification.ts`, `idempotency.ts`, `physical.ts` are
all pure, zero-I/O modules; `adapters/{manual,email,portal,api,physical}.ts` implement a common
`SubmissionAdapter` seam (every one degrades honestly to `MANUAL_REQUIRED` in this build — no live
provider/portal/email automation is wired in); `adapters/mock/mockAdapters.ts` is TEST-ONLY.
`runSubmission.ts` is the single I/O orchestration seam (mirrors `runSubmissionReadinessCheck.ts`) driving
prepare → confirm → attempt → receipt/manual-report → cancel, all through
`supabaseSubmissionExecutionStore.ts`. New tables: `bid_submission_executions` (one live aggregate row per
bid project), `bid_submission_confirmations` (immutable), `bid_submission_attempts` (append-only, one
active at a time), `bid_submission_receipts` (append-only evidence). `apps/api/src/routes/submissionExecution.ts`
registers `/api/bids/:id/submission...`/`prepare`/`confirm`/`attempt`/`attempts`/`receipts`/`manual-complete`/
`cancel`. `apps/web/src/components/bids/BidStrategyDashboard.tsx` gains a "Submission Execution" tab.

Data flow: Phase 15 `APPROVED_FOR_SUBMISSION` + the exact approved pack/readiness snapshot → method
resolution → durable human confirmation → a validated, idempotency-guarded attempt through the adapter
registry → a provider/manual outcome → receipt capture and verification → a status that is `SUBMITTED`
only once verified evidence exists, otherwise `SUBMISSION_REPORTED — VERIFICATION REQUIRED` or
`REQUIRES_MANUAL_ACTION`. Never a fabricated certainty (spec §62 binding constraint).

## Phase 17 addendum — Outcomes, Win/Loss & Learning

`apps/api/src/lib/outcomes/{types,reconciliation,metrics,winLoss,awardAnalytics,
competitorAnalytics,conflicts,learningFeatures,stateMachine,provenance}.ts` are
pure, zero-I/O modules (mirroring the port/pure-function/fake pattern used
throughout the codebase since Phase 10); `store.ts` is the port,
`supabaseOutcomeStore.ts` the production implementation,
`__tests__/fakeOutcomeStore.ts` the test fake. `routes/outcomes.ts` is the sole
I/O orchestration layer, registered in `app.ts`. New tables extend the
Phase 2 `awards`/`competitors`/`competitor_activity` architecture rather than
duplicating it — see `docs/OUTCOME-INTELLIGENCE.md` for the full design,
including the decision-time/outcome-feature split that protects against data
leakage into the future learning layer.

## Phase 18 addendum — Predictive Procurement Intelligence, Calibration & Decision Support

`apps/api/src/lib/intelligence/{types,readiness,baselines,evaluation,
temporalValidation,model,calibration,governance,distributionShift,
abstention,explanations,scoreCalibration,segments}.ts` are pure, zero-I/O
modules (statistics/ML implemented from scratch — Mann-Whitney AUC,
trapezoidal PR-AUC, Brier score/log loss, L2-regularized logistic
regression via batch gradient descent, Platt-scaling calibration — no
external ML library, no LLM call for any numerical decision); `store.ts` is
the port, `supabaseIntelligenceStore.ts` the production implementation,
`__tests__/fakeIntelligenceStore.ts` the test fake, matching the same
pure-function/port/fake pattern used since Phase 10. `routes/intelligence.ts`
is the sole I/O orchestration layer, registered in `app.ts`, exposed under
`/api/intelligence/*`. `readiness.ts`'s `computeDatasetReadiness()` is the
model-eligibility gate (`INSUFFICIENT_DATA` → `INSUFFICIENT_LABELS` →
`HIGH_CLASS_IMBALANCE` → `INSUFFICIENT_VARIATION` → `LEAKAGE_DETECTED` →
`READY_FOR_TRAINING` → `READY_FOR_EVALUATION` → `PRODUCTION_ELIGIBLE`); it is
built entirely on Phase 17's WON/LOST-verified, decision-time/outcome-feature
split and, against this system's real current outcome ledger, correctly and
expectedly reports `INSUFFICIENT_DATA` (see `docs/PREDICTIVE-INTELLIGENCE.md`
§22). New tables (`database/migrations/20260912220000_predictive_intelligence.sql`):
`model_datasets`, `model_registry`, `model_versions`, `model_training_runs`,
`model_evaluations`, `model_calibrations`, `model_predictions`,
`prediction_abstentions`, `model_card_documents`, `score_calibration_reports`,
`retrospective_segments`, `model_audit_events` — full design in
`docs/PREDICTIVE-INTELLIGENCE.md`. `apps/web/src/pages/Intelligence.tsx`
(`/intelligence`) adds Model Readiness, Score Calibration, Model Registry,
Prediction and Historical Learning tabs; no autonomous decision-making is
introduced anywhere — nothing in this phase can change scoring weights,
bid/no-bid thresholds, qualification rules, pricing, or submit/withdraw a
tender, and every promotion to `PRODUCTION` requires an explicit
`ADMIN`-role human approval (`lib/intelligence/governance.ts`).

## Phase 19 — Production Integration, Data Completeness & Intelligence Operations

Phase 19 closed three real production-readiness gaps found by inspecting
the repository rather than assuming a fresh roadmap (see
`docs/PRODUCTION-OPERATIONS.md` for the full audit): (1) addenda
acknowledgement was previously hard-coded to `false` for every addendum
(`docs/DECISIONS.md` Phase 15 #1) — closed with a new agency-scoped,
immutable `bid_addendum_acknowledgements` table
(`apps/api/src/lib/addenda/reconciliation.ts` — pure materiality/
reconciliation derivation, zero I/O — wired into
`supabaseSubmissionReadinessStore.ts`, exposed via
`routes/addenda.ts`); (2) no persisted, rule-based data-quality ledger
existed — added as `apps/api/src/lib/dataQuality/{rules,completeness}.ts`
(pure) plus `supabaseDataQualityStore.ts` and `routes/dataQuality.ts`,
backed by a new `data_quality_violations` table; (3) no single
operational-health aggregation existed — added as
`apps/api/src/lib/ops/health.ts` (pure) plus
`supabaseOpsHealthStore.ts` and `routes/ops.ts`, reading real counts
from tables every prior phase already built (`tender_sources`,
`tender_source_scans`, `tender_documents`, `tender_ai_runs`,
`agency_evidence_embeddings`, `tender_outcomes`, `outcome_conflicts`).
Two new pages: `/data-quality` and `/ops` ("Production Health"), both
under the existing "Operations" nav section. An inaccurate code
comment claiming submission packs used a live Supabase Storage adapter
(they don't need one — see `docs/PRODUCTION-OPERATIONS.md` §2) was
corrected. No BullMQ/queue infrastructure was introduced — re-verified,
not reversed, the fire-and-forget seam pattern from Phases 6/16.
Full detail: `docs/PRODUCTION-OPERATIONS.md`, `docs/DATA-QUALITY.md`,
`docs/INTEGRATION-STATUS.md`.

## Phase 20 addendum — Continuous Surveillance, Benchmarks & Audit Trail

The Phase 4/5 ingestion pipeline (`lib/ingestion/scanRunner.ts`) already detected that a re-scanned source
record's content hash had changed, but discarded that fact after logging it. Phase 20 adds a real
field-level diff engine (`lib/surveillance/diffEngine.ts`, pure) at exactly that point: PRE-scan facts
(the stored `tender_source_records` row) are compared against INCOMING facts (this scan's discovered item),
and a material change creates a real `tender_addenda` row (`detected_via = 'DIFF_ENGINE'`) — closing the
exact gap `lib/notifications/check.ts` had documented since Phase 19 ("no code path anywhere inserts into
`tender_addenda`"). `ADDENDUM_DETECTED` notifications, which always scanned that table, now genuinely fire.

A polling scheduler (`lib/surveillance/schedule.ts`) is pure, tested cadence-selection logic plus the
existing on-demand-seam pattern (`POST /api/surveillance/scan/:sourceId`) — no BullMQ/Redis was introduced
(none exists in this codebase; re-verified this phase).

Anonymized cross-agency benchmarking (`lib/benchmarks/aggregate.ts` + `supabaseBenchmarksStore.ts`) computes
group-level statistics (cycle time, price variance, volume) from real `tender_outcomes`/`tenders` rows,
enforcing a k-anonymity floor (>= 5 distinct entities) in both the pure aggregator and a DB CHECK
constraint — never a per-agency or per-bid value.

`audit_trail_events` is a new, generic, append-only, correlation-id-keyed table recording the chain of
custody named in spec §4D (Source Scan → Tender Import → Requirement Extraction → Strategy Generation →
Evidence Match → Human Signoff → Submission, plus Addendum Detected/Acknowledged and Outcome Recorded),
written at the corresponding route-level call sites. See `docs/DECISIONS.md`'s Phase 20 section for the
full reconciliation of this phase's schema/naming decisions against the spec's literal table names.
