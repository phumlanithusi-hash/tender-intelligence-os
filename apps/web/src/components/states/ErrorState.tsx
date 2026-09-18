import { Button } from '../ui/button.js'

/**
 * Standard error state. Deliberately shows the real error message
 * rather than a generic "something went wrong" — this is procurement
 * software (docs/ARCHITECTURE.md §1: explainability), and a hidden
 * error message makes a real failure harder to diagnose or report.
 */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 py-12 text-center"
    >
      <p className="text-sm font-medium text-destructive">Something went wrong</p>
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  )
}
