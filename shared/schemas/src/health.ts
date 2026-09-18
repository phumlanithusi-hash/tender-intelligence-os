import { z } from 'zod'

export const healthCheckResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.string().min(1),
  timestamp: z.string().datetime(),
  checks: z.object({
    database: z.enum(['ok', 'error', 'not_configured']),
  }),
})

export type HealthCheckResponse = z.infer<typeof healthCheckResponseSchema>
