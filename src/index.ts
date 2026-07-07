import { buildApp } from './app.js'
import { config } from './config/env.js'

const app = await buildApp()

const shutdown = async (error?: unknown): Promise<void> => {
  if (error) {
    app.log.error(error)
  }

  try {
    await app.close()
  } finally {
    process.exit(error ? 1 : 0)
  }
}

process.on('uncaughtException', (error) => {
  void shutdown(error)
})

process.on('unhandledRejection', (reason) => {
  void shutdown(reason)
})

process.on('SIGTERM', () => {
  app.log.info('Received SIGTERM, shutting down gracefully')
  void shutdown()
})

process.on('SIGINT', () => {
  app.log.info('Received SIGINT, shutting down gracefully')
  void shutdown()
})

try {
  await app.listen({
    port: config.app.port,
    host: '0.0.0.0',
  })
} catch (error) {
  await shutdown(error)
}
