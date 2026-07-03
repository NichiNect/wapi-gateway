import type { FastifyReply, FastifyRequest } from 'fastify'

export async function logoutController(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.server.waService.logoutAndClearAuth()

    return reply.send({
      success: true,
      data: {
        loggedOut: true,
        authCleared: true,
        message: 'WhatsApp session logged out and auth cleared',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to logout WhatsApp session'

    return reply.status(500).send({
      success: false,
      error: {
        code: 'WA_LOGOUT_FAILED',
        message,
      },
    })
  }
}
