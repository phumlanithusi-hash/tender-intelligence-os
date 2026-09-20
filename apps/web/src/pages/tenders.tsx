import { PlaceholderPage } from './PlaceholderPage.js'
import { TenderRadar } from '../components/tenders/TenderRadar.js'
import { TenderDetail as TenderDetailView } from '../components/tenders/TenderDetail.js'
import { WatchlistView } from '../components/tenders/WatchlistView.js'

export function TendersList() {
  return <TenderRadar />
}

export function TenderDetail() {
  return <TenderDetailView />
}

export function Opportunities() {
  return (
    <PlaceholderPage
      title="Opportunities"
      description="Tenders classified as PRIORITY BID or BID by the deterministic scoring engine."
      builtInPhase="Phase 10 (Opportunity Scoring)"
    />
  )
}

export function Watchlist() {
  return <WatchlistView />
}
