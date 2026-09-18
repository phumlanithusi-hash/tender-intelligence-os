import { buildApp } from './app.js'
import { env } from './lib/env.js'
import { logger } from './lib/logger.js'

async function main(): Promise<void> {
  const app = await buildApp()

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' })
    logger.info(`API listening on port ${env.PORT} (${env.NODE_ENV})`)
  } catch (err) {
    logger.error({ err }, 'Failed to start API server')
    process.exit(1)
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down gracefully`)
    await app.close()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err) => {
  console.error('Fatal startup error:', err)
  process.exit(1)
})
