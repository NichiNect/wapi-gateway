declare namespace NodeJS {
  interface ProcessEnv {
    APP_PORT?: string
    APP_NAME?: string
    API_KEY?: string
    WA_AUTH_PATH?: string
    WA_TYPING_DELAY?: string
    WA_TYPING_MIN_MS?: string
    WA_SEND_TIMEOUT_MS?: string
    TELEGRAM_ENABLED?: string
    BOT_TOKEN?: string
    CHAT_ID?: string
    HEARTBEAT_INTERVAL_MS?: string
    MAX_FILE_SIZE?: string
  }
}
