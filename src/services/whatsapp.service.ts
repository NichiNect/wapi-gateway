import {
  Browsers,
  DisconnectReason,
  delay,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeInMemoryStore,
  makeWASocket,
  useMultiFileAuthState,
  type AnyMessageContent,
  type ConnectionState,
  type WASocket,
} from '@whiskeysockets/baileys'
import { rmSync } from 'node:fs'
import pino from 'pino'
import qrcode from 'qrcode-terminal'
import { config } from '../config/env.js'
import { TelegramService } from './telegram.service.js'

type ConnectionStatus = 'connected' | 'disconnected'
type MediaType = 'image' | 'video' | 'audio' | 'document'
type SendResult = { id: string | undefined; status: number | undefined }
type MediaPayload = Buffer | { url: string }

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
    const { version, isLatest } = await fetchLatestBaileysVersion()

    console.log(`Using WA Web version ${version.join('.')} (latest: ${isLatest})`)

    this.sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
      },
      browser: Browsers.ubuntu('wapi-gateway'),
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      markOnlineOnConnect: false,
    })

    this.store.bind(this.sock.ev)
    this.sock.ev.on('creds.update', saveCreds)

    this.sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update

      console.log('connection.update:', {
        connection,
        hasQr: Boolean(qr),
        statusCode: (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode,
      })

      if (qr) {
        this.renderQr(qr)
        await this.telegram.sendAlert('Please scan QR code to connect')
      }

      if (connection === 'open') {
        this.connectionStatus = 'connected'
        this.userId = this.sock?.user?.id ?? null
        console.log('WhatsApp connected')
        await this.telegram.sendAlert('WhatsApp connected')
        return
      }

      if (connection === 'close') {
        this.connectionStatus = 'disconnected'
        this.userId = null

        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode

        if (!this.isShuttingDown) {
          console.log(`WhatsApp disconnected${statusCode ? `: ${statusCode}` : ''}`)
          await this.telegram.sendAlert(`WhatsApp disconnected${statusCode ? `: ${statusCode}` : ''}`)
        }

        this.sock = null

        if (this.isShuttingDown) {
          return
        }

        if (statusCode === DisconnectReason.loggedOut) {
          rmSync(config.whatsapp.authPath, { recursive: true, force: true })
        }

        await delay(2000)
        await this.init()
      }
    })
  }

  async isNumberRegistered(number: string): Promise<string> {
    await this.waitUntilConnected()

    if (!this.sock) {
      throw new Error('WhatsApp is not connected')
    }

    const jid = `${number}@s.whatsapp.net`
    const results = (await this.sock.onWhatsApp(jid)) ?? []
    const result = results[0]

    if (!result?.exists || !result.jid) {
      throw new Error('Number is not registered on WhatsApp')
    }

    return result.jid
  }

  async sendText(number: string, text: string): Promise<SendResult> {
    return this.sendWithReconnectRetry(async () => {
      const sock = await this.getConnectedSocket()
      const jid = await this.isNumberRegistered(number)

      if (config.whatsapp.typingDelay) {
        await sock.presenceSubscribe(jid)
        await sock.sendPresenceUpdate('composing', jid)
        await delay(config.whatsapp.typingMinMs)
        await sock.sendPresenceUpdate('paused', jid)
      }

      const response = await this.withTimeout(
        sock.sendMessage(jid, { text }),
        config.whatsapp.sendTimeoutMs,
        'Timed Out',
      )

      return this.toSendResult(response)
    })
  }

  async sendMediaBuffer(
    number: string,
    type: MediaType,
    buffer: Buffer,
    caption?: string,
    filename?: string,
  ): Promise<SendResult> {
    return this.sendWithReconnectRetry(async () => {
      const sock = await this.getConnectedSocket()
      const jid = await this.isNumberRegistered(number)
      const content = this.buildMediaMessage(type, caption, filename, buffer)
      const response = await this.withTimeout(
        sock.sendMessage(jid, content),
        config.whatsapp.sendTimeoutMs,
        'Timed Out',
      )

      return this.toSendResult(response)
    })
  }

  async sendMediaUrl(
    number: string,
    type: MediaType,
    url: string,
    caption?: string,
    filename?: string,
  ): Promise<SendResult> {
    return this.sendWithReconnectRetry(async () => {
      const sock = await this.getConnectedSocket()
      const jid = await this.isNumberRegistered(number)
      const content = this.buildMediaMessage(type, caption, filename, { url })
      const response = await this.withTimeout(
        sock.sendMessage(jid, content),
        config.whatsapp.sendTimeoutMs,
        'Timed Out',
      )

      return this.toSendResult(response)
    })
  }

  async logoutAndClearAuth(): Promise<void> {
    this.isShuttingDown = true
    this.connectionStatus = 'disconnected'
    this.userId = null

    const currentSocket = this.sock
    this.sock = null

    if (currentSocket) {
      try {
        await currentSocket.logout()
      } catch {
        currentSocket.end(undefined)
      }
    }

    rmSync(config.whatsapp.authPath, { recursive: true, force: true })
    await this.telegram.sendAlert('WhatsApp session logged out and auth cleared')

    this.isShuttingDown = false
    await this.init()
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

  private async getConnectedSocket(): Promise<WASocket> {
    await this.waitUntilConnected()

    if (!this.sock) {
      throw new Error('WhatsApp is not connected')
    }

    return this.sock
  }

  private async waitUntilConnected(timeoutMs: number = config.whatsapp.sendTimeoutMs): Promise<void> {
    if (this.connectionStatus === 'connected' && this.sock) {
      return
    }

    const startedAt = Date.now()

    while (Date.now() - startedAt < timeoutMs) {
      if (this.connectionStatus === 'connected' && this.sock) {
        return
      }

      await delay(250)
    }

    throw new Error('WhatsApp is not connected')
  }

  private async sendWithReconnectRetry(operation: () => Promise<SendResult>): Promise<SendResult> {
    try {
      return await operation()
    } catch (error) {
      if (!this.isRetryableSendError(error)) {
        throw error
      }

      await this.waitUntilConnected(config.whatsapp.sendTimeoutMs)
      return operation()
    }
  }

  private isRetryableSendError(error: unknown): boolean {
    const message = error instanceof Error ? error.message.toLowerCase() : ''

    return (
      message.includes('timed out') ||
      message.includes('timeout') ||
      message.includes('connection closed') ||
      message.includes('not connected') ||
      message.includes('stream errored out') ||
      message.includes('connection terminated')
    )
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | undefined

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(message))
      }, timeoutMs)
    })

    try {
      return await Promise.race([promise, timeoutPromise])
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
    }
  }

  private renderQr(qr: string): void {
    console.log('\nScan QR berikut dengan WhatsApp Linked Devices:\n')
    qrcode.generate(qr, { small: true })
    console.log('')
  }

  private toSendResult(response: { key?: { id?: string | null }; status?: number } | undefined): SendResult {
    return {
      id: response?.key?.id ?? undefined,
      status: response?.status,
    }
  }

  private buildMediaMessage(
    type: MediaType,
    caption: string | undefined,
    filename: string | undefined,
    payload: MediaPayload,
  ): AnyMessageContent {
    if (type === 'image') {
      return {
        image: payload,
        caption,
        mimetype: this.getMimeType(type, filename),
      }
    }

    if (type === 'video') {
      return {
        video: payload,
        caption,
        mimetype: this.getMimeType(type, filename),
      }
    }

    if (type === 'audio') {
      return {
        audio: payload,
        mimetype: this.getMimeType(type, filename),
      }
    }

    if (!filename) {
      throw new Error('Filename is required for document media')
    }

    return {
      document: payload,
      fileName: filename,
      mimetype: this.getMimeType(type, filename),
      caption,
    }
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
