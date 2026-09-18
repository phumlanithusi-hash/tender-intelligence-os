# Outcome Intelligence (Phase 17)

Awards, procurement outcomes, win/loss intelligence, and the
foundation for evidence-based procurement learning. This closes the
loop: DISCOVER → VERIFY → QUALIFY → SCORE → BID/NO-BID → STRATEGY →
EVIDENCE → PROPOSAL → SUBMISSION → RECEIPT → **AWARD/OUTCOME →
WIN/LOSS → ANALYSE → LEARN**.

## 1. Three layers, kept structurally separate

1. **FACT** — `tender_outcomes`: what an authoritative source says
   happened to the tender (winner, award value, status). Public
   procurement data, shared across agencies.
2. **HUMAN REASON / OUR RESULT** — `bid_outcomes` + `loss_reasons`:
   what happened to *our* bid, and (only when supported by evidence or
   a human) why. Agency-scoped, never public.
3. **SYSTEM INFERENCE / LEARNING** — `outcome_decision_time_features` /
   `outcome_result_features`: descriptive analytics and the historical
   learning dataset. Never presented as fact, never used to
   automatically change any other engine.

Every important field carries a `truth_status`
(VERIFIED/INFERRED/UNVERIFIED/UNKNOWN) and a `provenance`
(OFFICIAL_SOURCE/TENDER_DOCUMENT/PROVIDER_RECEIPT/AGENCY_RECORD/
HUMAN_REPORTED/SYSTEM_CALCULATED/OTHER).

## 2. Data model

- `tender_outcomes` (extends the Phase 2 `awards` table, cross-linked
  via `award_id`) — append-only/versioned: a correction inserts a new
  row (`supersedes_id`) and marks the old one `is_current = false`.
  Shared catalogue table (RLS: select-only for any authenticated user,
  service-role-only writes), same convention as `awards`.
- `outcome_conflicts` — one row per detected field-level disagreement
  between two sources. `status`: OPEN/RESOLVED/DISMISSED. Never
  auto-resolved.
- `bid_outcomes` — our result for one `bid_strategy_projects` row:
  `our_result` (NOT_SUBMITTED/SUBMITTED/WON/LOST/DISQUALIFIED/
  WITHDRAWN/UNKNOWN), rank/score/winning-score, disqualification
  reason, `reconciliation_basis` (the human-readable derivation
  trail). Agency-scoped RLS.
- `loss_reasons` — zero, one (primary) or many per `bid_outcomes` row.
  Category enum matches spec §19 exactly. Provenance is a *separate*
  vocabulary (OFFICIAL/HUMAN_REPORTED/SYSTEM_INFERRED/UNKNOWN) from
  `tender_outcomes.provenance` — a loss reason from an adjudication
  report is OFFICIAL; one typed in by an account manager is
  HUMAN_REPORTED.
- `competitors` / `competitor_activity` (Phase 2, extended) — added
  `normalized_name`, `registration_number`, `website`, `province`,
  `entity_type`, `first_seen_at`/`last_seen_at`, `data_quality`
  (OBSERVED/VERIFIED/INFERRED/UNKNOWN) to `competitors`; added
  `result` (BIDDER/WINNER/SHORTLISTED/DISQUALIFIED/UNKNOWN), `rank`,
  `evidence_document_id` to `competitor_activity`.
- `outcome_decision_time_features` — one immutable row per bid
  project, captured at (or reconstructed from) the moment of the bid
  decision. Never editable after insert (a trigger enforces this,
  mirroring `bid_submission_receipts`'s evidence-field immutability).
- `outcome_result_features` — one row per bid project, the *only*
  table allowed to carry `award_value`/`loss_reason_primary`/
  `winning_score`/`outcome` for learning purposes.

See `database/migrations/20260912200000_awards_outcomes_intelligence.sql`
for the full DDL, and `database/src/__tests__/outcomes.test.ts` for the
RLS/constraint/immutability test suite (12 tests).

## 3. Bid/outcome reconciliation

`apps/api/src/lib/outcomes/reconciliation.ts` — `reconcileBidResult` is
the single deterministic function that turns
`(tender outcome status, our submission status, winner-match, explicit
withdrawal/disqualification)` into our `BidResult`. Fixed precedence:

1. explicit withdrawal → `WITHDRAWN` (always wins)
2. explicit disqualification → `DISQUALIFIED` (never an ordinary loss)
3. `NOT_SUBMITTED` → stays `NOT_SUBMITTED` (never reclassified as LOST)
4. tender outcome `OPEN`/`AWARD_PENDING`/`DISPUTED`/`UNKNOWN` → `UNKNOWN`
5. tender `CANCELLED`/`NO_AWARD`/`WITHDRAWN` → `SUBMITTED` (never a loss)
6. tender `AWARDED` + `VERIFIED_SUBMITTED` + we are the winner → `WON`
7. tender `AWARDED` + `VERIFIED_SUBMITTED` + winner is someone else → `LOST`
8. tender `AWARDED` + `VERIFIED_SUBMITTED` + winner not yet resolved → `UNKNOWN`
9. tender `AWARDED` + only `SUBMISSION_REPORTED` (unverified) → `UNKNOWN`
   (never assumes we actually competed)

This is exercised by 12 unit tests in
`apps/api/src/lib/outcomes/__tests__/reconciliation.test.ts` and wired
live in `GET /api/bids/:id/outcome`, which derives `submissionStatus`
from Phase 16's `bid_submission_executions`/`bid_submission_receipts`
and `weAreWinner` from `matchWinnerToAgency`
(`apps/api/src/lib/outcomes/winnerMatch.ts`, gap-close addition).

**Winner-to-agency matching** (`matchWinnerToAgency`) checks two
signals, in a fixed, never-overridden order:

1. **Registration number** (`agencies.registration_number` vs
   `tender_outcomes.winner_registration_number`, whitespace/punctuation-
   normalised) — the strongest signal, checked first whenever *both*
   sides have one recorded. If both are present, this is authoritative:
   it is never overridden by a name-based guess, even when the names
   also happen to agree or disagree — a shared/similar trading name is
   exactly the ambiguous case a registration number exists to resolve,
   so letting a name match override a disagreeing registration number
   would be a false positive (or a false negative) by construction.
2. **Name** (case-insensitive, trimmed) — the fallback, used only when
   at least one side is missing a registration number.
3. **`INSUFFICIENT_DATA`** → `weAreWinner = null` (UNKNOWN) when neither
   signal can be computed on either side — never a guess.

10 unit tests in `apps/api/src/lib/outcomes/__tests__/winnerMatch.test.ts`
cover: registration-number match despite differing names, registration-
number mismatch despite *identical* names (the false-positive-prevention
case), whitespace/punctuation tolerance in registration numbers, the
one-sided-registration-number name fallback (both directions), a
neither-side-has-one name fallback, a name mismatch reported as `false`
(not `null`), and every `INSUFFICIENT_DATA` combination. The response of
`GET /api/bids/:id/outcome` now also carries `winnerMatchBasis`
(`REGISTRATION_NUMBER`/`NAME`/`INSUFFICIENT_DATA`) so a reviewer can see
which signal produced `weAreWinner`.

## 4. Conflicts and verification

- `detectConflict` (conflicts.ts) — two disagreeing values on the same
  field are *always* routed to an `outcome_conflicts` row with
  `status = OPEN`, regardless of relative authority level. Authority
  level is metadata for the human reviewer, never an auto-resolution
  rule.
- `outcomeIdentityKey` — deterministic dedup key
  (tender_number|organisation|winner|date) for the same award seen
  from multiple sources; two candidates with the *same* identity are
  linked, a different winner/date is a conflict, never a silent
  merge.
- `transitionOutcomeReview` (stateMachine.ts) — DISCOVERED →
  EVIDENCE_ATTACHED → HUMAN_REVIEW → VERIFIED. `VERIFIED` requires both
  attached evidence and an allowed reviewer role; nothing else can
  reach it. `POST /api/outcomes/:id/verify` enforces the same gate
  server-side (422 `NO_EVIDENCE` if no source is attached).

## 5. Metrics (all with numerator/denominator/completeness)

`apps/api/src/lib/outcomes/metrics.ts` implements every rate from spec
§27 (`rateWithCompleteness`/`computeCoreMetrics`): submission rate, bid
rate, win rate, loss rate, disqualification rate, withdrawal rate,
no-award rate. **Division by zero always returns `rate: null`**, never
`NaN`/`Infinity`/0. Every returned rate also carries
`insufficientSample` (below `MIN_MEANINGFUL_SAMPLE_SIZE = 5`), and the
UI (`OutcomesDashboard.tsx`) renders that as a visible caveat badge,
never silently.

`winLoss.ts` adds the funnel (`buildOutcomeFunnel`) and grouped
win-rate-by-category (`buildGroupedWinRate` +
`groupedMetricCaveat`) — a tiny sample is *always* caveated, never
presented as a "strongest category".

`awardAnalytics.ts` adds value bands (`valueBand`, six configurable
bands from spec §32), financial summaries (`summarizeFinancials` —
UNKNOWN values are excluded, never coerced to 0) and price variance
(`calculatePriceVariance` — labelled SYSTEM_CALCULATED, phrased as an
observed difference, never a causal claim).

`competitorAnalytics.ts` (`summarizeCompetitor`) reports observed
counts only ("appears in N recorded tenders with M recorded wins"),
never a fabricated "true market win-rate", and treats zero recorded
activity as *absence of data*, never as evidence of absence from the
market.

## 6. Bid/no-bid calibration

`winLoss.ts`'s `calibrationOutcomeForDecision` maps a `NO_BID` decision
to `COUNTERFACTUAL_UNKNOWN` unconditionally — a decision never to bid
can never be scored as a loss, because we never learn what would have
happened. A `BID` decision reflects the actual recorded result.
`buildCalibrationTable` aggregates counts per (decision, outcome) pair
for the learning dashboard — descriptive only, never framed as
"prediction accuracy".

## 7. The learning foundation and the data-leakage boundary

This is the part of the phase given the most engineering weight, per
spec §78/§79/§80/§113.

- `DecisionTimeFeatures` (types.ts) is a TypeScript type that
  **structurally cannot hold** `awardValue`/`winner`/`winningScore`/
  `lossReasonPrimary`/`outcome`/`submissionSuccess` — those fields do
  not exist on the type at all.
- `buildDecisionTimeFeatures` (learningFeatures.ts) additionally runs
  `assertNoOutcomeLeakage` at runtime against its raw input object and
  **throws** if any of those forbidden keys is present — so even a
  caller passing an over-broad object is caught, not just the type
  system. Covered by
  `apps/api/src/lib/outcomes/__tests__/learningFeatures.test.ts`.
- `OutcomeFeatures` is the *only* type allowed to carry those
  post-outcome fields, built by the separate `buildOutcomeFeatures`.
- At the database layer, the same split is enforced structurally by
  two separate tables (`outcome_decision_time_features` vs
  `outcome_result_features`) rather than one wide table with optional
  columns — there is no query that can accidentally join a
  "before-decision" view to a "not yet known" fact.
- `outcome_decision_time_features` rows are immutable after insert (a
  Postgres trigger rejects any `UPDATE`), so a later scoring-algorithm
  change can never rewrite what was actually known at decision time
  (spec §44/§46).
- `filterEvidenceAvailableAtDecision` enforces temporal integrity: a
  piece of evidence/certificate dated after the decision timestamp is
  excluded from "available at decision time", however obviously
  relevant it looks today.
- `computeLearningReadiness` returns a plain readiness count (bids ×
  verified submissions × verified outcomes × complete snapshots →
  "learning-ready records") and its note text is asserted, in tests,
  to never claim the system "has learned" anything.
- `buildLearningStatement` is the single choke point every
  learning-dashboard sentence must pass through: it labels the
  statement OBSERVATION or RECOMMENDATION, rejects causal language
  ("caused"/"guarantees"/"proves"/"will win") via
  `assertNoCausalLanguage`, and requires a RECOMMENDATION to be
  phrased as a suggestion to review — never an imperative rule change.
- **Nothing in this phase writes back into `scoring_configuration_versions`,
  `bid_policies`, qualification rules, evidence-matching weights, or
  bid strategy config.** There is no code path from the learning layer
  back into any other engine's configuration tables.
- **No win-probability field exists anywhere in this phase.**

## 8. API

All routes in `apps/api/src/routes/outcomes.ts`, registered in
`app.ts`. Role-gated via the existing `requireRole`/`requireAuth`
middleware; `OUTCOME_MANAGE_ROLES = [ADMIN, BID_MANAGER]`,
`OUTCOME_VERIFY_ROLES = [ADMIN, BID_MANAGER, REVIEWER]`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/outcomes` | shared tender-outcome facts, filter by tenderId/outcomeStatus, paginated (`limit`, max 100) |
| GET | `/api/outcomes/:id` | one outcome + its conflicts |
| POST | `/api/outcomes` | record a new/superseding outcome; auto-detects a winner-name conflict against the current record |
| PATCH | `/api/outcomes/:id` | notes only — fact fields are never edited in place |
| POST | `/api/outcomes/:id/verify` | human verification gate (422 if no evidence attached) |
| GET | `/api/outcomes/conflicts` | cross-outcome list of open/resolved/dismissed conflicts (status filter), backs the conflict-review panel |
| GET/POST | `/api/outcomes/:id/conflicts` | list / manually flag a conflict on one outcome |
| POST | `/api/outcomes/conflicts/:id/resolve` | RESOLVED or DISMISSED, requires resolver id |
| GET | `/api/tenders/:id/outcome` | tender-scoped public outcome + conflicts, backs the tender-detail Outcome tab |
| GET | `/api/bids/:id/outcome` | agency-scoped: reconciles + upserts the current `bid_outcomes` row, returns loss reasons and a follow-up recommendation |
| POST | `/api/bids/:id/outcome/loss-reasons` | record a structured loss reason against the current bid outcome |
| GET | `/api/analytics/outcomes` | agency-scoped core metrics + funnel |
| GET | `/api/analytics/win-loss` | grouped win-rate by category, plus a filterable `rows` array (result/category/province) backing the win/loss table |
| GET | `/api/analytics/competitors` | paginated (`page`/`pageSize`), filterable (`search` by name, `province`, `category` via competitor_activity→tenders) descriptive competitor directory data |
| POST | `/api/analytics/competitors` | upsert a competitor by `normalized_name` (role-gated, `OUTCOME_MANAGE_ROLES`), emits `COMPETITOR_RECORDED` audit |
| GET | `/api/analytics/learning` | learning readiness |

Route paths were checked against every existing `routes/*.ts` file
first (following the convention documented in
`routes/submissionExecution.ts` and `docs/DECISIONS.md`) — none of the
above collide with an existing route.

Public procurement facts (`/api/outcomes*`) never expose an agency's
internal fields (our score, internal notes, internal loss-reason
detail) — those live only on the agency-scoped `/api/bids/:id/outcome`
family (spec §73).

## 9. UI

- `apps/web/src/pages/OutcomesDashboard.tsx` at `/outcomes` (added to
  the "Bids" nav section in `AppShell.tsx`) — win/loss/disqualification/
  submission-rate tiles (each with its numerator/denominator/
  completeness and a small-sample badge), the outcome funnel, win-rate
  by category (with sample-size caveats), a filterable **win/loss
  table** (`WinLossTable`, server-side filter by result, re-queries
  `/api/analytics/win-loss`), a minimal **conflict-review panel**
  (`ConflictReviewPanel` — lists open conflicts with both disagreeing
  values and discovery date, and lets an `OUTCOME_VERIFY_ROLES` user
  resolve or dismiss with an optional note, via
  `POST /api/outcomes/conflicts/:id/resolve`), and historical learning
  readiness with the "never a win probability, never an automatic
  rule change" note rendered directly in the UI.
- `apps/web/src/components/tenders/OutcomeTab.tsx` — a new "Outcome"
  tab on the tender-detail page (`TenderDetail.tsx`): outcome status,
  winner, award value, decision date, truth-status/provenance badges,
  any open conflicts (existing vs conflicting values), and a "Verify
  outcome" action gated by `OUTCOME_VERIFY_ROLES` (422s without
  attached evidence). Renders "Outcome UNKNOWN" as a first-class empty
  state when no outcome is recorded yet.
- `apps/web/src/components/bids/BidStrategyDashboard.tsx` — a new
  "Outcome" tab (`BidOutcomeTab`) on the bid-project dashboard: our
  result, our score vs the winning score, the reconciliation basis
  text, the **winner match basis** (`REGISTRATION_NUMBER`/`NAME`/
  `INSUFFICIENT_DATA`, gap-close round 2 — so a reviewer can see which
  signal `matchWinnerToAgency` used, not only the resulting WON/LOST),
  a follow-up-due banner (never an automatic loss), and recorded loss
  reasons with category/primary/provenance.
- `apps/web/src/hooks/useOutcomes.ts` — typed hooks over every
  endpoint above (`useTenderOutcome`, `useBidOutcome`,
  `useOpenConflicts`, `useResolveConflict`, `useVerifyOutcome`,
  `useWinLossByCategory` now filter-driven), converted to the shared
  `AsyncState` union via `toAsyncState` so loading/empty/error/success
  are always rendered explicitly (never a bare number with no
  context).
- `UNKNOWN` is rendered as the literal string "UNKNOWN" wherever a rate
  or bid result cannot be computed — never coerced to 0% or hidden.
- `apps/web/src/pages/CompetitorsDirectory.tsx` at `/competitors`
  (gap-close addition, replacing the prior placeholder at that route)
  — a standalone browse/search/filter page over
  `GET /api/analytics/competitors`: search by name (debounced,
  server-side), filter by province, a data-quality badge, and per-
  competitor observed-activity counts (bidder/winner/shortlisted/
  disqualified — from `competitor_activity.result`, never a market-
  share estimate), paginated with page/pageSize/total from the server.
  See §15 for the decision to build this here rather than leave the
  Phase-20-reserved placeholder untouched.

`apps/web/src/hooks/useOutcomes.ts` also gained `useCompetitors`,
mirroring the same `AsyncState`/server-side-filtering convention as
every other hook in the file.

## 10. Security

- RLS on every new table (see migration file), following the two
  existing conventions exactly: shared catalogue (`tender_outcomes`,
  `outcome_conflicts`) select-only for any authenticated user;
  agency-owned (`bid_outcomes`, `loss_reasons`,
  `outcome_decision_time_features`, `outcome_result_features`)
  `agency_id = current_agency_id()` select-only. All writes are
  service-role only, via `apps/api/src/lib/outcomes/*` — verified by
  `database/src/__tests__/outcomes.test.ts`.
- Audit logging: `OUTCOME_CREATED`, `OUTCOME_UPDATED`,
  `OUTCOME_VERIFIED`, `OUTCOME_CONFLICT_CREATED`,
  `OUTCOME_CONFLICT_RESOLVED`, `WIN_RECORDED`, `LOSS_RECORDED`,
  `LOSS_REASON_ADDED`, and `COMPETITOR_RECORDED` (emitted from
  `POST /api/analytics/competitors`) are written from
  `routes/outcomes.ts` into the existing `audit_logs` table (free-text
  `action` column — no schema change needed). `ANALYTICS_GENERATED` is
  documented as a further audit action to add if/when an analytics-
  caching layer is built (not needed for the current live-computed
  endpoints).
- Internal vs public data: see §8 above.
- Evidence storage: no new binary evidence storage was introduced in
  this phase; `source_document_id`/`source_evidence_ref` reference the
  existing Phase 6/15 document/storage architecture, which remains
  private-by-default.

## 11. AI boundary

No AI calls were added in this phase (consistent with the sandbox's
confirmed `api.openai.com` network restriction, and with spec §76's
explicit permission to skip AI this phase). Every outcome/loss-reason/
conflict field is either human-entered or reconciled by the
deterministic engine above — nothing is AI-inferred, so there is
nothing for a prompt-injection attack in an award document to
influence.

## 12. Explicitly NOT built (spec §112 scope boundary)

- No win-probability field or model.
- No machine-learning model of any kind.
- No automatic change to scoring weights, bid/no-bid thresholds,
  qualification rules, evidence-ranking weights, or strategy rules.
- No autonomous procurement decisions (submit/withdraw/price/strategy).
- No external competitor surveillance or private-data gathering.
- No live outcome-source scanning — see §14.

## 13. Testing

- **Unit** (`apps/api/src/lib/outcomes/__tests__/*`): 74 tests across
  reconciliation, metrics, award analytics, win/loss, conflicts,
  learning features (including the leakage-guard and temporal-
  integrity tests), state machine, provenance and competitor
  analytics, and (gap-close) 10 winner-matching tests covering the
  registration-number path, its false-positive-prevention guarantee,
  and the name-match fallback.
- **Database** (`database/src/__tests__/outcomes.test.ts`): 12 tests —
  RLS agency isolation (bid_outcomes visible only to its own agency;
  tender_outcomes shared), service-role-only writes, one-current-per-
  tender/per-project uniqueness, append-only correction (a superseding
  outcome row alongside the untouched original), `VERIFIED` requiring
  a verifier, at-most-one-primary loss reason, conflict
  create/resolve, decision-time feature immutability, one-row-per-
  project uniqueness on both feature tables, and malformed-UUID
  rejection.
- **E2E** (`tests/e2e/outcomes.spec.ts`, registered in
  `playwright.config.ts`'s `chromium-fixture-auth` project): **21 new
  Phase 17 scenarios** across three authoring rounds —
  - *Original round (13):* tender-detail outcome display (losing
    tender), unknown-outcome display, cancelled tender (not a loss),
    conflicting award detection, verify outcome, bid-detail outcome
    display (winning), disqualified bid, no-bid≠loss/not-submitted≠lost,
    outcome follow-up, agency isolation, win/loss dashboard, filter
    outcomes (server-side), conflict resolution.
  - *First gap-close (1):* competitor directory search/filter.
  - *Second gap-close, reviewer-requested (7):* official outcome
    ingestion reflected through verification (OFFICIAL_SOURCE
    provenance, evidence attached at ingestion, truth_status flips to
    VERIFIED without rewriting provenance); conflict dismissal with a
    reason (distinct from the original round's Resolve-path test);
    submitted bid with no verified tender outcome shown as UNKNOWN with
    a follow-up banner on both the bid page and the win/loss table;
    NOT_SUBMITTED/WITHDRAWN/a cancelled-tender SUBMITTED row all listed
    in the win/loss table but never rendered as a loss; AWARDED +
    VERIFIED_SUBMITTED + registration-number-matched winner → WON, with
    the match basis shown; AWARDED + VERIFIED_SUBMITTED + winner
    resolved to a different entity → LOST, never WON; a registration-
    number mismatch despite an identical winner name → still LOST, the
    registration-number disagreement is never overridden by the
    matching name (the winnerMatch.ts false-positive-prevention
    guarantee, now proven end-to-end through the outcome API/UI, not
    only at the unit level).

  Historical feature-snapshot leakage protection (spec §79) remains a
  unit-level (`learningFeatures.test.ts`), not E2E, guarantee — none of
  the 21 scenarios touch the decision-time-feature UI surface (there
  isn't one), so this boundary was neither exercised nor weakened by
  this round.

  Combined with the pre-existing 72 scenarios from Phases 1-16, the
  full E2E suite is **93/93 passing**.

## 14. Known limitations (Phase 17, final)

- **Outcome ingestion is manual/API-only, not live.** Per spec §56/§103,
  no live outcome-source scanning was implemented or claimed — outcomes
  are recorded via `POST /api/outcomes` (human or a future adapter),
  never scraped. **LIVE OUTCOME INGESTION NOT VALIDATED.** This remains
  out of scope by design — it was not part of the gap-close ask.
- **Analytics are computed live, not cached.** Given the current data
  volumes this is cheap (a handful of `count`/`select` queries per
  request); no caching layer was added — documented as a decision
  (spec §98 permits this), not an oversight.
- **Winner-to-agency matching still has no fuzzy-matching step beyond
  registration-number-or-exact-name.** The gap-close round added
  registration-number matching as the primary signal (§3) with a name
  fallback, which resolves the most common false-negative case (a
  winner recorded under a differently-formatted legal name that still
  shares a registration number with the agency). A winner recorded
  under a *different* name with *no* registration number on either
  side (or a typo in one) still resolves to `weAreWinner = null`
  (UNKNOWN) rather than a guess — this is a deliberate refusal to
  guess, not a bug, but it does mean some genuine wins/losses will
  still show as UNKNOWN until a registration number or an exact name
  is recorded.
- **The competitor directory has no category filter exposed in the UI**
  (only search-by-name and province) even though the API supports
  `category`; the UI was kept to the two filters most directly useful
  for a first pass. Category filtering can be added to the page
  without any API change.

## 15. Carried-forward limitations verified still present

Re-checked against the current repository (not assumed): the eTenders
adapter remains network-restricted in this sandbox (configured, not
live-validated); OpenAI-backed features remain sandbox-network-
restricted; Supabase Storage remains the same abstraction introduced in
Phase 15/16 (still requires a real Supabase project to be live); Phase
16's real portal/email/API submission integrations remain
adapter-seamed with mock/manual paths, not live; the other
Phase 8-16 limitations listed in this task's brief were not touched by
Phase 17 and are assumed unchanged (not re-verified line-by-line in
this session beyond running their full existing test suites, which
remain green).
