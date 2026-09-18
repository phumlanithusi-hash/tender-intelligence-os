import { PlaceholderPage } from './PlaceholderPage.js'
import { SourceRegistry } from '../components/sources/SourceRegistry.js'
import { SourceDetail } from '../components/sources/SourceDetail.js'

export function Analytics() {
  return (
    <PlaceholderPage
      title="Analytics"
      description="Tender volume, value, bid/no-bid ratio, win/loss, and related metrics (spec §37)."
      builtInPhase="Phase 21 (Analytics)"
    />
  )
}

export function Sources() {
  return <SourceRegistry />
}

export function SourceDetailPage() {
  return <SourceDetail />
}

export function Settings() {
  return (
    <PlaceholderPage
      title="Settings"
      description="User, role, taxonomy, and notification configuration."
      builtInPhase="Phase 2 (Database) onward"
    />
  )
}
