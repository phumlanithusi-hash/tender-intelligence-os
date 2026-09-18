import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient.js'

export type SessionState =
  | { status: 'not_configured' }
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'signed_in'; session: Session }

/**
 * Authentication foundation (build execution Phase 1 requirement).
 * Subscribes to Supabase Auth state changes so the whole app reacts
 * to sign-in/sign-out without each page re-implementing the listener.
 * Distinguishes "not configured" from "signed out" deliberately —
 * they need different UI (docs/DECISIONS.md 2026-09-10: Phase 1 must
 * run before a real Supabase project exists).
 */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>(
    supabase ? { status: 'loading' } : { status: 'not_configured' },
  )

  useEffect(() => {
    if (!supabase) return

    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setState(data.session ? { status: 'signed_in', session: data.session } : { status: 'signed_out' })
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(session ? { status: 'signed_in', session } : { status: 'signed_out' })
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  return state
}
