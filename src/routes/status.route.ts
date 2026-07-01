import type { FastifyPluginAsync } from 'fastify'
import { authHook } from '../hooks/auth.hook.js'

const statusParamsSchema = {
  type: 'object',
  required: ['number'],
  properties: {
    number: {
      type: 'string',
      minLength: 10,
      maxLength: 15,
      pattern: '^[0-9]+$',
    },
  },
} as const

const statusRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/status/:number',
    {
      preHandler: authHook,
      schema: {
        params: statusParamsSchema,
      },
    },
    async (request, reply) => {
      const { number } = request.params as { number: string }

      try {
        const jid = await app.waService.isNumberRegistered(number)

        return {
          success: true,
          data: {
            exists: true,
            jid,
          },
        }
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
    },
  )
}

export default statusRoute
