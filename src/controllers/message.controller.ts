import type { FastifyReply, FastifyRequest } from 'fastify'

export async function messageController(
  request: FastifyRequest<{ Body: { number: string; message: string } }>,
  reply: FastifyReply,
) {
  try {
    const result = await request.server.waService.sendText(request.body.number, request.body.message)

    return reply.send({
      success: true,
      data: result,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send message'
    const isNotFound = message === 'Number is not registered on WhatsApp'
    const isDisconnected = message === 'WhatsApp is not connected'

    return reply.status(isNotFound ? 422 : isDisconnected ? 503 : 500).send({
      success: false,
      error: {
        code: isNotFound ? 'WA_NUMBER_NOT_FOUND' : isDisconnected ? 'WA_NOT_CONNECTED' : 'WA_SEND_FAILED',
        message,
      },
    })
  }
}
