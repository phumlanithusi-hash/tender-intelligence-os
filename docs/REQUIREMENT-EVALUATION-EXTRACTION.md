# Requirement & Evaluation Extraction — Phase 9

Status: implemented 2026-09-11. Answers the core question: "What does this tender actually ask of a
bidder, and how exactly will bids be evaluated?" — converting tender documents into structured,
hierarchical, evidence-linked requirement and evaluation-criterion records. This is **not** the
Qualification Engine (Phase 8 — "can THIS agency meet these requirements"), not scoring, not a Bid/No-Bid
decision, not win-probability, not portfolio matching, not bid strategy or proposal generation, not
red-teaming, not embeddings/semantic search, and not automatic addenda-conflict resolution — none of
those exist in this codebase and Phase 9 does not build toward them.

## 1. Requirement model

`tender_requirements` (Phase 2, extended by Phase 8 for qualification and again here) gained the
following Phase 9 columns (`database/migrations/20260911180000_requirement_evaluation_extraction.sql`):

| column | purpose |
|---|---|
| `requirement_type` | extended taxonomy — QUALIFICATION / FUNCTIONALITY / COMMERCIAL / PRICE / PREFERENCE / LOCAL_CONTENT / CONTRACTUAL / INFORMATIONAL (the existing enum, not a new column — see `docs/DECISIONS.md`) |
| `parent_requirement_id` | self-referencing FK — hierarchical clause structure (e.g. "3. FUNCTIONALITY" → "3.2 Company Experience") |
| `disqualification_risk` | boolean flag, never a decision — set when the source text itself uses disqualification/exclusion language, surfaced to a human, never auto-applied |
| `qualification_requirement_status` | gained `CONFLICT` alongside Phase 8's VERIFIED/PROVISIONAL/REQUIRES_REVIEW |
| `ai_run_id`, `ai_claim_id` | traceability back to the exact extraction run/claim that produced this row |
| `version`, `superseded_by`, `superseded_at`, `source_document_version_id` | append-only versioning, identical pattern to Phase 8 §6 |

New tables: `tender_requirement_evidence` (document/version/page/section/chunk/page-number/evidence-text
per requirement — mirrors `tender_ai_evidence`'s shape), `tender_requirement_reviews` (human
review decisions, `reviewer_id`/`decision`/`note`). `tender_requirement_conflicts` (Phase 8) is reused
unmodified for requirement-value conflicts across documents.

## 2. Evaluation model

`tender_evaluation_criteria` (Phase 2) gained:

| column | purpose |
|---|---|
| `parent_criterion_id` | self-referencing FK — hierarchical criteria (e.g. a parent "Functionality" section with weighted sub-criteria) |
| `criterion_type` | new `evaluation_criterion_type` enum — FUNCTIONALITY / PRICE / PREFERENCE / LOCAL_CONTENT / TECHNICAL / PRESENTATION / INTERVIEW / OTHER / UNKNOWN |
| `maximum_points`, `weight`, `minimum_threshold` | numeric fields — **null unless the source text states an exact figure**, never inferred or defaulted (a `CHECK` constraint additionally rejects a negative `maximum_points`) |
| `scoring_bands` | JSONB array capturing any stated point/band breakdown verbatim (e.g. "0-2 years: 0pts, 3-5 years: 10pts, 6+ years: 20pts") — never a computed interpolation |
| `gate` | boolean — this criterion is a pass/fail gate (e.g. a minimum functionality score to proceed to price/preference), not a points contributor |
| `threshold_type`, `formula_text`, `formula_type`, `formula_variables` | a stated scoring formula is captured as **text and named variables only** — never parsed into an executable expression, never evaluated |
| `local_content_min_percent` | for LOCAL_CONTENT criteria — `CHECK`-constrained to 0–100 when present |
| `presentation_mandatory`, `presentation_date`, `presentation_attendees` | for PRESENTATION/INTERVIEW criteria |
| `source_truth`, `status`, `version`, `superseded_by`, `superseded_at`, `source_document_version_id`, `ai_run_id`, `ai_claim_id` | the same truth-state/versioning/traceability columns Phase 8 gave `tender_requirements` |

New tables: `tender_evaluation_criterion_evidence`, `tender_evaluation_gates` (a gate can exist
independent of any single criterion — e.g. "bidders scoring below 60% on functionality are excluded from
price evaluation" — `criterion_id` is nullable) + `tender_evaluation_gate_evidence`,
`tender_evaluation_conflicts` (evidence-on-both-sides conflict records, same shape as
`tender_requirement_conflicts`), and `tender_evaluation_criteria_reviews` (a `CHECK` constraint requires
exactly one of `criterion_id`/`gate_id` to be set per review row).

## 3. Extraction architecture

`apps/api/src/lib/ai/agents/extraction/` — a **third agent**, `RequirementExtractionAgent`, registered
alongside `TenderClassificationAgent` (Phase 7) and `QualificationInterpretationAgent` (Phase 8), reusing
`apps/api/src/lib/ai/client.ts`, `config.ts`, `errors.ts`, `execution/retry.ts`, `evidence/resolver.ts`,
and `evidence/validator.ts` unmodified — not a parallel reimplementation:

- `schema.ts` — `rawRequirementExtractionSchema`: every numeric field defaults to `null`, every enum
  field defaults to `'UNKNOWN'`. There is no code path in the raw-output schema by which an unspecified
  number becomes anything other than `null`.
- `prompt.ts` — `REQUIREMENT_EXTRACTION_PROMPT_V1`, with explicit boundaries: never invent a
  weight/threshold/formula; never decide whether a requirement is met; never calculate a score; treat
  mandatory-sounding language in its full surrounding context (a heading alone is not evidence of
  mandatory status); flag disqualification/exclusion language as a risk signal, never as a decision;
  report a conflict between two documents explicitly rather than silently preferring one; capture any
  stated formula as text only, never execute or simplify it.
- `validator.ts` / `agent.ts` — `runRequirementExtractionAgent`, with the same document-chunk
  context-bounding/truncation logic as the classification and qualification agents (a run whose input had
  to be truncated is recorded as such, never silently).

`apps/api/src/lib/ai/requirementEvaluationStore.ts` (`RequirementEvaluationStore` port) and
`supabaseRequirementEvaluationStore.ts` (its real implementation) are tender-scoped — no `agencyId`
parameter anywhere in the interface, unlike `AiStore`/`QualificationAiStore` — reflecting that a
requirement or evaluation criterion is a property of the tender's own document set (§7 below).

### Orchestration

`apps/api/src/lib/ai/execution/runRequirementEvaluationExtraction.ts` is the full lifecycle:

1. Idempotency check — one active (`QUEUED`/`RUNNING`) extraction run per tender, both application-checked
   and DB-partial-unique-index-enforced (`tender_ai_runs_one_active_per_tender_no_agency`).
2. Fetch the tender's previously-extracted requirements/criteria (for version matching) **before**
   creating any new rows.
3. Call `RequirementExtractionAgent` with the tender's document chunks.
4. Validate the raw JSON output against the Zod schema (`MALFORMED_JSON`/`SCHEMA_INVALID` failure stages
   on rejection, matching Phase 7/8's exact error taxonomy).
5. For every requirement/criterion/gate, resolve every claimed evidence reference server-side
   (`resolveEvidenceRefs`) and gate its truth state by whether evidence actually resolved
   (`gateTruthByEvidence`) — a claim with no resolvable evidence is downgraded to `UNVERIFIED` and forces
   `requiresReview`.
6. Insert every requirement/criterion first (parent link left null), then a second pass wires each
   child's `parent_requirement_id`/`parent_criterion_id` to the real id its array-index parent received
   (§ the model returns hierarchy as array indices, which do not have real ids until after insert).
7. A conflict the model proposes is only persisted as a genuine `CONFLICT` row if **both** disagreeing
   sides independently resolve to real evidence; otherwise it is recorded as `requiresReview` instead of
   an asserted conflict.
8. Any previously-extracted row matching a newly-extracted one (by category/type + normalized title,
   scoped to rows this agent created) is marked `superseded_by`/`superseded_at` — never updated in place.
9. The run is closed out with `evidenceCoverage`/`conflictCount`/`unknownCount`/`requiresReviewCount`
   computed from the actual persisted rows, and status `COMPLETED` or `REQUIRES_REVIEW` (never a silent
   `COMPLETED` when unresolved items exist).

## 4. Hierarchy

Both requirements and evaluation criteria support one level of self-referencing parent/child nesting
(`parent_requirement_id`/`parent_criterion_id`) to represent a tender's own clause numbering (e.g. a
top-level "3. FUNCTIONALITY" section containing "3.1 Methodology", "3.2 Company Experience",
"3.3 Key Personnel" as children). The UI renders children indented beneath their parent
(`apps/web/src/components/tenders/TenderDetail.tsx`'s Requirements/Evaluation tabs). Nothing in this
phase computes a rolled-up total from children — that remains explicitly out of scope (no scoring).

## 5. Evidence model

Every requirement, criterion, and gate carries zero or more evidence rows
(`tender_requirement_evidence` / `tender_evaluation_criterion_evidence` /
`tender_evaluation_gate_evidence`) — `documentId`/`documentVersionId`/`pageId`/`sectionId`/`chunkId`/
`pageNumber`/`evidenceText`. The **server**, not the model, is the source of truth for `evidenceText`:
`resolveEvidenceRefs` looks up the claimed `chunkId` against the real, stored document-chunk text and
persists that — a model-echoed quote is never trusted or persisted verbatim. A chunk id that is not
UUID-shaped, does not exist, or belongs to a different tender's document is rejected before any further
processing, exactly like Phase 7/8's evidence resolution.

## 6. Conflicts

`tender_requirement_conflicts` (reused from Phase 8) and the new `tender_evaluation_conflicts` both record
both sides of a genuine disagreement (`evidence_a`/`evidence_b` JSONB, each carrying its own resolved
evidence) when two authoritative documents state incompatible values for the same requirement or
criterion (e.g. the original TOR says 15 points for experience, an addendum says 20). Both tables are
shared-catalogue-readable (describe the tender's document set, not one agency) and are **never
auto-resolved** — a conflicted item stays `CONFLICT`/`requiresReview` until a human resolves it; automatic
addenda-conflict resolution is explicitly out of scope for this phase (see Exclusions, §9).

## 7. Tenant model — why extraction is tender-scoped, not agency-scoped

Unlike Phase 7 classification and Phase 8 qualification (both inherently relative to one agency — "is
this tender relevant to us," "does our agency meet this requirement"), a requirement's text and an
evaluation criterion's points are facts about the tender itself, true for every agency reading the same
document. Extraction therefore writes to shared-catalogue tables (`select true for authenticated`,
writable only by the service role — the same RLS shape `tender_requirements`/`tender_evaluation_criteria`
already used), and `tender_ai_runs.agency_id` was relaxed to nullable specifically for extraction runs,
with its own RLS policies and idempotency index (`docs/DECISIONS.md` Phase 9 §1). The pre-existing
per-agency classification/qualification runs are entirely unaffected.

## 8. AI boundary — what RequirementExtractionAgent is and is not allowed to decide

The agent's output schema has **no field through which it could emit a qualification decision, a score,
a computed total, or a Bid/No-Bid recommendation** — those concepts do not exist anywhere in
`schema.ts`. It may only populate:

- `requirements[]` — `category`/`title`/`description`/`mandatoryStatus`/`ruleType`/`disqualificationRisk`
  (a flag, not a decision)/`parentIndex` (array-index hierarchy)/`truth`/`confidence`/`evidence`.
- `evaluationCriteria[]` — `name`/`description`/`criterionType`/`maximumPoints`/`weight`/
  `minimumThreshold`/`scoringBands`/`gate`/`thresholdType`/`formulaText`/`formulaType`/
  `formulaVariables`/`localContentMinPercent`/`presentation*`/`parentIndex`/`truth`/`confidence`/`evidence`.
- `evaluationGates[]` — `name`/`threshold`/`thresholdType`/`description`/`criterionIndex`/`truth`/
  `confidence`/`evidence`.
- `conflicts[]` — a proposed disagreement between two evidence spans, which the server independently
  verifies before ever persisting it as a genuine `CONFLICT` row (§6, §3 step 7).

`confidence` is metadata about the AI's own extraction certainty — it is never read by any downstream
consumer as proof that a requirement is mandatory or a criterion's points are correct; the UI always
displays it alongside the evidence, never in place of it, and Phase 8's qualification engine (the only
consumer that decides anything) reads `mandatoryStatus`/`category`/`ruleType` as plain requirement fields
regardless of whether a human or this agent populated them — it has no idea which, by design (same
precedent as Phase 8 §8).

## 9. Explicit exclusions (per this phase's binding scope)

None of the following were built, and nothing in this phase's code builds toward them:

- Bidder/opportunity scores, or any score for any tender.
- A Bid/No-Bid decision or recommendation.
- Win probability of any kind.
- Portfolio matching against agency case studies.
- Bid strategy or proposal generation.
- Red-teaming of a bid.
- Embeddings or semantic search over requirements/criteria.
- Automatic addenda-conflict resolution — a conflict is recorded and left for a human, never resolved by
  picking a side automatically.
- Treating a PREFERENCE-category requirement's points as a qualification gate — Phase 8's qualification
  engine (unmodified by this phase) is the only place PASS/FAIL/UNKNOWN/REQUIRES_ACTION is decided, and it
  continues to treat preference/points-bearing criteria exactly as it did before this phase existed.
- Treating AI confidence as proof of anything — confidence is always secondary to, and displayed
  alongside, resolved evidence, never a substitute for it.

## 10. Carried-forward technical debt (not expanded in this phase)

1. **Geographic province/municipality FK resolution** (Phase 7/8 limitation) — unaffected by this phase;
   no extraction logic here resolves geography beyond free text.
2. **`tender_ai_evidence.page_id` population** (Phase 7/8 limitation) — the new evidence tables
   (`tender_requirement_evidence`, `tender_evaluation_criterion_evidence`,
   `tender_evaluation_gate_evidence`) carry the identical `page_id` column (always null today), for the
   same reason: it can be populated later without a schema change.
3. **Phase 8's unimplemented qualification categories** — untouched; this phase does not extend or fix
   the qualification rule engine's category coverage.

## 11. Security model

See `docs/SECURITY.md` §16 for the full list; summary: extraction is tender-scoped and shared-catalogue
(no agency dimension to leak); every evidence reference is server-resolved and shape-validated before any
query runs; a proposed conflict is only persisted once independently verified on both sides; viewing
requires `ADMIN`/`BID_MANAGER`/`RESEARCHER`, triggering extraction or recording a review requires
`ADMIN`/`BID_MANAGER`; a dedicated partial unique index prevents concurrent duplicate extraction runs per
tender; prompt injection cannot change the agent's output shape into one that could emit a decision this
phase does not support; `OPENAI_API_KEY` handling is unchanged from Phase 7/8.
