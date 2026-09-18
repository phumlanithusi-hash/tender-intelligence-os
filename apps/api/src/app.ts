import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { env } from './lib/env.js'
import { logger } from './lib/logger.js'
import { errorHandler } from './middleware/errorHandler.js'
import { healthRoutes } from './routes/health.js'
import { meRoutes } from './routes/me.js'
import { catalogueRoutes } from './routes/catalogue.js'
import { tendersRoutes } from './routes/tenders.js'
import { tenderSourcesRoutes } from './routes/tenderSources.js'
import { tenderDocumentsRoutes } from './routes/tenderDocuments.js'
import { tenderAiRoutes } from './routes/tenderAi.js'
import { tenderQualificationRoutes } from './routes/tenderQualification.js'
import { tenderRequirementsEvaluationRoutes } from './routes/tenderRequirementsEvaluation.js'
import { tenderScoringRoutes } from './routes/tenderScoring.js'
import { tenderBidDecisionRoutes } from './routes/tenderBidDecision.js'
import { bidStrategyRoutes } from './routes/bidStrategy.js'
import { evidenceMatchingRoutes } from './routes/evidenceMatching.js'
import { proposalsRoutes } from './routes/proposals.js'
import { submissionReadinessRoutes } from './routes/submissionReadiness.js'
import { submissionExecutionRoutes } from './routes/submissionExecution.js'
import { watchlistRoutes } from './routes/watchlist.js'
import { savedFiltersRoutes } from './routes/savedFilters.js'
import { outcomesRoutes } from './routes/outcomes.js'
import { intelligenceRoutes } from './routes/intelligence.js'
import { addendaRoutes } from './routes/addenda.js'
import { dataQualityRoutes } from './routes/dataQuality.js'
import { opsRoutes } from './routes/ops.js'
import { notificationsRoutes } from './routes/notifications.js'
import { surveillanceRoutes } from './routes/surveillance.js'
import { benchmarksRoutes } from './routes/benchmarks.js'
import { auditTrailRoutes } from './routes/auditTrail.js'
// Registers every implemented source adapter (Phase 4 §6) before the
// app starts serving requests. Imported for its side effect only —
// see lib/adapters/index.ts's own comment on why it registers nothing
// in Phase 4.
import './lib/adapters/index.js'

/**
 * Builds the Fastify app without starting the listener, so tests can
 * inject requests directly (docs/TESTING.md §3 "Integration" row)
 * without binding a real port.
 *
 * The pino instance is cast to FastifyBaseLogger when handed to
 * Fastify: pino's own type is structurally richer than the interface
 * Fastify's generics expect, and without this cast TypeScript infers
 * a Fastify instance parameterised by pino's concrete Logger type,
 * which then fails to satisfy the plain `FastifyInstance` type used
 * everywhere else (e.g. routes/health.ts). The cast is a type-level
 * narrowing only — the same fully-configured logger (redaction
 * included) is still the one actually used at runtime.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
    disableRequestLogging: env.NODE_ENV === 'test',
  })

  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
  })

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  })

  app.setErrorHandler(errorHandler)

  await app.register(healthRoutes)
  await app.register(meRoutes)
  await app.register(catalogueRoutes)
  await app.register(tendersRoutes)
  await app.register(tenderSourcesRoutes)
  await app.register(tenderDocumentsRoutes)
  await app.register(tenderAiRoutes)
  await app.register(tenderQualificationRoutes)
  await app.register(tenderRequirementsEvaluationRoutes)
  await app.register(tenderScoringRoutes)
  await app.register(tenderBidDecisionRoutes)
  await app.register(bidStrategyRoutes)
  await app.register(evidenceMatchingRoutes)
  await app.register(proposalsRoutes)
  await app.register(submissionReadinessRoutes)
  await app.register(submissionExecutionRoutes)
  await app.register(watchlistRoutes)
  await app.register(savedFiltersRoutes)
  await app.register(outcomesRoutes)
  await app.register(intelligenceRoutes)
  await app.register(addendaRoutes)
  await app.register(dataQualityRoutes)
  await app.register(opsRoutes)
  await app.register(notificationsRoutes)
  await app.register(surveillanceRoutes)
  await app.register(benchmarksRoutes)
  await app.register(auditTrailRoutes)

  return app
}
