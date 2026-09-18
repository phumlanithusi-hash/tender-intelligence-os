# Qualification & Compliance Intelligence — Phase 8

Status: implemented 2026-09-11. Answers the core question: "Based on the tender requirements and the
agency's verified records, can this agency potentially qualify for this opportunity?" This is **not**
the Bid/No-Bid engine, not scoring, and not evaluation-points calculation — none of those exist in this
codebase and Phase 8 does not build toward them.

## 1. Requirement model

`tender_requirements` (Phase 2, `20260910200110_tender_requirements.sql`) already existed with a
per-agency `qualification_status` gated by `agency_evidence` — reviewed first per the spec and **extended**
rather than duplicated (`20260911160000_qualification.sql`). New columns:

| column | purpose |
|---|---|
| `category` | `QualificationCategory` — CSD/TAX/B_BBEE/... (configurable vocabulary, `shared/constants/src/qualification.ts`) |
| `mandatory_status` | MANDATORY / CONDITIONALLY_MANDATORY / PREFERENTIAL / INFORMATIONAL / UNKNOWN |
| `source_truth` | reuses Phase 7's `ai_truth_state` (FACT/INFERENCE/UNKNOWN/UNVERIFIED) |
| `requirement_status` | VERIFIED / PROVISIONAL / REQUIRES_REVIEW — a PROVISIONAL row (e.g. one derived from Phase 7's `apparentRequirements`) is still evaluated but must never be presented as a verified rule |
| `rule_type` | which `rules/*.ts` module evaluates it (BOOLEAN/NUMERIC_MIN/.../MANUAL_REVIEW) |
| `rule_config` | JSONB parameters for that rule (e.g. `{ "minTurnover": 10000000 }`) |
| `version`, `superseded_by`, `superseded_at`, `source_document_version_id` | append-only versioning (§6) |

The legacy `requirement_type`/`mandatory`/`qualification_status` columns are untouched — nothing in
Phase 8 writes to them.

## 2. Qualification states (never collapsed into each other)

`PASS` / `FAIL` / `UNKNOWN` / `REQUIRES_ACTION` — every rule module in
`apps/api/src/lib/qualification/rules/` returns exactly one. The binding invariants, enforced by the
rule implementations themselves and covered by unit tests:

- **UNKNOWN never collapses into FAIL.** No agency evidence for a fact → UNKNOWN, always (`rules/boolean.ts`,
  `rules/numeric.ts`, etc.).
- **REQUIRES_ACTION never collapses into PASS.** A missing/expired document, an unattended-but-not-yet-occurred
  compulsory briefing, an unregistered CSD status — all resolve to REQUIRES_ACTION with a concrete `Action`,
  never to a false PASS.
- Mandatory status (`MANDATORY`/`CONDITIONALLY_MANDATORY`/`PREFERENTIAL`/`INFORMATIONAL`/`UNKNOWN`) is never
  inferred just because wording "sounds important" — the evaluator only sets `mandatory: true` on a result when
  `requirement.mandatoryStatus === 'MANDATORY'`.

## 3. Deterministic rule engine

`apps/api/src/lib/qualification/`:

- `types.ts` — the pure-function contract (`QualificationRequirement`, `AgencyEvidenceSnapshot`,
  `EvaluationContext`, `RuleResult`).
- `categories.ts` — category label metadata.
- `rules/{boolean,numeric,date,document,experience,reference,briefing,enum,composite}.ts` — one pure function
  per rule shape.
- `evaluator.ts` — `evaluateRequirement(requirement, agency, context) → RuleResult`, dispatching by category
  (which slice of agency evidence is relevant) and ruleType (which comparison shape). No ruleType, or a
  category this phase has no deterministic check for, resolves to `UNKNOWN` + `requiresHumanReview: true`
  (the same behaviour as an explicit `MANUAL_REVIEW` ruleType) — **never a guess**.
- `status.ts` — `computeOverallStatus`, documented precedence (§5 below), and `summarizeResults`.
- `evidence.ts` — pure evidence-reference shape validation (UUID-shaped, not SQL/path-traversal-shaped) and
  dedupe helpers; a PASS result is application-invariant-checked to carry at least one agency evidence
  reference (`passRequiresAgencyEvidence`), mirroring the Phase 2 DB `CHECK` constraint's intent for the new
  result model.

Every one of these is a pure function: identical `(requirement, agency, context)` in always produces an
identical `RuleResult` out — no hidden I/O, no `new Date()` calls inside a rule (the caller passes `now`
and the tender's own dates via `EvaluationContext`), no randomness. 74 unit tests in
`apps/api/src/lib/qualification/__tests__/` exercise every rule shape, both PROVISIONAL and VERIFIED
requirement paths, and the evaluator's category dispatch, following the Phase 4 `computeSourceHealth`
pure-function precedent.

### Orchestration

`runQualification.ts` (`apps/api/src/lib/qualification/`) is the full lifecycle: idempotency check (one
active run per tender+agency, both application-checked and DB-partial-unique-index-enforced, exactly like
Phase 7's `tender_ai_runs`), fetch requirements + the agency's evidence snapshot, evaluate every
requirement, compute the overall status, persist one `tender_qualification_results` row (+ its evidence +
any `Action`s) per requirement, and mark the run `is_current`. It has **no external network call** — unlike
`runClassification`, the evaluate route awaits it synchronously.

## 4. Mandatory-failure detection (Phase 8 §24)

A **VERIFIED** mandatory requirement's result `FAIL` is a hard blocker: `computeOverallStatus` checks for
this first, unconditionally, before anything else — no aggregate can hide it. `MANDATORY` + `UNKNOWN` →
contributes to `REQUIRES_REVIEW`. `MANDATORY` + `REQUIRES_ACTION` → contributes to `ACTION_REQUIRED`
(only reached once no mandatory FAIL/UNKNOWN exists).

## 5. Overall status precedence (documented exactly, since the spec leaves edge cases to be resolved)

```
1. NOT_ELIGIBLE     — any mandatory requirement's result is FAIL.                    (always wins)
2. REQUIRES_REVIEW  — no mandatory FAIL, but any mandatory requirement is UNKNOWN,
                       OR any requirement at all (any mandatory status) is flagged
                       requiresHumanReview.
3. ACTION_REQUIRED  — no mandatory FAIL/REQUIRES_REVIEW condition, but a mandatory
                       requirement's result is REQUIRES_ACTION.
4. UNKNOWN          — none of the above, but at least one requirement (of any
                       mandatory status) is UNKNOWN.
5. ELIGIBLE         — all mandatory requirements PASS and no unresolved mandatory
                       ambiguity remains.
```

Implemented verbatim in `status.ts::computeOverallStatus`, with the six required test scenarios (all
mandatory PASS, a mandatory FAIL, a mandatory UNKNOWN, a mandatory REQUIRES_ACTION, an optional FAIL not
causing NOT_ELIGIBLE, a preferential failure not causing NOT_ELIGIBLE) plus several precedence-ordering
edge cases in `status.test.ts`.

**"ELIGIBLE" is worded in the UI and API as "no mandatory blocker found based on available evidence"** —
never as a guarantee of qualifying. See `apps/web/src/components/tenders/badges.tsx`'s
`QualificationOverallStatusBadge`.

## 6. Requirement versioning & conflicts

- **Versioning**: a new document/addendum changing a requirement is expected to append a new
  `tender_requirements` row with an incremented `version` and set `superseded_by`/`superseded_at` on the
  prior row — never an update-in-place, mirroring Phase 7's append-only run history. Read routes filter
  `superseded_by is null`.
- **Conflicts**: `tender_requirement_conflicts` records both evidence sides (`evidence_a`/`evidence_b` JSONB)
  when two documents disagree on a requirement value (e.g. original vs. addendum turnover figure). It is
  shared-catalogue-readable (describes the document set, not one agency) and never auto-resolved — a
  requirement whose value is in dispute stays `REQUIRES_REVIEW` until a later addenda-resolution mechanism
  (out of scope for this phase) settles it.

## 7. Agency evidence

Reuses the Phase 2 agency tables (`agencies`, `agency_documents`, `agency_certificates`,
`agency_case_studies`, `agency_references`, `agency_team`, `agency_evidence`) — these already existed,
contrary to the spec's "almost certainly do NOT exist yet" assumption — extended with the minimum new
columns/tables the rule engine needs:

- `agency_financial_records` (new table) — a **verified numeric** annual turnover; `agencies.turnover_band`
  is a text band and cannot back a `NUMERIC_MIN` comparison.
- `lifecycle_status` (new column, `agency_documents`/`agency_certificates`) —
  VALID/EXPIRED/MISSING/PENDING_VERIFICATION/REJECTED/UNKNOWN.
- `agencies.csd_status`/`registration_status` (new columns, reusing the existing `evidence_status` enum),
  `tax_expiry`/`tax_evidence_document_id`.
- `agency_case_studies.service_id`/`client_type`/`project_type`/`geography_text` (new columns) — the
  defined EXPERIENCE-matching dimensions (service, industry, client type, project type, value, year);
  geography stays free text (§9).
- `agency_references.reference_period_start`/`reference_period_end`/`project_similarity_notes` (new columns).

`apps/api/src/lib/qualification/supabaseQualificationStore.ts::getAgencySnapshot` builds the pure
`AgencyEvidenceSnapshot` the evaluator consumes, from real rows only — a field is `null`/empty exactly
when the agency has no verified evidence, and the evaluator treats that as UNKNOWN, never as FAIL and
never inferring a value.

No fabricated production agency data was seeded into `database/seeds/` (that would violate the existing
"seed data contains no fabricated procurement data" invariant tested in
`database/src/__tests__/schema.test.ts`, which asserts zero agencies/requirements after seeding). Small,
clearly-synthetic agency fixtures are instead created inline inside
`database/src/__tests__/qualification.test.ts` (e.g. "Qualification Test Agency A/B") for RLS testing only,
and inside the API unit-test fakes (`fixtures.ts`) — never presented as real company data anywhere.

## 8. AI boundary — what QualificationInterpretationAgent is and is not allowed to decide

`apps/api/src/lib/ai/agents/qualification/` — a **second agent registered alongside
TenderClassificationAgent**, reusing `apps/api/src/lib/ai/client.ts`, `config.ts`, `errors.ts`,
`execution/retry.ts`, `evidence/resolver.ts` (its `store` parameter type was narrowed from `AiStore` to
`Pick<AiStore, 'resolveChunkForTender'>` so it can be shared structurally without editing its behaviour),
and `evidence/validator.ts` — not a parallel reimplementation. It reuses the same `tender_ai_runs` /
`tender_ai_claims` / `tender_ai_evidence` tables (`agent_name = 'QualificationInterpretationAgent'`, a new
`ai_claim_type` value `QUALIFICATION_INTERPRETATION`), plus one small new table
`tender_qualification_ai_interpretations` for the extra structured fields.

**The agent's output schema (`agents/qualification/schema.ts`) has no PASS/FAIL/UNKNOWN/REQUIRES_ACTION
field at all** — it is structurally impossible for it to emit a qualification decision. It may only
populate:

- `category` (QualificationCategory)
- `ruleType` (QualificationRuleType, nullable)
- `mandatoryStatus` (MANDATORY/CONDITIONALLY_MANDATORY/PREFERENTIAL/INFORMATIONAL/UNKNOWN)
- `suggestedRuleConfig` — a suggestion only, never auto-applied
- `interpretation` — evidence-gated explanation text, especially of ambiguity
- `truth`/`confidence`/`evidence` — same shape and same server-side evidence-gating as the classification
  agent (`gateTruthByEvidence`): a non-UNKNOWN claim with no resolvable evidence is downgraded to
  UNVERIFIED and forces the run to `REQUIRES_REVIEW`.

`confidence` is metadata about the AI's own interpretation certainty — **it is never read by the rule
engine and never promotes a qualification state**. `evaluator.ts` takes `category`/`ruleType`/
`mandatoryStatus` as plain requirement fields regardless of whether a human or the AI populated them; the
deterministic engine has no idea which.

## 9. Carried-forward technical debt (not expanded in this phase)

1. **Geographic province/municipality FK resolution** (Phase 7 limitation) — GEOGRAPHIC requirements are
   evaluated textually and always resolve to `UNKNOWN` + `requiresHumanReview: true`
   (`evaluator.ts`'s `GEOGRAPHIC` case). No province/municipality matching was built here either, per the
   explicit instruction not to expand this scope. `agency_case_studies.geography_text` and
   `AgencyEvidenceSnapshot.geographyText` are plain text fields specifically so a future phase can add real
   resolution without a schema rewrite.
2. **`tender_ai_evidence.page_id` population** (Phase 7 limitation) — still never populated; the new
   `tender_qualification_result_tender_evidence` table carries the same `page_id` column (always null today)
   for the identical reason, so it can be populated later without a schema change.

## 10. Security model

See `docs/SECURITY.md` §Phase 8 for the full list; summary: agency isolation and tender isolation are both
RLS-enforced (`tender_qualification_runs`/`results`/`actions`/`reviews` are agency-scoped exactly like
`tender_ai_runs`; `tender_requirement_conflicts` is shared-catalogue since it describes the document set,
not one agency); all writes go through the privileged service-role client only (no `authenticated` write
policy exists on any Phase 8 table); evidence references are shape-validated before ever reaching a query
(`evidence.ts`); prompt injection against the interpretation agent cannot change its output shape (no
PASS/FAIL field exists to hijack) and evidence is still independently server-resolved regardless of what
the model claims.
