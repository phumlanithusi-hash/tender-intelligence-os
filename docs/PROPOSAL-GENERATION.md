# Proposal Generation & Document Assembly — Phase 14

Status: implemented. This document describes the as-built system. See `docs/DECISIONS.md` ("Phase 14") for naming/collision decisions and `docs/TESTING.md`/this phase's completion report for exact test counts.

## 1. Objective and critical principle

Phase 14 turns an approved bid strategy (Phase 12), human-approved evidence (Phase 13), and tender requirements/evaluation criteria (Phase 8/9) into a structured, traceable, reviewable **internal draft** bid proposal.

Phase 14 is a proposal generation and document assembly system, **not** an autonomous tender submission system. It never submits a tender, emails anyone, uploads to a procurement portal, fabricates company facts, converts candidate evidence into approved evidence, approves its own generated content, or claims compliance with an unresolved mandatory issue outstanding.

## 2. Architecture: Proposal → Version → Section → Block → Requirement/Evaluation/Evidence → Claim

```
bid_strategy_projects (Phase 12, read-only)
        │
        ▼
  bid_proposals ── 1:1 per bid project
        │
        ▼
  bid_proposal_versions ── append-only, versioned (version 1, 2, 3…)
        │
        ▼
  bid_proposal_sections ── one per COVER/EXECUTIVE_SUMMARY/TECHNICAL_RESPONSE/…
        │            │
        │            ├── bid_proposal_requirement_links → tender_requirements
        │            ├── bid_proposal_evaluation_links  → tender_evaluation_criteria(/subcriteria)
        │            └── bid_proposal_evidence_links     → bid_evidence_claims (Phase 13, APPROVED only)
        │
        ▼
  bid_proposal_blocks ── HEADING/PARAGRAPH/BULLET_LIST/TABLE/CASE_STUDY/…
        │
        ▼
  bid_proposal_claims ── claim_text + support_status (SUPPORTED/PARTIALLY_SUPPORTED/UNSUPPORTED/REQUIRES_REVIEW)
```

Side tables: `bid_proposal_section_edit_history` (edit/regeneration snapshots), `bid_proposal_generations` (one row per AI generation run), `bid_proposal_reviews` (review/approve/reject decisions), `bid_proposal_compliance_results`/`bid_proposal_compliance_issues` (deterministic compliance runs), `bid_proposal_missing_information`, `bid_proposal_documents` (assembled DOCX/PDF metadata).

## 3. Blueprint generation (`lib/proposals/blueprint.ts`)

`generateProposalBlueprint()` is a pure, deterministic function. Given the tender's requirements (with `requirement_type`), evaluation criteria (with weight), win themes and differentiators, and whether any evidence needs exist, it returns an ordered list of section plans. COVER, EXECUTIVE_SUMMARY and COMPLIANCE are always included; every other section type is included only when there is a traceable reason (a matching requirement type, a weighted evaluation criterion, or evidence needs existing) — never guessed. Each plan records the exact `requirementIds`/`evaluationCriterionIds` it is expected to cover, seeding the traceability links before any content exists.

## 4. AI-assisted drafting

### 4.1 Contract (Phase 14 §14)

`ProposalGenerationResult` (defined as a Zod schema in `@tender-os/schemas`, `proposalGenerationResultSchema`) is the only shape a generation may return: `sectionTitle`, `sectionPurpose`, `contentBlocks[]`, `claims[]`, `requirementReferences[]`, `evaluationReferences[]`, `evidenceReferences[]`, `warnings[]`, `missingInformation[]`, `unsupportedClaims[]`, `confidence`. Malformed JSON or a schema-invalid response is rejected outright (`AiMalformedOutputError`/`AiSchemaValidationError`) — never coerced or partially persisted.

### 4.2 Prompt / trusted-untrusted boundary (`lib/ai/agents/proposalSection/prompt.ts`)

The system prompt establishes an explicit trusted/untrusted boundary: tender/agency text is always wrapped `[UNTRUSTED TENDER TEXT]`/`[UNTRUSTED AGENCY TEXT]` in the user message, and the system prompt states plainly that such content must never be obeyed as an instruction (reveal secrets, approve evidence, change Bid/No-Bid, modify records, etc.). The model may only cite ids from an explicit "AVAILABLE IDS" allow-list built from the section's actual requirement/evaluation/evidence context — never the full tender corpus.

### 4.3 Independent re-verification (`lib/ai/execution/runProposalGeneration.ts`)

The orchestration function never trusts the model's own citations:
- Every cited `evidenceClaimId` is checked against a caller-supplied map of **currently approved, non-revoked** `bid_evidence_claims` rows. Not present → `NOT_APPROVED`; present but the underlying evidence match is flagged stale → `APPROVED_STALE`; both resolve to `REQUIRES_REVIEW`, never `SUPPORTED`. Only `APPROVED_CURRENT` resolves to `SUPPORTED`.
- Every cited requirement/evaluation-criterion id is checked against the tender's real id set; anything outside it is dropped and recorded as a warning (defence against cross-tender/malicious ids).
- A model-flagged `unsupportedClaims[]` entry, or a claim downgraded by re-verification, is rendered in the persisted content as the fixed placeholder text `[REQUIRES AGENCY INPUT: Provide verified evidence supporting this claim.]` — never filled with plausible prose (`lib/proposals/unsupportedClaims.ts`).
- Reproducibility: `computeGenerationInputContextHash()` hashes the exact prompt version, section type, and sorted requirement/evaluation/evidence id sets plus user instructions and strategy version, so an identical generation input always produces the same hash (verified by test).

### 4.4 Failure handling

`OPENAI_API_KEY` unset → `AI_UNAVAILABLE`, no fabricated content, rest of the system (manual section creation/editing, evidence attachment, compliance, manual assembly) stays usable. A transient provider error (timeout/429/5xx) retries with bounded backoff (`withProviderRetry`, reused from Phase 7); a persistent failure records `FAILED`. Malformed/schema-invalid output records `REJECTED_INVALID_OUTPUT`. All four outcomes are persisted as `bid_proposal_generations` rows — never silently dropped.

## 5. Traceability

Both directions are answerable directly from the schema:
- **Requirement → Section**: `bid_proposal_requirement_links` (`section_id`, `tender_requirement_id`, `coverage_status`).
- **Section → Requirement**: same table, queried the other way.
- **Evaluation Criterion → Section → Win Theme → Evidence → Content**: `bid_proposal_evaluation_links` (criterion/subcriterion/win_theme → section) plus `bid_proposal_evidence_links` (section/block → approved evidence claim) plus `bid_proposal_claims` (claim text → evidence claim).
- Coverage status is `COVERED`/`PARTIAL`/`NOT_COVERED` — never invented as `COVERED` without an actual link row.

## 6. Compliance engine (`lib/proposals/compliance.ts`)

Pure, deterministic — not an LLM decision. Checks (in order, all independent):
- **Structure**: required section types present, mandatory sections have content, no unresolved placeholder in a mandatory section (blocker) or non-mandatory section (warning).
- **Requirements**: every mandatory requirement `NOT_COVERED` is a blocker; non-mandatory is a warning; a mandatory requirement only `PARTIAL` is a warning.
- **Evaluation**: an uncovered criterion is a warning; a criterion expecting evidence with none linked is a blocker.
- **Evidence**: any `UNSUPPORTED` claim is always a blocker; `REQUIRES_REVIEW`/`PARTIALLY_SUPPORTED` claims are warnings.
- **Pricing**: required-but-not-provided is a blocker (§25 — pricing is never invented, see Known Limitations for how "provided" is currently always `false`).
- **Staleness**: a stale version is always a blocker.

Precedence: `BLOCKED` (any blocker) > `REQUIRES_REVIEW` (any warning, no blocker) > `READY_FOR_INTERNAL_REVIEW`. This is proposal readiness only — Phase 11 remains authoritative for Bid/No-Bid, Phase 12 for strategy readiness.

### Proposal Coverage Score (`lib/proposals/coverageScore.ts`)

A deterministic `{ requirementsCoverage, evaluationCoverage, evidenceCoverage, unresolvedMandatoryIssues, unsupportedClaimCount, missingInformationCount }` object. Never called "win probability" / "chance of winning" / "success probability" anywhere in code, UI, or docs.

## 7. Versioning and staleness

`bid_proposal_versions` is append-only; a historical (`is_current = false`) row's `input_snapshot`/`notes` are DB-immutable (`prevent_historical_proposal_version_mutation`). Staleness (`lib/proposals/staleness.ts`, reusing `isSnapshotStale` from Phase 10) compares the version's stored `input_snapshot` (requirement/criterion ids+text, strategy version, approved-evidence-claim id set) against a freshly computed one every time `POST .../compliance/run` executes; a mismatch marks the version stale and always requires human review — it never triggers a silent regeneration.

## 8. Human review workflow

`DRAFT → AI_GENERATED → REQUIRES_REVIEW → IN_REVIEW → APPROVED_INTERNAL` (or `REJECTED`, with a mandatory reason enforced by a DB CHECK). Approval is role-gated (`PROPOSAL_REVIEW_ROLES` = ADMIN/BID_MANAGER); once `APPROVED_INTERNAL`, a section's identity fields and blocks are DB-immutable until it is rejected or a new proposal version is created. Every human edit and every regeneration snapshots the section's prior blocks into `bid_proposal_section_edit_history` first.

## 9. Document assembly (`lib/proposals/documentAssembly.ts`)

Pure, zero-I/O buffer builders: `assembleProposalDocx()` (via the `docx` npm library) and `assembleProposalPdf()` (via `pdf-lib`, hand-drawn text layout). Both preserve section order, headings, paragraphs, lists, and metadata (tender number, tender title, organisation, bid project, proposal version, generated date, status) and stamp the document "INTERNAL DRAFT — NOT A SUBMISSION". No secrets or internal security metadata are ever included. Known limitation: PDF tables render as plain delimited text rows rather than a drawn grid (see §10).

## 10. Known limitations (new, Phase 14)

- **No dedicated pricing-input UI/field.** `pricingProvided` is unconditionally `false`; a tender with a PRICING/COMMERCIAL requirement will always compliance-BLOCK on `PRICING_REQUIRED` until a human-authored pricing surface is built (Phase 15+). This is the safe, honest default — never guessing pricing is "present".
- **Assembled documents are not uploaded to Supabase Storage in this phase.** `bid_proposal_documents` records assembly metadata, but the DOCX/PDF bytes are returned directly in the HTTP response rather than persisted to a bucket + signed URL — a real storage wiring is straightforward future work reusing the exact `DocumentStorage` port shape from `lib/documents/storage.ts`, but was not required to prove the assembly logic itself.
- **PDF table rendering is plain text rows, not a drawn grid** — `pdf-lib` has no built-in table primitive; a full grid-drawing implementation was out of scope for this phase.
- **Approved evidence "summary" text passed into the AI prompt is a generic placeholder** (`"${entityType} evidence (approved ${approvedAt})"`), not the actual case-study/certificate narrative — richer per-entity-type context building (mirroring `supabaseEvidenceMatchingStore.ts`'s `buildContent()`) was not reproduced in this phase to keep scope bounded; the independent evidence-approval re-verification is unaffected by this (it checks ids/lifecycle, not prompt prose).
- **No dedicated Compliance/Versions tabs were added** — this phase folds compliance results and version awareness into the single Proposal tab (outline + section inspector) rather than three separate tabs, since the section-level workflow already surfaces the same information; a future phase can split them out if the UI grows crowded.
- **Section-level "geographic requirement" and Phase 8 unimplemented qualification categories** (JV_SUBCONTRACTING, MANDATORY_FORM, DECLARATION, SIGNATURE, SUBMISSION, EQUIPMENT, CAPACITY, FINANCIAL, OTHER) are carried forward unchanged from Phase 8 — Phase 14's blueprint only routes requirements it recognises by `requirement_type` into a matching section; unrecognised types still land under UNDERSTANDING_OF_REQUIREMENT/COMPLIANCE and are never silently dropped from requirement coverage tracking.

## 11. Existing limitations carried forward unchanged

eTenders live-network limitation; eTenders CONFIGURED-not-ACTIVE; OpenAI network limitation (api.openai.com blocked by this sandbox's egress proxy, confirmed every phase since 7 — `pnpm ai:proposal:smoke` reports SKIPPED honestly); PPTX unsupported; WebSearch 403/network limitations; geographic FK limitations; geographic requirements textual/human-review limitation; document `page_id` limitation; Phase 8 unimplemented qualification categories (see above); Phase 10 evaluation-criterion↔agency-evidence linking UI limitation; Phase 10 dormant `CRITICAL_COMPLIANCE_FAILURE`; Phase 12 strategy staleness not exposed as a top-level API field; Phase 12 human differentiator/ad-hoc risk write limitation; Phase 12 milestone AT_RISK/MISSED persistence limitation; Phase 12 Activity/dashboard limitation; Phase 13 agency evidence lifecycle-field limitation; Phase 13 tender-chunk evidence matching schema-only limitation; no competitor intelligence; no automated tender submission.

## 12. API summary

All endpoints require auth + agency ownership of the bid project + Zod validation. See `apps/api/src/routes/proposals.ts` for the full handler set: `GET/POST /api/bids/:id/proposal`, `GET /api/bids/:id/proposal/versions`, `POST /api/bids/:id/proposal/sections`, `GET /api/bids/:id/proposal/sections/:sectionId`, `POST .../generate` (and `/regenerate`, same handler), `PATCH .../sections/:sectionId`, `POST .../review|approve|reject`, `GET/POST /api/bids/:id/proposal/compliance[/run]`, `GET /api/bids/:id/proposal/claims`, `GET /api/bids/:id/proposal/generations`, `POST /api/bids/:id/proposal/assemble`.

Roles (`@tender-os/constants`): `PROPOSAL_VIEW_ROLES` = ADMIN/BID_MANAGER/RESEARCHER (read); `PROPOSAL_EDIT_ROLES` = same three (draft/generate/edit); `PROPOSAL_REVIEW_ROLES` = ADMIN/BID_MANAGER only (review/approve/reject) — RESEARCHER can never approve its own drafts.
