import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { ROUTES } from '@tender-os/constants'
import { useSession } from '../hooks/useSession.js'
import { LoadingState } from './states/LoadingState.js'
import { EmptyState } from './states/EmptyState.js'

/**
 * Route guard implementing the authentication-foundation acceptance
 * test: unauthenticated access to a protected route redirects to
 * /login (build execution §6). When Supabase isn't configured at all,
 * this renders an explanatory state rather than an infinite redirect
 * loop to a login page that couldn't work either.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const session = useSession()

  if (session.status === 'not_configured') {
    return (
      <div className="p-6">
        <EmptyState
          title="Authentication is not configured"
          description="Copy apps/web/.env.example to apps/web/.env.local with your Supabase project URL and anon key."
        />
      </div>
    )
  }

  if (session.status === 'loading') return <LoadingState />
  if (session.status === 'signed_out') return <Navigate to={ROUTES.login} replace />

  return children
}
