# Submission Execution, Submission Tracking & Receipt Intelligence (Phase 16)

Status: Phase 16 complete (GREEN WITH LIMITATIONS — see §16). This document is the architecture reference for controlled submission execution, submission tracking and receipt intelligence, continuing directly from Phase 15's `APPROVED FOR HUMAN SUBMISSION` state. It does not repeat Phase 15's own architecture (see `docs/SUBMISSION-READINESS.md`) except where Phase 16 extends it.

## 1. What this phase is, and is not

Phase 15 answers "is this package ready, and has a human approved it internally?" and deliberately stops there — it never submits anything. Phase 16 picks up exactly where that stops: it moves a bid from `APPROVED FOR SUBMISSION` through **preparation → method detection → human confirmation → a controlled submission attempt → provider/human response → receipt/evidence → a verified submission status**.

The system **never** claims a tender was submitted merely because a pack was generated, downloaded, prepared, or opened. It also never claims a tender was submitted merely because a human clicked a button that says "I submitted it" — that produces `SUBMISSION_REPORTED`, a distinct, lower-confidence state from `SUBMITTED`, which requires independently-captured/verified evidence (§7).

## 2. State machine

`apps/api/src/lib/submissions/stateMachine.ts` — `resolveSubmissionExecutionStatus` is a pure function with fixed precedence (highest first):

```
CANCELLED > SUPERSEDED > readiness blocked (NOT_READY) > approval missing/invalid (NOT_READY)
> pack invalid (NOT_READY) > method unknown (REQUIRES_MANUAL_ACTION)
> automation unsupported (REQUIRES_MANUAL_ACTION) > confirmation required (AWAITING_HUMAN_CONFIRMATION)
> attempt active (SUBMITTING) > verified receipt exists (SUBMITTED)
> human reported without verified evidence (SUBMISSION_REPORTED)
> last attempt failed, retry-safe (FAILED) > last attempt outcome unknown (REQUIRES_MANUAL_ACTION)
> READY_FOR_SUBMISSION
```

Ten states total: `NOT_READY`, `READY_FOR_SUBMISSION`, `AWAITING_HUMAN_CONFIRMATION`, `SUBMITTING`, `SUBMITTED`, `SUBMISSION_REPORTED`, `FAILED`, `REQUIRES_MANUAL_ACTION`, `SUPERSEDED`, `CANCELLED`. Exactly one branch fires for any input — no contradictory statuses are representable.

## 3. Submission methods and automation capability

`SUBMISSION_EXECUTION_METHOD`: `PORTAL`, `EMAIL`, `PHYSICAL_COURIER`, `PHYSICAL_HAND_DELIVERY`, `API`, `OTHER`, `UNKNOWN`.
`SUBMISSION_AUTOMATION_STATUS`: `AUTOMATION_AVAILABLE`, `MANUAL_REQUIRED`, `UNSUPPORTED`, `UNKNOWN`.

Method resolution (`lib/submissions/resolver.ts`, `resolveSubmissionMethod`) is entirely deterministic — no AI (§39 binding constraint). Precedence: an explicit human-confirmed method always wins; otherwise the verified tender record (`tenders.submission_method/submission_url/submission_email`) is preferred over document-evidence text; a conflict between the two produces `UNKNOWN` + `requiresReview: true` rather than silently picking one; nothing known at all produces `UNKNOWN`, never a guess.

In this build, **no method is ever `AUTOMATION_AVAILABLE`** — every adapter (portal/email/API) degrades honestly to `MANUAL_REQUIRED` because no live provider integration, authorised browser-automation session, or email-sending credential is configured anywhere in this deployment (§48/§49's "never send a real tender accidentally" default). The adapter seam is real and fully tested; only the live wiring is absent, and that is documented here rather than faked.

## 4. Adapter architecture

`apps/api/src/lib/submissions/adapters/types.ts` defines the `SubmissionAdapter` contract (`canHandle`/`validate`/`execute`), mirroring the pure-function + port pattern used throughout this codebase (Phase 7 `OpenAiClient`, Phase 15 `SubmissionPackStoragePort`). Implementations:

- `manual.ts` — always `REQUIRES_MANUAL_ACTION`, carrying numbered instructions. Never contacts anything.
- `email.ts` — verifies outgoing attachments against the approved manifest (§6) before any send; sends only if an `EmailSenderPort` is injected (none is, by default); otherwise returns the exact recipient/subject/body/attachment-manifest a human needs.
- `portal.ts` — accepts an optional `PortalAutomationPort` (an authorised connector this deployment doesn't have). CAPTCHA/MFA/auth-required responses from the port always resolve to `REQUIRES_MANUAL_ACTION` with the matching error code — **never bypassed**. A timeout resolves to `UNKNOWN_OUTCOME`/`TIMEOUT`, never silently retried.
- `api.ts` — same shape for an official provider API/web service; degrades to manual with no client configured.
- `physical.ts` — always `REQUIRES_MANUAL_ACTION`; the physical/courier lifecycle itself is tracked separately (§8), not pretended to be "executed".
- `adapters/mock/mockAdapters.ts` — **TEST-ONLY**, never imported by any route or store: `MockPortalSuccessAdapter`, `MockPortalTimeoutAdapter`, `MockPortalCaptchaAdapter`, `MockPortalRejectedAdapter`, `MockEmailAdapter`, `MockPhysicalAdapter`. Used exclusively by `lib/submissions/__tests__` to exercise every adapter outcome deterministically.

`lib/submissions/registry.ts`'s `buildDefaultAdapterRegistry` is what `routes/submissionExecution.ts` actually uses in production — it wires the real (not mock) adapters with every injectable capability set to `null`/empty, so every attempt in this deployment safely produces `REQUIRES_MANUAL_ACTION` rather than a live external call.

## 5. Human confirmation

`bid_submission_confirmations` (migration `20260912000000_submission_execution.sql`) is durable and server-recorded — not merely a frontend checkbox. It captures who confirmed, when, and the **exact** readiness snapshot id, pack id, pack version, pack hash, manifest hash, submission method, and target. A DB trigger (`prevent_submission_confirmation_mutation`) makes every field but `invalidated`/`invalidated_reason`/`invalidated_at` immutable once written.

`lib/submissions/confirmation.ts`'s `isConfirmationStillValid` re-checks all five identity fields against the *current* pack/readiness before every attempt (`lib/submissions/runSubmission.ts`'s `attemptSubmission`). Any drift — pricing edited, a new pack version built, a different readiness snapshot computed — makes the confirmation invalid and the attempt is blocked with `NO_VALID_CONFIRMATION`, requiring a fresh confirmation cycle. This directly implements the spec's worked example: approved pack v4/hash ABC123 → user edits pricing → pack v5 exists → the v4 confirmation is never honoured for a v5 submission.

## 6. Pack integrity & pre-submission validation

`lib/submissions/validation.ts`'s `runPreflightValidation` is the single deterministic gate before every attempt, checking (all five categories, every blocker returned at once, never short-circuited): bid state (exists/agency/decision/override), readiness (current, `READY_TO_SUBMIT`), approval (exists, references current pack+readiness), pack (exists, not superseded, hash/manifest match, files present), compliance (no mandatory blocker), and deadline (server time only). `PreflightBlockCode` enumerates every reason.

Email attachment integrity (§16 of the spec) is a separate, focused check: `lib/submissions/attachmentIntegrity.ts`'s `verifyAttachmentsAgainstManifest` compares filename/size/SHA-256/MIME type of every outgoing file against the approved manifest and blocks the send on any mismatch — the email adapter calls this before ever attempting to send.

## 7. Receipt intelligence

`bid_submission_receipts` records `receipt_type` (`PORTAL_RECEIPT`, `EMAIL_MESSAGE_ID`, `EMAIL_DELIVERY_CONFIRMATION`, `COURIER_TRACKING`, `PROOF_OF_DELIVERY`, `PROCUREMENT_REFERENCE`, `MANUAL_ATTESTATION`, `OTHER`) and `verification_status` (`MISSING`, `CAPTURED`, `VERIFIED`, `UNVERIFIED`, `CONFLICTING`). `lib/submissions/receipts.ts`'s `classifyReceiptVerification` never fabricates confidence: a provider-issued receipt (captured automatically from a successful adapter response, or explicitly marked `providerIssued` by a human) is `VERIFIED`; a corroborated-but-not-itself-provider-issued reference is also `VERIFIED`; a bare user-typed reference is `UNVERIFIED`; two disagreeing receipts are `CONFLICTING`. `hasSufficientVerifiedEvidence` is the single gate that allows the execution to ever report `SUBMITTED` (§37's precedence). A DB trigger makes every receipt's evidentiary fields immutable once created — only `verification_status`/`notes` may ever change, and every capture is append-only.

## 8. Physical/courier submission

The system cannot physically deliver anything. `lib/submissions/physical.ts`'s `canTransitionPhysicalStage` enforces a strict, non-skippable lifecycle — `NOT_STARTED → PREPARED → DISPATCHED → IN_TRANSIT → DELIVERED → SUBMISSION_REPORTED → SUBMITTED` — with evidence required at the meaningful transitions (dispatch evidence to move to `DISPATCHED`, delivery evidence to `DELIVERED`, a human attestation to `SUBMISSION_REPORTED`, and **proof of delivery** — not merely a human report — to reach the verified `SUBMITTED` stage). `DISPATCHED` never implies `SUBMITTED`, per the spec's explicit binding constraint.

## 9. Retry safety & duplicate protection

`lib/submissions/retry.ts`'s `classifyRetrySafety` never treats a timeout/network error as automatically safe to retry — the external system may have accepted the submission despite the local failure to observe a response. Retry is `SAFE_TO_RETRY` only when the adapter has deterministic proof the provider never received the previous attempt, or a human explicitly confirms it. Deadline-passed, pack-changed, and CAPTCHA/MFA/manual-action outcomes are never retryable at all, regardless of confirmation.

`lib/submissions/duplicateProtection.ts`'s `checkDuplicateSubmission` blocks any further attempt once a confirmed submission (successful attempt) already exists for this bid, unless an explicit human override is passed — this is never automatic.

## 10. Idempotency & concurrency

`lib/submissions/idempotency.ts` computes a SHA-256 **local** idempotency key from `agencyId + bidProjectId + packVersionId + submissionTarget + confirmationId`, enforced as a DB unique constraint (`bid_submission_attempts_idempotency_key_unique`). This is explicitly documented as *local* idempotency only — it detects an accidental duplicate execution originating from this system, but can never guarantee the external provider itself treats a resend as a no-op.

Concurrency is protected at the database layer: `bid_submission_attempts_one_active_idx` is a partial unique index permitting at most one `STARTED` attempt per submission execution at a time; `bid_submission_executions.version` is an optimistic-concurrency counter checked on every write by the store layer, so two concurrent writers can never silently create two independent submission outcomes — the second writer's stale write is rejected with a `CONFLICT` error and must re-read and retry the whole orchestration.

## 11. Deadline handling

`lib/submissions/deadline.ts`'s `classifySubmissionDeadlineUrgency` is the Phase-16-specific threshold scale (distinct from Phase 15's 72h/24h readiness-warning bands): **>24h `NORMAL`, ≤24h `CLOSING_SOON`, ≤2h `URGENT`, ≤30min `CRITICAL`, deadline passed `BLOCKED`**. Always fed the server's `nowIso` explicitly — never `new Date()` inside the pure function, never browser time. A warning is informational only; only `BLOCKED` (deadline actually passed) is ever a hard blocker in `runPreflightValidation`.

## 12. Security

- **No CAPTCHA/MFA/anti-bot bypass, ever.** Every adapter treats a CAPTCHA/MFA/auth-required response as `REQUIRES_MANUAL_ACTION`, never as an error to engineer around (unit-tested in `adapters.test.ts`).
- **Submission target security** (`lib/submissions/targetSecurity.ts`): portal/API targets must be HTTPS and on a configured allow-list (reusing `lib/security/urlSafety.ts`'s SSRF-safe URL validation); email targets are structurally validated; any deviation from the tender's own verified recipient requires explicit human confirmation before being accepted.
- **RBAC**: viewing (`SUBMISSION_EXECUTION_VIEW_ROLES`) is always less privileged than confirming/attempting/manual-completing (`SUBMISSION_EXECUTION_CONFIRM_ROLES`/`SUBMISSION_EXECUTION_MANAGE_ROLES` = `ADMIN`/`BID_MANAGER` only), enforced server-side via `requireRole`.
- **RLS + agency isolation**: every new table is agency-scoped with a `select`-only `authenticated` policy; every write goes through the service-role Supabase client from `routes/submissionExecution.ts`/`lib/submissions/supabaseSubmissionExecutionStore.ts`, never a browser-scoped client.
- **Storage**: no new document storage is introduced beyond Phase 15's `SubmissionPackStoragePort` (still an in-memory mock in this sandbox — see §16); receipt files/proof-of-delivery are recorded by storage path/URL reference only in this build, with the same private-bucket/signed-URL requirement documented as a limitation.
- **Prompt injection**: no AI is involved in any submission decision (§13 below), so tender-document text has zero authority over submission state regardless of its content.

## 13. No AI dependency

Every decision in this phase — method resolution, preflight validation, confirmation validity, retry safety, receipt verification, deadline urgency, duplicate detection, the aggregate status — is a pure, deterministic TypeScript function with unit tests. Nothing in `lib/submissions/*` calls an LLM. This is intentional (spec §39/§57): AI must never decide whether a bid was submitted, whether a receipt is genuine, or whether a retry is safe.

## 14. Audit trail

`SUBMISSION_EXECUTION_AUDIT_EVENTS` (shared/constants): `SUBMISSION_PREPARED`, `SUBMISSION_CONFIRMATION_REQUESTED`, `SUBMISSION_CONFIRMED`, `SUBMISSION_ATTEMPT_STARTED`, `SUBMISSION_ATTEMPT_COMPLETED`, `SUBMISSION_ATTEMPT_FAILED`, `SUBMISSION_RECEIPT_CAPTURED`, `SUBMISSION_RECEIPT_VERIFIED`, `SUBMISSION_MARKED_MANUAL`, `SUBMISSION_REPORTED`, `SUBMISSION_APPROVAL_INVALIDATED`, `SUBMISSION_CANCELLED` — every one is actually emitted by `lib/submissions/runSubmission.ts` (not merely declared and left dormant, addressing the Phase 15 §59 known limitation for this phase's own events). No secret (password/API key/session token/MFA code) is ever logged.

## 15. Test strategy

- **Unit** (`apps/api/src/lib/submissions/__tests__/`, 136 tests): state machine precedence, deadline thresholds, method resolution (including the conflicting-evidence case), preflight validation (every blocker code, all-blockers-at-once), confirmation staleness, retry safety, receipt verification, physical lifecycle, duplicate protection, attachment integrity, target security, error classification (every declared code), idempotency key determinism, every adapter (manual/email/portal/api/physical) plus every mock adapter, and a full orchestration integration suite (`runSubmission.test.ts`) against an in-memory fake store covering the complete workflow and every required failure path (deadline passed, pack changed, provider CAPTCHA/rejection/timeout, duplicate attempt, concurrent attempt, manual completion → receipt → SUBMITTED upgrade, unverified receipt staying `SUBMISSION_REPORTED`, cancellation rules).
- **Database** (`database/src/__tests__/submissionExecution.test.ts`, 14 tests): RLS agency isolation on every new table, service-role-only writes, one-execution-per-project uniqueness, confirmation immutability (trigger), FK enforcement for attempts, one-active-attempt concurrency guard, idempotency-key uniqueness, terminal-attempt (append-only) immutability, receipt evidence-field immutability, malformed/malicious id rejection.
- **E2E** (`tests/e2e/submission-execution.spec.ts`, 15 scenarios, mocked at the network boundary — same convention as every prior phase): ready-for-submission, confirmation required, changed-package blocks a stale confirmation, manual portal workflow, email method display, physical/courier workflow, successful mock submission → verified receipt → `SUBMITTED`, provider failure → `FAILED`, unknown outcome (timeout) never becomes `SUBMITTED`, duplicate-submission warning, deadline blocks an attempt, receipt capture/view with `UNVERIFIED` status, immutable timeline rendering, cross-agency access blocked, pack-hash-mismatch blocks execution.

## 16. Known limitations (Phase 16, new)

- **No live provider/portal/email integration is wired in this build.** Every method safely and honestly degrades to `MANUAL_REQUIRED`/`REQUIRES_MANUAL_ACTION`. The adapter seam (`SubmissionAdapter`, `PortalAutomationPort`, `EmailSenderPort`, `ApiSubmissionClientPort`) is real, typed, and unit-tested against mocks — wiring a real, authorised connector is future work, never faked here.
- **Live Supabase Storage for receipt files/proof-of-delivery is not wired** in this sandbox (no reachable Supabase project), consistent with Phase 15's own `SubmissionPackStoragePort` limitation (Phase 15 §40). Receipt records store a `receipt_url`/`receipt_file` reference field; the private-bucket/signed-URL implementation is deferred alongside Phase 15's identical gap rather than duplicated.
- **No dedicated notification/reminder platform exists.** Deadline-approaching, manual-action-required, approval-invalidated, attempt-failed and receipt-missing events are all recorded as audit events (§14) that a future phase's notification system could subscribe to; no email/push/SMS delivery mechanism is built in this phase (matches the existing `notifications` table's dormant state noted in prior phases).
- **`humanOverrideToBid` is always `false`** in `getBidContext` (no dedicated Phase-16 field/UI exists yet to record a human override of a `NO_BID` decision for submission purposes) — a genuine `NO_BID` always blocks submission preparation in this build; this mirrors the conservative default already used elsewhere rather than inventing a new override mechanism speculatively.
- **Document-evidence-derived submission method** (`documentEvidenceMethod`) has no automatic extraction wired from Phase 6/9's document pipeline in this phase — it is accepted as an optional parameter to `prepare`, but nothing yet populates it automatically; until it is, method resolution runs on the verified tender record alone (which is the higher-confidence source in any case).

## 17. Carried-forward limitations (verified still applicable)

All Phase 15 limitations remain and are unchanged by this phase (Phase 15 §59): the mock `SubmissionPackStoragePort`/`InMemorySubmissionPackStorage` (see §16 above), forms/signatures inferred from `tender_requirements` rather than a dedicated table, file-level format/size/naming validation defaulting to "no constraint" absent structured tender data, and `agency_certificates`-derived certificate status mapping. Earlier-phase limitations (eTenders live-network/CONFIGURED-not-ACTIVE, OpenAI unavailable in this sandbox, geographic FK gaps, document `page_id` gap, Phase 8 qualification categories routed to human review, the dormant `CRITICAL_COMPLIANCE_FAILURE` state, strategy staleness API gap, milestone `AT_RISK`/`MISSED` persistence gap, PDF table rendering, structured tender forms/signatures extraction, addenda acknowledgement/reconciliation) are all unaffected by this phase and continue to apply exactly as documented in their originating phase's docs — none of them are Phase 16 failures.
