import type { FastifyPluginAsync } from 'fastify'
import { logoutController } from '../controllers/logout.controller.js'
import { mediaUploadController, mediaUrlController } from '../controllers/media.controller.js'
import { messageController } from '../controllers/message.controller.js'
import { statusController } from '../controllers/status.controller.js'
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

const mediaUrlBodySchema = {
  type: 'object',
  required: ['number', 'type', 'url'],
  properties: {
    number: {
      type: 'string',
      minLength: 10,
      maxLength: 15,
      pattern: '^[0-9]+$',
    },
    type: {
      type: 'string',
      enum: ['image', 'video', 'audio', 'document'],
    },
    url: {
      type: 'string',
      minLength: 1,
    },
    caption: {
      type: 'string',
    },
    filename: {
      type: 'string',
      minLength: 1,
    },
  },
} as const

const apiRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authHook)

  app.get('/status/:number', {
    schema: {
      params: statusParamsSchema,
    },
  }, statusController)

  app.post('/message', {
    schema: {
      body: messageBodySchema,
    },
  }, messageController)

  app.post('/media-url', {
    schema: {
      body: mediaUrlBodySchema,
    },
  }, mediaUrlController)

  app.post('/media', mediaUploadController)
  app.post('/logout', logoutController)
}

export default apiRoute
