import type { FastifyReply, FastifyRequest } from 'fastify'

export async function statusController(
  request: FastifyRequest<{ Params: { number: string } }>,
  reply: FastifyReply,
) {
  try {
    const jid = await request.server.waService.isNumberRegistered(request.params.number)

    return reply.send({
      success: true,
      data: {
        exists: true,
        jid,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to check number status'
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
