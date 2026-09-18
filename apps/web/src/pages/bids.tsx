import { PlaceholderPage } from './PlaceholderPage.js'
import { BidsList as BidStrategyList, BidProjectDetail } from '../components/bids/BidStrategyDashboard.js'

/**
 * Phase 12 §30/§31 — the standalone Bid Strategy dashboard
 * (`/bids`, `/bids/:id`). Deliberately not a redesign of the Tender
 * Radar. `BidStrategy`/`BidCompliance`/`BidDocuments` below remain
 * later-phase placeholders (proposal generation / compliance gate /
 * document generation are explicitly out of Phase 12 scope — see
 * docs/BID-STRATEGY-ENGINE.md).
 */
export function BidsList() {
  return <BidStrategyList />
}

export function BidDetail() {
  return <BidProjectDetail />
}

export function BidStrategy() {
  return (
    <PlaceholderPage
      title="Bid Strategy (legacy route)"
      description="Superseded by the Strategy tab on /bids/:id (Phase 12)."
      builtInPhase="Phase 12 (Bid Strategy & Bid Project Intelligence)"
    />
  )
}

export function BidCompliance() {
  return (
    <PlaceholderPage
      title="Bid Compliance"
      description="Deterministic READY/BLOCKED submission gate (spec §32)."
      builtInPhase="Phase 17 (Compliance)"
    />
  )
}

export function BidDocuments() {
  return (
    <PlaceholderPage
      title="Bid Documents"
      description="Supporting documents and generated submission pack."
      builtInPhase="Phase 15 (Proposal Generator)"
    />
  )
}
