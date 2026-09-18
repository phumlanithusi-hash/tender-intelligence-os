import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './ui/button.js'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Top-level React error boundary (build execution: "basic error
 * boundary"). Catches render-time exceptions anywhere in the tree so
 * a single broken page can never take down the entire application
 * shell — the nav and the rest of the app remain usable.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error caught by ErrorBoundary:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-lg font-semibold">The application hit an unexpected error</p>
          <p className="max-w-md text-sm text-muted-foreground">{this.state.error.message}</p>
          <Button onClick={() => this.setState({ error: null })}>Try again</Button>
        </div>
      )
    }
    return this.props.children
  }
}
