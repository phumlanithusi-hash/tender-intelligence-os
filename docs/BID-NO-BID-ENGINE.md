# Phase 11 — Bid/No-Bid Intelligence Engine

## 0. Purpose and core principle

Phase 10 answers "how attractive is this opportunity" (`OpportunityScoreResult`, `HIGH_PRIORITY`/`PROMISING`/`REVIEW`/`LOW_PRIORITY`/`BLOCKED`/`INSUFFICIENT_DATA`). Phase 11 answers a
different question: "given everything known — qualification, requirements, evaluation framework, opportunity score, commercial information, strategic fit, evidence readiness, and this
agency's own business rules — should we invest resources in bidding?" The two are never collapsed: a tender can legitimately be Phase 10 `HIGH_PRIORITY` and Phase 11 `REVIEW` at the same
time (e.g. commercial value unknown, capacity not confirmed) — that is an expected, correct outcome, not a contradiction.

Architecture:

```
Phase 8 Qualification ──┐
Phase 9 Requirements +  │
        Evaluation ─────┼──▶ Phase 10 Opportunity Score ──▶ Phase 11 Business Rules + Decision Logic ──▶ BID / NO_BID / REVIEW
Agency Bid Policy ───────────────────────────────────────────────────┘
```

Phase 11 has **no AI/LLM dependency of any kind**. The decision comes only from explicit, versioned, configurable rules evaluated by a pure function.

## 1. The three decision states

- **BID** — known evidence and configured business rules support investing resources.
- **NO_BID** — an explicit deterministic rule makes pursuing inappropriate or unattractive.
- **REVIEW** — the opportunity may be attractive, but unresolved conditions require human judgement.

`UNKNOWN` never silently becomes `BID` or `NO_BID` — only a *confirmed* bad condition produces `NO_BID`; an unresolved-but-not-confirmed-bad condition produces `REVIEW`.

## 2. Hard gates always win over score

`MANDATORY_QUALIFICATION_FAILURE` (via qualification `NOT_ELIGIBLE`), `MANDATORY_REQUIREMENT_FAILURE`, `SUBMISSION_DEADLINE_PASSED` (closed tender), and `COMPULSORY_BRIEFING_FAILURE` (confirmed
missed) are reused directly from Phase 10's own hard-gate computation (`lib/scoring/gates.ts`) and re-evaluated as Phase 11 rules with `HARD_BLOCK` severity by default. An Opportunity Score of
95 with a confirmed mandatory qualification failure always decides `NO_BID` — verified by `evaluateBidDecision.test.ts` test 2, which forces `overallScore: 95` alongside a `NOT_ELIGIBLE`
qualification status and asserts `NO_BID`.

A hard gate can be explicitly downgraded to `REVIEW` per policy (`bid_policy_versions.hard_gate_overrides`, Phase 11 §5), but never invented: a condition only becomes a hard gate because (a) the
tender itself explicitly establishes the requirement (a Phase 9-extracted mandatory requirement, a Phase 8 qualification failure, an extracted closing date) or (b) the agency has explicitly
configured it (`excludedSectors`/`excludedOrganisationTypes` with `HARD_BLOCK` severity — `CONFIRMED_NO_BID_RULE`). Unknown compulsory-briefing attendance is never treated as a hard gate — it
resolves to `REVIEW` (severity configurable per `unknownSeverity.BRIEFING_ATTENDANCE`), and only a *confirmed* miss (`NOT_ATTENDED`) triggers `CONFIRMED_SUBMISSION_IMPOSSIBILITY`.

## 3. Decision precedence

Stored as policy data (`bid_policy_versions.precedence`, an ordered array), never scattered in code:

1. `CONFIRMED_NO_BID_RULE` — explicit agency exclusion (sector/organisation type) matched.
2. `CLOSED_TENDER` — Phase 10's deadline gate is `CLOSED`.
3. `NOT_ELIGIBLE` — qualification overall status is `NOT_ELIGIBLE`.
4. `CONFIRMED_MANDATORY_FAILURE` — Phase 10's `MANDATORY_REQUIREMENT_FAILURE` gate is `TRIGGERED`.
5. `CONFIRMED_SUBMISSION_IMPOSSIBILITY` — confirmed missed compulsory briefing, or insufficient preparation time under a `HARD_BLOCK`/`NO_BID`-severity policy.
6. `QUALIFICATION_BLOCKER` — qualification is `REQUIRES_REVIEW`/`ACTION_REQUIRED`/`UNKNOWN`/no run yet.
7. `MATERIAL_UNRESOLVED_RISK` — a configured score/coverage/evidence/fit/commercial/effort/conflict threshold fails.
8. `INSUFFICIENT_DATA` — data completeness below the configured minimum, or a material unknown (commercial value, deadline, etc.) per policy.
9. `POSITIVE_BID_RULE` — the configured minimum-opportunity-score rule passes and nothing above triggered.
10. `DEFAULT_REVIEW` — fallback; nothing conclusively supports BID and no rule blocked. **This step is what keeps an unconfigured policy from ever silently defaulting to BID.**

`lib/bidDecision/precedence.ts`'s `decideFromPrecedence` walks this list in order; the first step containing a rule result with `status !== 'PASS'` and `severity !== 'WARNING'` decides the
outcome (`HARD_BLOCK`/`NO_BID` severity → `NO_BID`; `REVIEW` severity → `REVIEW`). Every rule is still evaluated and returned regardless of which step "wins" (§31) — `evaluateAllRules` in
`lib/bidDecision/rules.ts` runs all ~23 rules unconditionally, every run.

## 4. Rule evaluation

Every rule (`lib/bidDecision/rules.ts`) returns a `BidRuleResult`:

```ts
{ ruleId, precedenceStep, status: 'PASS'|'FAIL'|'UNKNOWN', severity: 'HARD_BLOCK'|'NO_BID'|'REVIEW'|'WARNING', actualValue, expectedValue, explanation }
```

— always fully populated, including for `UNKNOWN` (e.g. `{ ruleId: 'commercial-value-known', status: 'UNKNOWN', severity: 'REVIEW', explanation: 'Tender estimated value is not available.' }`).
Rules implemented: excluded-sector, excluded-organisation-type, tender-closed, qualification-not-eligible / qualification-status-review, mandatory-requirement-failure, compulsory-briefing-missed,
minimum/maximum-preparation-days, minimum-data-completeness, commercial-value-known, minimum-contract-value, minimum-requirement-coverage, minimum-evidence-strength, minimum-evaluation-fit,
minimum-strategic-fit, unresolved-evaluation-conflict, maximum-bid-effort, minimum-opportunity-score, capacity-known, minimum-expected-margin, and three preferred-alignment (service/sector/
organisation) informational rules.

## 5. Business rule configuration (agency bid policy)

`bid_policies`/`bid_policy_versions` (agency-owned, RLS-scoped, versioned exactly like Phase 10's `scoring_configurations`/`scoring_configuration_versions`). Fields implemented — every one checked
against real, already-existing agency/tender data before being added (per the binding "only create fields actually supported by real data structures" instruction):

`minimumOpportunityScore`, `minimumDataCompleteness`, `minimumRequirementCoverage`, `minimumEvidenceStrength`, `minimumEvaluationFit`, `minimumStrategicFit`, `minimumContractValue`,
`preferredContractValue`, `minimumPreparationDays`, `maximumPreparationDays`, `minimumExpectedMargin` (always `UNKNOWN`/`WARNING` — no real cost data source exists), `maximumBidEffort`,
`preferredServices`/`preferredSectors`/`preferredOrganisationTypes`/`preferredProvinces` (informational only, never a penalty when absent), `excludedOrganisationTypes`/`excludedSectors`,
`unresolvedEvaluationConflict`, and `unknownSeverity` (per-unknown-type REVIEW/CONTINUE severity — §16).

Every threshold field is `{active, severity, value} | null` — `null` means "not part of this policy at all"; `{active: false, ...}` means "configured but switched off". **Business rules are
never stored in the same tables as tender rules** — `tender_evaluation_gates`/`tender_requirements.mandatory` (the tender's own functionality threshold, evaluation gate, etc.) remain completely
separate from `bid_policy_versions` (this agency's own bid appetite), per §11.

### Score bands (§14)

`bid_policy_versions.score_bands` (`[{min,max,label}]`) is a distinct, agency-configurable labelling concept from Phase 10's own tender-scoring decision bands — explanation/labelling only, never
itself a decision rule.

## 6. Bid effort

`lib/bidDecision/bidEffort.ts`'s `computeBidEffort` — a fully documented, deterministic point formula (see the module's own doc comment for the exact thresholds) over
`mandatoryDocumentCount`/`evaluationCriteriaCount`/`mandatoryFormCount`/`presentationRequired`/`briefingCompulsory`, all sourced from Phase 9's own extracted `tender_requirements`/
`tender_evaluation_criteria` and Phase 2's `tenders.briefing_required` — never AI-derived, never a hidden judgement call. Result: `LOW`/`MEDIUM`/`HIGH`/`UNKNOWN` (fully unknown only when *every*
input is unknown/zero). Bid effort is stored and reported entirely separately from `opportunityScore` (§25) — `Opportunity Score = 88, Bid Effort = HIGH, Decision = REVIEW` is a legitimate,
directly-tested outcome (`evaluateBidDecision.test.ts` "bid effort is reported separately...").

## 7. UNKNOWN policy

`bid_policy_versions.unknown_severity` maps each of `COMMERCIAL_VALUE`/`STRATEGIC_FIT`/`BRIEFING_ATTENDANCE`/`EVALUATION_CONFLICT`/`DEADLINE` independently to `REVIEW` or `CONTINUE` — not a
uniform policy. The default seed treats commercial value, briefing attendance, evaluation conflicts, and deadline feasibility as `REVIEW`-worthy when unknown, and strategic-fit unknowns as
`CONTINUE` (never penalised), matching the spec's own worked example.

## 8. Human override

Role-gated via the existing Phase 4/7/8 RBAC (`shared/constants/src/roles.ts`'s `user_role`): `ADMIN`/`BID_MANAGER` may override; `RESEARCHER` may view but never override (enforced both in
`routes/tenderBidDecision.ts` via `requireRole(BID_DECISION_OVERRIDE_ROLES)` and in the UI, where the override control is disabled with an explanatory title for a non-authorised viewer).

An override **never mutates the system decision**. `bid_decision_runs` stores `system_decision`, `human_decision`, and `final_decision` side by side; `final_decision` equals `human_decision`
when present, otherwise `system_decision` — enforced by a `CHECK` constraint (`bid_decision_runs_final_decision_consistent`), not just application logic. Overriding requires a non-null,
non-empty `override_reason` — enforced by a second `CHECK` constraint (`bid_decision_runs_override_requires_reason`) that rejects `NULL` *and* an all-whitespace string, verified directly against
a live Postgres instance in `database/src/__tests__/bidDecision.test.ts` ("a human override without a reason is rejected by a CHECK constraint... an empty-string override reason is also
rejected"). A `BID_DECISION_OVERRIDDEN` audit event is written to the existing generic `audit_logs` table (see §11) on every override.

## 9. Staleness

`lib/bidDecision/staleness.ts` re-exports Phase 10's own `isSnapshotStale` (§41 binding instruction: "mirror Phase 10's staleness mechanism exactly"). A decision's `input_snapshot` captures
Phase 10's own snapshot (which already covers tender/qualification/requirement/evaluation-criteria/agency-evidence/agency-profile changes) plus Phase 11-only additions: the current Phase 10
scoring run id, the unresolved evaluation-conflict count, and the bid-effort input counts. A fresh comparison at read time (`repositories/tenderBidDecision.ts`'s `getBidDecision`) flags
`isStale: true` whenever *any* of these change — including an agency bid-policy change, since `runBidDecision`'s idempotency check also compares `bidPolicyVersionId`. A stale decision is never
silently presented as current; the UI surfaces an explicit "Stale — inputs changed since this run" banner exactly like Phase 10's own Scoring Engine tab.

## 10. Addendum / conflict handling

Phase 9's `tender_evaluation_conflicts` (unresolved, `status = 'OPEN'`) feeds the `unresolved-evaluation-conflict` rule (`MATERIAL_UNRESOLVED_RISK` category by default). Phase 11 never resolves
a conflict itself — an unresolved conflict can trigger `REVIEW` (or `NO_BID` if explicitly configured with that severity) but is never assumed to automatically invalidate the opportunity.

## 11. Audit

`writeAuditEvent` in `supabaseBidDecisionStore.ts` writes directly into the existing generic, already-agency-scoped, append-only `audit_logs` table (Phase 2 §22 —
`database/migrations/20260910200170_notifications_audit.sql`), confirmed to be a reusable generic audit log (not the AI-specific `lib/ai/execution/audit.ts`, which is only a set of structured
Pino log-line helpers with no table behind it). `BID_DECISION_CREATED` and `BID_DECISION_OVERRIDDEN` are written today; `BID_DECISION_RECALCULATED`, `BID_DECISION_MARKED_STALE`, and
`BID_POLICY_CHANGED` are defined in `shared/constants/src/bidDecision.ts`'s `BID_DECISION_AUDIT_EVENT` vocabulary as the seam for a future phase/UI action that explicitly triggers them (staleness
today is computed at read time, not as a discrete recalculation/mark-stale action; policy editing has no UI yet — see Known Limitations).

## 12. API

See `routes/tenderBidDecision.ts`. All routes require authentication; role gates per §46.

| Method | Path | Roles |
|---|---|---|
| GET | `/api/tenders/:id/bid-decision` | ADMIN, BID_MANAGER, RESEARCHER |
| GET | `/api/tenders/:id/bid-decision/rules` | ADMIN, BID_MANAGER, RESEARCHER |
| GET | `/api/tenders/:id/bid-decision/history` | ADMIN, BID_MANAGER, RESEARCHER |
| POST | `/api/tenders/:id/bid-decision/evaluate` | ADMIN, BID_MANAGER |
| POST | `/api/tenders/:id/bid-decision/override` | ADMIN, BID_MANAGER |

No path collisions were found (see docs/DECISIONS.md).

## 13. UI

`apps/web/src/components/tenders/BidDecisionTab.tsx` — a new "Bid Decision" tab on Tender Detail (`apps/web/src/components/tenders/TenderDetail.tsx`), following §47-§54: decision badge +
system/human/final breakdown when an override exists, BLOCKERS always shown first, an ACTION REQUIRED checklist for REVIEW, WARNINGS shown distinctly, a full rules table, and an override control
that always renders alongside the full decision context (never a bare toggle). `apps/web/src/hooks/useBidDecision.ts` mirrors `useOpportunityScore.ts`'s pattern exactly.

## 14. Phase 12 handoff

A future Phase 12 (bid strategy) receives, without ever needing to reconstruct any decision logic: System Decision, Human Decision, Final Decision, Opportunity Score (Phase 10), Qualification
status (Phase 8), Requirement Coverage / Evaluation Fit / Evidence Strength / Commercial Fit / Strategic Fit component scores (Phase 10), Data Completeness (Phase 10), Triggered Rules, Blockers,
Warnings, Unknowns (unresolved items), Positive Factors, Required Human Actions, Bid Effort, Policy Version, and Decision Version (`bid_decision_runs.id`/`createdAt`) — all already returned by
`GET /api/tenders/:id/bid-decision`.

## 15. Known limitations (Phase 11-specific, in addition to all carried-forward limitations — see the completion report)

- Bid policy has no create/edit UI yet — a policy is created via the seeded default row or directly against the database; the versioned schema and API read surface are complete, but there is no
  admin screen to author a new policy version. Documented rather than built to avoid disproportionate scope growth in this phase.
- `BID_DECISION_RECALCULATED`/`BID_DECISION_MARKED_STALE`/`BID_POLICY_CHANGED` audit events are defined in the vocabulary but not yet emitted by any code path, since staleness is computed at read
  time (not as a discrete action) and there is no policy-editing UI yet to trigger a policy-changed event.
- The dashboard-level Bid Decision filter (§55) was scoped out — see docs/DECISIONS.md for why, matching the precedent Phase 10 itself set.
- Capacity and expected margin are permanently `UNKNOWN` — real schema/rule seams exist (§23/§20), never fabricated data.
