import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { logger } from '../lib/logger.js'

/**
 * Centralised error handler (docs/SECURITY.md §7, spec §38/§39).
 * No route handler should format its own error response — this is
 * the single place that decides what shape an error takes and what
 * gets logged vs. what gets returned to the client.
 */
export function errorHandler(
  error: FastifyError | ZodError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof ZodError) {
    logger.warn({ err: error, path: request.url }, 'Request validation failed')
    reply.code(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request did not match the expected schema.',
        details: error.flatten(),
      },
    })
    return
  }

  const statusCode = 'statusCode' in error && error.statusCode ? error.statusCode : 500

  if (statusCode >= 500) {
    logger.error({ err: error, path: request.url }, 'Unhandled server error')
  } else {
    logger.warn({ err: error, path: request.url }, 'Request error')
  }

  reply.code(statusCode).send({
    error: {
      code: statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
      message: statusCode >= 500 ? 'An unexpected error occurred.' : error.message,
    },
  })
}
