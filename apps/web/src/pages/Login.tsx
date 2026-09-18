import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '@tender-os/constants'
import { supabase } from '../lib/supabaseClient.js'
import { Button } from '../components/ui/button.js'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card.js'
import { EmptyState } from '../components/states/EmptyState.js'
import { ErrorState } from '../components/states/ErrorState.js'

export function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!supabase) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <EmptyState
            title="Authentication is not configured"
            description="Copy apps/web/.env.example to apps/web/.env.local with your Supabase project URL and anon key to enable sign-in."
          />
        </div>
      </div>
    )
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error: signInError } = await supabase!.auth.signInWithPassword({ email, password })
    setSubmitting(false)
    if (signInError) {
      setError(signInError.message)
      return
    }
    navigate(ROUTES.home)
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Tender Intelligence OS</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <label className="flex flex-col gap-1 text-sm">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Password
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            {error ? <ErrorState message={error} /> : null}
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
