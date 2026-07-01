declare namespace NodeJS {
  interface ProcessEnv {
    APP_PORT?: string
    APP_NAME?: string
    API_KEY?: string
    WA_AUTH_PATH?: string
    TELEGRAM_ENABLED?: string
    BOT_TOKEN?: string
    CHAT_ID?: string
    HEARTBEAT_INTERVAL_MS?: string
    MAX_FILE_SIZE?: string
  }
}
