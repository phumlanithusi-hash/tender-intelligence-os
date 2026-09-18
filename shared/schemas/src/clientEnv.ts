import { z } from 'zod'

/**
 * Client-side (browser-safe) environment schema (apps/web).
 * Only Vite `VITE_`-prefixed public values. This file is intentionally
 * separate from serverEnv.ts and is the only one re-exported from the
 * package's main entry point — so a frontend importing
 * `@tender-os/schemas` cannot pull in the server schema (or its field
 * names) even transitively, closing the gap a barrel `export *` would
 * otherwise leave (docs/SECURITY.md §4).
 */
export const clientEnvSchema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1),
  VITE_API_BASE_URL: z.string().url().default('http://localhost:4000'),
})

export type ClientEnv = z.infer<typeof clientEnvSchema>
