import type { OpenAiClient } from '../ai/types.js'
import type { AiConfig } from '../ai/config.js'

/**
 * Phase 14 — the store port every route depends on, mirroring
 * lib/evidenceMatching/store.ts / lib/bidStrategy's equivalent
 * exactly. The Supabase-backed implementation
 * (supabaseProposalStore.ts) is the only thing that ever touches
 * Postgres/OpenAI directly for writes.
 */
export interface ProposalStore {
  createProposal(input: { bidProjectId: string; tenderId: string; agencyId: string; createdBy: string | null }): Promise<Record<string, unknown>>
  getProposalByBidProject(bidProjectId: string): Promise<Record<string, unknown> | null>
  getCurrentVersion(proposalId: string): Promise<Record<string, unknown> | null>
  listSections(versionId: string): Promise<Record<string, unknown>[]>
  getSection(sectionId: string): Promise<Record<string, unknown> | null>
  listBlocks(sectionId: string): Promise<Record<string, unknown>[]>
  listClaims(sectionId: string): Promise<Record<string, unknown>[]>
  createSection(input: { versionId: string; agencyId: string; sectionType: string; sectionKey: string; title: string; objective: string | null; sortOrder: number; isMandatory: boolean }): Promise<Record<string, unknown>>

  generateSection(deps: { client: OpenAiClient; config: AiConfig }, input: { sectionId: string; userId: string; userInstructions: string | null }): Promise<Record<string, unknown>>

  patchSection(input: { sectionId: string; userId: string; title?: string; objective?: string | null; blocks?: Array<{ blockType: string; content: Record<string, unknown>; sortOrder?: number }> }): Promise<Record<string, unknown>>

  reviewSection(input: { sectionId: string; reviewerId: string; action: 'REVIEWED' | 'APPROVED' | 'REJECTED'; reason?: string }): Promise<Record<string, unknown>>

  runCompliance(input: { versionId: string; computedBy: string | null }): Promise<Record<string, unknown>>

  assembleDocument(input: { versionId: string; format: 'DOCX' | 'PDF'; userId: string | null }): Promise<{ record: Record<string, unknown>; bytes: Buffer; filename: string; contentType: string }>

  listGenerations(sectionId: string): Promise<Record<string, unknown>[]>
  listMissingInformation(versionId: string): Promise<Record<string, unknown>[]>
}
