import { createBrowserRouter } from 'react-router-dom'
import { ROUTE_PATTERNS } from '@tender-os/constants'
import { AppShell } from './layouts/AppShell.js'
import { RequireAuth } from './components/RequireAuth.js'
import { Login } from './pages/Login.js'
import { Dashboard } from './pages/Dashboard.js'
import { TendersList, TenderDetail, Opportunities, Watchlist } from './pages/tenders.js'
import { BidsList, BidDetail, BidStrategy, BidCompliance, BidDocuments } from './pages/bids.js'
import {
  AgencyOverview,
  AgencyCapabilities,
  AgencyPortfolio,
  AgencyTeam,
  AgencyDocuments,
} from './pages/agency.js'
import { Analytics, Sources, SourceDetailPage, Settings } from './pages/operations.js'
import { OutcomesDashboard } from './pages/OutcomesDashboard.js'
import { CompetitorsDirectory } from './pages/CompetitorsDirectory.js'
import { Intelligence } from './pages/Intelligence.js'
import { Benchmarks } from './pages/Benchmarks.js'
import { AuditLogs } from './pages/AuditLogs.js'
import { DataQuality } from './pages/DataQuality.js'
import { ProductionHealth } from './pages/ProductionHealth.js'
import { NotFound } from './pages/NotFound.js'

/**
 * Full route map from spec §9, wired end to end in Phase 1 so
 * navigation can be verified against the spec immediately — every
 * route renders something (a real page or a clearly-labelled
 * placeholder), none 404 (docs/BUILD-PLAN.md §3).
 */
export const router = createBrowserRouter([
  { path: ROUTE_PATTERNS.login, element: <Login /> },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { path: ROUTE_PATTERNS.home, element: <Dashboard /> },
      { path: ROUTE_PATTERNS.tenders, element: <TendersList /> },
      { path: ROUTE_PATTERNS.tenderDetail, element: <TenderDetail /> },
      { path: ROUTE_PATTERNS.opportunities, element: <Opportunities /> },
      { path: ROUTE_PATTERNS.watchlist, element: <Watchlist /> },
      { path: ROUTE_PATTERNS.bids, element: <BidsList /> },
      { path: ROUTE_PATTERNS.bidDetail, element: <BidDetail /> },
      { path: ROUTE_PATTERNS.bidStrategy, element: <BidStrategy /> },
      { path: ROUTE_PATTERNS.bidCompliance, element: <BidCompliance /> },
      { path: ROUTE_PATTERNS.bidDocuments, element: <BidDocuments /> },
      { path: ROUTE_PATTERNS.agency, element: <AgencyOverview /> },
      { path: ROUTE_PATTERNS.agencyCapabilities, element: <AgencyCapabilities /> },
      { path: ROUTE_PATTERNS.agencyPortfolio, element: <AgencyPortfolio /> },
      { path: ROUTE_PATTERNS.agencyTeam, element: <AgencyTeam /> },
      { path: ROUTE_PATTERNS.agencyDocuments, element: <AgencyDocuments /> },
      { path: ROUTE_PATTERNS.analytics, element: <Analytics /> },
      { path: ROUTE_PATTERNS.outcomes, element: <OutcomesDashboard /> },
      { path: ROUTE_PATTERNS.competitors, element: <CompetitorsDirectory /> },
      { path: ROUTE_PATTERNS.intelligence, element: <Intelligence /> },
      { path: ROUTE_PATTERNS.intelligenceBenchmarks, element: <Benchmarks /> },
      { path: ROUTE_PATTERNS.dataQuality, element: <DataQuality /> },
      { path: ROUTE_PATTERNS.opsHealth, element: <ProductionHealth /> },
      { path: ROUTE_PATTERNS.sources, element: <Sources /> },
      { path: ROUTE_PATTERNS.sourceDetail, element: <SourceDetailPage /> },
      { path: ROUTE_PATTERNS.settings, element: <Settings /> },
      { path: ROUTE_PATTERNS.settingsAuditLogs, element: <AuditLogs /> },
    ],
  },
  { path: '*', element: <NotFound /> },
])
