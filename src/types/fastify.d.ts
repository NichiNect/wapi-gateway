import 'fastify'
import type { WhatsAppService } from '../services/whatsapp.service.js'

declare module 'fastify' {
  interface FastifyInstance {
    waService: WhatsAppService
  }
}
