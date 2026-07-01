import type { FastifyReply, FastifyRequest } from 'fastify'
import { config } from '../config/env.js'

export async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authorization = request.headers.authorization

  if (!authorization?.startsWith('Bearer ')) {
    void reply.status(401).send({
      success: false,
      error: {
        code: 'AUTH_INVALID',
        message: 'Unauthorized',
      },
    })
    return
  }

  const token = authorization.slice('Bearer '.length).trim()

  if (!token || token !== config.auth.apiKey) {
    void reply.status(401).send({
      success: false,
      error: {
        code: 'AUTH_INVALID',
        message: 'Unauthorized',
      },
    })
  }
}
