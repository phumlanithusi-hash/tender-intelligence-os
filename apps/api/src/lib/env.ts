import 'dotenv/config'
import { serverEnvSchema, type ServerEnv } from '@tender-os/schemas/server'

/**
 * Parsed, validated server environment. Fails fast and loudly at
 * startup rather than letting an invalid/missing var surface later
 * as a confusing runtime error deep in a request handler.
 *
 * All fields are optional at the schema level (Phase 1 must run with
 * no Supabase project configured yet — docs/DECISIONS.md 2026-09-10),
 * so this never throws for a missing Supabase/OpenAI/Redis/Apify
 * value; callers that need one of those check for it explicitly and
 * degrade (health check reports `not_configured`) rather than crash.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const result = serverEnvSchema.safeParse(source)
  if (!result.success) {
    console.error('Invalid environment configuration:', result.error.flatten().fieldErrors)
    throw new Error('Invalid environment configuration — see logged field errors above.')
  }
  return result.data
}

export const env = loadEnv()
