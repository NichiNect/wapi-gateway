import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import Fastify, { type FastifyInstance } from 'fastify'
import { config } from './config/env.js'
import healthRoute from './routes/health.route.js'
import apiRoute from './routes/api.js'
import { WhatsAppService } from './services/whatsapp.service.js'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport:
        process.env.NODE_ENV === 'production'
          ? undefined
          : {
              target: 'pino-pretty',
            },
    },
  })

  await app.register(cors, { origin: true })
  await app.register(helmet)
  await app.register(multipart, {
    limits: {
      fileSize: config.uploads.maxFileSize,
    },
  })

  const waService = new WhatsAppService()
  await waService.init()
  app.decorate('waService', waService)

  await app.register(healthRoute)
  await app.register(apiRoute, { prefix: '/api' })

  app.addHook('onClose', async () => {
    await app.waService.disconnect()
  })

  return app
}
