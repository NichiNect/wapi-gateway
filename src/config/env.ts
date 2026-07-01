import dotenv from 'dotenv'

dotenv.config()

function toNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback
  }

  return value.toLowerCase() === 'true'
}

export const config = {
  app: {
    port: toNumber(process.env.APP_PORT, 3000),
    name: process.env.APP_NAME ?? 'wapi-gateway',
  },
  auth: {
    apiKey: process.env.API_KEY ?? '',
  },
  whatsapp: {
    authPath: process.env.WA_AUTH_PATH ?? './auth/baileys_auth_info',
  },
  telegram: {
    enabled: toBoolean(process.env.TELEGRAM_ENABLED, false),
    botToken: process.env.BOT_TOKEN ?? '',
    chatId: process.env.CHAT_ID ?? '',
    heartbeatIntervalMs: toNumber(process.env.HEARTBEAT_INTERVAL_MS, 1800000),
  },
  uploads: {
    maxFileSize: toNumber(process.env.MAX_FILE_SIZE, 10485760),
  },
} as const

export type AppConfig = typeof config
