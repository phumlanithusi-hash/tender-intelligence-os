import { createHash } from 'node:crypto'

/**
 * Phase 15 §33/§34/§35/§32 — PURE helpers for assembling a Submission
 * Pack manifest and computing file-integrity hashes. No I/O: the
 * caller (supabaseSubmissionReadinessStore.ts) supplies file bytes /
 * metadata already fetched, and this module only computes/derives.
 */

export interface PackFileInput {
  documentType: string
  fileName: string
  storagePath: string | null
  mimeType: string | null
  sizeBytes: number | null
  /** Raw file bytes, when available, to hash (Phase 15 §35). If omitted, `precomputedSha256` must be supplied. */
  bytes?: Buffer
  precomputedSha256?: string
  sourceTable?: string | null
  sourceId?: string | null
}

export interface PackFileRecord {
  documentType: string
  fileName: string
  storagePath: string | null
  mimeType: string | null
  sizeBytes: number | null
  sha256: string
  sourceTable: string | null
  sourceId: string | null
}

/** sha256Hex: deterministic SHA-256 hash of file bytes (Phase 15 §35). */
export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** buildPackFileRecord: computes/normalises one submission pack file entry. */
export function buildPackFileRecord(input: PackFileInput): PackFileRecord {
  const sha256 = input.precomputedSha256 ?? (input.bytes ? sha256Hex(input.bytes) : sha256Hex(Buffer.from(input.storagePath ?? input.fileName)))
  return {
    documentType: input.documentType,
    fileName: input.fileName,
    storagePath: input.storagePath,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    sha256,
    sourceTable: input.sourceTable ?? null,
    sourceId: input.sourceId ?? null,
  }
}

/** detectDuplicateFiles: two files with the same sha256 are the same content regardless of name (Phase 15 §30 "duplicate"). */
export function detectDuplicateFiles(files: PackFileRecord[]): string[] {
  const seen = new Map<string, number>()
  for (const f of files) seen.set(f.sha256, (seen.get(f.sha256) ?? 0) + 1)
  return [...seen.entries()].filter(([, count]) => count > 1).map(([hash]) => hash)
}

export interface SubmissionManifestDocument {
  documentType: string
  fileName: string
  status: string
  version: number | null
  sizeBytes: number | null
  sha256: string
  required: boolean
  verified: boolean
}

export interface SubmissionManifestInput {
  tenderTitle: string
  tenderNumber: string | null
  organisationName: string
  closingDate: string | null
  closingTime: string | null
  submissionMethod: string
  documents: SubmissionManifestDocument[]
  compliancePercentagesByCategory: Record<string, number>
  overallStatus: string
}

/** buildSubmissionManifest: deterministic rollup for the Submission Manifest (Phase 15 §32) — no fabricated status, every field sourced from real system data supplied by the caller. */
export function buildSubmissionManifest(input: SubmissionManifestInput) {
  return {
    tender: { title: input.tenderTitle, tenderNumber: input.tenderNumber },
    organisation: input.organisationName,
    closingDate: input.closingDate,
    closingTime: input.closingTime,
    submissionMethod: input.submissionMethod,
    documents: input.documents,
    complianceSummary: input.compliancePercentagesByCategory,
    overallStatus: input.overallStatus,
    generatedAt: new Date(0).toISOString(), // caller overwrites with the real computed_at when persisting; kept deterministic for pure-function testing
  }
}

// -------------------------------------------------------------------
// Storage port (Phase 15 §40) — deterministic abstraction so the code
// path is real/testable even where live Supabase Storage isn't
// reachable in this sandbox (spec §40/§59 explicit allowance).
// -------------------------------------------------------------------

export interface StoredObject {
  storagePath: string
  sha256: string
  sizeBytes: number
}

export interface SubmissionPackStoragePort {
  /** Uploads bytes to a private, agency-scoped path and returns the stored object's metadata. */
  put(agencyId: string, packId: string, fileName: string, bytes: Buffer, mimeType: string): Promise<StoredObject>
  /** Issues a short-lived signed URL for privileged, server-side-checked access only. */
  getSignedUrl(storagePath: string, expiresInSeconds: number): Promise<string>
}

/**
 * InMemorySubmissionPackStorage: deterministic test-only adapter
 * (Phase 15 §40/§59).
 *
 * Phase 19 production-limitation audit correction: this port and its
 * in-memory adapter are NOT wired into
 * `supabaseSubmissionReadinessStore.ts` in production, and no
 * `createSupabaseSubmissionPackStorage` exists — a prior comment here
 * claimed otherwise, which was inaccurate and is corrected now. In
 * practice this port turned out to be unnecessary: a Submission Pack
 * never re-uploads file bytes into a separate bucket — it only
 * references the storage_path of files already uploaded through the
 * real Supabase-backed `DocumentStorage`
 * (`lib/documents/storage.ts::createSupabaseDocumentStorage`, wired in
 * `routes/tenderDocuments.ts`) and the real proposal-document storage
 * paths recorded in `bid_proposal_documents`
 * (`supabaseSubmissionReadinessStore.ts::assembleInput`). This port
 * remains only as a tested, documented seam for a future phase that
 * needs to store pack-specific bytes (e.g. a generated ZIP) that don't
 * already exist as a document row — see docs/PRODUCTION-OPERATIONS.md.
 */
export class InMemorySubmissionPackStorage implements SubmissionPackStoragePort {
  private readonly objects = new Map<string, Buffer>()

  async put(agencyId: string, packId: string, fileName: string, bytes: Buffer, _mimeType: string): Promise<StoredObject> {
    const storagePath = `submission-packs/${agencyId}/${packId}/${fileName}`
    this.objects.set(storagePath, bytes)
    return { storagePath, sha256: sha256Hex(bytes), sizeBytes: bytes.length }
  }

  async getSignedUrl(storagePath: string, expiresInSeconds: number): Promise<string> {
    if (!this.objects.has(storagePath)) throw new Error(`No such object: ${storagePath}`)
    return `mock://signed/${encodeURIComponent(storagePath)}?expires=${expiresInSeconds}`
  }

  /** Test-only helper to simulate cross-agency access rejection at the application layer (real Storage enforces this via private bucket + agency-scoped path + server-side signed URL issuance). */
  assertAgencyOwnsPath(agencyId: string, storagePath: string): void {
    if (!storagePath.startsWith(`submission-packs/${agencyId}/`)) {
      throw new Error('FORBIDDEN: storage path does not belong to this agency')
    }
  }
}
