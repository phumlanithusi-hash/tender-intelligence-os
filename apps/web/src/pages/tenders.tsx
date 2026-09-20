import { TenderRadar } from '../components/tenders/TenderRadar.js'
import { TenderDetail as TenderDetailView } from '../components/tenders/TenderDetail.js'
import { WatchlistView } from '../components/tenders/WatchlistView.js'
import { OpportunitiesView } from '../components/tenders/OpportunitiesView.js'

export function TendersList() {
  return <TenderRadar />
}

export function TenderDetail() {
  return <TenderDetailView />
}

export function Opportunities() {
  return <OpportunitiesView />
}

export function Watchlist() {
  return <WatchlistView />
}
