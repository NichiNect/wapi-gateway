import { config } from '../config/env.js'

export class TelegramService {
  private readonly enabled = config.telegram.enabled
  private readonly botToken = config.telegram.botToken
  private readonly chatId = config.telegram.chatId
  private readonly appName = config.app.name

  async sendAlert(message: string): Promise<void> {
    if (!this.enabled || !this.botToken || !this.chatId) {
      return
    }

    try {
      await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: `[${this.appName}] ${message}`,
        }),
      })
    } catch {
      return
    }
  }

  async sendHeartbeat(status: string, uptime: number): Promise<void> {
    const uptimeText = this.formatUptime(uptime)
    await this.sendAlert(`Heartbeat\nStatus: ${status}\nUptime: ${uptimeText}`)
  }

  private formatUptime(uptime: number): string {
    const hours = Math.floor(uptime / 3600)
    const minutes = Math.floor((uptime % 3600) / 60)
    return `${hours}h ${minutes}m`
  }
}
