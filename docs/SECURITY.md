# Security — Tender Intelligence OS

Status: Phase 0 design document. Security posture to be validated against the real implementation at the end of every phase, not just Phase 1.

## 1. Threat model summary

The system holds three categories of sensitive material: agency commercial data (pricing, strategy, case studies, credentials — competitively sensitive), procurement-relevant records that feed real bid/no-bid and submission decisions (where an error has real financial and compliance consequences, not just a UX bug), and third-party document content ingested from the open web and untrusted uploads (a prompt-injection and malware surface). Security controls are designed against all three, not just conventional web-app auth.

## 2. Authentication

Supabase Auth is the identity provider. The frontend never talks to the database directly with elevated privileges — it authenticates via Supabase Auth, receives a JWT, and every subsequent API call carries that JWT. `apps/api` verifies the JWT signature and expiry on every request via middleware (spec §38); there is no endpoint that trusts a client-supplied user id without verifying it against the token.

## 3. Authorization — two independent layers

1. **Row Level Security (Postgres)** — the database itself refuses to return or accept rows outside an agency's scope, per DATABASE.md §5. This holds even if application code has a bug, because the database enforces it regardless of which layer issued the query — critical given that background workers, jobs, and multiple API instances all touch the same database.
2. **RBAC (API middleware)** — the six roles from spec §39 (`ADMIN`, `BID_MANAGER`, `RESEARCHER`, `WRITER`, `REVIEWER`, `VIEWER`) gate specific actions, not just data visibility. RLS alone would let a `VIEWER` read anything their agency can see; RBAC middleware is what stops a `VIEWER` from recording a NO-BID decision or submitting a bid. Permission checks are declared per route/action (e.g. `requireRole(['ADMIN','BID_MANAGER'])` on the NO-BID and final-submission endpoints), not scattered as ad hoc `if` statements, so the full permission map is auditable in one place.

Both layers are required; neither substitutes for the other.

## 4. Secrets management

Per spec §38 and §40: OpenAI API keys, Supabase service role key, scraper credentials, and database credentials are never sent to the browser. Concretely: `apps/web`'s Vite build only ever embeds `VITE_`-prefixed variables (Supabase URL + anon key — safe by Supabase's own design since RLS is the real access boundary, not key secrecy); every other secret lives only in `apps/api` and worker process environments, loaded via `.env` locally and the deployment platform's secret store in any real environment. `.env.example` documents every required variable with a placeholder and a note on where to obtain it; `.env` is gitignored from the first commit and never committed at any phase. A CI/pre-commit check (added in Phase 1) scans for accidentally committed secret-shaped strings.

## 5. Storage and file handling

Supabase Storage buckets for tender documents and agency documents are private by default; the frontend and any external link never gets a permanent public URL — it gets a short-lived signed URL issued by `apps/api` after an authorization check (spec §38). Uploaded files (agency documents, certificates) are validated for MIME type and size before storage, and are scanned/handled as untrusted binary content — text extraction happens in an isolated worker process (documents pipeline), not by directly executing or rendering uploaded content in a trusted context.

## 6. Untrusted content and prompt injection

Scraped tender documents and any uploaded file are untrusted input twice over: as documents that might carry malicious payloads (handled per §5), and as text that might carry prompt-injection attempts against AI agents (handled per AI-ARCHITECTURE.md §5 — document text is delimited as data, agents have no tool/database access, and structured-output validation is the actual enforcement boundary, not the model's good behavior). This document and AI-ARCHITECTURE.md should be read together on this point; the control lives at the agent boundary, but the reason it matters is a security concern, not just a quality concern.

## 7. Input validation

Every API request body/query/params is validated against a Zod schema from `shared/schemas` before touching a service or repository (spec §38's "input validation" + ARCHITECTURE.md's layering). This is the same schema set used to validate AI agent output, so a malformed or hostile payload — whether from a browser client or a model response — is rejected at the same boundary with the same rules.

## 8. Rate limiting

API-level rate limiting (per-user and per-IP) protects against abuse of expensive endpoints (AI generation, document upload, search). Separately, the scraping layer has its own per-source rate limiting for a different reason — respecting the target site, not protecting this system (SCRAPING-ARCHITECTURE.md §9). These are two distinct mechanisms and must not be conflated in implementation.

## 9. Audit logging

`audit_logs` (DATABASE.md §3.4) is the system of record for who/what changed a procurement-relevant entity and when, including AI-agent-driven changes (agent name + model + prompt version recorded, per AI-ARCHITECTURE.md §1). The table is insert-only at the database grant level — no role, including `ADMIN` through the application, has UPDATE or DELETE on it — so a compromised admin account cannot retroactively cover its tracks. Logging never includes secret values (API keys, passwords, tokens) even in a `before`/`after` diff (spec §39); a redaction step strips known secret-shaped fields before a row is written.

## 10. Data integrity for procurement decisions

Nothing that feeds a bid/no-bid or submission decision is ever hard-deleted or silently overwritten (ARCHITECTURE.md §6, DATABASE.md §1/§6): scores, compliance checks, and status changes are append-only history. This is a security property as much as a data-quality one — it means an after-the-fact investigation ("why did we submit with this score") cannot be defeated by a later update to the same row.

## 11. Dependency and supply-chain hygiene

`npm audit` / equivalent runs as part of the Phase 1 CI scripts and on every subsequent phase's test gate (TESTING.md). Scraper and document-processing dependencies (which parse untrusted, attacker-influenceable input — PDFs, DOCX, HTML) are kept current deliberately, since parser vulnerabilities are a realistic attack surface for a system whose entire job is ingesting documents from the open web.

## 12. Environment separation

Development, staging, and production use separate Supabase projects and separate secret sets. Seed/demo data (DATABASE.md §6) is gated behind `NODE_ENV !== 'production'` so a seeding script cannot run against production even if invoked by mistake.

## 13. What is explicitly deferred, and why that's safe for now

Multi-factor authentication, SSO/SAML, and formal penetration testing are not part of the Phase 1 foundation; Supabase Auth's standard email/password + session model is the Phase 1 baseline. This is acceptable at this stage because Phase 1 contains no procurement data and no real tenders — but it is flagged here explicitly so it is not forgotten once the system holds real commercial and procurement information; it should be revisited no later than the Phase 10 MVP checkpoint (Tender Radar), when the system starts holding data an agency would not want exposed.

## 14. Phase 7 AI-specific security notes

Full detail in `docs/AI-DISCOVERY-CLASSIFICATION.md`. Summary of the properties enforced:

- **Prompt injection**: tender document content is passed to the model with an explicit `TRUSTED APPLICATION DATA` / `UNTRUSTED TENDER CONTENT` separation and a system instruction stating untrusted content is never an instruction channel — but the actual enforcement backstop is that persistence never trusts the model's own output regardless of how well it complied (Zod schema validation + server-side evidence resolution, `docs/AI-DISCOVERY-CLASSIFICATION.md` §5–§6).
- **Evidence/cross-tenant reference integrity**: a claimed evidence chunk id is rejected outright if it is not UUID-shaped (blocking SQL-injection/path-traversal-shaped strings before any query runs), rejected if it does not exist, and rejected if it exists but belongs to a different tender's document — enforced in `evidence/resolver.ts` and covered by dedicated tests (`runAgent.test.ts`, `evidence.test.ts`) and a database-level test in `schema.test.ts`.
- **API key handling**: `OPENAI_API_KEY` is read only in `apps/api/src/lib/ai/config.ts` from server environment; it is never sent to, or reachable from, the browser bundle (it lives in `serverEnv.ts`, the server-only subpath export — same mechanism §4/DATABASE.md §5 already use to keep `SUPABASE_SERVICE_ROLE_KEY` out of `apps/web`). The key is never logged.
- **Tenant isolation**: AI run/classification records are agency-scoped under RLS exactly like `tender_scores` (DATABASE.md §13) — an agency can never read another agency's AI results, verified by a dedicated RLS test suite.
- **Role enforcement**: triggering a classification run (`POST .../ai/classify|reclassify`) requires `ADMIN` or `BID_MANAGER`; viewing results requires at least `RESEARCHER`. A plain `VIEWER`/`WRITER`/`REVIEWER` cannot execute an arbitrary prompt — there is no endpoint that accepts free-form prompt text from any caller at all; the prompt is entirely server-owned.
- **Idempotency/replay**: a database-level partial unique index prevents two concurrently `QUEUED`/`RUNNING` runs for the same tender+agency, closing the race a purely application-level check could miss under concurrent requests.
- **Logging**: AI observability events (`AI_RUN_STARTED` etc.) log ids, model name, and short reason strings only — never full extracted document text, never the API key.

## 15. Phase 8 qualification-specific security notes

Full detail in `docs/QUALIFICATION-ENGINE.md`. Summary:

- **Agency isolation**: `tender_qualification_runs`/`results`/`actions`/`reviews` are agency-scoped under RLS exactly like `tender_ai_runs` (§14) — verified by a dedicated RLS test suite (`database/src/__tests__/qualification.test.ts`) that inserts two agencies and asserts agency B cannot read agency A's run/result/action rows, and that the shared-catalogue `tender_requirements` row itself (correctly) remains cross-agency readable while the agency-relative *result* never leaks.
- **Tender isolation**: every qualification table carries `tender_id` and is scoped through it; evidence resolution reuses Phase 7's exact cross-tender rejection logic (`evidence/resolver.ts`, shared unmodified by the qualification agent).
- **Evidence validation**: `apps/api/src/lib/qualification/evidence.ts::isWellFormedEvidenceRef` rejects non-UUID-shaped (SQL-injection/path-traversal-shaped) evidence ids before any query runs, exactly like Phase 7's evidence resolver; a result claimed as PASS is application-invariant-checked to require at least one agency evidence reference.
- **Role enforcement**: viewing qualification data requires `ADMIN`/`BID_MANAGER`/`RESEARCHER` (`QUALIFICATION_VIEW_ROLES`); triggering an evaluation or recording a human review requires `ADMIN`/`BID_MANAGER` (`QUALIFICATION_ACTION_ROLES`) — the exact same role split as Phase 7's AI routes, re-checked server-side regardless of what the UI shows.
- **Prompt injection**: `QualificationInterpretationAgent`'s output schema has no PASS/FAIL/UNKNOWN/REQUIRES_ACTION field at all, so even a fully-compromised model response cannot make the agent emit a qualification decision; evidence is still independently server-resolved regardless of what the model claims (same mechanism as Phase 7).
- **No new secrets**: the qualification engine has no external network dependency of its own (deterministic, in-process); `QualificationInterpretationAgent` reuses the exact same `OPENAI_API_KEY` handling as Phase 7 (server-only env, never reachable from the browser bundle, never logged).
- **Malicious identifiers**: route param schemas (`z.object({ id: z.string().uuid() })`) reject malformed/malicious tender and requirement ids before any handler logic runs — covered by `apps/api/src/routes/__tests__/tenderQualification.test.ts`.

## 16. Phase 9 requirement/evaluation extraction security notes

Full detail in `docs/REQUIREMENT-EVALUATION-EXTRACTION.md`. Summary:

- **Tenant model**: extraction is tender-scoped, not agency-scoped (a requirement/criterion is a property
  of the tender's own document set) — the new tables are shared-catalogue (`select true for authenticated`),
  writable only by the service role, exactly like `tender_requirements`/`tender_evaluation_criteria`
  themselves; no agency ever sees another agency's data here because there is no agency dimension to leak.
- **Evidence validation**: every claimed evidence chunk is re-resolved server-side against the real
  document/chunk tables via the unmodified Phase 7 `evidence/resolver.ts` (`resolveEvidenceRefs`) —
  non-UUID-shaped ids are rejected before any query runs, a chunk belonging to a different tender is
  rejected, and the model's own quoted text is never trusted or persisted verbatim; the canonical stored
  chunk text is what gets saved.
- **Conflict trust boundary**: the agent may propose that two documents disagree, but the server only
  persists an actual `CONFLICT` row if it can independently verify resolvable evidence on *both* sides;
  otherwise the item is downgraded to `requiresReview` rather than asserted as a conflict on the model's
  word alone.
- **Role enforcement**: viewing requirements/evaluation data requires `ADMIN`/`BID_MANAGER`/`RESEARCHER`
  (`REQUIREMENT_EVALUATION_VIEW_ROLES`); triggering extraction or recording a human review requires
  `ADMIN`/`BID_MANAGER` (`REQUIREMENT_EVALUATION_ACTION_ROLES`) — the same role split as Phase 7/8's AI
  routes, checked server-side regardless of what the UI shows.
- **Prompt injection**: extraction fixtures include a document containing an embedded instruction; the
  agent's structured output schema has no field through which an instruction embedded in tender text could
  cause a database write outside the schema's shape, and evidence is still independently server-resolved
  regardless of what the model claims (same mechanism as Phase 7/8).
- **Idempotency/replay**: a dedicated partial unique index (`tender_ai_runs_one_active_per_tender_no_agency`)
  prevents two concurrently `QUEUED`/`RUNNING` extraction runs for the same tender at the database level,
  the same pattern Phase 7/8 use for their own per-agency index.
- **No new secrets**: `RequirementExtractionAgent` reuses the exact same `OPENAI_API_KEY` handling as
  Phase 7/8 (server-only env, never reachable from the browser bundle, never logged).
- **Malicious identifiers**: route param schemas reject malformed/malicious tender, requirement, and
  criterion ids before any handler logic runs — covered by
  `apps/api/src/routes/__tests__/tenderRequirementsEvaluation.test.ts`.

## Phase 10 (Opportunity Scoring Engine) additions

- **Agency isolation**: `tender_scoring_runs` and its four child tables (`tender_score_components`/
  `_drivers`/`_risks`/`_gates`) are agency-scoped exactly like `tender_qualification_runs` (Phase 8) —
  verified against real Postgres RLS in `database/src/__tests__/opportunityScoring.test.ts` (agency B
  cannot read agency A's run/components/drivers/risks/gates; a malicious/malformed run id is rejected as
  an invalid UUID rather than silently matched; no `authenticated` role can write these tables directly,
  service-role only). `scoring_configurations`/`scoring_configuration_versions` are the one intentional
  exception — shared-catalogue readable by any authenticated user (they describe policy, not any
  agency's data), same as `tender_requirements` itself.
- **No opaque scoring authority**: the scoring engine (`apps/api/src/lib/scoring/`) is pure TypeScript
  with zero network calls and zero OpenAI dependency — there is no AI trust boundary to defend here
  because AI is never in the numeric-score path at all.
- **Role enforcement**: viewing a score requires `ADMIN`/`BID_MANAGER`/`RESEARCHER`
  (`OPPORTUNITY_SCORE_VIEW_ROLES`); triggering a scoring run requires `ADMIN`/`BID_MANAGER`
  (`OPPORTUNITY_SCORE_ACTION_ROLES`) — same role split as Phase 7/8/9, checked server-side.
- **No fake precision / no bid language**: `OPPORTUNITY_DECISION_SIGNAL` has no `BID`/`NO_BID` value, and
  nothing in `apps/api/src/lib/scoring/` or `apps/web/src/components/tenders/OpportunityScoreTab.tsx`
  renders a win probability, chance-of-success percentage, or AI confidence percentage — enforced by
  `apps/web/src/components/tenders/badges.test.tsx` and `tests/e2e/opportunity-scoring.spec.ts`.
- **Malicious identifiers**: `apps/api/src/routes/__tests__/tenderScoring.test.ts` rejects malformed/
  malicious tender ids before any handler logic runs, and confirms the new
  `/api/tenders/:id/opportunity-score` routes do not collide with the pre-existing, unrelated legacy
  `/api/tenders/:id/score` route.

- **Phase 11 bid-decision/policy isolation**: `bid_policies`, `bid_policy_versions`, `bid_decision_runs`,
  and `bid_decision_rule_results` are all agency-scoped RLS tables, verified against real Postgres RLS in
  `database/src/__tests__/bidDecision.test.ts` (agency B cannot read agency A's policy/decision run/rule
  results; a malicious/malformed run id is rejected as an invalid UUID; no `authenticated` role can write
  these tables directly, service-role only; a cross-agency override attempt cannot even see the target row
  to override it).
- **Override integrity enforced at the database level**: `bid_decision_runs_override_requires_reason`
  (a `CHECK` constraint, not only app-level Zod validation) rejects both a `NULL` and an all-whitespace
  override reason, and `bid_decision_runs_final_decision_consistent` prevents `final_decision` from ever
  drifting from `human_decision`/`system_decision`. `POST /api/tenders/:id/bid-decision/override` is
  additionally role-gated to `ADMIN`/`BID_MANAGER` only — `RESEARCHER` can view a decision but never
  override one, checked server-side via `requireRole(BID_DECISION_OVERRIDE_ROLES)`.
- **No opaque bid authority**: the bid-decision engine (`apps/api/src/lib/bidDecision/`) is pure
  TypeScript with zero network calls and zero OpenAI dependency, exactly like the Phase 10 scoring engine
  — there is no AI trust boundary to defend here because AI is never in the decision path at all.
- **Malicious identifiers**: `apps/api/src/routes/__tests__/tenderBidDecision.test.ts` rejects malformed/
  malicious tender ids before any handler logic runs, and confirms the new `/api/tenders/:id/bid-decision`
  routes do not collide with the pre-existing legacy `/api/tenders/:id/score` or Phase 10
  `/api/tenders/:id/opportunity-score` routes.

## Phase 12 (Bid Strategy & Bid Project Intelligence) additions

- **Agency isolation**: every Phase 12 table's RLS policy scopes reads to `agency_id = current_agency_id()`, directly on `bid_strategy_projects` or via a join back to it for every child table (win themes, evaluation strategy, requirement plans, evidence needs, tasks, milestones, questions, risks, assumptions, readiness snapshots) — the exact join-based pattern Phase 10/11 established.
- **Resource ownership**: every `routes/bidStrategy.ts` handler that takes a `:id` path param loads the Bid Project first and 404s if it does not belong to the caller's own agency (`loadOwnedProject`) — the project id from the URL is never trusted to already be agency-scoped by RLS alone at the application layer, matching Phase 10/11's own ownership-guard discipline.
- **Role gating**: `BID_STRATEGY_VIEW_ROLES` (ADMIN/BID_MANAGER/RESEARCHER) gates every GET; `BID_STRATEGY_MANAGE_ROLES` (ADMIN/BID_MANAGER) gates project creation, status transitions, strategy generation, and task creation; `BID_STRATEGY_APPROVE_ROLES` (ADMIN/BID_MANAGER) gates strategy approval; question creation additionally allows RESEARCHER (spec §24: "contribute research/evidence notes"). These reuse the exact existing RBAC roles from Phase 4/7/8/10/11 — no new roles were introduced.
- **The NO_BID→409 create-gate** (`lib/bidStrategy/projectGate.ts`) is a pure function, unit-tested independently of any route, and is the only path by which a Bid Project can be created — it is invoked server-side after fetching the current `bid_decision_runs.final_decision` from the privileged client, never trusting a client-supplied "decision" value.
- **Server-side-only mutation**: strategy generation and approval never accept a client-supplied strategy payload — the route only ever calls `buildBidStrategy(input)` (a pure function fed exclusively by server-read data) or flips an approval flag; there is no endpoint that writes arbitrary strategy content from the request body.
- **The strategy-approval blocker override** requires `request.user.role === 'ADMIN'` AND an explicit `overrideBlockers: true` AND a non-empty `overrideReason` — checked server-side, never a query param or a role-agnostic flag.
- **Malformed/cross-agency IDs**: `paramsSchema` (`z.string().uuid()`) rejects a malformed bid project or tender id before any query runs; a well-formed but cross-agency id 404s via `loadOwnedProject` rather than leaking existence.

## Phase 13 (Evidence Matching & Portfolio Intelligence) additions

- **Agency isolation for the first vector-search surface in the system**: `agency_evidence_embeddings`,
  `bid_evidence_matches`, and `bid_evidence_claims` all carry RLS policies scoped to `agency_id =
  current_agency_id()`. The vector similarity query itself is never expressed ad hoc at a call site — it
  is centralized in one Postgres function, `match_agency_evidence_embeddings(p_agency_id, ...)`, whose
  body always filters `WHERE agency_id = p_agency_id` before the `ORDER BY embedding <=> ...`, so a future
  caller cannot accidentally omit the tenant filter the way it could if every store method wrote its own
  ad hoc vector query. Proven directly: `database/src/__tests__/evidenceMatching.test.ts` seeds two
  agencies' embeddings and asserts each agency's query only ever returns its own rows.
- **AI/semantic decision-authority boundary, enforced in code, not just documentation**: `verifyEvidenceCandidate()`'s
  return type (`VerificationResult.resultingStatus: 'CANDIDATE' | 'REQUIRES_VERIFICATION' | 'VERIFIED'`)
  makes it a compile-time impossibility for the pure verification function to produce `APPROVED` or
  `REJECTED` — there is no code path, adversarial input, or future maintenance edit to that function alone
  that could cause it to auto-approve anything. The only two places that ever write `APPROVED`/`REJECTED`
  are `approveMatch`/`rejectMatch` in `supabaseEvidenceMatchingStore.ts`, reached only after
  `routes/evidenceMatching.ts` has checked `EVIDENCE_MATCH_DECIDE_ROLES` (ADMIN/BID_MANAGER only).
- **Decided-match immutability enforced at the DB level**: `prevent_decided_evidence_match_mutation`
  (mirroring Phase 12's `prevent_approved_bid_strategy_mutation`) rejects any UPDATE to an
  APPROVED/REJECTED row's scored/verification/decision fields — even a compromised or buggy service-role
  caller cannot silently rewrite a human decision after the fact; the only allowed transition is the exact
  bookkeeping a re-evaluation's superseding step performs.
- **Rejection always carries a reason**: `bid_evidence_matches_rejection_requires_reason` is a DB `CHECK`
  constraint, not only a Zod schema validation at the route layer — a direct service-role write that
  skipped the API entirely would still be rejected.
- **Cross-tenant evidence references are rejected at the validation layer, never fabricated**: every
  candidate the store persists is re-loaded from the underlying agency evidence table scoped to the
  requesting agency (`loadEntityRow(..., agencyId)`); a row that no longer resolves for that agency (moved,
  deleted, or belonging to a different tenant) is silently skipped rather than persisted — never a
  reference to evidence the current agency cannot actually see.
- **Role gating**: `EVIDENCE_MATCH_VIEW_ROLES` (ADMIN/BID_MANAGER/RESEARCHER) gates every GET;
  `EVIDENCE_MATCH_GENERATE_ROLES` (same three — RESEARCHER may trigger candidate generation but never
  decide) gates `POST .../evidence-matches`; `EVIDENCE_MATCH_DECIDE_ROLES` (ADMIN/BID_MANAGER only) gates
  approve/reject. These reuse the exact existing RBAC roles — no new roles were introduced.
- **Malformed/cross-agency IDs**: `paramsSchema`/`matchParamsSchema` (`z.string().uuid()`) reject
  malformed ids before any query runs; a well-formed but cross-agency bid project id 404s via
  `loadOwnedProject` rather than leaking existence, matching every prior phase's ownership-guard discipline.
- **Audit logging**: `EVIDENCE_MATCH_CANDIDATES_GENERATED`, `EVIDENCE_MATCH_APPROVED`, and
  `EVIDENCE_MATCH_REJECTED` events are written to the existing `audit_logs` table (service-role only,
  append-only, no authenticated write policy) — the same generic audit mechanism Phase 11's
  `BID_DECISION_CREATED`/`OVERRIDDEN` events use, never a second audit system.

## Phase 14 — Proposal generation security

Full detail in `docs/PROPOSAL-GENERATION.md`. Same conventions as every prior phase:

- **RLS**: every `bid_proposal_*` table is `select`-only for `authenticated`, scoped to the caller's
  `agency_id` (directly or via a join back to `bid_proposal_sections`/`bid_proposal_versions`). No
  authenticated INSERT/UPDATE/DELETE policy exists anywhere — all writes go through
  `lib/proposals/supabaseProposalStore.ts` using the privileged service-role client, reached only after
  `routes/proposals.ts` has already checked role + agency ownership.
- **Cross-agency references are rejected at the DB level, not only in application code**: dedicated
  triggers (`check_proposal_section_agency_matches`, `check_proposal_evidence_link_agency_matches`,
  `check_proposal_claim_evidence_agency_matches`, `check_proposal_requirement_link_tender_matches`,
  `check_proposal_evaluation_link_tender_matches`) reject a section/claim/link that does not belong to the
  same agency or tender as its parent — verified directly in
  `database/src/__tests__/proposalGeneration.test.ts`.
- **Role gating**: `PROPOSAL_VIEW_ROLES`/`PROPOSAL_EDIT_ROLES` (ADMIN/BID_MANAGER/RESEARCHER) gate
  read/draft/generate/edit actions; `PROPOSAL_REVIEW_ROLES` (ADMIN/BID_MANAGER only) gates
  review/approve/reject — a RESEARCHER can draft and generate a section but can never approve its own
  output, mirroring Phase 13's evidence-match view/generate/decide split.
- **Malformed/cross-agency IDs**: every route param is `z.string().uuid()`-validated before any query
  runs; a well-formed but cross-agency bid project or section id 404s via `loadOwnedProject`/
  `loadOwnedSection` rather than leaking existence.
- **Secrets never reach the browser**: `OPENAI_API_KEY`/`SUPABASE_SERVICE_ROLE_KEY` are read only inside
  `apps/api` route handlers/stores; the generation call happens entirely server-side
  (`lib/ai/execution/runProposalGeneration.ts`), and the web app only ever calls
  `/api/bids/:id/proposal/...` endpoints.
- **Prompt injection defence**: the system prompt in `lib/ai/agents/proposalSection/prompt.ts` establishes
  an explicit trusted/untrusted boundary and instructs the model to never obey instructions embedded in
  tender/agency text — verified by a dedicated test asserting the system prompt content and that untrusted
  excerpts are always wrapped `[UNTRUSTED ...]` in the user message.
- **Audit logging**: `PROPOSAL_CREATED`, `PROPOSAL_VERSION_CREATED`, `PROPOSAL_SECTION_CREATED`,
  `PROPOSAL_GENERATION_STARTED/COMPLETED/FAILED`, `PROPOSAL_SECTION_EDITED`, `PROPOSAL_CLAIM_CREATED`,
  `PROPOSAL_CLAIM_MARKED_UNSUPPORTED`, `PROPOSAL_SECTION_REVIEWED/APPROVED/REJECTED`,
  `PROPOSAL_COMPLIANCE_RUN`, `PROPOSAL_MARKED_STALE`, `PROPOSAL_DOCUMENT_ASSEMBLED` are written to the
  existing `audit_logs` table — the same generic, append-only, service-role-only audit mechanism every
  prior phase uses.

## Phase 15 — Submission readiness, pricing, submission pack security

Full detail in `docs/SUBMISSION-READINESS.md`.

- **Every route** (`apps/api/src/routes/submissionReadiness.ts`) enforces `requireAuth` → `requireRole`
  (`SUBMISSION_VIEW_ROLES`/`SUBMISSION_MANAGE_ROLES`/`SUBMISSION_PRICING_ROLES`/`SUBMISSION_APPROVE_ROLES`)
  → `loadOwnedProject` (resolves `agency_id` server-side from `bid_strategy_projects`, never trusting a
  browser-supplied `agency_id`/`bid_project_id`/`tender_id` — a well-formed but cross-agency project id
  404s rather than leaking existence) → Zod validation (`@tender-os/schemas`) → the privileged service-role
  Supabase client only after every prior check passes.
- **RLS**: every new table's `select` policy is `agency_id = current_agency_id()` (directly or via a join
  to `bid_submission_readiness`); no authenticated INSERT/UPDATE/DELETE policy exists anywhere — all writes
  go through `lib/submissionReadiness/supabaseSubmissionReadinessStore.ts`, which additionally re-checks
  `agency_id` on every pricing/pack/approval mutation before writing (defence in depth beyond RLS alone,
  verified directly in `apps/api/src/lib/submissionReadiness/__tests__/security.test.ts`).
- **Pricing is commercially sensitive**: `SUBMISSION_PRICING_ROLES` (ADMIN/BID_MANAGER only) gates every
  pricing route; pricing is never sent to an AI prompt, never logged in an audit payload's readable text
  beyond an opaque id reference, and never exposed via any unauthenticated or cross-role route.
- **Role gating**: `SUBMISSION_VIEW_ROLES` (ADMIN/BID_MANAGER/RESEARCHER/VIEWER) read; `SUBMISSION_MANAGE_ROLES`
  (ADMIN/BID_MANAGER) run checks and build packs; `SUBMISSION_APPROVE_ROLES` (ADMIN/BID_MANAGER) is the
  *only* set of roles that may ever call `POST .../submission-approval` — enforced both by `requireRole` at
  the route and again by the pure `canApproveForSubmission()` gate, so a role check bypassed at one layer
  is still caught at the other.
- **No automatic submission anywhere**: no route in `routes/submissionReadiness.ts` calls out to any
  external portal/email/upload API; `POST .../submission-approval` only ever writes an internal
  `bid_submission_approvals` row and returns the literal text "READY FOR HUMAN SUBMISSION" — there is no
  code path in this system that performs an actual tender submission.
- **Malformed/malicious IDs**: every route param is `z.string().uuid()`-validated before any query runs; a
  SQL-injection-shaped id is rejected by the same Zod schema and never reaches a query (also verified at
  the pure-engine level — a malicious source id is treated as opaque string data, never interpolated or
  executed).
- **Secrets never reach the browser**: `SUPABASE_SERVICE_ROLE_KEY` is read only inside
  `apps/api`'s `supabaseAdmin.ts`; the pure engine/pricing/pack/approval modules take plain data only and
  import no Supabase client at all (verified structurally in `security.test.ts`).
- **Audit logging**: `FINAL_COMPLIANCE_RUN`, `SUBMISSION_READINESS_CALCULATED`, `SUBMISSION_PACK_CREATED`,
  `SUBMISSION_PACK_VERSION_CREATED`, `SUBMISSION_MANIFEST_CREATED`, `SUBMISSION_APPROVED_FOR_SUBMISSION`,
  `SUBMISSION_APPROVAL_REVOKED` are written to the existing `audit_logs` table. No `SUBMISSION_COMPLETED`
  event exists anywhere in this system (binding constraint).

## Phase 16 — Submission Execution security

- **No blind submission**: the only path to an actual attempt is Prepare → (server re-validates readiness/
  approval/pack/deadline) → durable human Confirmation → Attempt. `lib/submissions/runSubmission.ts`'s
  `attemptSubmission` re-runs the full preflight gate and re-checks confirmation validity against the
  *current* pack/readiness on every single call — never a cached or assumed-still-valid confirmation.
- **No CAPTCHA/MFA/anti-bot bypass**: every adapter (`adapters/portal.ts`, the mock CAPTCHA/MFA fixtures)
  treats a CAPTCHA/MFA/authentication-required provider response as `REQUIRES_MANUAL_ACTION`, never as an
  obstacle to route around. Unit-tested explicitly (`adapters.test.ts`: "never bypasses a CAPTCHA/MFA").
- **No fabricated receipt or reference**: `lib/submissions/receipts.ts` never marks a bare user-typed
  reference `VERIFIED` — only a provider-issued or independently-corroborated receipt qualifies, and only a
  `VERIFIED` receipt can ever move an execution to `SUBMITTED`.
- **Role gating**: `SUBMISSION_EXECUTION_VIEW_ROLES` (ADMIN/BID_MANAGER/RESEARCHER/VIEWER) read;
  `SUBMISSION_EXECUTION_MANAGE_ROLES`/`SUBMISSION_EXECUTION_CONFIRM_ROLES` (ADMIN/BID_MANAGER only) may
  prepare, confirm, attempt, capture receipts, manually complete, or cancel — enforced by `requireRole` on
  every route in `routes/submissionExecution.ts`. Viewing is always less privileged than submitting.
- **Submission target security** (`lib/submissions/targetSecurity.ts`): portal/API targets must be HTTPS and
  allow-listed (reusing `lib/security/urlSafety.ts`'s SSRF-safe validation, including private/reserved-IP
  and DNS-rebinding rejection); a target that deviates from the tender's own verified recipient is rejected
  unless a human explicitly confirms the deviation.
- **Email attachment integrity**: `lib/submissions/attachmentIntegrity.ts` verifies every outgoing
  attachment's filename/size/SHA-256/MIME type against the approved manifest before any send is attempted;
  any mismatch is a hard `ATTACHMENT_INVALID` block, never a silent substitution.
- **Concurrency/idempotency**: a partial unique index permits only one in-flight (`STARTED`) attempt per
  submission execution; an optimistic-concurrency `version` column rejects a stale concurrent write; a
  SHA-256 local idempotency key (documented as local-only, never a guarantee of provider-side idempotency)
  is globally unique at the database level.
- **No automatic retry on an unknown outcome**: `lib/submissions/retry.ts` never treats a timeout/network
  error as automatically safe to retry — the provider may have received the submission despite the local
  failure to observe a response; retry requires either deterministic non-receipt proof or an explicit human
  confirmation.
- **Immutability/append-only**: confirmations, terminal attempts, and captured receipts are all frozen at
  the database trigger level (`prevent_submission_confirmation_mutation`, `prevent_submission_attempt_mutation`,
  `prevent_submission_receipt_mutation`) — a later change always adds a new row, never rewrites history.
- **Audit logging**: `SUBMISSION_PREPARED`, `SUBMISSION_CONFIRMATION_REQUESTED`, `SUBMISSION_CONFIRMED`,
  `SUBMISSION_ATTEMPT_STARTED`, `SUBMISSION_ATTEMPT_COMPLETED`, `SUBMISSION_ATTEMPT_FAILED`,
  `SUBMISSION_RECEIPT_CAPTURED`, `SUBMISSION_RECEIPT_VERIFIED`, `SUBMISSION_MARKED_MANUAL`,
  `SUBMISSION_REPORTED`, `SUBMISSION_APPROVAL_INVALIDATED`, `SUBMISSION_CANCELLED` are all actually emitted
  (not merely declared) by `lib/submissions/runSubmission.ts`. No password/API key/session token/MFA code is
  ever logged.

## Phase 17 addendum — Outcome/award security

`tender_outcomes`/`outcome_conflicts` are shared catalogue tables (public
procurement facts, select-only RLS for any authenticated user, service-role
writes only) — the same convention as `awards`/`competitors` since Phase 2.
`bid_outcomes`/`loss_reasons`/`outcome_decision_time_features`/
`outcome_result_features` are agency-scoped (`agency_id = current_agency_id()`
select-only). An agency's internal fields (our score, internal notes,
internal loss-reason provenance) are never exposed on the shared
`/api/outcomes*` endpoints — only on the agency-scoped `/api/bids/:id/outcome`
family. New audit actions: `OUTCOME_CREATED`, `OUTCOME_UPDATED`,
`OUTCOME_VERIFIED`, `OUTCOME_CONFLICT_CREATED`, `OUTCOME_CONFLICT_RESOLVED`,
`WIN_RECORDED`, `LOSS_RECORDED`, `LOSS_REASON_ADDED`. See
`docs/OUTCOME-INTELLIGENCE.md` §10.

## Phase 18 addendum — Predictive intelligence security

All 12 new tables are agency-scoped (`agency_id = current_agency_id()`
select-only RLS), service-role writes only, via
`lib/intelligence/supabaseIntelligenceStore.ts` — the same convention as
every agency-owned table since Phase 2. **No autonomous decision-making**:
nothing in this phase can automatically change scoring weights, bid/no-bid
thresholds, qualification rules, pricing, or submit/withdraw a tender —
model output is exposed only as an advisory prediction with mandatory
abstention (`lib/intelligence/abstention.ts`) and a decision-support
disclaimer. **No AI/LLM call for any numerical decision** — all statistics
and model fitting are pure deterministic TypeScript (consistent with this
sandbox's `api.openai.com` egress restriction and the codebase's binding
constraint since earlier phases). **Governed promotion**: a version can only
reach `PRODUCTION` status through `lib/intelligence/governance.ts`'s
`evaluatePromotion`, which requires an explicit `ADMIN`-role human approval,
a completed model card, `PRODUCTION_ELIGIBLE` dataset readiness, and
measurable AUC/calibration improvement over the baselines — never an
automatic promotion. **Associative, not causal, language**: every generated
explanation passes through `assertNoCausalLanguage`
(`lib/outcomes/provenance.ts`, reused from Phase 17) before being returned,
guaranteeing no prediction or explanation ever claims a feature *caused* an
outcome. **Test-fixture isolation**: every row used to exercise
`READY_FOR_TRAINING`+ code paths is flagged `is_test_fixture = true` and
never counted by the real readiness gate against production data (see
`docs/PREDICTIVE-INTELLIGENCE.md` §22). New audit actions: `DATASET_CREATED`,
`MODEL_CREATED`, `MODEL_VERSION_CREATED`, `MODEL_TRAINED`,
`MODEL_EVALUATED`, `MODEL_CALIBRATED`, `MODEL_CANDIDATE_PROPOSED`,
`MODEL_APPROVED`, `MODEL_REJECTED`, `MODEL_RETIRED`, `PREDICTION_MADE`,
`PREDICTION_ABSTAINED`.

## Phase 19 — Production Operations security review

- **RLS re-verified, not weakened**: the two new tables
  (`bid_addendum_acknowledgements`, `data_quality_violations`) follow
  the established agency-owned/shared-catalogue patterns exactly (see
  `docs/DATABASE.md` Phase 19 entry); no existing RLS policy was
  altered.
- **Server-side scope filtering, never client-trusted**: `GET
  /api/data-quality/violations` and the resolve endpoint filter to
  `agency_id is null or agency_id = caller's own agency` in the route
  layer itself, even though the underlying store runs on the
  privileged service-role client — the same discipline
  `routes/submissionReadiness.ts::loadOwnedProject` already
  established. `routes/addenda.ts` verifies the addendum's `tender_id`
  matches the caller's owned bid project's `tender_id` before
  recording an acknowledgement against it, never trusting a
  frontend-supplied addendum id blindly.
- **No secrets in the operational-health payload**: `GET
  /api/ops/health` was audited and unit-tested
  (`apps/api/src/lib/ops/__tests__/health.test.ts`) to contain no
  key/secret/token/password-shaped field.
- **Immutability re-verified**: both new tables reject direct mutation
  of their core facts even by a service-role client, enforced by
  Postgres triggers, not merely application discipline (see
  `docs/DATABASE.md` Phase 19 entry) — consistent with every
  historical-integrity trigger since Phase 12.
- **No new attack surface from background processing**: no queue/
  worker process was introduced this phase (re-verified: no
  BullMQ/Redis dependency exists in `apps/api/package.json`), so no new
  job-queue security surface exists either.
- **Historical/decision-time data-leakage boundary re-verified**: five
  new regression tests
  (`apps/api/src/lib/outcomes/__tests__/historicalIntegrity.test.ts`)
  specifically assert that `buildDecisionTimeFeatures` can never
  produce an object carrying any `OUTCOME_ONLY_FIELDS` key, and that a
  raw input already carrying `awardValue`/`winner`/`winningScore`/
  `lossReasonPrimary` is rejected outright (`assertNoOutcomeLeakage`,
  unchanged from Phase 17) rather than silently stripped.

## Phase 19 gap-closing — concrete security audit (spec §22)

The first Phase 19 pass asserted "RLS re-verified" without evidence.
This section replaces that assertion with a concrete, per-area audit —
each finding names the file(s) that were read/tested, not just a
conclusion.

- **Notifications** (the new area this round adds): the Phase 2
  `notifications` table's original RLS was agency-scoped only —
  meaning any authenticated member of an agency could read or write
  another member's notification rows directly via the Supabase REST
  API (bypassing this codebase's own API layer entirely). Found by
  reading `20260910200180_rls_policies.sql`'s agency-owned-tables
  loop; **fixed**, not merely documented, in
  `database/migrations/20260913100000_notifications_v2.sql`, which
  drops and replaces the four generic policies with ones that also
  require `user_id is null or user_id = auth.uid()`. Proven by
  `database/src/__tests__/notifications.test.ts`'s "RLS: user A1 sees
  agency-wide notifications and their own, but not user A2's targeted
  one" and the read/write variants of the same test. The API layer
  (`routes/notifications.ts`) additionally never trusts a
  client-supplied `agencyId`/`userId` — both come from
  `request.user`, server-verified by `requireAuth`.
- **Signed URLs**: `apps/api/src/lib/documents/storage.ts`'s
  `createSignedUrl(path, expiresInSeconds)` always requires an
  explicit, caller-supplied expiry — there is no code path anywhere in
  this codebase that requests or falls back to a permanent/public
  Supabase Storage URL (verified by reading the full file; the
  interface has no such method). **Finding**: this method is currently
  unused by any route — no endpoint yet returns a document's storage
  path or a signed URL to the frontend (`storage_path` is read only
  internally, for reprocessing, in `routes/tenderDocuments.ts`). This
  means there is no live document-download feature today, and
  therefore no signed-URL exposure surface to audit in practice yet —
  documented honestly as a gap in the Document Pipeline's UI-facing
  surface (Phase 6), not fabricated as "verified safe" for a feature
  that doesn't exist.
- **SSRF protection**: re-verified, not merely re-asserted, by reading
  `apps/api/src/lib/security/urlSafety.ts` (`isPrivateOrReservedIp`,
  `assertUrlStructurallySafe`, `resolveAndValidateHost`,
  `assertUrlSafeToFetch` — DNS-resolves before fetching and rejects
  private/reserved/loopback/link-local ranges) and its test file
  `apps/api/src/lib/security/__tests__/urlSafety.test.ts`. Every
  outbound document/document-adapter fetch goes through this
  (`lib/documents/download.ts`, `lib/documents/allowedHosts.ts`,
  `lib/adapters/etenders/allowlist.ts`, `lib/submissions/targetSecurity.ts`
  for submission-portal targets) — no new document/URL-handling code
  this phase bypasses it.
- **Malicious documents**: `apps/api/src/lib/documents/zipGuard.ts`
  (zip-bomb/decompression-ratio guard for DOCX/XLSX, both zip
  containers) and its test `zipGuard.test.ts`; a malformed PDF is
  caught by the extractor throwing and the pipeline marking the
  version `INVALID` rather than fabricating a successful empty
  extraction (`pipeline.integration.test.ts`: "marks a malformed PDF
  as INVALID rather than a fake successful extraction"). No document
  content is ever executed, evaluated, or templated — extraction is
  read-only parsing throughout.
- **Prompt injection**: AI agent prompts
  (`lib/ai/agents/proposalSection/prompt.ts`,
  `lib/ai/agents/extraction/prompt.ts`) embed extracted document/tender
  text as clearly-delimited data, never as instructions the model is
  told to follow, and — the actual enforcement boundary — every AI
  claim is written through `lib/ai/claims` as an `UNVERIFIED`/`INFERRED`
  claim requiring human confirmation before it affects any
  score/decision/requirement (Phase 7 boundary, re-verified unchanged
  this phase: no Phase 19 code path writes directly to a scoring,
  qualification, or requirement table from an AI response). This means
  a successful prompt injection could at worst produce a wrong
  *unverified suggestion*, never an auto-applied change — the
  structural mitigation, not prompt-level filtering alone.
- **Uploaded content**: this system has no end-user file upload route
  today (documents arrive only via source-adapter discovery/download,
  or `bytesOverride` in tests) — verified by grep for a multipart/
  upload route across `apps/api/src/routes`. No finding to report
  because no such surface exists yet; noted so a future upload feature
  is added with this audit's context, not assumed already covered.
- **Outcome evidence**: `POST /api/outcomes/:id/verify` is
  structurally blocked from verifying an outcome with no attached
  evidence (`if (!before.sourceUrl && !before.sourceDocumentId &&
  !before.sourceEvidenceRef)` → 422), re-verified by reading
  `routes/outcomes.ts` and confirmed still present after this round's
  edits to that same file (the new notification-fan-out code was
  added around, not inside, this gate).
- **Competitor data**: `competitors`/`competitor_activity` are
  shared-catalogue tables (select-authenticated, write service-role
  only — `20260910200180_rls_policies.sql`); no Phase 19 code path
  writes to them, so no new exposure was introduced. `awards_outcomes_
  intelligence`'s competitor extension columns default `data_quality`
  to `UNKNOWN` rather than assuming completeness (re-verified, DB test
  `database/src/__tests__/outcomes.test.ts`: "competitor extension
  columns exist and default data_quality to UNKNOWN").
- **Cross-agency isolation tests for newer domains** — checked which
  domains already had an explicit test before writing new ones:
  predictions (`database/src/__tests__/intelligence.test.ts`: "agency
  A can read its own model registry/version; agency B cannot"),
  pricing (`database/src/__tests__/submissionReadiness.test.ts`:
  agency B cannot read agency A's `bid_pricing`/readiness/pack), and
  outcomes (`database/src/__tests__/outcomes.test.ts`: "agency B
  cannot read agency A bid outcome"). **Audit_logs had no such test** —
  added `database/src/__tests__/notifications.test.ts`'s "security-audit
  finding (spec §22): audit_logs RLS" test, proving an ADMIN of agency
  A cannot see agency B's audit entries and a non-ADMIN of agency A
  cannot see agency A's own entries either (ADMIN-only visibility, per
  `audit_logs_select_admin_own_agency`).

## Phase 20 addendum — audit trail & benchmark access

`audit_trail_events` is ADMIN-only (own agency plus agency-null/system-wide rows), matching `audit_logs`'s
existing visibility rule exactly — a full cross-entity chain-of-custody view is at least as sensitive as
the single-entity audit log. It is append-only AND delete-proof (both enforced by a DB trigger, not just
convention) and has no insert/update/delete policy for `authenticated` at all — written exclusively by the
service-role client.

`industry_benchmarks_daily` is the one new table this phase gives broader-than-usual read access:
authenticated-any-agency, no scoping — by design, since every row is a fully anonymized, k-anonymized
(>= 5 distinct entities) group statistic with no agency identity or per-bid value on it at all. The
k-anonymity floor is enforced twice: once in the pure aggregator before a row is ever built, and again by a
DB CHECK constraint that rejects a below-floor row carrying real statistics — an application-layer bug alone
cannot leak a below-floor group's real numbers.
