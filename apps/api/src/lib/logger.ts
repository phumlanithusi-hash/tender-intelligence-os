import { pino } from 'pino'
import { env } from './env.js'

/**
 * Centralised structured logger (docs/SECURITY.md §9, spec §39).
 * Every log call goes through this instance so redaction is applied
 * uniformly — never call console.log directly for anything that
 * might touch request data, user input, or configuration values.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'SUPABASE_SERVICE_ROLE_KEY',
      'OPENAI_API_KEY',
      'APIFY_TOKEN',
      '*.password',
      '*.token',
      '*.apiKey',
      '*.serviceRoleKey',
    ],
    censor: '[REDACTED]',
  },
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
})
