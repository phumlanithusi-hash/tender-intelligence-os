import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { z } from 'zod'
import { errorHandler } from '../errorHandler.js'

describe('errorHandler', () => {
  it('formats a ZodError as a 400 VALIDATION_ERROR', async () => {
    const app = Fastify()
    app.setErrorHandler(errorHandler)
    app.get('/boom', () => {
      z.object({ name: z.string() }).parse({})
    })

    const response = await app.inject({ method: 'GET', url: '/boom' })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('VALIDATION_ERROR')
    await app.close()
  })

  it('formats an unexpected error as a 500 INTERNAL_ERROR without leaking the message', async () => {
    const app = Fastify()
    app.setErrorHandler(errorHandler)
    app.get('/boom', () => {
      throw new Error('sensitive internal detail')
    })

    const response = await app.inject({ method: 'GET', url: '/boom' })
    expect(response.statusCode).toBe(500)
    const body = response.json()
    expect(body.error.code).toBe('INTERNAL_ERROR')
    expect(body.error.message).not.toContain('sensitive internal detail')
    await app.close()
  })
})
