# Document Ingestion & Evidence Pipeline (Phase 6)

Converts a discovered tender document (Phase 5: a URL + filename, nothing more) into
provenance-complete, machine-readable evidence ready for Phase 7's AI analysis — and
nothing more than that. No classification/qualification/requirement-extraction/scoring
AI, no embeddings, no semantic search exist yet; this phase's output is the source
material those phases will consume.

## 1. Pipeline stages

```
DISCOVERED → DOWNLOAD → VALIDATE → HASH → STORE
  → EXTRACT → OCR (if required) → PAGE SEGMENT → SECTION DETECT → CHUNK
  → READY_FOR_ANALYSIS
```

Implemented as one composable, idempotent function — `processDocument()`
(`apps/api/src/lib/documents/pipeline.ts`) — not scattered across API routes (Phase 6
§8/§17). Each stage is its own module (`download.ts`, `hashing.ts`, `fileType.ts`,
`extractors/*`, `ocr/*`, `sectionDetection.ts`, `chunking.ts`, `classification.ts`) so
it can be unit-tested in isolation and reused verbatim by a future job queue (see §9).

A failed stage never removes the `tender_documents` row (Phase 6 §18) — the document
identity is untouched; only its version/processing state reflects the failure.

## 2. Document lifecycle

`tender_document_processing.state` (one row per version) is the fine-grained state
machine — `DISCOVERED, DOWNLOAD_QUEUED, DOWNLOADING, DOWNLOADED, VALIDATING, VALID,
INVALID, EXTRACTING, EXTRACTED, OCR_REQUIRED, OCR_QUEUED, OCR_PROCESSING,
OCR_COMPLETE, OCR_FAILED, SEGMENTED, CHUNKED, READY_FOR_ANALYSIS, DOWNLOAD_FAILED,
EXTRACTION_FAILED, FAILED, REQUIRES_REVIEW` (`shared/constants/src/documents.ts`).
This is deliberately separate from the existing (Phase 2) `tender_documents.extraction_status`,
which stays as the coarse Tender-Detail-facing summary.

**Known limitation:** a version row (and therefore a persisted processing-state row)
is only created once a download has actually produced bytes — there is nowhere to
attach a `DOWNLOAD_FAILED` state for a document identity that has *never* successfully
downloaded anything. A first-attempt download failure is reported synchronously in
the API response (`{ state: 'DOWNLOAD_FAILED', error }`) and logged, not persisted as
a DB row. Every failure *after* a version exists (extraction, OCR, a redownload
attempt for a new version) is fully tracked in `tender_document_processing`.

## 3. Storage

Supabase Storage, private bucket `tender-documents` (`storage.ts`). Path shape:

```
tenders/{tender_id}/documents/{document_id}/v{version}/{sanitised_filename}
```

`tenderId`/`documentId` are always our own generated UUIDs (`filename.ts` refuses
anything else), so no externally-supplied value ever reaches a storage path.
Filenames are sanitised by taking only the final path segment (defeats `../`
traversal and absolute paths on either separator style), stripping control/null
bytes, and replacing every non `[A-Za-z0-9._-]` character. Client access is only ever
via a server-issued signed URL (`createSignedUrl`) — the service-role key never
reaches `apps/web` (structurally impossible: separate workspace package, Phase 1
decision).

In this sandbox there is no live Supabase project, so `storage.ts`'s production
implementation is exercised through its interface only; tests use an in-memory fake
(`__tests__/fakeStorage.ts`) that implements the exact same `DocumentStorage`
contract.

## 4. Download security (SSRF)

`apps/api/src/lib/security/urlSafety.ts` is a new **shared** module (used by both this
phase's `download.ts` and available to Phase 5's adapter code, which keeps its own
already-tested, narrower `allowlist.ts` domain check unmodified — no passing test was
touched). It adds what Phase 5 never needed: real DNS resolution plus rejection of
private/loopback/link-local/reserved addresses, including the cloud metadata address
`169.254.169.254`.

`download.ts` (`downloadDocument()`):
- Validates scheme (`http:`/`https:` only) and a per-document host allow-list
  (`allowedHosts.ts`: the hostname of the document's own `tender_sources.base_url`,
  or its already-recorded `file_url` host as a narrower fallback when no source is
  linked) — **before** any network I/O.
- Resolves the hostname and pins the actual TCP connection to the validated IP
  address (via Node's `http`/`https` `lookup` socket option), closing the
  check-then-connect DNS-rebinding gap a second, uncontrolled lookup would leave open.
- Re-validates every redirect target through the same check before following it,
  and enforces a maximum redirect count (`MAX_DOWNLOAD_REDIRECTS`, default 5).
- Enforces a per-attempt timeout (`DOWNLOAD_TIMEOUT_MS`, default 30s) and a maximum
  byte size (`MAX_DOCUMENT_FILE_SIZE_BYTES`, default 50 MiB), aborting the stream the
  instant it is exceeded rather than buffering it all first.

Tested end-to-end (`__tests__/download.test.ts`) against a real, test-owned local
HTTP server — no live external network call is made anywhere in this test suite, per
this phase's own instruction to use a local server for genuine download/SSRF/timeout/
redirect coverage rather than mocking the transport away. A documented, explicitly-named
test-only flag (`allowPrivateNetworksForTesting`) is the only way to point the
downloader at `127.0.0.1`; production code never sets it.

## 5. Validation, hashing, MIME/file-type detection

- `hashing.ts`: SHA-256 over the raw downloaded bytes.
- `fileType.ts`: detects real file type from content (magic bytes via the `file-type`
  library for PDF/DOCX/XLSX/PPTX/images; a structural HTML check; a printable-byte
  heuristic for plain text) — **never** the filename extension alone. An
  extension-vs-content mismatch is always resolved in favour of content.
- Anything the extractor registry doesn't recognise (§6) is marked
  `REQUIRES_REVIEW`, never silently discarded, and the `tender_documents` row is
  untouched.

## 6. Extractor registry

`extractors/registry.ts` maps a detected `DocumentFileKind` to one
`DocumentExtractor` (`{ extract(bytes): Promise<ExtractionResult> }`):

| Kind | Library | Notes |
|---|---|---|
| PDF | `pdf-parse` v2 | Per-page native text; malformed PDFs throw → `INVALID` |
| DOCX | `mammoth` | Parses OOXML as data only, never executes macros; whole doc = page 1 (DOCX has no native page concept) |
| XLSX | `exceljs` | One page per worksheet; rows/columns preserved as a table, not flattened |
| HTML | hand-rolled | Strips `<script>`/`<style>`, tags, decodes a small entity set — never rendered/executed |
| TXT | passthrough | Decoded as UTF-8 |
| IMAGE | — | Always reports `ocrRequired: true`; OCR (§7) does the real work |
| PPTX | *(none)* | **Documented limitation**: no reasonably-maintained, purely-parsing (no macro execution) pure-JS PPTX text extractor was added — Phase 6 explicitly prefers `REQUIRES_REVIEW` over a sketchy dependency. A PPTX document is detected correctly (magic bytes) and marked `REQUIRES_REVIEW`. |

**Decompression-bomb defence** (`zipGuard.ts`, Phase 6 §33): DOCX/XLSX/PPTX are zip
containers. Before mammoth/exceljs ever decompress anything, a pure binary parser
reads only the ZIP central directory (no decompression) and sums every entry's
*declared* uncompressed size, rejecting the file if that sum exceeds
`MAX_DECOMPRESSED_SIZE_BYTES` (200 MiB). This is one defence layer (declared sizes can
themselves be forged) alongside the overall 50 MiB download cap.

## 7. OCR

`ocr/types.ts` defines the engine interface (`isAvailable()`, `recognizeImage()`).
**This sandbox has a real `tesseract` binary with the `eng` language pack installed**
(confirmed: `tesseract --list-langs`), so `ocr/tesseractEngine.ts` performs genuine
OCR, not a stub — verified in `ocr/__tests__/tesseractEngine.test.ts` and exercised
end-to-end against a real synthetic scanned-PDF fixture in
`pipeline.integration.test.ts`. Confidence is a real average, computed from
tesseract's own TSV word-confidence output — never fabricated.

`ocr/pdfRasteriser.ts` uses the system `pdftoppm` (poppler-utils, also present in this
sandbox) to render a scanned PDF page to PNG before OCR, since the OCR engine only
understands raster images. `ocr/ocrPipeline.ts` runs page-by-page with per-page retry
(one retry by default) and failure isolation — one page's OCR failure doesn't abort
the rest, and is recorded rather than silently dropped.

If no OCR engine were available in a given environment, `isAvailable()` returns
`false` and the pipeline moves the document to `OCR_FAILED` with an explicit,
human-readable reason (`"OCR engine ... is not available in this environment."`) —
**never fabricated text**. This exact path is tested with a fake `UnavailableOcrEngine`
in `pipeline.integration.test.ts`, independent of whether this particular sandbox
happens to have `tesseract` installed.

`extraction_method` on every page is always exactly one of `NATIVE_TEXT`, `OCR`, or
`STRUCTURED` (spreadsheets) — never ambiguous.

## 8. Page / section / chunk model (provenance)

- **`tender_document_pages`**: one row per `(document_version_id, page_number)` —
  text, extraction method, confidence where available.
- **`tender_document_sections`**: deterministic only (`sectionDetection.ts`) —
  numbered headings (`1.`, `3.2`), `ANNEXURE`/`APPENDIX`/`SCHEDULE` headings, and
  plain uppercase heading lines. No AI. Unmatched text falls into an UNKNOWN section
  (`section_number = null`, `confidence = 0`) rather than being dropped.
- **`tender_document_chunks`**: deterministic (`chunking.ts`) — chunks never span two
  sections; within a section, whole paragraphs are accumulated up to a target size
  (1800 chars) and only a single paragraph exceeding the hard max (3000 chars) is
  split at the character level. `previous_chunk_id` links chunks in order. Same input
  always produces the same chunks (tested).

Full chain: **Tender → Source → Document → Version → Page → Section → Chunk**, every
link a real foreign key. No table of "requirements" is created this phase — the FK
shape (`chunk.section_id`, `page.document_version_id`) is exactly what Phase 7's
Requirement/Evidence linkage will attach to, without a placeholder table that would
sit empty and drift from the eventual real shape.

## 9. Queue seam (no BullMQ wired in yet)

Checked before building: no BullMQ/Redis wiring exists anywhere in `apps/api` (only a
placeholder `REDIS_URL` in `.env.example`, unused). Rather than introduce a second,
parallel job system, `processDocument()`/`reprocessDocumentVersion()`
(`pipeline.ts`) are already the exact unit a future BullMQ worker would call per job —
idempotent (reprocessing the same bytes never duplicates rows — `replacePages`/
`replaceSections`/`replaceChunks` delete-then-insert scoped to one version id),
retryable (attempt counters on `tender_document_processing`), and observable (every
stage logs tender id / document id / version id / execution id — see §11). The two API
routes (`POST .../download`, `POST .../reprocess`) call these functions directly and
synchronously **only because no queue exists yet** — this is the one place Phase 6
knowingly runs pipeline work inside an HTTP handler, and is the seam a BullMQ worker
will replace without touching pipeline logic.

## 10. Versioning & deduplication

`tender_document_versions` — one row per physical file ever seen for a document
identity, unique on `(document_id, file_hash)`. A new download whose hash already
exists reuses that version (no duplicate storage, no duplicate row) unless the caller
explicitly reprocesses it. A new download with a **different** hash creates version
N+1 with `previous_version_id` pointing at N — the original version's pages/sections/
chunks are never deleted or overwritten. `tender_documents.current_version_id` always
points at the latest version for convenience; every prior version stays fully queryable.

Cross-document, content-addressed global deduplication (the same physical file
appearing under two different `tender_documents` identities) is **not** implemented —
each document identity has its own path segment (`documents/{document_id}/...`)
per Phase 6 §3's own deterministic path spec. Documented as a known limitation, not
attempted this phase.

## 11. Observability

Every stage logs (via the existing `pino` logger) at minimum: tender id, document id,
version id (once known), processing stage, and `executionId` (the API request id when
triggered via the routes; `null` in direct pipeline calls, ready to become a real
BullMQ job id later). No secrets are ever logged — the same redaction config as the
rest of the API applies.

## 12. API

`apps/api/src/routes/tenderDocuments.ts` (all gated by `requireAuth` + `requireRole`,
following `routes/tenderSources.ts`'s convention exactly):

- `GET /api/tenders/:id/documents/:documentId` — document + all versions + current
  processing state.
- `GET /api/tenders/:id/documents/:documentId/pages|sections|chunks`
- `POST /api/tenders/:id/documents/:documentId/download` — runs the full pipeline.
- `POST /api/tenders/:id/documents/:documentId/reprocess` — reruns extraction onward
  against the already-stored bytes for the current version.

Reads: `VIEW_ROLES = [ADMIN, BID_MANAGER, RESEARCHER]` (matches the Source Registry).
Actions: `ACTION_ROLES = [ADMIN, BID_MANAGER]`. Every mutating route uses the
privileged service-role Supabase client — these tables carry no `authenticated`
write policy at all (§13). No storage credential is ever returned to the client;
only a server-issued signed URL would be, where a future UI needs one.

## 13. Database migration & RLS

`database/migrations/20260911120000_document_pipeline.sql` — additive only. New
tables: `tender_document_versions`, `tender_document_processing`,
`tender_document_pages`, `tender_document_sections`, `tender_document_chunks`. Two new
columns on the existing `tender_documents` (`current_version_id`, `classification`) —
no duplication of the Phase 2 shape. RLS follows the exact Phase 2/4 shared-catalogue
pattern: `select` for any `authenticated` user, no `authenticated` write policy at all
(writes are service-role only, same reasoning as `tender_sources`/`tender_documents`
themselves).

## 14. Document classification (deterministic)

`classification.ts` — filename-then-early-page-text keyword matching against
`TOR/RFP/RFQ/SBD_FORM/PRICING_SCHEDULE/SPECIFICATION/ANNEXURE/ADDENDUM/BRIEFING/OTHER/UNKNOWN`.
No AI. Returns `UNKNOWN` with confidence 0 rather than guessing when nothing matches.

## 15. UI

Tender Detail → Documents tab (`apps/web/src/components/tenders/TenderDetail.tsx`)
now shows, per document: filename, type/classification, version, size, fine-grained
processing state, extraction method, page count, and (via a "View" expander)
Download/Reprocess actions gated to `ADMIN`/`BID_MANAGER` (hiding a button is a UX
convenience only — the API re-checks the role regardless). "View evidence" opens a
minimal document evidence view: page navigation on the left, extracted text in the
centre, and an explicit provenance line above the text — `"Tender Document · Page N ·
Section X"` — never displaying extracted text with no source (Phase 6 §28). No
annotation functionality yet, as specified.

## 16. Testing

- **Unit**: hashing, filename sanitisation/path-traversal, MIME/file-type detection
  (content over extension), SSRF/private-IP checks, extractor selection, each
  extractor (PDF/DOCX/XLSX) against synthetic fixtures, zip-bomb guard, section
  detection, chunking (including determinism and paragraph-boundary preference),
  classification, real OCR against a rendered PNG.
- **Integration** (`pipeline.integration.test.ts`, real Postgres via a raw-`pg`-backed
  `DocumentPipelineStore` — same reasoning as Phase 5's `pgIngestionStore.ts`: this
  sandbox has no PostgREST endpoint, so this is what makes a genuine end-to-end test
  against the real schema possible): full pipeline success (PDF/DOCX/XLSX),
  malformed-PDF → `INVALID`, unsupported-format → `REQUIRES_REVIEW`, idempotency (no
  duplicate versions/pages/chunks on a second identical run), versioning (original +
  revised both remain queryable), reprocessing (no duplicate chunks), and the scanned
  PDF → OCR path, both with real OCR and with a fake unavailable engine.
- **Download/SSRF** (`download.test.ts`): a real, test-owned local HTTP server
  exercises success, redirect-and-revalidate, redirect-to-private-IP rejection,
  too-many-redirects, oversized file, timeout, wrong-host rejection, a genuine
  SSRF attempt against `127.0.0.1` (without the test-only bypass), non-HTTP scheme
  rejection, and a 404.
- **E2E** (`tests/e2e/document-pipeline.spec.ts`): the Documents tab shows processing
  state and the evidence viewer's explicit page/section provenance line, and an
  ADMIN sees the Reprocess action — same mocked-`/api/*` convention as the other
  E2E specs, no live backend.

**Synthetic fixtures only** (`tests/fixtures/documents/`): a normal text PDF, a
scanned (image-only) PDF, a multi-page tender PDF with numbered/uppercase/annexure
headings, a DOCX, an XLSX pricing schedule, an addendum PDF, a malformed PDF, a
byte-identical duplicate PDF, and a revised PDF. All clearly synthetic ("SYNTHETIC",
"FOR TESTING ONLY" in their content) — no fabricated procurement facts, matching this
phase's binding constraint that no live document has ever been processed from this
environment.

## 17. Known limitations

1. First-download failure has no persisted version-level state (§2).
2. PPTX has no extractor; routed to `REQUIRES_REVIEW` (§6).
3. Cross-document (identity-independent) storage deduplication is not implemented (§10).
4. No BullMQ wiring yet — the two mutating routes run the pipeline synchronously in
   the request handler, the one seam Phase 6 explicitly accepts until a queue exists (§9).
5. Section detection is heading-pattern-based only; a document with no numbered or
   uppercase headings and no annexures produces a single UNKNOWN section spanning the
   whole document — accurate (nothing was detected), not wrong, but coarse.
6. Table extraction is preserved as rows/cells for XLSX only; PDF tables are not
   specially reconstructed this phase (Phase 6 §21 allows this: "no sophisticated AI
   table interpretation this phase" — PDF table geometry reconstruction without AI is
   itself a substantial project deferred here).
7. Everything in this document has been verified against a real Postgres schema, a
   real local HTTP server, and (where available) a real `tesseract`/`pdftoppm`
   binary in *this* sandbox — never against a live tender-source document, per the
   binding constraint carried forward from Phase 5.
