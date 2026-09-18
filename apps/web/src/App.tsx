import { RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { ErrorBoundary } from './components/ErrorBoundary.js'
import { queryClient } from './lib/queryClient.js'
import { router } from './routes.js'

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
