import { clientEnvSchema } from '@tender-os/schemas'

/**
 * Validated, browser-safe environment. Fails fast at startup with a
 * clear message rather than letting a missing Supabase URL surface
 * later as a confusing network error (spec §38 "environment
 * variables work" acceptance criterion).
 */
function loadClientEnv() {
  const result = clientEnvSchema.safeParse({
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
    VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  })

  if (!result.success) {
    console.error(
      'Invalid or missing frontend environment configuration. Copy apps/web/.env.example ' +
        'to apps/web/.env.local and fill in your Supabase project details.',
      result.error.flatten().fieldErrors,
    )
    return null
  }

  return result.data
}

export const clientEnv = loadClientEnv()
