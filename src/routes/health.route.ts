import type { FastifyPluginAsync } from 'fastify'
import { healthController } from '../controllers/health.controller.js'

const healthRoute: FastifyPluginAsync = async (app) => {
  app.get('/health', healthController)
}

export default healthRoute
