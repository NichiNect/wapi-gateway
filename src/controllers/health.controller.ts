import type { FastifyReply, FastifyRequest } from 'fastify'
import { config } from '../config/env.js'

export async function healthController(request: FastifyRequest, reply: FastifyReply) {
  return reply.send({
    success: true,
    data: {
      ...request.server.waService.getConnectionStatus(),
      uptime: process.uptime(),
      telegram: config.telegram.enabled
    },
  })
}
