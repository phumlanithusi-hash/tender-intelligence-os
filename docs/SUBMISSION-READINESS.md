# Final Bid Compliance, Submission Readiness & Submission Pack — Phase 15

Status: implemented. This document describes the as-built system. See `docs/DECISIONS.md` ("Phase 15") for naming/collision decisions and the Phase 15 completion report for exact test counts.

## 1. Objective and critical principle

Phase 15 answers one question: **given the current bid decision and all available bid artifacts, is this package ready to submit?** It is the final deterministic compliance/packaging layer sitting after Phase 14 (proposal generation).

Phase 15 is **not** submission automation. It never submits a tender, uploads to eTenders or any procurement portal, emails anyone automatically, clicks a final "submit" on an external system, bypasses auth/CAPTCHA, fabricates documents/signatures/pricing/certificates, or automatically approves the final bid. It prepares and validates the package only.

## 2. Authoritative decision boundaries

Phase 8 Qualification → Phase 10 Opportunity Score → Phase 11 Bid/No-Bid → Phase 12 Bid Strategy/Readiness → Phase 13 Evidence Approval → Phase 14 Proposal Generation → **Phase 15 Final Submission Readiness**. Phase 15 never changes Qualification, Opportunity Score, Bid/No-Bid, Bid Strategy, or Approved Evidence — it only determines final submission readiness given all of the above.

Three distinct concepts, never merged: **Bid/No-Bid** (Phase 11 — should we pursue?), **Bid Strategy/Readiness** (Phase 12 — are we strategically prepared?), **Submission Readiness** (Phase 15 — is the final submission package complete and compliant enough to submit?).

## 3. Architecture

```
bid_strategy_projects (Phase 12, read-only)
        │
        ▼
  bid_submission_readiness ── one CURRENT snapshot per bid project, immutable once superseded
        │
        ├── bid_submission_readiness_items ── one row per BLOCKER/WARNING/INFO
        │
        ▼
  bid_submission_packs ── versioned, never overwritten (CURRENT/SUPERSEDED/INVALIDATED)
        │
        ├── bid_submission_pack_files ── sha256, size, mime type per packaged file
        └── bid_submission_manifests ── human-readable rollup
        │
        ▼
  bid_submission_approvals ── APPROVED_FOR_SUBMISSION human decision, references EXACT pack+readiness
```

Pricing (the Phase 14 gap): `bid_pricing` (one CURRENT version per bid project) → `bid_pricing_items` (line/description/quantity/unit/unit price/total/notes).

## 4. Final compliance engine (`apps/api/src/lib/submissionReadiness/engine.ts`)

`calculateSubmissionReadiness(input): SubmissionReadinessResult` is a **pure, zero-I/O, deterministic** function — no database, network, or OpenAI calls, mirroring `lib/proposals/compliance.ts` and `lib/bidStrategy/readiness.ts` exactly. AI is not used anywhere in this engine (Phase 15 §49 — AI may at most explain a blocker in a future phase; it never decides readiness).

### Categories checked (16, per spec §9)

QUALIFICATION, MANDATORY_REQUIREMENTS, EVALUATION_COVERAGE, BRIEFING, ADDENDA, PROPOSAL, EVIDENCE, PRICING, MANDATORY_DOCUMENTS, FORMS, CERTIFICATES, SIGNATURES, FILE_FORMATS, FILE_NAMES, FILE_SIZES, SUBMISSION_METHOD, DEADLINE.

### Precedence

`BLOCKED` (any BLOCKER item) > `REQUIRES_REVIEW` (any WARNING, no blocker) > `READY_TO_SUBMIT` (no blockers or warnings). A package can be arbitrarily complete and still `BLOCKED` by a single mandatory unresolved issue — never a green percentage overriding a hard blocker.

### UNKNOWN vs FAIL

An UNKNOWN state (certificate status unknown, briefing attendance unrecorded, submission method undetermined) is never automatically a failure — it becomes `REQUIRES_REVIEW` unless the tender explicitly proves a mandatory item is missing/expired/invalid, which is a hard `BLOCKED`. Examples enforced in the engine: certificate `UNKNOWN` → warning; certificate `EXPIRED` → blocker; mandatory form not found → blocker; optional document missing → warning.

### Hard blockers (from spec §11, all implemented)

Missing mandatory form/certificate/signature/pricing; missed compulsory briefing; unresolved mandatory requirement; invalid required file format/oversized file/invalid file name (only when a naming convention exists); missing required document; expired required certificate; required addendum not acknowledged; deadline passed; submission method unresolved (when the method itself is known but instructions aren't); required proposal section missing; required evidence missing; rejected evidence used; stale mandatory evidence; unresolved mandatory compliance issue (Phase 14 proposal compliance `BLOCKED`); NO_BID authoritative decision.

### Deadline engine (`deadline.ts`)

Uses only `nowIso` (the server's authoritative clock, always passed in — never `new Date()` inside the pure module, never browser time) and the tender's `closing_date`/`closing_time`. States: `OPEN`/`CLOSING_SOON`/`CLOSED`/`UNKNOWN`. A passed deadline is always `BLOCKED`; an approaching deadline (`CLOSING_WITHIN_72_HOURS`/`CLOSING_WITHIN_24_HOURS`/`CLOSING_TODAY`) is informational only — never itself a blocker.

## 5. Pricing (`pricing.ts`)

The Phase 14 pricing gap is now implemented: `bid_pricing`/`bid_pricing_items` support line item/description/quantity/unit/unit price/total/currency/notes, and a `is_mandatory_schedule_item` flag for a tender-prescribed BOQ/pricing schedule. `validatePricingLine`/`validatePricingLines` are pure deterministic arithmetic checks (`quantity × unitPrice == lineTotal`, within a cent of rounding tolerance) — nothing here invents, estimates, or optimises a price. Missing required pricing → `BLOCKED`; an arithmetic mismatch on any line → `BLOCKED`; a missing currency where required → `BLOCKED`; a missing optional line's currency → `WARNING`. Pricing reads/writes are restricted to `SUBMISSION_PRICING_ROLES` (ADMIN/BID_MANAGER) — never exposed to RESEARCHER/VIEWER, AI prompts, or unauthenticated routes.

## 6. Submission pack, manifest, and integrity (`pack.ts`)

`buildPackFileRecord()` computes a SHA-256 hash (`sha256Hex`, Node's `crypto`) for every packaged file, alongside its mime type, size, and exact source table/id (never "the latest version" — an exact `bid_proposal_versions`/`bid_pricing` row id). `detectDuplicateFiles()` flags files sharing a hash regardless of filename. `buildSubmissionManifest()` assembles the human-readable rollup (tender/organisation/closing date/submission method/document list/compliance summary/overall status) entirely from data the caller supplies — never a fabricated status.

A pack is immutable once created (`prevent_submission_pack_mutation` DB trigger) and versioned (`bid_submission_packs.version`, unique per bid project); creating pack N+1 marks pack N `SUPERSEDED` rather than overwriting it — historical packs remain fully reproducible.

### Storage (Phase 15 §40)

`SubmissionPackStoragePort` is a deterministic storage abstraction (`put`/`getSignedUrl`), with `InMemorySubmissionPackStorage` as a test/mock adapter enforcing agency-scoped paths (`submission-packs/<agencyId>/<packId>/<fileName>`) and rejecting cross-agency path access at the application layer. **Known limitation, stated honestly rather than fabricated**: this phase does not wire a live Supabase Storage bucket (no real Supabase project/network reachable in this sandbox, same limitation Phase 14 documented for `bid_proposal_documents`) — the current implementation records `storage_path`/`sha256`/`mime_type`/`size_bytes` for each pack file (sourced from Phase 14's `bid_proposal_documents.storage_path`/`file_hash` where available) without itself performing a live upload. The port abstraction and mock adapter make the code path real and testable; wiring a live bucket is mechanical follow-up work (private bucket + agency-scoped path + short-lived signed URLs + server-side privileged access), not a redesign.

## 7. Addenda & staleness (`staleness.ts`)

`tender_addenda` already existed (Phase 2 §9) and is reused as-is — not re-implemented. The engine reconciles every addendum: `acknowledgementRequired && !acknowledged` → `BLOCKED`; `isMaterial && !reconciled` → `BLOCKED` (if acknowledgement is also required) or `REQUIRES_REVIEW` (otherwise) — never silently assuming a proposal remains valid after a material addendum.

A readiness snapshot/pack becomes invalid when any material dependency changes: tender addendum, requirement change, evaluation change, proposal change, pricing change, required document change, certificate expiry, evidence becoming stale, submission instruction change, deadline change, file replacement. `isSnapshotStale` (reused unchanged from Phase 10 §46, the same mechanism every prior phase uses) drives this; `isApprovalStillValid` additionally asserts an `APPROVED_FOR_SUBMISSION` decision still references the exact CURRENT pack and readiness snapshot — any drift means the approval must be treated as no longer valid (`checkApprovalValidity` in `runSubmissionReadiness.ts`).

## 8. Final approval (`approval.ts`, `runSubmissionReadiness.ts`)

`canApproveForSubmission()` is the single pure gate: refuses when the actor's role isn't in `SUBMISSION_APPROVE_ROLES` (ADMIN/BID_MANAGER only), when any blocker remains, when the readiness status isn't exactly `READY_TO_SUBMIT`, or when no non-empty approval reason/confirmation was given. `approveForSubmission()` is the only path to an approval row, and always references the exact `readiness_id`/`pack_id` (never "the latest") — enforced further at the DB level (`bid_submission_approvals` FKs + a unique index allowing only one `APPROVED` row per bid project at a time).

Even after `APPROVED_FOR_SUBMISSION`, the system displays **"APPROVED FOR HUMAN SUBMISSION"** — it has not submitted anything. No `SUBMITTED` status, and no `SUBMISSION_COMPLETED` audit event, exist anywhere in this system (binding constraint).

## 9. Audit events

Reuses the existing `audit_logs` framework exactly (no new table). Events emitted: `FINAL_COMPLIANCE_RUN`, `SUBMISSION_READINESS_CALCULATED`, `SUBMISSION_PACK_CREATED`, `SUBMISSION_PACK_VERSION_CREATED`, `SUBMISSION_MANIFEST_CREATED`, `SUBMISSION_APPROVED_FOR_SUBMISSION`, `SUBMISSION_APPROVAL_REVOKED`. `SUBMISSION_BLOCKER_CREATED`/`SUBMISSION_BLOCKER_RESOLVED`/`SUBMISSION_PACK_INVALIDATED`/`SUBMISSION_APPROVAL_REQUESTED` are declared in the shared audit-event vocabulary (`@tender-os/constants`) for a future phase's UI-driven blocker-resolution workflow to emit; this phase's automated check/pack/approval flow does not yet emit them itself (see Known Limitations).

## 10. Security

Every route (`apps/api/src/routes/submissionReadiness.ts`) enforces `requireAuth` + `requireRole` + agency ownership resolved server-side (`loadOwnedProject`, mirroring `routes/bidStrategy.ts` exactly — `agency_id`/`bid_project_id` are never trusted from the request body/URL for authorization) + Zod validation (`@tender-os/schemas`) + RLS (every new table's `select` policy is `agency_id = current_agency_id()`; all writes go through the service-role client, only after the route's own checks). Pricing routes are further restricted to `SUBMISSION_PRICING_ROLES`. Cross-agency access is verified to fail both at the DB layer (`database/src/__tests__/submissionReadiness.test.ts`) and the application layer (`apps/api/src/lib/submissionReadiness/__tests__/security.test.ts`).

## 11. API summary

`GET/POST /api/bids/:id/submission-readiness[/check|/items]`, `GET/POST/PATCH /api/bids/:id/pricing[/items[/:itemId]]`, `GET/POST /api/bids/:id/submission-pack[/versions|/:packId]`, `GET /api/bids/:id/submission-manifest`, `POST /api/bids/:id/submission-approval[/revoke]`. No route in this file submits anything externally.

## 12. UI

A new "Submission Readiness" tab on the Bid Project dashboard (`apps/web/src/components/bids/BidStrategyDashboard.tsx`, `SubmissionReadinessTab`): header status badge, category summary grid, a Blocker Panel (prominent, red), a separate Warning/Notice Panel (non-alarming), an authorised-only Pricing section (add/inspect lines), a Submission Pack & Manifest section (build pack, inspect file hashes, expand manifest JSON), and a Final Approval section that withholds the approve button entirely while blocked and always displays "READY FOR HUMAN SUBMISSION" / "APPROVED FOR HUMAN SUBMISSION" rather than any claim of an actual submission.

## 13. Known limitations (new, Phase 15)

- **Forms/signatures have no dedicated per-tender extraction schema yet.** Phase 8/9 does not structurally distinguish "a form to sign" from a general requirement; the assembler currently derives certificates/documents from `agency_certificates`/`agency_documents` and leaves the `forms`/`signatures` arrays empty by default (never fabricated true/false) unless a human records them through the pricing-adjacent extension point. This is the same "safe nullable default, never invented" discipline every prior phase applies.
- **File-level format/size/naming validation requires machine-readable tender constraints that are not currently extracted as structured fields** — where absent, files default to "no constraint" (`formatValid`/`sizeValid: null`, `NO_NAMING_RULE`), never invented as failing or passing.
- **Live Supabase Storage upload is not wired** (see §6) — a deterministic storage-port abstraction and mock adapter make the code path real/testable; a live bucket is stated as a limitation, not fabricated as working.
- **Addenda are treated as always material with unresolved acknowledgement/reconciliation** by the current Supabase store's `assembleInput` (no dedicated "acknowledged"/"reconciled" tracking columns were added to `tender_addenda` — Phase 15 explicitly scoped that table as reused-as-is). This means the engine will correctly `REQUIRES_REVIEW` (or `BLOCKED` if a tender is later marked acknowledgement-required) on any existing addendum until a future phase adds the tracking columns; it never silently treats an addendum as already reconciled.
- **`SUBMISSION_BLOCKER_CREATED`/`SUBMISSION_BLOCKER_RESOLVED`/`SUBMISSION_PACK_INVALIDATED`/`SUBMISSION_APPROVAL_REQUESTED` audit events are declared but not yet emitted** by this phase's synchronous check/pack/approval flow (see §9) — reserved for a future interactive blocker-resolution workflow.
- **Evaluation criterion "mandatory coverage" is read from a `mandatory` column assumed present on `tender_evaluation_criteria`**; where absent it defaults to `false` (uncovered criteria warn rather than block) — the safe default, never an invented mandatory flag.

## 14. Existing limitations carried forward unchanged

All Phase 14 limitations (pricing gap — now resolved by this phase; proposal documents not yet in live Supabase Storage — still true, same root cause as §6 above; PDF table rendering as plain rows; generic evidence-summary placeholder text in AI prompts; no separate Compliance/Versions proposal tabs; Phase 8 unimplemented qualification categories), plus every limitation Phase 14 itself carried forward (eTenders live-network limitation; eTenders CONFIGURED-not-ACTIVE; OpenAI network limitation — confirmed again this phase, `pnpm ai:smoke` reports SKIPPED honestly; PPTX unsupported; WebSearch 403/network limitations; geographic FK/requirement limitations; document `page_id` limitation; Phase 10 evaluation-criterion↔agency-evidence linking UI limitation; Phase 10 dormant `CRITICAL_COMPLIANCE_FAILURE`; Phase 12 strategy staleness/differentiator/milestone/Activity limitations; Phase 13 agency-evidence-lifecycle-field limitation; Phase 13 tender-chunk evidence matching schema-only limitation; no competitor intelligence; no automated tender submission — the last of these is Phase 15's own central binding constraint, not merely carried forward).
