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

export class WhatsAppService {
  public sock: WASocket | null = null
  public store = makeInMemoryStore({
    logger: pino({ level: 'silent' }),
  })
  public telegram: TelegramService

  private connectionStatus: ConnectionStatus = 'disconnected'
  private userId: string | null = null

  constructor() {
    this.telegram = new TelegramService()
  }

  async init(): Promise<void> {
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

        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
          ?.statusCode

        await this.telegram.sendAlert(`WhatsApp disconnected${statusCode ? `: ${statusCode}` : ''}`)

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

  getConnectionStatus(): { status: ConnectionStatus; user: string | null } {
    return {
      status: this.connectionStatus,
      user: this.userId,
    }
  }
}
