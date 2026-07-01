import type { FastifyPluginAsync } from 'fastify'
import { authHook } from '../hooks/auth.hook.js'

const messageBodySchema = {
  type: 'object',
  required: ['number', 'message'],
  properties: {
    number: {
      type: 'string',
      minLength: 10,
      maxLength: 15,
      pattern: '^[0-9]+$',
    },
    message: {
      type: 'string',
      minLength: 1,
    },
  },
} as const

const messageRoute: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/message',
    {
      preHandler: authHook,
      schema: {
        body: messageBodySchema,
      },
    },
    async (request, reply) => {
      const { number, message } = request.body as { number: string; message: string }

      try {
        const result = await app.waService.sendText(number, message)

        return {
          success: true,
          data: result,
        }
      } catch (error) {
        const messageText = error instanceof Error ? error.message : 'Failed to send message'
        const isNotFound = messageText === 'Number is not registered on WhatsApp'
        const isDisconnected = messageText === 'WhatsApp is not connected'

        return reply.status(isNotFound ? 422 : isDisconnected ? 503 : 500).send({
          success: false,
          error: {
            code: isNotFound ? 'WA_NUMBER_NOT_FOUND' : isDisconnected ? 'WA_NOT_CONNECTED' : 'WA_SEND_FAILED',
            message: messageText,
          },
        })
      }
    },
  )
}

export default messageRoute
