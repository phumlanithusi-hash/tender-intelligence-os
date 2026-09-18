import { z } from 'zod'

/**
 * Server-side environment schema (apps/api and workers ONLY).
 *
 * This module is deliberately NOT re-exported from the package's main
 * entry point (src/index.ts) — it is only reachable via the
 * `@tender-os/schemas/server` subpath export. A bundler barrel
 * (`export *`) can otherwise pull in an entire module's field names
 * even when the importer only uses one sibling export, which would
 * put strings like "SUPABASE_SERVICE_ROLE_KEY" in a frontend bundle
 * with no functional purpose — harmless on its own, but exactly the
 * kind of boundary blur docs/SECURITY.md §4 exists to prevent. Keeping
 * this as a separate subpath makes that import structurally
 * impossible from apps/web rather than relying on tree-shaking to
 * remove it.
 */
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  OPENAI_API_KEY: z.string().min(1).optional(),
  // Phase 7 §3: model is configurable, never hard-coded in agent code.
  OPENAI_MODEL: z.string().min(1).default('gpt-4o-mini'),
  // Config only for a future phase (Phase 7 §3) — must NOT be used for
  // semantic/vector search in this phase.
  OPENAI_EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),

  // Phase 7 §26: bounded AI context — explicit, config-driven limits.
  AI_MAX_DOCUMENT_CHUNKS: z.coerce.number().int().positive().default(40),
  AI_MAX_CONTEXT_CHARS: z.coerce.number().int().positive().default(60_000),
  AI_MAX_TOKENS_ESTIMATE: z.coerce.number().int().positive().default(16_000),
  // Phase 7 §27: bounded retry for transient provider failures only.
  AI_MAX_RETRIES: z.coerce.number().int().min(0).default(2),

  REDIS_URL: z.string().url().optional(),

  APIFY_TOKEN: z.string().min(1).optional(),

  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>
