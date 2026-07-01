import type { FastifyReply, FastifyRequest } from 'fastify'

export async function healthController(request: FastifyRequest, reply: FastifyReply) {
  return reply.send({
    success: true,
    data: {
      ...request.server.waService.getConnectionStatus(),
      uptime: process.uptime(),
    },
  })
}
