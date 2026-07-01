import type { Multipart, MultipartFile } from '@fastify/multipart'
import type { FastifyReply, FastifyRequest } from 'fastify'

type MediaType = 'image' | 'video' | 'audio' | 'document'

type MediaUrlBody = {
  number: string
  type: MediaType
  url: string
  caption?: string
  filename?: string
}

export async function mediaUrlController(
  request: FastifyRequest<{ Body: MediaUrlBody }>,
  reply: FastifyReply,
) {
  try {
    const { number, type, url, caption, filename } = request.body

    if (type === 'document' && !filename) {
      throw new Error('Filename is required for document media')
    }

    const result = await request.server.waService.sendMediaUrl(number, type, url, caption, filename)

    return reply.send({
      success: true,
      data: result,
    })
  } catch (error) {
    return sendMediaError(reply, error)
  }
}

export async function mediaUploadController(request: FastifyRequest, reply: FastifyReply) {
  try {
    const file = await request.file()

    if (!file) {
      throw new Error('Media file is required')
    }

    const fields = file.fields
    const number = getFieldValue(getMultipartFieldValue(fields.number))
    const type = getFieldValue(getMultipartFieldValue(fields.type)) as MediaType
    const caption = getOptionalFieldValue(getMultipartFieldValue(fields.caption))
    const filenameField = getOptionalFieldValue(getMultipartFieldValue(fields.filename))
    const filename = filenameField ?? file.filename

    if (!number || !/^[0-9]+$/.test(number)) {
      throw new Error('Invalid number')
    }

    if (!type || !['image', 'video', 'audio', 'document'].includes(type)) {
      throw new Error('Invalid media type')
    }

    if (type === 'document' && !filename) {
      throw new Error('Filename is required for document media')
    }

    const buffer = await file.toBuffer()
    const result = await request.server.waService.sendMediaBuffer(number, type, buffer, caption, filename)

    return reply.send({
      success: true,
      data: result,
    })
  } catch (error) {
    return sendMediaError(reply, error)
  }
}

function getFieldValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function getOptionalFieldValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function getMultipartFieldValue(part: Multipart | Multipart[] | undefined): unknown {
  if (!part || Array.isArray(part) || isMultipartFile(part)) {
    return undefined
  }

  return part.value
}

function isMultipartFile(part: Multipart): part is MultipartFile {
  return typeof (part as MultipartFile).toBuffer === 'function'
}

function sendMediaError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : 'Failed to send media'
  const isNotFound = message === 'Number is not registered on WhatsApp'
  const isDisconnected = message === 'WhatsApp is not connected'
  const isInvalidMedia =
    message === 'Filename is required for document media' ||
    message === 'Media file is required' ||
    message === 'Invalid number' ||
    message === 'Invalid media type'

  return reply.status(isNotFound ? 422 : isDisconnected ? 503 : isInvalidMedia ? 400 : 500).send({
    success: false,
    error: {
      code: isNotFound ? 'WA_NUMBER_NOT_FOUND' : isDisconnected ? 'WA_NOT_CONNECTED' : isInvalidMedia ? 'MEDIA_INVALID' : 'WA_SEND_FAILED',
      message,
    },
  })
}
