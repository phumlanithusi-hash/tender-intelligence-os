# Phase 13 — Evidence Matching & Portfolio Intelligence

## 0. Scope and read-first

Reviewed before writing any code, per the binding spec: `apps/api/src/lib/bidStrategy/**` (esp.
`supabaseBidStrategyStore.ts`, `buildStrategy.ts`, `staleness.ts`), `apps/api/src/lib/bidDecision/**`
(esp. `evaluateBidDecision.ts`, `precedence.ts`), `apps/api/src/lib/ai/**` (esp. `client.ts`, `config.ts`,
`testing.ts`, `evidence/resolver.ts`, `evidence/validator.ts`, `execution/runAgent.ts`),
`apps/api/src/lib/scoring/staleness.ts`, `apps/api/src/lib/qualification/evidence.ts`, the Phase 6
document/evidence tables, the Phase 2/8 agency evidence tables, every prior migration (in order), and
`apps/api/src/routes/` for path collisions. See `docs/DECISIONS.md` for the collision check outcome
(nothing collided — the spec's literal §G paths are used verbatim, unlike Phase 10/11's route deviations).

## 1. Objective

Match an agency's own evidence library — `agency_documents`, `agency_certificates`,
`agency_case_studies`, `agency_references`, `agency_financial_records` — against a bid project's evidence
needs (Phase 12's `bid_evidence_needs`), surfacing ranked candidate matches for human review, and feeding
unresolved gaps back into Phase 12's evidence-needs list. AI/semantic similarity retrieves and ranks
candidates and assists structural interpretation; it never decides, verifies, or approves a match. Only a
human with the right role can move a match to APPROVED or REJECTED.

## 2. Architecture — the pure/I-O split

Following the exact pattern established in `lib/bidStrategy/`, `lib/bidDecision/`, `lib/scoring/`,
`lib/qualification/`, and `lib/ai/`:

```
apps/api/src/lib/evidenceMatching/
  types.ts                       — pure-function contracts, no I/O
  contentHash.ts                 — pure sha256 hashing (in-process, no I/O)
  rankEvidenceCandidates.ts      — PURE retrieval-result ranking (Phase 13 §B)
  verifyEvidenceCandidate.ts     — PURE deterministic verification (Phase 13 §C)
  gaps.ts                        — PURE evidence-gap computation (Phase 13 §E)
  staleness.ts                   — re-exports isSnapshotStale (Phase 13 §F)
  embedAgencyEvidence.ts         — the idempotent I/O SEAM (Phase 13 §A/§8) — not pure, injectable deps
  store.ts                       — EvidenceMatchingStore port interface
  supabaseEvidenceMatchingStore.ts — real Supabase-backed implementation
  __tests__/                     — unit tests for every pure function + the embedding job with a fake client
```

`apps/api/src/lib/ai/embeddingClient.ts` is a new, additive file (client.ts itself, Phase 7's chat
transport, is untouched) providing the OpenAI embeddings-endpoint counterpart to `client.ts`'s chat
completion transport, plus a `createFakeEmbeddingClient`-shaped inline fake used by tests
(`{ embed: async () => [...] }`), mirroring `ai/testing.ts`'s discipline for the chat client.

Retrieval (the pgvector similarity query) is the store's job (`match_agency_evidence_embeddings`, a
Postgres function called via `supabase.rpc(...)`) — `rankEvidenceCandidates()` only ever receives
pre-fetched candidates plus metadata and is completely free of I/O, exactly as the spec requires
("keep retrieval (I/O) and ranking (pure) cleanly separated").

## 3. Embedding lifecycle (§A)

`agency_evidence_embeddings` (agency-scoped) and `tender_evidence_chunk_embeddings` (tender-scoped —
see §9 below for why chunks get a separate table) both carry a `status` enum:
`NOT_EMBEDDED → QUEUED → PROCESSING → READY | STALE | FAILED`. A `content_hash` (sha256 of the canonical
text that was embedded) is compared on every re-embed attempt; a change flags STALE, never a silent reuse
of an outdated vector. A DB `CHECK` constraint (`..._vector_matches_status`) makes it structurally
impossible for a READY/STALE row to have a null `embedding`, or for any other status to have a non-null one.

`embedAgencyEvidence(ref, deps)` is the idempotent job function (Phase 13 §8): calling it twice for an
unchanged entity is a no-op; a concurrently-PROCESSING record is treated as in-flight (never
double-submitted to the provider); a provider failure always transitions the record to FAILED with the
real error message, never a fabricated vector. **This is the exact seam a future BullMQ worker would
call** (`worker.process(job => embedAgencyEvidence(job.data.ref, deps))`) — no BullMQ is wired into this
codebase (binding constraint), so today it is invoked fire-and-forget from
`supabaseEvidenceMatchingStore.ts`'s `backfillEmbeddingsForAgency()` and from the candidate-generation
route handler, both explicitly documented in code comments as this seam.

## 4. Retrieval & ranking (§B)

`rankEvidenceCandidates(evidenceNeed, candidates, config)` combines four documented, weighted factors
(`shared/constants/src/evidenceMatching.ts`'s `EVIDENCE_RANKING_WEIGHTS`):

| Factor | Weight | What it measures |
|---|---|---|
| Semantic similarity | 0.45 | cosine similarity from the vector query, already computed by the store |
| Evidence type match | 0.20 | 1 if the candidate's type is in the need's allowed types (or the need allows any type), else 0 |
| Recency | 0.15 | exponential decay, half-life 365 days (`EVIDENCE_RECENCY_HALF_LIFE_DAYS`), from the embedding's `embedded_at` |
| Prior approval history | 0.20 | `approvals / (approvals + rejections)`, or 0.5 (neutral) with no history at all — never penalised as if rejected |

Candidates below `EVIDENCE_MIN_SIMILARITY_THRESHOLD` (0.15) are filtered out before ranking. Ties are
broken deterministically: score desc → similarity desc → entityId asc, so the same inputs always produce
the same ordering (verified by a repeat-run test). Every ranked candidate carries a human-readable
`rationale` string referencing its real inputs — never an opaque score alone.

## 5. Deterministic verification (§C)

`verifyEvidenceCandidate(candidate, evidenceNeed, rules)` is a second, independent, PURE function that
never reads the semantic score at all. It applies five structural checks:

- `AGENCY_MATCH` — the candidate's agency id equals the evidence need's required agency id (defence in
  depth beyond the store's own agency-scoped query and RLS).
- `TYPE_ELIGIBLE` — the candidate's entity type is one the need allows.
- `SOURCE_ACTIVE` — for `AGENCY_DOCUMENT`/`AGENCY_CERTIFICATE`, the underlying row's `lifecycle_status`
  (Phase 8) is `VALID`/`PENDING_VERIFICATION`, not `EXPIRED`/`MISSING`/`REJECTED`. The other three
  evidence types have no equivalent lifecycle concept in this schema and are always treated as active — a
  documented limitation (§10 below), not a fabricated signal.
- `NOT_EXPIRED` — compares `expiryDate` (when the evidence type has one) against `now`.
- `EMBEDDING_AVAILABLE` — the candidate's embedding status is READY or STALE (a candidate could not have
  been retrieved with anything else, but this is checked explicitly rather than assumed).

If any hard check fails, `resultingStatus` stays `CANDIDATE` regardless of semantic score. If every hard
check passes but the underlying `evidence_status` (Phase 2/8, `VERIFIED`/`INFERRED`/`UNVERIFIED`/`UNKNOWN`)
is `UNVERIFIED` or `UNKNOWN`, `resultingStatus` caps at `REQUIRES_VERIFICATION` — an `UNKNOWN` truth state
is never silently promoted to a positive determination. Only when the structural checks pass AND the
underlying evidence is already `VERIFIED`/`INFERRED` does this function return `VERIFIED` — its ceiling.
**This function can never return `APPROVED` or `REJECTED`** (asserted directly in
`verifyEvidenceCandidate.test.ts` across every input combination) — those are exclusively human-actioned,
applied only by `approveMatch`/`rejectMatch` in the store after a route handler has already checked
`EVIDENCE_MATCH_DECIDE_ROLES`.

## 6. Human approval / rejection workflow (§D)

`bid_evidence_matches` — one row per (evidence need × candidate) pairing, append-only on status change.
Status vocabulary: `CANDIDATE → REQUIRES_VERIFICATION → VERIFIED → APPROVED | REJECTED`, plus
`SUPERSEDED` for a decided-or-stale row displaced by a fresh evaluation. Re-running candidate generation
for the same need never mutates a prior CURRENT row in place — it flips it to `SUPERSEDED`/`is_current =
false` and inserts a new one, with `supersedes_match_id` pointing back.

Rejection requires a mandatory `rejection_reason` — enforced by a DB `CHECK` constraint
(`bid_evidence_matches_rejection_requires_reason`), mirroring Phase 12's `bid_questions`
answer/answer_source pattern. Once a match reaches `APPROVED`/`REJECTED`, a Postgres trigger
(`prevent_decided_evidence_match_mutation`, mirroring Phase 12's `prevent_approved_bid_strategy_mutation`)
makes every scored/verification/decision field immutable — the only permitted transition out of a decided
row is the exact superseding bookkeeping a re-evaluation performs (`status = 'SUPERSEDED', is_current =
false`, every other field unchanged), verified directly in
`database/src/__tests__/evidenceMatching.test.ts`.

`bid_evidence_claims` is the authoritative "this evidence satisfies this need" record, written only when
`approveMatch` succeeds — never by any AI/semantic path. At most one *active* (non-revoked) claim can
exist per evidence need at a time (a partial unique index), so satisfying a need with a different piece of
evidence later requires an explicit revoke (with a mandatory `revoked_reason`, another `CHECK` constraint)
before a new claim can be approved.

RBAC: `EVIDENCE_MATCH_VIEW_ROLES` (ADMIN/BID_MANAGER/RESEARCHER) gates every read;
`EVIDENCE_MATCH_GENERATE_ROLES` (same three) gates triggering candidate generation — RESEARCHER may
"suggest" but never decide; `EVIDENCE_MATCH_DECIDE_ROLES` (ADMIN/BID_MANAGER only) gates approve/reject.

## 7. Evidence gap feedback loop (§E)

`computeEvidenceGap(input)` is a pure function recommending the status Phase 12's own
`bid_evidence_needs.status` column should carry, given a real approved-claim count against
`minimum_count` — it never forks a parallel evidence-needs model. `SATISFIED` is reached only once
approved claims meet the minimum; `PARTIALLY_SATISFIED` when some but not enough exist;
human/rule-decided `WAIVED`/`BLOCKED` statuses are never overridden by this computation. A need whose only
candidate activity so far has produced rejections (or none at all) is explicitly flagged as a gap with an
honest reason string, never silently swept away. `GET /api/bids/:id/evidence-gaps` both returns the
current set of open gaps and writes the recommended status back onto `bid_evidence_needs` when it differs.

## 8. Staleness (§F)

`isSnapshotStale` (re-exported, same mechanism as Phase 10→11→12) compares a match's recorded
`input_snapshot` (the evidence need's description/minimum count plus the embedding's content hash at
match time) against a freshly-built one; a difference flags `is_stale = true` on the match — never a
silent presentation of a stale match as current. `recomputeMatchStaleness()` in
`supabaseEvidenceMatchingStore.ts` is the exposed entry point a route or script can call independently of
a full generation run.

## 9. Scope decision — tender document chunks get their own table

The spec lists "tender document chunks from Phase 6, where relevant to matching evaluation criteria
evidence" as an embeddable entity. `tender_document_chunks` (Phase 6) are owned by a *tender*, not an
*agency* — forcing them into the agency-scoped `agency_evidence_embeddings` table (whose every RLS policy
and the `match_agency_evidence_embeddings()` function are keyed on `agency_id`) would either require a
fabricated `agency_id` on a genuinely shared-catalogue row, or a second, incompatible RLS shape bolted onto
one table. Instead, `tender_evidence_chunk_embeddings` is a separate, tender-scoped table with the exact
same shared-catalogue RLS pattern Phase 6 already uses for `tender_document_chunks` itself (`select` for
any `authenticated` user). It exists in the schema and lifecycle-tracking sense this phase requires, but
no route or store method in this phase actually populates or queries it yet — using it for evaluation-
criterion-context retrieval (e.g. "does this candidate case study match the actual RFP wording") is left as
a documented, real limitation rather than a half-built parallel embedding path. See Known Limitations below.

## 10. Known limitations (Phase 13)

- **`agency_references` has no `evidence_status` column at all** (verified against the Phase 2 schema
  directly) — `evidenceStatusOf()` uses `is_current` as the closest honest proxy (`UNVERIFIED` if current,
  `UNKNOWN` otherwise) rather than inventing a status the schema never tracks.
- **Only `agency_documents`/`agency_certificates` carry a real `lifecycle_status`** (Phase 8). The other
  three evidence types (`AGENCY_CASE_STUDY`, `AGENCY_REFERENCE`, `AGENCY_FINANCIAL_RECORD`) have no
  supersession concept in this schema and are always treated as `sourceActive: true` — a documented gap,
  not a fabricated signal.
- **`tender_evidence_chunk_embeddings` is schema-only in this phase** (see §9) — no embedding job or
  retrieval path populates or queries it yet.
- **Candidate generation performs a live OpenAI embeddings call synchronously inside the request handler**
  (embedding the evidence need's own description text) rather than as a separate queued/polled step — the
  same design choice Phase 8's qualification engine made for its own synchronous evaluate endpoint (no
  external network dependency there; here there is one, so this endpoint can be slow or fail if the
  embeddings API is unavailable, surfaced honestly as a 422/500 rather than silently degrading).
- **The recency half-life (365 days) and ranking weights are fixed constants**, not per-agency
  configurable — the same discipline Phase 12 applied to its `BID_MILESTONE_AT_RISK_WINDOW_DAYS` constant.
- **OpenAI embeddings API unreachable in this sandbox** (egress allowlist blocks `api.openai.com`) — the
  live embedding smoke test (`pnpm ai:embedding:smoke`) honestly reports `SKIPPED`, never a fabricated
  `PASS`. This is unchanged from every prior AI-touching phase's documented limitation.

## 11. API surface (§G)

- `GET /api/bids/:id/evidence-matches` — list current candidate matches for the project.
- `POST /api/bids/:id/evidence-matches` — trigger a candidate-generation run (optionally scoped to one
  `evidenceNeedId`); requires a live embeddings call, so `AI_NOT_CONFIGURED`/`DATABASE_NOT_CONFIGURED`
  are both honestly reported rather than silently no-op'd.
- `GET /api/bids/:id/evidence-matches/:matchId` — get one match's full detail (rank factors, verification
  checks, rationale) for the evidence inspector view.
- `POST /api/bids/:id/evidence-matches/:matchId/approve` — human approval; writes the authoritative claim.
- `POST /api/bids/:id/evidence-matches/:matchId/reject` — human rejection; requires a non-empty `reason`.
- `GET /api/bids/:id/evidence-claims` — list active (non-revoked) approved claims.
- `GET /api/bids/:id/evidence-gaps` — list unresolved gaps, recomputing and persisting
  `bid_evidence_needs.status` as a side effect.

No path collided with any pre-existing route (`apps/api/src/routes/` was searched for
`evidence-match`/`evidence-claim`/`evidence-gap` before writing a single route) — the spec's literal paths
are used verbatim, unlike Phase 10's `/opportunity-score` or Phase 9's route consolidation.

## 12. UI (§H)

`apps/web/src/components/bids/BidStrategyDashboard.tsx` gains a new **"Evidence Matches"** tab (distinct
from the pre-existing Phase 12 "Evidence Needs" tab — the two show genuinely different things, so no
rename was needed, unlike Phase 10's "Opportunity Score" → "Scoring Engine" disambiguation). The tab shows:
a "Generate candidate matches" action (role-gated), a filter/search box, one card per current candidate
match with its semantic score, deterministic verification badge, rationale, an expandable "Inspect
underlying evidence" panel listing every verification check with its pass/fail message, and
approve/reject controls (reject requires a non-empty reason before the confirm button enables) —
role-gated to `EVIDENCE_MATCH_DECIDE_ROLES`; an "Approved Evidence" panel listing active claims; and an
"Evidence Gaps" panel listing unresolved gaps with severity, feeding back visibly into the same project's
evidence-needs list.
