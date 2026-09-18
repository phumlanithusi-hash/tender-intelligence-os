import { supabase } from './supabaseClient.js'
import { clientEnv } from './env.js'

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Thin typed fetch wrapper used by every resource hook. Attaches the
 * current Supabase session token automatically so callers never
 * forget the Authorization header, and centralises error shaping so
 * hooks can rely on a consistent thrown ApiError.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = clientEnv?.VITE_API_BASE_URL ?? 'http://localhost:4000'
  const headers = new Headers(init.headers)
  // Only claim a JSON body when one is actually being sent — Fastify's
  // default JSON body parser rejects an empty body outright when
  // Content-Type says application/json, which is exactly what every
  // bodyless action (enable/disable/pause/resume/health-check) was
  // hitting: a real 400 from the server, not a client-side bug someone
  // could work around by retrying.
  if (init.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  if (supabase) {
    const { data } = await supabase.auth.getSession()
    if (data.session?.access_token) {
      headers.set('Authorization', `Bearer ${data.session.access_token}`)
    }
  }

  const response = await fetch(`${baseUrl}${path}`, { ...init, headers })

  if (!response.ok) {
    let message = `Request to ${path} failed with status ${response.status}`
    try {
      const body = (await response.json()) as { error?: { message?: string } }
      if (body.error?.message) message = body.error.message
    } catch {
      // response body wasn't JSON — keep the generic message
    }
    throw new ApiError(message, response.status)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}
