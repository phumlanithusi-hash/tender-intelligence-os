/**
 * Deduplication rules (Phase 5 §9). Pure and DB-agnostic: given a
 * small set of already-fetched candidate canonical tenders (the
 * repository layer is responsible for narrowing that set down, e.g.
 * by organisation or tender number, before calling this), decide
 * whether an incoming discovered record is the SAME tender as one of
 * them, a NEW tender, or too uncertain to decide automatically.
 *
 * Primary matching, in order: (1) tender number, (2) issuing
 * organisation, (3) source/external id — the source/external id case
 * is handled upstream by `tender_source_records`' own unique
 * (source_id, external_id) constraint (an update, not a dedupe
 * decision) before this function is ever consulted; this module
 * exists for the case where the SAME tender appears without a prior
 * source-record row for this source/external-id pair yet (e.g. first
 * time eTenders is scanned for a tender manually entered earlier, or
 * a genuine duplicate reappearing under a new external id).
 *
 * Secondary matching (organisation + normalised title, or
 * organisation + closing date) never auto-merges — Phase 5 §9 is
 * explicit: "Do NOT merge records based only on title similarity...
 * flag the potential duplicate rather than automatically merging."
 */

export interface DedupeCandidate {
  id: string
  tenderNumber: string | null
  organisation: string | null
  title: string | null
  closingDate: string | null
}

export interface DedupeIncoming {
  tenderNumber: string | null
  organisation: string | null
  title: string | null
  closingDate: string | null
}

export type DedupeDecision =
  | { outcome: 'MATCH'; tenderId: string; reason: 'tender_number' | 'tender_number_and_organisation' | 'organisation_and_title' }
  | { outcome: 'AMBIGUOUS'; candidateIds: string[]; reason: string }
  | { outcome: 'NEW' }

function normaliseKey(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, ' ')
  return trimmed.length > 0 ? trimmed : null
}

export function matchExistingTender(candidates: DedupeCandidate[], incoming: DedupeIncoming): DedupeDecision {
  const incomingNumber = normaliseKey(incoming.tenderNumber)
  const incomingOrg = normaliseKey(incoming.organisation)
  const incomingTitle = normaliseKey(incoming.title)

  // 1. Tender number is the strongest signal — but only within the
  // same issuing organisation when both sides state one, since a
  // numbering scheme can legitimately be reused across organisations
  // (see the `tenders_number_per_organisation_unique` constraint this
  // mirrors).
  if (incomingNumber) {
    const byNumber = candidates.filter((c) => normaliseKey(c.tenderNumber) === incomingNumber)
    if (byNumber.length === 1) {
      const only = byNumber[0]!
      const sameOrg = incomingOrg && normaliseKey(only.organisation) === incomingOrg
      return { outcome: 'MATCH', tenderId: only.id, reason: sameOrg ? 'tender_number_and_organisation' : 'tender_number' }
    }
    if (byNumber.length > 1) {
      if (incomingOrg) {
        const byNumberAndOrg = byNumber.filter((c) => normaliseKey(c.organisation) === incomingOrg)
        if (byNumberAndOrg.length === 1) {
          return { outcome: 'MATCH', tenderId: byNumberAndOrg[0]!.id, reason: 'tender_number_and_organisation' }
        }
      }
      return {
        outcome: 'AMBIGUOUS',
        candidateIds: byNumber.map((c) => c.id),
        reason: 'Multiple existing tenders share this tender number and organisation could not disambiguate them.',
      }
    }
  }

  // 2. No usable tender-number match. Organisation + exact normalised
  // title is a strong-enough secondary signal to auto-match (this is
  // NOT "title similarity" — it requires an exact match on both
  // fields, not a fuzzy score).
  if (incomingOrg && incomingTitle) {
    const byOrgAndTitle = candidates.filter(
      (c) => normaliseKey(c.organisation) === incomingOrg && normaliseKey(c.title) === incomingTitle,
    )
    if (byOrgAndTitle.length === 1) {
      return { outcome: 'MATCH', tenderId: byOrgAndTitle[0]!.id, reason: 'organisation_and_title' }
    }
    if (byOrgAndTitle.length > 1) {
      return {
        outcome: 'AMBIGUOUS',
        candidateIds: byOrgAndTitle.map((c) => c.id),
        reason: 'Multiple existing tenders share this organisation and title.',
      }
    }
  }

  // 3. Weak secondary signal (same organisation + same closing date +
  // similar-but-not-identical title): never auto-merged — flagged as
  // a potential duplicate for human review (Phase 5 §9).
  if (incomingOrg && incoming.closingDate) {
    const weakMatches = candidates.filter(
      (c) =>
        normaliseKey(c.organisation) === incomingOrg &&
        c.closingDate === incoming.closingDate &&
        titlesAreSimilar(c.title, incoming.title),
    )
    if (weakMatches.length > 0) {
      return {
        outcome: 'AMBIGUOUS',
        candidateIds: weakMatches.map((c) => c.id),
        reason:
          'Same organisation and closing date with a similar (not identical) title — flagged as a potential duplicate rather than auto-merged (title similarity alone is never sufficient to merge).',
      }
    }
  }

  return { outcome: 'NEW' }
}

/** Coarse token-overlap similarity — only ever used to FLAG a potential duplicate for review, never to merge automatically (Phase 5 §9). */
function titlesAreSimilar(a: string | null, b: string | null): boolean {
  const normA = normaliseKey(a)
  const normB = normaliseKey(b)
  if (!normA || !normB) return false
  if (normA === normB) return true
  const tokensA = new Set(normA.split(' ').filter((t) => t.length > 3))
  const tokensB = new Set(normB.split(' ').filter((t) => t.length > 3))
  if (tokensA.size === 0 || tokensB.size === 0) return false
  let overlap = 0
  for (const t of tokensA) if (tokensB.has(t)) overlap += 1
  const smaller = Math.min(tokensA.size, tokensB.size)
  return overlap / smaller >= 0.6
}
