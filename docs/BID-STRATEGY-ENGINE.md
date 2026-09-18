# Bid Strategy Engine — Phase 12

Phase 11 answers "should we pursue this tender?" Phase 12 answers "if we are pursuing it, how should we
approach the bid?" This document covers the Bid Project lifecycle, the Bid Strategy model and its
versioning, win themes, differentiators, evaluation strategy, requirement response planning, evidence
needs/gaps, workstreams/tasks/milestones, risks, assumptions, questions, readiness, staleness, permissions,
audit events, and the exact handoff to Phase 13.

## 1. Objective and hard scope

Transforms Tender + Qualification (Phase 8) + Requirements/Evaluation (Phase 9) + Opportunity Score
(Phase 10) + Bid Decision (Phase 11) + Agency evidence into: **Bid Project → Bid Strategy → Win Themes →
Response Strategy → Requirement Plan → Evaluation Strategy → Evidence Needs → Content Plan → Production
Plan → Review Plan.**

Explicitly out of scope (never implemented here): final proposal writing, executive summary generation,
full bid document generation, LLM-generated final answers, semantic search, embeddings, vector search,
case-study matching, automatic portfolio selection, competitor intelligence, pricing strategy, win
probability, automated competitor claims, final submission packaging. Phase 12 has **no AI/LLM dependency
anywhere** — it is a third deterministic engine family alongside Phase 10's scoring and Phase 11's
bid/no-bid engines.

## 2. Bid Project

### 2.1 Table collision investigation

`bid_projects` already existed (Phase 2 §18, `20260910200150_bid_architecture.sql`) with a different
lifecycle enum (`bid_project_status`: DRAFTING/REVIEW/READY/SUBMITTED/WON/LOST/WITHDRAWN) and an
unstructured `decision`/`decision_reason` field. It was verified unreferenced anywhere in `apps/api/src` or
`apps/web/src`. Rather than reinterpret it, Phase 12 introduces `bid_strategy_projects` — see
`docs/DECISIONS.md` for the full reasoning (mirrors Phase 11's `bid_decision_runs` vs `bid_projects.decision`
precedent exactly).

### 2.2 Lifecycle

```
DRAFT → STRATEGY → IN_PROGRESS → INTERNAL_REVIEW → READY_FOR_SUBMISSION → SUBMITTED → CLOSED
  ↓        ↓             ↓
CANCELLED CANCELLED  CANCELLED
```

Exact transition map (`shared/constants/src/bidStrategy.ts`, `BID_PROJECT_TRANSITIONS`):

| From | Allowed To |
|---|---|
| DRAFT | STRATEGY, CANCELLED |
| STRATEGY | IN_PROGRESS, CANCELLED |
| IN_PROGRESS | INTERNAL_REVIEW, CANCELLED |
| INTERNAL_REVIEW | READY_FOR_SUBMISSION, IN_PROGRESS |
| READY_FOR_SUBMISSION | SUBMITTED, IN_PROGRESS |
| SUBMITTED | CLOSED |
| CLOSED / CANCELLED | (terminal) |

`POST /api/bids/:id/status` rejects any transition not in this map with HTTP 409
(`INVALID_STATUS_TRANSITION`) and records every transition in `bid_strategy_project_status_history`, plus a
`BID_PROJECT_STATUS_CHANGED` audit event.

### 2.3 Creation gate (binding constraint)

`lib/bidStrategy/projectGate.ts`'s `canCreateBidProject` is a **pure function**:

- `finalDecision === 'BID'` → allowed.
- `finalDecision === 'REVIEW'` → allowed only when the caller passed `authorizedFromReview: true` **and**
  holds an ADMIN/BID_MANAGER role (checked server-side in `routes/bidStrategy.ts` before the flag is ever
  honoured).
- `finalDecision === 'NO_BID'` → **always** HTTP 409, with a clear explanation, never silently created —
  even if `authorizedFromReview` is passed. If a human has since overridden the Phase 11 decision to BID,
  `bid_decision_runs.final_decision` becomes `'BID'` and the first branch applies; the gate never needs to
  know a decision was originally NO_BID.
- No decision at all → HTTP 409.

Unit-tested exhaustively in `apps/api/src/lib/bidStrategy/__tests__/projectGate.test.ts` (7 tests).

### 2.4 Data

`bid_strategy_projects`: id, tender_id, agency_id, project_name, status, bid_decision_run_id (not null —
a Bid Project cannot exist without a Phase 11 decision), current_strategy_version, owner_user_id,
start_date, target_submission_date, actual_submission_date, priority, bid_effort,
overall_score_snapshot (a snapshot only — never a competing authority; see §11), created_by, created_at,
updated_at, closed_at. One active (non-CANCELLED/CLOSED) project per (tender_id, agency_id), enforced by a
partial unique index.

## 3. Bid Strategy

### 3.1 Model

`bid_strategies`: id, bid_project_id, agency_id, version, status (DRAFT/IN_REVIEW/APPROVED/SUPERSEDED),
objective, strategy_summary, response/evidence/production/risk_strategy_summary (narrative text only —
every structured item lives in its own table below), supersedes_strategy_id, is_current, input_snapshot
(for staleness), created_by/at, approved_by/at.

Client priorities, tender priorities, win themes, differentiators, evaluation strategy, requirement plans,
evidence needs, risks, and assumptions are **relational child tables**, not JSON columns on `bid_strategies`
— per the binding spec instruction, so each item is independently filterable/ownable/status-tracked.

### 3.2 Versioning (binding constraint: immutability)

- A new strategy version is **always** a new `bid_strategies` row — never a mutation of an approved one.
- A Postgres trigger (`prevent_approved_bid_strategy_mutation`) makes an APPROVED row immutable at the DB
  level: the only permitted update is the exact bookkeeping a new version's creation performs
  (`status → SUPERSEDED`, `is_current → false`). Any other update to an APPROVED row raises an exception.
- Historical versions remain retrievable forever via `GET /api/bids/:id/strategy` (returns `current` +
  `history`, ordered by version descending).
- Verified directly in `database/src/__tests__/bidStrategy.test.ts`.

### 3.3 Generation — `buildBidStrategy` (pure, zero-I/O)

`lib/bidStrategy/buildStrategy.ts`'s `buildBidStrategy(input): BidStrategyDraft` performs **no** OpenAI
call, embeddings, database read, or network call — anywhere in its call graph. Given identical input it
always returns byte-identical JSON output, verified by an explicit repeat-call test
(`buildStrategy.test.ts`, "is a pure function"). `lib/bidStrategy/supabaseBidStrategyStore.ts` is the only
I/O-performing module: it assembles the pure `BidStrategyBuildInput` from Phase 8/9/10/11 tables, calls
`buildBidStrategy`, and persists the returned draft as a new version's rows (never the reverse).

Deterministic rules (§27 worked examples, implemented exactly):
- Evaluation criterion weight ≥ the configured threshold (20, `EVALUATION_WEIGHT_THRESHOLD`) → HIGH
  priority evaluation strategy item + (if evidence-linked) a win theme.
- Evaluation criterion with zero linked agency evidence (Phase 10's
  `tender_evaluation_criterion_agency_evidence`, read-only) → an evidence need, severity CRITICAL if the
  criterion is high-weight, else HIGH/MEDIUM depending on whether the weight is even known.
- Mandatory requirement not yet a confirmed PASS (Phase 8's `qualification_status`, consumed never
  recalculated) → a requirement plan (`REQUIRES_HUMAN_REVIEW`) + a CRITICAL evidence need + a CRITICAL risk.
- Unknown closing date, unresolved qualification, or a REVIEW-authorized pursuit → a risk.
- Workstreams are created only for categories the tender's actual data supports (STRATEGY/APPROVAL/
  SUBMISSION are always created since every bid needs them; CONTENT only if requirements exist; COMPLIANCE
  only if a mandatory requirement exists; CASE_STUDIES only if an evidence need was identified) — never a
  blanket set of all ten categories.
- **Differentiators are never auto-generated** — the only evidence signal this phase has (the evaluation
  link count) is already used for win themes/evaluation strategy; reusing it to also invent differentiators
  would risk exactly the "sounds good" fabrication the spec forbids (§9/§42). A future write endpoint for
  human-authored differentiators was not built in this pass (see §12 Known Limitations) — the table and its
  CHECK constraint exist and are tested (`SUPPORTED` requires `supporting_evidence_count > 0`).

### 3.4 Approval

`POST /api/bids/:id/strategy/approve` requires ADMIN/BID_MANAGER. If the current readiness computation
(§6) has any blockers, approval is refused with HTTP 409 **unless** the caller is ADMIN and passes
`overrideBlockers: true` with a non-empty `overrideReason` — an explicit, audited (`BID_STRATEGY_APPROVED`
still fires with the override recorded in the request; a future pass could also persist the override reason
onto the strategy row itself — not yet wired, see Known Limitations) override, never a silent bypass.

## 4. Evaluation Strategy (Phase 9 data consumption)

`bid_evaluation_strategies`: one row per meaningful Phase 9 `tender_evaluation_criteria` row per strategy
version (unique on `(strategy_id, evaluation_criterion_id)`). Never redefines the client's actual
evaluation weighting — `strategy`/`response_objective`/`priority`/`evidence_status` describe **how we
respond**, `evaluation_criterion_id` is a read-only reference to **what the client scores**. `GET
/api/bids/:id/evaluation` surfaces the full list; `calculateBidReadiness` treats a criterion with no
`strategy` text as a hard BLOCKED (§23 "required evaluation criterion has no response strategy").

## 5. Evidence (needs and gap detection)

Phase 12 creates evidence **requests**, never evidence matching/selection (Phase 13 scope). `bid_evidence_needs`:
source_type/source_id, requirement_id/evaluation_criterion_id, description, minimum_count, current_count
(only incremented by a human attaching something — no automatic count in this phase), status
(OPEN/PARTIALLY_SATISFIED/SATISFIED/BLOCKED/WAIVED), severity (CRITICAL/HIGH/MEDIUM/LOW, deterministic
rule-based, never "AI confidence").

Gap-detection rules (all inside the pure `buildBidStrategy`, so they are unit-tested without a database):
evaluation criterion requiring evidence with zero links → evidence need; mandatory requirement not PASS →
evidence need (always CRITICAL, since it also blocks readiness).

## 6. Readiness

`lib/bidStrategy/readiness.ts`'s `calculateBidReadiness(input): BidReadiness` is a **pure function**
returning `{status: READY|BLOCKED|REVIEW, blockers, warnings, completedItems, outstandingItems,
completeness: {requirements, evaluationCriteria, evidenceNeeds, tasks, compliance}}`. **Blockers always
override completeness** — a project at 90%+ completeness with one outstanding mandatory item is BLOCKED,
never a green percentage. Hard blocks implemented exactly per §23: mandatory requirement unresolved,
mandatory compliance evidence missing, evaluation criterion with no response strategy, critical evidence
gap, submission requirement unresolved, compulsory briefing status unresolved, tender closed, critical
human review outstanding. `GET /api/bids/:id/readiness` computes this live from the caller's own RLS-scoped
read of every input table (see Known Limitations for why `bid_readiness_snapshots` is not yet written on
every read).

## 7. Tasks — workstreams, tasks, milestones

`bid_workstreams` (only categories the tender's real data supports, §3.3), `bid_tasks` (human-created via
`POST /api/bids/:id/tasks` — never auto-generated by the strategy engine), `bid_milestones` with a **live
computed** AT_RISK/MISSED status (`lib/bidStrategy/milestones.ts`'s `evaluateMilestoneAtRisk`): a milestone
still UPCOMING/IN_PROGRESS becomes AT_RISK once its due date is within `BID_MILESTONE_AT_RISK_WINDOW_DAYS`
(5) days of now, and MISSED once the due date has passed — COMPLETED/MISSED are never overridden. This is
computed at read time (`repositories/bidStrategy.ts`'s `listMilestones`, exposed as `computed_status`) and
is not yet persisted back to the row (see Known Limitations).

## 8. Questions — clarification workflow

`bid_questions`: question/context/source_requirement_id/source_evaluation_criterion_id, status
(DRAFT/INTERNAL_REVIEW/READY_TO_SEND/SUBMITTED/ANSWERED/CLOSED), assigned_to, due_date, answer,
answer_source. **The system never invents a question or an answer** — `POST /api/bids/:id/questions` only
accepts human-authored `question`/`context` text (available to RESEARCHER too, per §24 "contribute
research"); a DB CHECK constraint (`bid_questions_answer_requires_source`) additionally guarantees an
`answer` can never be stored without an `answer_source`.

## 9. Risks

`bid_risks`: title/description/severity/status/source_type/source_id/mitigation/owner. Never speculative —
every risk generated by `buildBidStrategy` traces to a concrete source (an unresolved mandatory
requirement, an unknown closing date, an unresolved qualification, or a REVIEW-authorized pursuit); a human
may add further risks through a future write endpoint (not built in this pass — the table/route
`GET /api/bids/:id/risks` exists and is read-only in this phase, see Known Limitations).

## 10. Staleness

`lib/bidStrategy/staleness.ts` re-exports Phase 10/11's exact `isSnapshotStale` (a JSON string-inequality
comparison between the strategy's stored `input_snapshot` and a freshly-assembled one). Triggers, per §21:
tender requirement changes, evaluation criteria changes, tender addendum, qualification changes, bid
decision changes, opportunity score changes, agency evidence changes (via the evaluation-criterion link
count), agency capability changes, closing date changes, compulsory briefing status changes — every one of
these is included in the `input_snapshot` assembled by
`supabaseBidStrategyStore.ts`'s `assembleBuildInput`. `repositories/bidStrategy.ts`'s
`isCurrentStrategyStale` exposes this comparison; it is not yet wired into every GET response as a
top-level `isStale` flag on the strategy DTO in the web UI (see Known Limitations) though the underlying
mechanism and function are complete and tested.

## 11. Bid Deadline Authority

The tender's own `closing_date` (Phase 2/5/10/11) remains the sole authoritative deadline everywhere in
this phase. `bid_strategy_projects.target_submission_date` is explicitly a planning field only, and
`overall_score_snapshot` is explicitly a snapshot, never re-derived as authoritative. Nothing in Phase 12
writes to `tenders.closing_date`.

## 12. API

All routes in `apps/api/src/routes/bidStrategy.ts`, registered in `apps/api/src/app.ts`. `/api/bids` and
`/api/bids/:id` were verified free of any pre-existing route before use (`docs/DECISIONS.md`).

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/api/tenders/:id/bid-project` | BID_MANAGER, ADMIN | NO_BID→409; REVIEW needs `authorizedFromReview` |
| GET | `/api/bids` | VIEW roles | agency-scoped list |
| GET | `/api/bids/:id` | VIEW roles | 404 cross-agency |
| POST | `/api/bids/:id/status` | MANAGE roles | validated transition map, 409 otherwise |
| GET | `/api/bids/:id/strategy` | VIEW roles | current + full version history |
| POST | `/api/bids/:id/strategy/generate` | MANAGE roles | pure `buildBidStrategy` + persist |
| POST | `/api/bids/:id/strategy/approve` | APPROVE roles | 409 on blockers unless ADMIN override |
| GET | `/api/bids/:id/evaluation` | VIEW roles | |
| GET | `/api/bids/:id/requirements` | VIEW roles | |
| GET | `/api/bids/:id/evidence-needs` | VIEW roles | |
| GET/POST | `/api/bids/:id/tasks` | VIEW / MANAGE roles | |
| GET | `/api/bids/:id/milestones` | VIEW roles | live AT_RISK/MISSED |
| GET/POST | `/api/bids/:id/questions` | VIEW roles (incl. RESEARCHER on POST) | never an invented answer |
| GET | `/api/bids/:id/risks` | VIEW roles | |
| GET | `/api/bids/:id/readiness` | VIEW roles | computed live |

Every endpoint: `requireAuth` → `requireRole` → resolves `agencyId` from the authenticated session (never
the request body/query) → `loadOwnedProject` (404 on cross-agency or missing) → reads via the caller's
RLS-scoped client, writes via the service-role client only after the above checks.

## 13. UI

`apps/web/src/pages/bids.tsx` (routes `/bids`, `/bids/:id`, already present in `ROUTE_PATTERNS`) →
`apps/web/src/components/bids/BidStrategyDashboard.tsx` + `apps/web/src/hooks/useBidStrategy.ts`.

- `/bids` — list of Bid Projects (Project name, Status, Priority, Bid Effort, Target submission date).
- `/bids/:id` — tabs: Overview, Strategy, Evaluation, Requirements, Evidence Needs, Tasks, Milestones,
  Questions, Risks, Readiness (Activity tab from the spec's §31 list was not built in this pass — see
  Known Limitations). Overview shows tender/organisation-adjacent fields available on the project row,
  Opportunity Score snapshot, Bid Effort, Owner, Strategy version, and a Readiness card.
- Reuses the existing `Badge`/`Tabs`/`Card` components and colour conventions from Phases 4/7/8/9/10/11 —
  no new visual system introduced.

## 14. Phase 13 handoff

Phase 13 (**Evidence Matching & Portfolio Intelligence** — "which actual agency case studies/clients/
projects/team members/documents best support each requirement and evaluation criterion?") receives, for
each Bid Project:

- Bid Project (id, status, priority, bid_effort, owner, dates)
- Tender (via `tender_id` — full Phase 2/5 tender record)
- Final Bid Decision (via `bid_decision_run_id` — Phase 11's system/human/final decision, unchanged)
- Opportunity Score (`overall_score_snapshot`, plus the live Phase 10 run if still current)
- Strategy Version (`bid_strategies.version`, `.status`, `.is_current`)
- Strategic Objective / Strategy Summary (`bid_strategies.objective`/`strategy_summary`)
- Client Priorities / Tender Priorities (`bid_strategy_priorities`)
- Win Themes (`bid_win_themes`, with `source_type`/`source_id` for traceability)
- Differentiators (`bid_differentiators` — human-authored only)
- Evaluation Strategy (`bid_evaluation_strategies`, one per criterion)
- Requirement Response Plan (`bid_requirement_plans`, one per mandatory requirement)
- Evidence Needs (`bid_evidence_needs` — the exact set Phase 13 should attempt to satisfy)
- Evidence Gaps (the subset of evidence needs with `status != SATISFIED`)
- Risks (`bid_risks`), Assumptions (`bid_assumptions`), Open Questions (`bid_questions`)
- Workstreams (`bid_workstreams`), Tasks (`bid_tasks`), Milestones (`bid_milestones`)
- Readiness (`calculateBidReadiness` output: status, blockers, warnings, completeness)
- Strategy Status and Version (for staleness-awareness)

Phase 12 does **not** implement evidence matching, case-study scoring, or automatic evidence attachment —
`bid_evidence_needs.current_count` only increases when a human explicitly records that they attached
something; Phase 13 is expected to be the first phase that reads agency case studies/documents/team members
and proposes matches against these evidence needs.

## 15. Known Limitations (Phase 12-specific, in addition to all carried-forward limitations — see the
completion report)

- `bid_readiness_snapshots` exists in the schema but `GET /api/bids/:id/readiness` computes live and does
  not yet persist a snapshot row (or a `BID_READINESS_RECALCULATED` audit event) on every read — only the
  service-role store's `computeAndSaveReadiness` helper (unused by the current route) does that.
- Differentiators and Risks have no dedicated human-authoring write endpoint yet — the tables, CHECK
  constraints, and read routes exist and are tested, but only `buildBidStrategy` populates Risks
  automatically; a human cannot yet add a differentiator or an ad-hoc risk through the API.
- Milestone AT_RISK/MISSED status is computed live at read time and not written back to the `status`
  column, so a milestone list fetched by a different client (e.g. a future notification job) would need to
  run the same pure function itself rather than trusting the stored column.
- No dedicated `isStale` boolean is surfaced on the strategy DTO returned by `GET /api/bids/:id/strategy` in
  this pass, though the underlying `isCurrentStrategyStale` function and its snapshot mechanism are complete
  and available to wire in.
- No "Activity" tab (spec §31's eleventh detail tab) was built — every other structured item's own tab
  already surfaces its own change history implicitly (e.g. strategy version history); a unified
  cross-entity activity feed was left for a later pass.
- The evaluation-weight threshold used to decide "significant enough for a win theme/HIGH priority" is a
  single hard-coded constant (20) rather than a per-agency configurable value (unlike Phase 11's bid policy
  thresholds) — documented in `docs/DECISIONS.md`.
- No dashboard-level filters (Status/Bid Decision/Owner/Readiness/Priority/Submission date, per §30) were
  built on `/bids` beyond the underlying data being present on each row — only a flat list renders today.
