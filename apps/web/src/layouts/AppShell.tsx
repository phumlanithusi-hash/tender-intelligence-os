import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '../lib/utils.js'
import { ROUTES } from '@tender-os/constants'
import { NotificationBell } from '../components/notifications/NotificationBell.js'

const NAV_SECTIONS: Array<{ label: string; items: Array<{ to: string; label: string }> }> = [
  {
    label: 'Intelligence',
    items: [
      { to: ROUTES.home, label: 'Dashboard' },
      { to: ROUTES.tenders, label: 'Tenders' },
      { to: ROUTES.opportunities, label: 'Opportunities' },
      { to: ROUTES.watchlist, label: 'Watchlist' },
    ],
  },
  {
    label: 'Bids',
    items: [
      { to: ROUTES.bids, label: 'Bid workspace' },
      { to: ROUTES.outcomes, label: 'Outcomes' },
      { to: ROUTES.intelligence, label: 'Intelligence' },
      { to: ROUTES.intelligenceBenchmarks, label: 'Benchmarks' },
    ],
  },
  {
    label: 'Agency',
    items: [
      { to: ROUTES.agency, label: 'Overview' },
      { to: ROUTES.agencyCapabilities, label: 'Capabilities' },
      { to: ROUTES.agencyPortfolio, label: 'Portfolio' },
      { to: ROUTES.agencyTeam, label: 'Team' },
      { to: ROUTES.agencyDocuments, label: 'Documents' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: ROUTES.analytics, label: 'Analytics' },
      { to: ROUTES.competitors, label: 'Competitors' },
      { to: ROUTES.dataQuality, label: 'Data Quality' },
      { to: ROUTES.opsHealth, label: 'Production Health' },
      { to: ROUTES.sources, label: 'Sources' },
      { to: ROUTES.settings, label: 'Settings' },
      { to: ROUTES.settingsAuditLogs, label: 'Audit Trail' },
    ],
  },
]

export function AppShell() {
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card">
        <div className="flex h-14 items-center border-b border-border px-4">
          <span className="text-sm font-semibold tracking-tight">Tender Intelligence OS</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Primary">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="mb-4">
              <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {section.label}
              </p>
              <ul className="flex flex-col gap-0.5">
                {section.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === ROUTES.home}
                      className={({ isActive }) =>
                        cn(
                          'block rounded-md px-2 py-1.5 text-sm text-foreground/80 hover:bg-muted hover:text-foreground',
                          isActive && 'bg-muted font-medium text-foreground',
                        )
                      }
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border px-6">
          <span className="text-sm text-muted-foreground">South African procurement intelligence</span>
          <NotificationBell />
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
