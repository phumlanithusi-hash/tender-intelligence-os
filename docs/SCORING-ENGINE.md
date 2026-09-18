# Scoring Engine (Phase 10 — Evaluation & Opportunity Scoring)

This document describes the deterministic Opportunity Scoring Engine: what it computes, exactly how,
and how it consumes Phase 8 (Qualification) and Phase 9 (Requirement & Evaluation Extraction) plus
agency evidence. It complements `docs/QUALIFICATION-ENGINE.md` and
`docs/REQUIREMENT-EVALUATION-EXTRACTION.md` rather than repeating them.

## 0. Two unrelated things this is NOT, and must never be confused with

1. **`shared/constants/src/scoring.ts`** (`SCORING_WEIGHTS`/`SCORE_CLASSIFICATION_BANDS`) is an unused
   Phase-0 placeholder written before Phase 2's schema existed. It is not wired to any table, route, or
   UI. Phase 10's engine has its own file (`shared/constants/src/opportunityScoring.ts`) and never
   imports from `scoring.ts`.
2. **The pre-existing Phase 3 "Score"/"Risk" tabs** (`ScoreTab`, `useTenderScore`, backed by the
   `tender_scores_risks` migration and `BID`/`NO_BID`/`PRIORITY_BID` vocabulary in
   `OpportunityClassBadge`) are a separate, earlier feature this phase does not touch, extend, or
   reuse. Phase 10's own tab is labelled **"Scoring Engine"** in the tender detail tab bar specifically
   to avoid colliding with the pre-existing tab already labelled "Opportunity Score" — see §8 API and
   §9 UI below, and `docs/DECISIONS.md`.

Both exist in the codebase; neither is part of Phase 10; this document only describes the genuinely new
system.

## 1. Objective and boundary

Given a tender's Phase 8 qualification result, Phase 9 requirements/evaluation framework, and this
agency's evidence, answer: *"How strong is this opportunity for our agency, given what we can actually
verify right now?"* — deterministically, explainably, and reproducibly.

This is **not** Bid/No-Bid, win probability, competitor analysis, proposal generation, or bid strategy.
The engine's only output is a **DECISION SIGNAL** (`HIGH_PRIORITY`/`PROMISING`/`REVIEW`/`LOW_PRIORITY`/
`BLOCKED`/`INSUFFICIENT_DATA`) plus a fully explained numeric score. Phase 11 is expected to combine
this with explicit business rules to produce an actual Bid/No-Bid recommendation — see §11 (Phase 11
Handoff).

## 2. Design principles

- **Deterministic**: identical (tender state, agency state, scoring configuration) → identical result,
  always. No AI call anywhere in the scoring path.
- **Explainable**: every component has drivers, risks, and unknowns, each traceable to a real evidence
  reference or a named rule (`ScoringEvidenceRef` — `TENDER`/`AGENCY`/`RULE` variants).
- **Repeatable/Auditable**: a scoring run records exactly which qualification run, requirement/criterion
  versions, and agency-evidence timestamps it consumed (`input_snapshot`).
- **Versioned**: both the scoring model's own configuration (`scoring_configuration_versions`) and every
  run's config reference are queryable; nothing overwrites a historical run.
- **Evidence-grounded**: UNKNOWN is a first-class state everywhere, never silently collapsed into a
  positive or negative number.

## 3. Score dimensions and weights

Six dimensions, each independently `KNOWN`/`UNKNOWN`/`NOT_APPLICABLE`, with configurable weights summing
to 1 (default configuration, seeded in
`database/migrations/20260911220000_opportunity_scoring.sql`):

| Dimension              | Default weight | Source module                                        |
|-------------------------|---------------|-------------------------------------------------------|
| QUALIFICATION           | 0.20          | `lib/scoring/dimensions/qualification.ts`             |
| REQUIREMENT_COVERAGE     | 0.20          | `lib/scoring/dimensions/requirementCoverage.ts`       |
| EVALUATION_FIT           | 0.20          | `lib/scoring/dimensions/evaluationFit.ts`             |
| EVIDENCE_STRENGTH        | 0.15          | `lib/scoring/dimensions/evidenceStrength.ts`          |
| COMMERCIAL_FIT           | 0.15          | `lib/scoring/dimensions/commercialFit.ts`             |
| STRATEGIC_FIT            | 0.10          | `lib/scoring/dimensions/strategicFit.ts` (folds in geography, `dimensions/geography.ts`) |

These weights are **internal opportunity-scoring weights** — completely separate, structurally and
conceptually, from Phase 9's `tender_evaluation_criteria.weight` (which describes how the *issuing
organ* scores bidders). Never merge or confuse the two; the engine reads Phase 9 weights only as an
input to EVALUATION_FIT (§3.3), it never writes to them.

### 3.1 QUALIFICATION

Pure lookup: `config.qualificationStatusScoreMap[phase8.overallStatus]` — default
`{ELIGIBLE: 100, ACTION_REQUIRED: 60, REQUIRES_REVIEW: 40, UNKNOWN: 20, NOT_ELIGIBLE: 0}`. No qualification
run at all → `UNKNOWN`, never a fabricated score. `NOT_ELIGIBLE` also arms the
`MANDATORY_QUALIFICATION_FAILURE` hard gate (§5).

### 3.2 REQUIREMENT_COVERAGE

Every Phase 9 `tender_requirements` row is classified into `SUPPORTED`/`PARTIALLY_SUPPORTED`/`UNKNOWN`/
`ACTION_REQUIRED`/`FAILED`/`NOT_APPLICABLE` by **reusing the already-computed Phase 8 qualification
result for that exact row** (both phases extend the same `tender_requirements` table — see
`docs/QUALIFICATION-ENGINE.md`/`docs/REQUIREMENT-EVALUATION-EXTRACTION.md`). This phase never
re-evaluates a requirement against agency evidence itself. Mapping: `PASS→SUPPORTED`,
`FAIL→FAILED`, `UNKNOWN→UNKNOWN`, `REQUIRES_ACTION→ACTION_REQUIRED`; a requirement with no Phase 8
result at all is `UNKNOWN` (never `FAILED`); a requirement whose `mandatoryStatus` is `INFORMATIONAL` is
always `NOT_APPLICABLE` regardless of any underlying check (no compliance obligation).
`PARTIALLY_SUPPORTED` is defined in the value map for forward compatibility but is not currently
reachable from Phase 8's four-state check status — documented as a limitation (§10).

**Exact formula (§8 of the spec)**: `coverage = weighted_supported_value / weighted_applicable_value`,
where `NOT_APPLICABLE` requirements are excluded from both numerator and denominator, and — because
Phase 9's `tender_requirements` carries no per-requirement weight column — **every applicable
requirement is weighted equally** (documented fallback, never an invented importance ranking).
`config.requirementCoverageValueMap` (default `SUPPORTED=1, PARTIALLY_SUPPORTED=0.5, UNKNOWN=0,
ACTION_REQUIRED=0, FAILED=0`) supplies the per-status value. A single mandatory `FAILED` requirement is
still surfaced as an explicit risk even when the aggregate coverage number looks high (e.g. "90%") — and
independently arms the `MANDATORY_REQUIREMENT_FAILURE` hard gate (§5), which is what actually forces
`BLOCKED`, not the numeric score.

Service alignment (§3.5 below) also contributes a risk here when a required service is missing.

### 3.3 EVALUATION_FIT

Uses **only explicit evidence links** recorded in the new
`tender_evaluation_criterion_agency_evidence` table (§6) between a Phase 9 evaluation criterion and a
specific agency evidence record. **No semantic/text matching of any kind is performed** — a criterion
with zero linked evidence rows is `UNKNOWN`, full stop, even if its name obviously resembles something
the agency has evidence for. This is the literal reading of the binding instruction ("if no explicit
link... exists yet, that criterion's fit is UNKNOWN — do not free-associate"). In this phase, nothing
creates a link automatically; a link is either seeded by a human/reviewer action or, in tests, by a
fixture. **Known limitation**: no dedicated UI/API exists yet to create these links interactively — see
§10.

Per-criterion strength (`STRONG`/`MODERATE`/`WEAK`/`UNKNOWN`): counts `VERIFIED`-state linked evidence —
`≥2 verified → STRONG`, `1 verified → MODERATE`, `≥1 linked but 0 verified → WEAK`, `0 linked →
UNKNOWN`. `config.evaluationFitValueMap` (default `STRONG=1, MODERATE=0.6, WEAK=0.3`) supplies the
value; `UNKNOWN` criteria are excluded from the weighted average entirely (never assigned 0).

**Weight fallback (`INTERNAL_FALLBACK`)**: if *any* criterion's tender-stated `weight` is `null`, ALL
criteria use equal internal weighting for this computation only, and `metadata.internalFallbackWeighting
= true` is recorded on the component. The tender's own `tender_evaluation_criteria.weight` column is
never written to by this engine.

**Thresholds** (`gate = true`, `minimum_score` set): a threshold is always recorded but never claimed
`PASS` — this phase cannot compute a bidder-side numeric score for a criterion, so `thresholdStatus` is
always surfaced as a qualitative "cannot currently be assessed" risk, never a fabricated pass/fail.

### 3.4 EVIDENCE_STRENGTH

Equal-weighted average of `config.evidenceStateValueMap` (default `VERIFIED=1, UNVERIFIED=0.5,
UNKNOWN=0, MISSING=0, EXPIRED=0`) over every agency evidence record supplied (certificates, case
studies, references, documents, financial records — via `supabaseScoringStore.fetchAgencyEvidence`).
AI confidence is never read here — only deterministic lifecycle/evidence-status columns already
computed by Phase 2/8 (`agency_certificates.lifecycle_status`, `agency_case_studies.evidence_status`,
etc., mapped by `evidenceStateFromLifecycleStatus`/`evidenceStateFromEvidenceStatus`). Recency (§16 of
the spec) is deliberately NOT modelled with an invented global expiry period — only an explicit
tender-stated recency requirement (captured, if present, as a Phase 9 evaluation criterion or
requirement) would ever narrow this, and no such wiring exists yet (documented limitation, §10).

### 3.5 COMMERCIAL_FIT

Conservative by design. `estimatedValue === null` → `UNKNOWN` (never estimated from similar tenders).
`agencyMinProjectValue === null` (agency has not configured one) → `UNKNOWN`. Otherwise: `estimatedValue
>= agencyMinProjectValue → 100` else `30`, with the comparison itself as the only driver/risk — no other
commercial modelling (contract duration, pricing structure) is scored quantitatively in this phase;
`contractDuration` is carried through as metadata only.

### 3.6 STRATEGIC_FIT (folds in geography)

`agencies.strategic_profile_status !== 'VERIFIED'` → `UNKNOWN` (an agency with an empty
`target_sectors`/`preferred_org_types` array is distinguishable from one that has explicitly confirmed
"we have no sector preference" via this status flag). Otherwise, a **neutral baseline of 50** — Phase 10
deliberately does **not** assume every public-sector tender is strategically desirable by default —
adjusted only by explicit matches: `+25` tender category ∈ agency `target_sectors`, `+15` tender
`entity_type` ∈ agency `preferred_org_types` (or `-15` if the agency has a preference list and this
tender's type is not on it), `±10` for the geography match (§3.7), clamped to `[0, 100]`.

### 3.7 Geography (Phase 10 §20, folded into Strategic Fit)

`lib/scoring/dimensions/geography.ts` compares `tender_geographic_scope` against the new
`agency_geographic_scope` table (mirrors the tender-side table's shape exactly). This **carries forward
the Phase 7/8 textual/FK-lite geography limitation unchanged** — no new province/municipality resolution
architecture was added. No agency geography recorded at all → `UNKNOWN`, never assumed `MATCH`. National
agency coverage matches any tender scope; otherwise province/municipality ids are compared directly.

### 3.8 Service alignment (Phase 10 §19)

`lib/scoring/dimensions/serviceAlignment.ts` is a plain set comparison of `tender_services.service_id`
against `agency_services.service_id` (both already resolved to the shared services taxonomy — no
semantic matching). No tender services classified yet → `UNKNOWN`. A missing mandatory service is a
named `SERVICE_GAP` risk surfaced on `REQUIREMENT_COVERAGE` (it does not change that dimension's numeric
formula, which stays exactly as documented in §3.2 — the gap is visible as an explicit risk instead).

## 4. Overall score and data completeness (the UNKNOWN policy)

```
knownWeight        = Σ weight of every component with status === 'KNOWN'
totalWeight        = Σ weight of every component (≈ 1 for a valid configuration)
dataCompleteness   = knownWeight / totalWeight
overallScore       = knownWeight === 0 ? null
                    : Σ(componentScore × weight for KNOWN components) / knownWeight
```

This is the **documented mechanism (§22 of the spec) for "accounting for UNKNOWN"**: overall score is a
weighted average **renormalised over only the dimensions that are actually known**, so an UNKNOWN
dimension is never silently treated as 0 (which would unfairly punish a merely-incomplete profile) or as
perfect (which would hide missing information). `dataCompleteness` is reported entirely separately, and
the UI (§9) makes explicit that it is *not* a confidence or accuracy percentage and *not* a chance of
winning.

`overallScore` is `null` only when literally every dimension is `UNKNOWN` — a defensive, honest, extreme
case.

## 5. Hard gates (always checked, always all five, always recorded)

`lib/scoring/gates.ts` evaluates exactly these five gate types, **every run**, whether or not they
trigger — so "why isn't this BLOCKED" is answerable from the same persisted record as "why is this
BLOCKED":

1. **MANDATORY_QUALIFICATION_FAILURE** — Phase 8 `overallStatus === 'NOT_ELIGIBLE'`.
2. **MANDATORY_REQUIREMENT_FAILURE** — any `MANDATORY`/`CONDITIONALLY_MANDATORY` requirement classified
   `FAILED` in §3.2 (independent evidence path from #1, though in the common case both fire off the same
   underlying Phase 8 result — this is intentional parallel visibility, not double-jeopardy).
3. **SUBMISSION_DEADLINE_PASSED** — `tenders.closing_date < today (UTC)`. `closing_date`/`closing_time`
   carry **no timezone** in this schema (Phase 2/5 convention, unchanged) — `timezoneUnknown` is
   therefore **always `true`** in this phase's output, and a tender closing exactly *today* is left
   `OPEN` (benefit of the doubt) rather than guessed either way. This is how §30's "CLOSED tender" case
   is folded into the gate layer, per the spec's own suggestion.
4. **COMPULSORY_BRIEFING_FAILURE** — Phase 9 `briefingRequired === true` AND Phase 8-style attendance
   evidence says `NOT_ATTENDED` → `TRIGGERED`; `UNKNOWN` attendance is `UNKNOWN`, **never** an automatic
   pass or fail; `ATTENDED` → `OK`.
5. **CRITICAL_COMPLIANCE_FAILURE** — no distinct deterministic signal exists in the current data model
   beyond what #1/#2 already capture; **always recorded `OK`** in this phase (an honest limitation, not
   a fabricated trigger condition — see §10).

**Precedence** (`lib/scoring/decisionSignal.ts`, exact order, documented once and never reordered without
updating this file):

1. Any gate `TRIGGERED` → **`BLOCKED`** (regardless of score/completeness).
2. `dataCompleteness < config.dataCompletenessInsufficientThreshold` (default `0.5`) → **`INSUFFICIENT_DATA`**.
3. Any dimension in `config.criticalDimensions` (default `[QUALIFICATION, REQUIREMENT_COVERAGE]`) is
   itself `UNKNOWN` → **`INSUFFICIENT_DATA`**, even if overall completeness clears the threshold.
4. `overallScore === null` (defensive fallback, should be unreachable once completeness > 0) →
   **`INSUFFICIENT_DATA`**.
5. Band lookup against `config.decisionBands` (default `80-100 HIGH_PRIORITY / 65-79 PROMISING / 50-64
   REVIEW / 0-49 LOW_PRIORITY`).

The numeric score is **still computed and shown** even when `BLOCKED` — for audit purposes only, never
implying the tender is actually a good idea to pursue.

## 6. Explicit evidence links (new, minimal, Phase 10 mechanism)

`tender_evaluation_criterion_agency_evidence` (agency-scoped, RLS-isolated) records
`(criterion_id, agency_id, evidence_type, evidence_id)` — a deliberately generic, discriminated pointer
into whichever agency evidence table the link targets (`AGENCY_CASE_STUDY`/`AGENCY_CERTIFICATE`/
`AGENCY_REFERENCE`/`AGENCY_DOCUMENT`/`AGENCY_TEAM`/`AGENCY_FINANCIAL_RECORD`), mirroring the existing
generic `agency_evidence` polymorphic pattern from Phase 2. Nothing in this phase populates this table
automatically; it exists so EVALUATION_FIT (§3.3) has an honest, explicit, non-invented signal to
consume, and so a future phase can add a reviewer-facing "link this evidence to this criterion" UI
without a schema change.

## 7. Database

New migration: `database/migrations/20260911220000_opportunity_scoring.sql`. See
`docs/DATABASE.md` §18 for the full table list. In summary:

- `agencies` gained `min_project_value`, `target_sectors`, `preferred_org_types`,
  `strategic_capabilities`, `strategic_profile_status` (all nullable/empty-default; never fabricated).
- `agency_geographic_scope` — new, mirrors `tender_geographic_scope`.
- `tender_evaluation_criterion_agency_evidence` — new, explicit evidence links (§6).
- `scoring_configurations` / `scoring_configuration_versions` — versioned, shared-catalogue-readable
  scoring configuration, seeded with the exact default values from §3.
- `tender_scoring_runs` — append-only, one `is_current` row per `(tender_id, agency_id)`, agency-scoped
  RLS exactly like `tender_qualification_runs`. Carries `input_snapshot` (§8 staleness).
- `tender_score_components` / `tender_score_drivers` / `tender_score_risks` / `tender_score_gates` —
  always exactly six component rows and five gate rows per run (never omitted), agency-scoped via join
  to the parent run.

## 8. Scoring runs: idempotency, versioning, staleness

`lib/scoring/runScoring.ts` mirrors `lib/qualification/runQualification.ts`'s lifecycle exactly, with one
addition — an **idempotency guard** (§47 of the spec): before creating a new run, it compares the
current run's `(scoringConfigurationVersionId, inputSnapshot)` to what a fresh assembly would produce; if
identical, it returns the existing current run rather than creating a pointless duplicate. A new
**scoring configuration version always creates a new run**, even with byte-identical tender/agency state
— configuration changes must remain queryable as distinct, attributable results.

**Staleness** (§46): `input_snapshot` records references (never copies) — the current qualification
run's id/`updated_at`, every consumed requirement's `id`→`version`, every consumed evaluation criterion's
`id`→`version`, the evaluation gate count, the agency row's `updated_at`, and the max `updated_at` across
consumed agency evidence records plus the current criterion-evidence-link count. At **read time**
(`repositories/tenderScoring.ts`), the current snapshot is cheaply rebuilt and compared byte-for-byte
against the stored one; a mismatch sets `run.isStale = true` in the API response (never silently hidden,
never a background job that mutates the run itself — a stale run is exactly what it says, until someone
explicitly re-scores).

## 9. API and UI

API base path is `/api/tenders/:id/opportunity-score...` — **not** `/api/tenders/:id/score...` as a
literal reading of the spec's §37 would suggest, because that exact path already belongs to the
pre-existing Phase 3 legacy score feature (§0). See `apps/api/src/routes/tenderScoring.ts`'s own header
comment for the full explanation. Endpoints, roles (`OPPORTUNITY_SCORE_VIEW_ROLES` =
`ADMIN`/`BID_MANAGER`/`RESEARCHER`, `OPPORTUNITY_SCORE_ACTION_ROLES` = `ADMIN`/`BID_MANAGER`):

```
GET  /api/tenders/:id/opportunity-score              — full explainable response (OpportunityScoreDto)
POST /api/tenders/:id/opportunity-score               — trigger a scoring run (synchronous — no AI call)
GET  /api/tenders/:id/opportunity-score/components
GET  /api/tenders/:id/opportunity-score/drivers
GET  /api/tenders/:id/opportunity-score/risks
GET  /api/tenders/:id/opportunity-score/gates
GET  /api/tenders/:id/opportunity-score/runs
GET  /api/scoring/configurations                      — read-only for any viewer role; no mutation route exists in this phase
```

UI: `apps/web/src/components/tenders/OpportunityScoreTab.tsx`, wired into `TenderDetail.tsx` under a tab
labelled **"Scoring Engine"** (distinct from the pre-existing "Opportunity Score" tab, §0/§9). Shows the
prominent score + `DecisionSignalBadge`, an explicit "Data completeness: NN%" line immediately below it,
the "this is not a prediction of winning" disclaimer, a per-dimension progress-bar breakdown
(`ScoreComponentStatusBadge` distinguishes `KNOWN`/`UNKNOWN`/`NOT_APPLICABLE`), an expandable "Why is
this score what it is?" section with drivers/risks/unknowns as three visually separate lists (never
conflated), and a hard-gate table (`ScoreGateStatusBadge`) with a `BLOCKED` banner shown above the fold,
not buried, when any gate is triggered. No "win probability"/"chance of success"/"AI confidence %" text
appears anywhere on this screen.

## 10. Known limitations (this phase's own, in addition to carried-forward ones)

- No UI/API exists yet to create `tender_evaluation_criterion_agency_evidence` links interactively —
  they can only be seeded directly (tests do this). EVALUATION_FIT will read `UNKNOWN` for every
  criterion in a fresh environment until such links exist.
- `CRITICAL_COMPLIANCE_FAILURE` has no distinct trigger condition in this phase (§5.5) — always `OK`.
- Briefing attendance has no dedicated tracking table (same gap as Phase 8's own store) — always
  `UNKNOWN` in the production Supabase-backed store; only test fixtures can exercise the `ATTENDED`/
  `NOT_ATTENDED` sub-cases end to end.
- `PARTIALLY_SUPPORTED` requirement coverage is defined in configuration but not currently reachable
  (Phase 8's check status has no partial concept).
- Evidence recency (§16) has no wiring to a tender-stated "experience within N years" requirement yet —
  the concept is documented but not consumed.
- Carried forward unchanged from earlier phases: province/municipality FK resolution remains textual
  (Phase 7/8 §21/§42); evidence `page_id` remains unpopulated (Phase 7 §42); Phase 8's unimplemented
  qualification categories; Phase 9's versioning-match heuristic on re-extraction.

## 11. Phase 11 Handoff Contract

Phase 11 (final Bid/No-Bid) can read, per tender+agency, from `GET /api/tenders/:id/opportunity-score`
(or directly from `tender_scoring_runs`/`tender_score_components`/`tender_score_drivers`/
`tender_score_risks`/`tender_score_gates`) without re-deriving any of the following:

- **Overall Opportunity Score** (`run.overallScore`, 0-100 or `null`)
- **Score Components**: Qualification, Requirement Coverage, Evaluation Fit, Evidence Strength,
  Commercial Fit, Strategic Fit — each with status/score/weight/explanation
- **Qualification Status** (`components.QUALIFICATION.metadata.overallStatus`)
- **Requirement Coverage** counts (`components.REQUIREMENT_COVERAGE.metadata.counts`)
- **Evaluation Fit** per-criterion assessed/total (`components.EVALUATION_FIT.metadata`)
- **Evidence Strength** counts (`components.EVIDENCE_STRENGTH.metadata.counts`)
- **Commercial Fit** raw inputs (`components.COMMERCIAL_FIT.metadata`)
- **Strategic Fit** match flags (`components.STRATEGIC_FIT.metadata`)
- **Data Completeness** (`run.dataCompleteness`, 0-1)
- **Hard Gates** — all five, each with `status`/`description`/`evidence` (`gates[]`)
- **Risks** / **Drivers** / **Unknowns** — each evidence- or rule-referenced (`risks[]`/`drivers[]`/`unknowns[]`)
- **Score Version** (`run.scoringConfigurationVersionId`) and **Scoring Run** (`run.id`,
  `run.isCurrent`, `run.isStale`, `run.createdAt`)

Phase 11 must not re-implement any deterministic dimension calculation above — it consumes these as
inputs to its own explicit Bid/No-Bid business rules.
