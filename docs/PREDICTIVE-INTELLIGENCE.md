# Predictive Procurement Intelligence, Calibration & Decision Support (Phase 18)

Builds a trustworthy predictive layer on top of Phase 17's outcome
ledger, without ever fabricating a model, a probability, or a sample
size the real data does not support. **The single most important fact
about this phase: against this repository's actual, current, verified
outcome data, the dataset-readiness gate correctly reports
`INSUFFICIENT_DATA`.** That is the intended, honest result — Phase 17
only just built the outcome ledger, and there has not yet been time
for enough verified WON/LOST bid outcomes to accumulate. Everything
described below (the readiness gate, leakage protection, baselines,
temporal validation, evaluation, calibration, governance, predictions,
abstention) is fully built and tested — exercised, where a real
end-to-end run is needed, against clearly-labelled test fixtures
(`is_test_fixture = true` throughout the schema), never against
production data pretending to be sufficient when it is not.

## 1. Prediction target (spec §4)

`VERIFIED_BID_OUTCOME_WON_LOST`. A record becomes a labelled
observation ONLY when Phase 17's `bid_outcomes.truth_status = 'VERIFIED'`
and `our_result` is exactly `WON` (positive) or `LOST` (negative).
`NOT_SUBMITTED`, `WITHDRAWN`, `DISQUALIFIED`, `UNKNOWN`, and any
tender-level `NO_AWARD`/`CANCELLED` are excluded from the label
entirely (`label = null`) — never coerced into an ordinary loss. This
is enforced in exactly one place:
`apps/api/src/lib/intelligence/store.ts`'s
`fetchDecisionTimeObservations`.

## 2. No prediction from future data (spec §5/§6/§25)

Every observation is built from Phase 17's immutable
`outcome_decision_time_features` snapshot — never reconstructed from
today's live tables. `apps/api/src/lib/intelligence/readiness.ts`
carries two independent leakage guards:

- `assertNoOutcomeLeakageInFeatureSource` — throws at runtime if a raw
  feature source object carries any outcome-only key (`awardValue`,
  `winner`, `winnerName`, `lossReasonPrimary`, `winningScore`,
  `outcome`, `submissionSuccess`), mirroring Phase 17's own guard.
- `checkLeakage` — fails if any feature/evidence timestamp is after
  the decision timestamp, or if the feature source wasn't sourced from
  a stored (immutable) snapshot.

`computeDatasetReadiness` additionally rejects any observation whose
decision timestamp is in the future relative to "now" as
`LEAKAGE_DETECTED` — the whole dataset is refused, not just the one
row, because a leakage finding calls the entire dataset's integrity
into question (spec §5 "a model that performs well because of leakage
is FAILED").

## 3. Data readiness gate (spec §3/§8) — the core of this phase

`computeDatasetReadiness` (`readiness.ts`) runs, in a fixed order,
every check from spec §3 and returns the FIRST blocking
`ModelEligibilityState`:

`INSUFFICIENT_DATA` → `INSUFFICIENT_LABELS` → `HIGH_CLASS_IMBALANCE` →
`INSUFFICIENT_VARIATION` → `LEAKAGE_DETECTED` → `READY_FOR_TRAINING` →
`READY_FOR_EVALUATION` → `PRODUCTION_ELIGIBLE`.

Every threshold is a documented, reviewable constant in
`shared/constants/src/intelligence.ts`, each with a one-line
statistical rationale in its own comment — never an inline magic
number:

| Constant | Value | Rationale (abridged) |
|---|---|---|
| `MIN_DATASET_SAMPLE_SIZE` | 30 | Conventional minimum for a usable normal approximation on a proportion at conservative minority prevalence. |
| `MIN_TRAINING_SAMPLE_SIZE` | 50 | Small margin above the dataset minimum so a temporal train/validation/test split still leaves a non-trivial holdout. |
| `MIN_CLASS_SAMPLE_SIZE` | 10 | Below this, a model cannot learn to distinguish the minority class at all. |
| `MIN_MINORITY_CLASS_FRACTION` | 0.1 | Below 10% minority prevalence, plain AUC/accuracy become unreliable without imbalance handling this phase does not implement as "production". |
| `MIN_FEATURE_COMPLETENESS` | 0.7 | Fraction of decision-time feature fields that must be non-null. |
| `MIN_SEGMENT_SAMPLE_SIZE` | 5 | Reused verbatim from Phase 17's `MIN_MEANINGFUL_SAMPLE_SIZE`. |
| `MIN_CALIBRATION_BUCKET_SIZE` | 5 | Below this, a calibration bucket's observed frequency is noise, not signal. |
| `MAX_DUPLICATE_RATE` | 5% | Protects against one bid project inflating the sample via a data-entry error. |
| `MIN_AUC_IMPROVEMENT_OVER_BASELINE` | 0.03 | A conservative floor, not a target — "must demonstrate meaningful value over simpler baselines" (spec §7). |
| `MAX_CALIBRATION_ERROR` | 0.15 | Ceiling on mean absolute calibration error before a model is considered CALIBRATED. |

## 4. Baselines first (spec §7)

`apps/api/src/lib/intelligence/baselines.ts`, always computed before
any model, and always recorded (even when a model itself does not
train):

- **Baseline A — prevalence**: every observation "predicted" at the
  constant historical WON rate. AUC = 0.5 by construction — the pure
  floor.
- **Baseline B — existing Opportunity Score**: the Phase 10 score at
  decision time, normalised to [0,1], used directly as the predicted
  probability. This is the retrospective calibration analysis spec §15
  asks for, reused here as a baseline.
- **Baseline C — simple logistic regression** (`model.ts`): a small,
  L2-regularised logistic regression over five decision-time features
  (Opportunity Score, requirement coverage, evidence strength,
  commercial fit, strategic fit), trained via batch gradient descent.
  Deliberately never an ensemble or neural model (spec §7).

## 5. Temporal validation (spec §9)

`apps/api/src/lib/intelligence/temporalValidation.ts`:
`chronologicalSplit` splits strictly by decision timestamp (never a
random shuffle) into train/validation/test; `verifyNoFutureLeakage`
asserts no train observation is chronologically after any validation
observation (and validation after test); `buildWalkForwardFolds` /
`verifyWalkForwardIntegrity` provide an expanding-window walk-forward
alternative for when more data exists. `routes/intelligence.ts`'s
`POST /versions/:id/train` uses `chronologicalSplit` and asserts
`verifyNoFutureLeakage` before ever fitting the model.

## 6. Evaluation (spec §10)

`apps/api/src/lib/intelligence/evaluation.ts` — pure, zero-I/O:
`computeAUC` (Mann-Whitney rank-sum, exact tie handling),
`computePRAUC` (trapezoidal, anchored at recall=0/precision=1),
`computeConfusionMatrix`/`computePrecisionRecallF1` (threshold 0.5),
`computeBrierScore`, `computeLogLoss`. `evaluatePredictions` bundles
every metric together with `sampleSize` — there is no code path that
can display a metric without it (spec §10).

## 7. Calibration (spec §11)

`apps/api/src/lib/intelligence/calibration.ts`: `buildCalibrationBuckets`
places predictions into deciles, each carrying its own `sampleSize` and
an `insufficientSample` flag (below `MIN_CALIBRATION_BUCKET_SIZE`);
`meanCalibrationError` averages only qualifying buckets.
`fitPlattScaling`/`applyPlattScaling` implement Platt scaling (a
single-feature logistic regression of the label on the log-odds of the
raw prediction) as the optional recalibration step spec §11 permits —
isotonic regression was scoped out this round in favour of Platt
scaling plus the always-available raw reliability table, given the
current data volume. Every calibration is inserted as a new,
immutable `model_calibrations` row (`calibration_version` increments;
the row itself is never updated — enforced by a Postgres trigger).

## 8. Prediction confidence vs. probability, and abstention (spec §12/§13)

A predicted probability is never labelled "confidence". The
API/UI always separately surface: predicted probability (or
`abstained: true`), the model version, training sample size, data
completeness, prediction timestamp, and (when abstaining) a specific
reason.

`apps/api/src/lib/intelligence/abstention.ts`'s `evaluateAbstention`
checks, in order, and returns the FIRST applicable reason — a
numerical prediction is never forced: `LEAKAGE_DETECTED` →
`INSUFFICIENT_VERIFIED_OUTCOMES` (dataset not yet eligible) →
`MODEL_NOT_PRODUCTION_ELIGIBLE` (no PRODUCTION model) →
`INSUFFICIENT_SEGMENT_SAMPLE` → `MISSING_CRITICAL_FEATURES` →
`DISTRIBUTION_SHIFT` → `CALIBRATION_INSUFFICIENT`. Every abstained
prediction is still recorded (`model_predictions.abstained = true`,
`predicted_probability = null` — enforced by a check constraint) with
its own `model_abstentions` row and a templated explanation.

## 9. Distribution shift (spec §18)

`apps/api/src/lib/intelligence/distributionShift.ts`'s
`detectDistributionShift` is a basic, documented (not a formal KS-test)
check: an unseen category/province/value-band, or a training sample
below `MIN_TRAINING_SAMPLE_SIZE`, marks the candidate as shifted —
which routes straight into abstention rather than a silently-degraded
number.

## 10. Explainability (spec §14/§25)

`apps/api/src/lib/intelligence/model.ts`'s `featureContributions`
computes each feature's standardised-weight contribution, sorted by
magnitude. `apps/api/src/lib/intelligence/explanations.ts` builds the
templated (never LLM-generated — see below) explanation text, always
ending with: *"This is decision support, not a procurement decision.
The human remains responsible for Bid/No-Bid and submission
decisions."* Every explanation passes through Phase 17's
`assertNoCausalLanguage` guard before being returned — associative
language only ("historically associated with"), never causal.

## 11. AI boundary (spec §25)

No LLM call exists anywhere in this phase. Per the coordinator's
explicit instruction and the sandbox's confirmed `api.openai.com`
network restriction, natural-language explanation generation uses the
same deterministic-template pattern as
`apps/api/src/lib/bidDecision/explanations.ts` — every numerical
result (probability, eligibility state, evaluation metric, calibration
error, leakage finding, promotion decision) is a pure, deterministic
statistical computation; nothing here is AI-inferred.

## 12. Model registry & governance (spec §19/§20/§21/§30/§31)

Statuses: `EXPERIMENTAL → EVALUATED → CALIBRATED →
PRODUCTION_CANDIDATE → PRODUCTION → RETIRED` (terminal from
PRODUCTION only) `/ FAILED` (terminal from any pre-PRODUCTION state).
`apps/api/src/lib/intelligence/governance.ts`'s
`isForwardTransitionAllowed` encodes the fixed state machine;
`evaluatePromotion` is the single choke point a
`PRODUCTION_CANDIDATE → PRODUCTION` promotion must pass — eligibility
state must be `PRODUCTION_ELIGIBLE`, the approver role must be
`INTELLIGENCE_APPROVE_ROLES` (`ADMIN` only), a model card must exist,
the model's AUC must beat the best baseline by
`MIN_AUC_IMPROVEMENT_OVER_BASELINE`, and calibration error must be
within `MAX_CALIBRATION_ERROR`. A model never becomes PRODUCTION
because training merely completed. `model_versions` rows are immutable
after insert except `status`/retirement fields (Postgres trigger);
`model_versions_one_production_per_registry` enforces at most one
PRODUCTION version per model at a time. `evaluateRetirement` gates
retirement the same way; retiring a model never deletes its historical
`model_predictions` rows (spec §31) — they remain FK-linked to the
retired version.

No autonomous decision-making exists anywhere: nothing in this phase
writes to `scoring_configuration_versions`, `bid_policies`,
qualification rules, evidence-matching weights, or bid strategy
config, and no code path submits/withdraws a tender or changes a
price (spec §21/§44).

## 13. Model card (spec §23)

`POST /versions/:id/candidate` generates a structured model card
(`model_cards.content`, JSON) covering intended use, prohibited use,
target definition, training sample size and class balance, validation
methodology, feature definitions, leakage controls, performance vs.
baselines, calibration, known weak segments, abstention conditions,
version, and approval status — required before promotion is even
attempted.

## 14. Prediction audit trail (spec §24)

`model_predictions` is fully immutable after insert (Postgres
trigger — no `UPDATE` at all). Reconstructable chain: tender →
`bid_strategy_projects` → `outcome_decision_time_features` (decision-
time snapshot) → `model_versions` (model + dataset + hyperparameters)
→ `model_calibrations` → `model_predictions` (the prediction itself,
frozen) → `model_prediction_explanations` → `model_abstentions` (if
abstained) → `model_promotions`/`model_audit_events` (governance
history) → the eventual `bid_outcomes` row (actual outcome, from
Phase 17). Replacing a model later never rewrites an existing
prediction's `model_version_label` or `predicted_probability`.

## 15. Database (spec §27)

`database/migrations/20260912220000_predictive_intelligence.sql` adds
12 agency-scoped tables: `model_registry`, `model_datasets`,
`model_versions`, `model_training_runs`, `model_evaluations`,
`model_calibrations`, `model_predictions`,
`model_prediction_explanations`, `model_abstentions`,
`model_promotions`, `model_cards`, `model_audit_events`. RLS follows
the established agency-owned convention exactly: `agency_id =
current_agency_id()` select-only for `authenticated`, service-role-only
writes via `apps/api/src/lib/intelligence/*`. Immutability triggers on
`model_versions` (core fields only), `model_calibrations` (fully), and
`model_predictions` (fully). `model_versions_one_production_per_registry`
is a partial unique index (`where status = 'PRODUCTION'`).

## 16. API (spec §28)

All routes in `apps/api/src/routes/intelligence.ts`, registered in
`app.ts`. Checked against every existing `routes/*.ts` file first —
none of the `/api/intelligence/*` paths collide with anything already
registered.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/intelligence/readiness` | live-computed dataset readiness (never persisted implicitly) |
| POST/GET | `/api/intelligence/datasets` | snapshot readiness as an immutable versioned dataset; list history |
| POST/GET | `/api/intelligence/models` | model registry CRUD |
| GET | `/api/intelligence/models/:id` | model + its versions |
| POST | `/api/intelligence/models/:id/versions` | new EXPERIMENTAL version from a dataset |
| GET | `/api/intelligence/versions/:id` | version + evaluations + calibrations + card + promotions + training runs |
| POST | `/api/intelligence/versions/:id/train` | baselines always; model only if dataset is READY_FOR_TRAINING+ |
| POST | `/api/intelligence/versions/:id/calibrate` | EVALUATED → CALIBRATED |
| POST | `/api/intelligence/versions/:id/candidate` | CALIBRATED → PRODUCTION_CANDIDATE, creates the model card |
| POST | `/api/intelligence/versions/:id/approve` | PRODUCTION_CANDIDATE → PRODUCTION, `ADMIN` only, requires rationale |
| POST | `/api/intelligence/versions/:id/reject` | any pre-production status → FAILED, `ADMIN` only, requires rationale |
| POST | `/api/intelligence/versions/:id/retire` | PRODUCTION → RETIRED, `ADMIN` only, requires rationale |
| POST | `/api/intelligence/predictions` | generate (or abstain from) a prediction for one bid project |
| GET | `/api/intelligence/predictions/:bidProjectId` | prediction + explanation history |
| GET | `/api/intelligence/score-calibration` | Phase 10 Opportunity Score retrospective calibration by band |
| GET | `/api/intelligence/segments` | segmented performance by tender category |

## 17. UI (spec §29)

`/intelligence` (checked against every route in `routes.tsx` first — no
collision), added to the "Bids" nav section. Five tabs in
`apps/web/src/pages/Intelligence.tsx`: **Model Readiness** (live
readiness + dataset version history, snapshot action),
**Score Calibration** (Opportunity Score bands + segmented
performance), **Model Registry & Performance** (create model/version,
train/calibrate/candidate/approve/reject/retire, evaluation +
calibration metrics), **Prediction** (request a prediction, predicted
probability or abstention, explanation), **Historical Learning**
(links out to the existing `/outcomes` dashboard rather than
duplicating it, per spec §29). `apps/web/src/hooks/useIntelligence.ts`
provides typed hooks over every endpoint above.

## 18. Security (spec §26)

Every new table RLS-isolated by agency; all writes service-role-only
via `apps/api/src/lib/intelligence/*` and `routes/intelligence.ts`;
model artifacts (fitted logistic-regression weights) are stored
server-side only (`model_versions.hyperparameters`, never sent to the
browser as raw weights — only the resulting prediction/explanation);
production promotion/rejection/retirement require `ADMIN`
(`INTELLIGENCE_APPROVE_ROLES`); every governance action writes both a
dedicated `model_audit_events` row and the shared `audit_logs` table
(`MODEL_DATASET_GENERATED`, `MODEL_VERSION_CREATED`,
`MODEL_EVALUATED`, `MODEL_CALIBRATED`, `MODEL_READY_FOR_REVIEW`,
`MODEL_PROMOTED`, `MODEL_REJECTED`, `MODEL_RETIRED`,
`PREDICTION_MADE`, `PREDICTION_ABSTAINED`).

## 19. Notifications (spec §42)

No second notification architecture was built — Phase 16/17 already
established that only `audit_logs` exists as a durable event record in
this system (no email/push notification service is wired). The
`model_audit_events` rows above (`MODEL_READY_FOR_REVIEW`,
`MODEL_PROMOTED`, `MODEL_REJECTED`, `MODEL_RETIRED`,
`PREDICTION_ABSTAINED`) are the clean future hook: a notification
dispatcher, if built later, subscribes to these exact event types
without any further schema change.

## 20. Retraining signal (spec §32)

No autonomous retraining exists. A "new dataset version available"
signal is simply the existence of a newer `model_datasets` row than
the one a model's current PRODUCTION version was trained on — visible
today via the dataset-version-history list in the Model Readiness tab.
A dedicated "RETRAIN AVAILABLE" banner comparing a model's
`dataset_id` against the latest `model_datasets.id` is a natural
Phase 19 addition, not built this round to keep the scope to what was
asked.

## 21. Testing (spec §34-§37/§45)

- **Unit** (`apps/api/src/lib/intelligence/__tests__/*`): 107 tests
  across readiness/leakage (18), evaluation (20), baselines (5),
  temporal validation (7), calibration (9), the logistic-regression
  model (4), governance (15), abstention (9), distribution shift (5),
  explanations (6), score/bid-no-bid retrospective calibration (6),
  segmented performance (3).
- **Database** (`database/src/__tests__/intelligence.test.ts`): 17
  tests — agency isolation (registry/versions/datasets), service-role-
  only writes, duplicate model-version/registry-name rejection,
  `model_versions` core-field immutability (status alone mutable),
  RETIRED-requires-reason constraint, one-PRODUCTION-per-registry
  uniqueness, `model_calibrations` full immutability + duplicate-
  version rejection, `model_predictions` full immutability +
  probability-range + abstained-has-no-probability constraints,
  retirement-does-not-delete-predictions, malformed-UUID rejection, FK
  integrity, one-explanation-per-prediction, and promotion approver FK
  enforcement.
- **E2E** (`tests/e2e/intelligence.spec.ts`): **25 new Phase 18
  scenarios** (target was ≥20) — INSUFFICIENT_DATA display, READY_FOR_
  TRAINING dataset detail, LEAKAGE_DETECTED warning, dataset snapshot
  creation, dataset version history, Opportunity Score calibration
  bands, segmented performance, create a model, create a version
  (EXPERIMENTAL), create a training run (baselines-always), display
  evaluation metrics, display calibration metrics, mark a production
  candidate, approve a candidate to PRODUCTION, reject a candidate to
  FAILED, display a model version, retire a PRODUCTION model, generate
  a prediction, display a prediction explanation, trigger prediction
  abstention, agency isolation (404 on cross-agency prediction), a
  historical prediction rendered read-only with no edit affordance,
  post-outcome/model-retirement never rewriting a historical
  prediction's displayed model version, the Historical Learning tab
  linking to (not duplicating) `/outcomes`, and Intelligence reachable
  from the primary navigation.

## 22. Live integration status

No real production model exists or has ever been trained on real
agency data in this environment. The live `GET /api/intelligence/readiness`
endpoint, run against this repository's actual current data, returns
`INSUFFICIENT_DATA` (there are not yet 30 verified WON/LOST decision-
time-complete observations for any agency). Every `READY_FOR_TRAINING`/
`PRODUCTION_ELIGIBLE`/trained-model scenario exercised in this phase's
tests uses `is_test_fixture = true` rows, structurally distinguishable
from production data in every table that carries that column, and
never counted toward a real agency's live readiness computation (which
reads only `outcome_decision_time_features`/`bid_outcomes`, tables that
have no `is_test_fixture` concept because they are Phase 17's real
ledger — a real production dataset is only ever generated by actually
calling `POST /api/intelligence/datasets` against real Phase 17 rows).

## 23. Known limitations

- **No real production model exists.** This is the correct state given
  current data volume, not a shortcoming to be silently worked around.
- **No live retraining workflow** — signalled only, per spec §32.
- **Isotonic regression was not implemented**, only Platt scaling plus
  the raw reliability table — acceptable at current/expected data
  volumes; isotonic regression needs materially more data to avoid
  overfitting the calibration curve itself.
- **Distribution-shift detection is basic** (unseen category/province/
  value-band, or too-small a training set) — not a formal statistical
  drift test (e.g. population stability index, KS-test).
- **Segmentation is currently only by tender category** in the
  `/segments` endpoint/UI — the pure `buildSegmentedPerformance`
  function itself is segment-key-agnostic and can be called for any of
  the other spec §17 dimensions (province, value band, organisation,
  etc.) without a schema change, simply by passing a different
  `segmentKey` extraction at the route layer.
- **Carried forward from Phase 17** (re-verified, not re-solved this
  phase): outcome ingestion remains manual/API-only, not live; the
  eTenders adapter and OpenAI-backed features remain sandbox-network-
  restricted; winner-to-agency matching still resolves to UNKNOWN
  without a registration number or exact name match on both sides.

## 24. Master build-plan conflict check (spec §1)

Re-verified against the current repository, not assumed: `docs/BUILD-
PLAN.md`'s own numbering note (added at Phase 16) already documents
that its original Phase-0 planning sequence — where "Phase 18"/"19"/"20"
corresponded to Addenda/Awards/Competitors — diverged from the as-built
sequence starting around Phase 11, and that Phase 17's own completion
report found Addenda, Awards and Competitors substantially covered by
as-built work (Phase 6 addenda handling, Phase 17 awards/outcomes,
Phase 17's competitor directory). This phase's own "Phase 18" is the
as-built numbering's next unit of work (Predictive Intelligence), per
the coordinator's explicit brief — nothing in the master plan or
`docs/BUILD-PLAN.md` is silently rewritten; this section is the
required conflict disclosure, not a plan change.
