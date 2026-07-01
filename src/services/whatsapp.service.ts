import {
  DisconnectReason,
  delay,
  makeInMemoryStore,
  makeWASocket,
  useMultiFileAuthState,
  type ConnectionState,
  type WASocket,
} from '@whiskeysockets/baileys'
import { rmSync } from 'node:fs'
import pino from 'pino'
import { config } from '../config/env.js'
import { TelegramService } from './telegram.service.js'

type ConnectionStatus = 'connected' | 'disconnected'
type MediaType = 'image' | 'video' | 'audio' | 'document'

export class WhatsAppService {
  public sock: WASocket | null = null
  public store = makeInMemoryStore({
    logger: pino({ level: 'silent' }),
  })
  public telegram: TelegramService

  private connectionStatus: ConnectionStatus = 'disconnected'
  private userId: string | null = null
  private isShuttingDown = false

  constructor() {
    this.telegram = new TelegramService()
  }

  async init(): Promise<void> {
    this.isShuttingDown = false

    const { state, saveCreds } = await useMultiFileAuthState(config.whatsapp.authPath)

    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      logger: pino({ level: 'silent' }),
    })

    this.store.bind(this.sock.ev)
    this.sock.ev.on('creds.update', saveCreds)

    this.sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        await this.telegram.sendAlert('Please scan QR code to connect')
      }

      if (connection === 'open') {
        this.connectionStatus = 'connected'
        this.userId = this.sock?.user?.id ?? null
        await this.telegram.sendAlert('WhatsApp connected')
        return
      }

      if (connection === 'close') {
        this.connectionStatus = 'disconnected'
        this.userId = null

        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode

        if (!this.isShuttingDown) {
          await this.telegram.sendAlert(`WhatsApp disconnected${statusCode ? `: ${statusCode}` : ''}`)
        }

        this.sock = null

        if (this.isShuttingDown) {
          return
        }

        if (statusCode === DisconnectReason.loggedOut) {
          rmSync(config.whatsapp.authPath, { recursive: true, force: true })
        }

        await this.init()
      }
    })
  }

  async isNumberRegistered(number: string): Promise<string> {
    if (!this.sock) {
      throw new Error('WhatsApp is not connected')
    }

    const jid = `${number}@s.whatsapp.net`
    const [result] = await this.sock.onWhatsApp(jid)

    if (!result?.exists || !result.jid) {
      throw new Error('Number is not registered on WhatsApp')
    }

    return result.jid
  }

  async sendText(number: string, text: string): Promise<{ id: string | undefined; status: number | undefined }> {
    if (!this.sock) {
      throw new Error('WhatsApp is not connected')
    }

    const jid = await this.isNumberRegistered(number)

    await this.sock.presenceSubscribe(jid)
    await this.sock.sendPresenceUpdate('composing', jid)
    await delay(3000)

    const response = await this.sock.sendMessage(jid, { text })

    return {
      id: response.key.id,
      status: response.status,
    }
  }

  async sendMediaBuffer(
    number: string,
    type: MediaType,
    buffer: Buffer,
    caption?: string,
    filename?: string,
  ): Promise<{ id: string | undefined; status: number | undefined }> {
    if (!this.sock) {
      throw new Error('WhatsApp is not connected')
    }

    const jid = await this.isNumberRegistered(number)
    const content = this.buildMediaMessage(type, caption, filename, buffer)
    const response = await this.sock.sendMessage(jid, content)

    return {
      id: response.key.id,
      status: response.status,
    }
  }

  async sendMediaUrl(
    number: string,
    type: MediaType,
    url: string,
    caption?: string,
    filename?: string,
  ): Promise<{ id: string | undefined; status: number | undefined }> {
    if (!this.sock) {
      throw new Error('WhatsApp is not connected')
    }

    const jid = await this.isNumberRegistered(number)
    const content = this.buildMediaMessage(type, caption, filename, { url })
    const response = await this.sock.sendMessage(jid, content)

    return {
      id: response.key.id,
      status: response.status,
    }
  }

  getConnectionStatus(): { status: ConnectionStatus; user: string | null } {
    return {
      status: this.connectionStatus,
      user: this.userId,
    }
  }

  async disconnect(): Promise<void> {
    this.isShuttingDown = true
    this.connectionStatus = 'disconnected'
    this.userId = null

    if (this.sock) {
      this.sock.end(undefined)
      this.sock = null
    }
  }

  private buildMediaMessage(
    type: MediaType,
    caption: string | undefined,
    filename: string | undefined,
    payload: Buffer | { url: string },
  ): Record<string, Buffer | { url: string } | string> {
    const message: Record<string, Buffer | { url: string } | string> = {
      [type]: payload,
    }

    if (type === 'document') {
      if (!filename) {
        throw new Error('Filename is required for document media')
      }

      message.fileName = filename
      message.mimetype = this.getMimeType(type, filename)
      return message
    }

    if (caption) {
      message.caption = caption
    }

    message.mimetype = this.getMimeType(type, filename)
    return message
  }

  private getMimeType(type: MediaType, filename?: string): string {
    if (type === 'image') {
      return 'image/jpeg'
    }

    if (type === 'video') {
      return 'video/mp4'
    }

    if (type === 'audio') {
      return 'audio/mpeg'
    }

    const extension = filename?.split('.').pop()?.toLowerCase()

    if (extension === 'pdf') {
      return 'application/pdf'
    }

    if (extension === 'png') {
      return 'image/png'
    }

    if (extension === 'jpg' || extension === 'jpeg') {
      return 'image/jpeg'
    }

    return 'application/octet-stream'
  }
}
