import { Link } from 'react-router-dom'
import { ROUTES } from '@tender-os/constants'

export function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-lg font-semibold">Page not found</p>
      <p className="text-sm text-muted-foreground">The route you requested doesn't exist.</p>
      <Link
        to={ROUTES.home}
        className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Back to dashboard
      </Link>
    </div>
  )
}
