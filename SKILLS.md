# SKILLS.md — WhatsApp Gateway Development Guide

> Panduan teknis lengkap untuk membangun **wapi-gateway** — WhatsApp API Gateway menggunakan TypeScript + Fastify + Baileys.
> Dokumen ini berisi knowledge base, patterns, dan referensi implementasi.

---

## 1. Tech Stack

| Layer | Teknologi | Alasan |
|-------|-----------|--------|
| **Runtime** | Node.js (≥ 18 LTS) | Required oleh Baileys |
| **Language** | TypeScript 5.x | Type safety, better DX |
| **Framework** | Fastify 5.x | Lebih cepat dari Express, built-in schema validation, TypeScript-first |
| **WhatsApp** | @whiskeysockets/baileys ^6.6.0 | Unofficial WA Web multi-device protocol |
| **Logger** | Pino (built-in Fastify) | Fastify sudah include Pino secara default |
| **HTTP Client** | Built-in fetch / undici | Node 18+ sudah support native fetch |
| **Env** | dotenv / @fastify/env | Environment variable management |
| **Validator** | Fastify JSON Schema / Zod | Request validation |

---

## 2. Arsitektur Project

### Struktur Folder

```
wapi-gateway/
├── src/
│   ├── index.ts                    # Entry point
│   ├── app.ts                      # Fastify app factory
│   ├── config/
│   │   └── env.ts                  # Environment config & validation
│   ├── plugins/
│   │   ├── auth.ts                 # Bearer token auth plugin
│   │   ├── cors.ts                 # CORS configuration
│   │   └── helmet.ts               # Security headers
│   ├── services/
│   │   ├── whatsapp.service.ts     # Core WhatsApp service (Baileys)
│   │   └── telegram.service.ts     # Telegram notification service
│   ├── routes/
│   │   ├── health.route.ts         # GET /health
│   │   ├── status.route.ts         # GET /api/status/:number
│   │   ├── message.route.ts        # POST /api/message (text)
│   │   └── media.route.ts          # POST /api/media & /api/media-url
│   ├── hooks/
│   │   └── auth.hook.ts            # preHandler hook for Bearer auth
│   └── types/
│       ├── env.d.ts                # Environment type declarations
│       ├── message.types.ts        # Message request/response types
│       └── whatsapp.types.ts       # WhatsApp related types
├── auth/                           # (gitignored) Baileys auth state
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

### Architectural Pattern

```
[HTTP Request]
    │
    ▼
[Fastify Server]
    │
    ├── [Auth Hook] ── Bearer Token validation
    │
    ├── [Route Handler] ── Schema validation (JSON Schema / Zod)
    │       │
    │       ▼
    │   [WhatsApp Service] ── Singleton, manages Baileys connection
    │       │
    │       ├── sendTextMessage()
    │       ├── sendMediaMessage()
    │       ├── getStatus()
    │       └── reconnect()
    │
    └── [Telegram Service] ── Optional, monitoring notifications
            │
            ├── sendAlert()
            └── sendHeartbeat()
```

---

## 3. Baileys Knowledge Base

### 3.1 Inisialisasi Koneksi

```typescript
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  makeInMemoryStore,
  delay,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys'

import type { WASocket, ConnectionState } from '@whiskeysockets/baileys'

// Auth state disimpan sebagai multi-file di filesystem
const { state, saveCreds } = await useMultiFileAuthState('./auth/baileys_auth_info')

// Buat socket connection
const sock: WASocket = makeWASocket({
  printQRInTerminal: true,   // Print QR code ke terminal
  auth: state,
  logger: pino({ level: 'silent' }),
})

// Bind in-memory store untuk cache
const store = makeInMemoryStore({ logger: pino({ level: 'silent' }) })
store.bind(sock.ev)

// Save credentials setiap ada update
sock.ev.on('creds.update', saveCreds)
```

### 3.2 Connection Event Handling

```typescript
sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
  const { connection, lastDisconnect, qr } = update

  if (connection === 'close') {
    const statusCode = (lastDisconnect?.error as any)?.output?.statusCode
    const shouldReconnect = statusCode !== DisconnectReason.loggedOut

    if (shouldReconnect) {
      // Reconnect otomatis
      init()
    } else {
      // Logged out — hapus auth, minta QR scan ulang
      rimraf.sync('./auth/baileys_auth_info')
      init()
    }
  }

  if (connection === 'open') {
    console.log('WhatsApp connected!')
  }
})
```

### 3.3 Kirim Pesan Text

```typescript
async function sendTextMessage(number: string, text: string) {
  const jid = `${number}@s.whatsapp.net`

  // 1. Check apakah nomor terdaftar
  const [result] = await sock.onWhatsApp(jid)
  if (!result?.exists) {
    throw new Error(`Number ${number} is not registered on WhatsApp`)
  }

  // 2. Simulate typing (anti-bot detection)
  await sock.presenceSubscribe(result.jid)
  await delay(500)
  await sock.sendPresenceUpdate('composing', result.jid)
  await delay(Math.max(text.length * 10, 3000)) // min 3 detik
  await sock.sendPresenceUpdate('paused', result.jid)

  // 3. Kirim pesan
  const sentMsg = await sock.sendMessage(result.jid, { text })
  return {
    id: sentMsg?.key.id,
    status: sentMsg?.status,
  }
}
```

### 3.4 Kirim Media/Image

```typescript
import { readFile } from 'fs/promises'

// Dari file lokal
async function sendImage(number: string, imagePath: string, caption?: string) {
  const jid = `${number}@s.whatsapp.net`
  const [result] = await sock.onWhatsApp(jid)
  if (!result?.exists) throw new Error('Number not registered')

  const imageBuffer = await readFile(imagePath)

  const sentMsg = await sock.sendMessage(result.jid, {
    image: imageBuffer,
    caption: caption || '',
    mimetype: 'image/jpeg',  // atau 'image/png'
  })

  return { id: sentMsg?.key.id, status: sentMsg?.status }
}

// Dari URL
async function sendImageFromUrl(number: string, imageUrl: string, caption?: string) {
  const jid = `${number}@s.whatsapp.net`
  const [result] = await sock.onWhatsApp(jid)
  if (!result?.exists) throw new Error('Number not registered')

  const sentMsg = await sock.sendMessage(result.jid, {
    image: { url: imageUrl },
    caption: caption || '',
  })

  return { id: sentMsg?.key.id, status: sentMsg?.status }
}

// Kirim document
async function sendDocument(number: string, docPath: string, filename: string) {
  const jid = `${number}@s.whatsapp.net`
  const [result] = await sock.onWhatsApp(jid)
  if (!result?.exists) throw new Error('Number not registered')

  const docBuffer = await readFile(docPath)

  const sentMsg = await sock.sendMessage(result.jid, {
    document: docBuffer,
    mimetype: 'application/pdf', // sesuaikan
    fileName: filename,
  })

  return { id: sentMsg?.key.id, status: sentMsg?.status }
}
```

### 3.5 JID Format

| Tipe | Format | Contoh |
|------|--------|--------|
| Personal | `{number}@s.whatsapp.net` | `6281234567890@s.whatsapp.net` |
| Group | `{groupId}@g.us` | `120363xxx@g.us` |
| Broadcast | `status@broadcast` | `status@broadcast` |

> **Penting**: Nomor harus dalam format internasional TANPA `+` atau `0` di depan. Contoh: `6281234567890` bukan `081234567890`.

### 3.6 Presence (Typing Simulation)

```typescript
// Subscribe ke presence (wajib sebelum update)
await sock.presenceSubscribe(jid)

// Status options: 'composing' | 'recording' | 'paused' | 'available' | 'unavailable'
await sock.sendPresenceUpdate('composing', jid)  // "sedang mengetik..."
await sock.sendPresenceUpdate('recording', jid)  // "sedang merekam audio..."
await sock.sendPresenceUpdate('paused', jid)     // berhenti mengetik
```

**Anti-bot strategy**: Delay proporsional dengan panjang pesan sebelum kirim, minimum 3-7 detik.

---

## 4. Fastify Patterns

### 4.1 App Factory Pattern

```typescript
// src/app.ts
import Fastify, { FastifyInstance } from 'fastify'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    },
  })

  // Register plugins
  await app.register(import('@fastify/cors'), { origin: '*' })
  await app.register(import('@fastify/helmet'))

  // Register routes
  await app.register(import('./routes/health.route'), { prefix: '/health' })
  await app.register(import('./routes/status.route'), { prefix: '/api' })
  await app.register(import('./routes/message.route'), { prefix: '/api' })
  await app.register(import('./routes/media.route'), { prefix: '/api' })

  return app
}
```

### 4.2 Bearer Auth Hook

```typescript
// src/hooks/auth.hook.ts
import { FastifyRequest, FastifyReply } from 'fastify'

export async function authHook(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ success: false, message: 'Missing or invalid Authorization header' })
  }

  const token = authHeader.replace('Bearer ', '')

  if (token !== process.env.API_KEY) {
    return reply.status(401).send({ success: false, message: 'Unauthorized' })
  }
}
```

### 4.3 Route dengan Schema Validation

```typescript
// src/routes/message.route.ts
import { FastifyInstance } from 'fastify'
import { authHook } from '../hooks/auth.hook'

const sendMessageSchema = {
  body: {
    type: 'object',
    required: ['number', 'message'],
    properties: {
      number: { type: 'string', minLength: 10, maxLength: 15, pattern: '^[0-9]+$' },
      message: { type: 'string', minLength: 1, maxLength: 10000 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'number' },
          },
        },
      },
    },
  },
}

export default async function messageRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authHook)

  app.post('/message', { schema: sendMessageSchema }, async (request, reply) => {
    const { number, message } = request.body as { number: string; message: string }
    const result = await app.waService.sendTextMessage(number, message)
    return { success: true, data: result }
  })
}
```

### 4.4 Fastify Plugin untuk WhatsApp Service

```typescript
// src/plugins/whatsapp.plugin.ts
import fp from 'fastify-plugin'
import { FastifyInstance } from 'fastify'
import { WhatsAppService } from '../services/whatsapp.service'

declare module 'fastify' {
  interface FastifyInstance {
    waService: WhatsAppService
  }
}

export default fp(async (app: FastifyInstance) => {
  const waService = new WhatsAppService(app.log)
  await waService.init()

  app.decorate('waService', waService)

  app.addHook('onClose', async () => {
    waService.disconnect()
  })
})
```

---

## 5. Telegram Notification Service

### 5.1 Implementation

```typescript
// src/services/telegram.service.ts
export class TelegramService {
  private botToken: string
  private chatId: string
  private enabled: boolean
  private appName: string

  constructor() {
    this.botToken = process.env.BOT_TOKEN || ''
    this.chatId = process.env.CHAT_ID || ''
    this.enabled = process.env.TELEGRAM_ENABLED === 'true'
    this.appName = process.env.APP_NAME || 'WA Gateway'
  }

  async sendAlert(message: string): Promise<void> {
    if (!this.enabled) return

    try {
      await fetch(
        `https://api.telegram.org/bot${this.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.chatId,
            text: `[${this.appName}] ${message}`,
            parse_mode: 'HTML',
          }),
        }
      )
    } catch (err) {
      // Jangan throw — notifikasi gagal tidak boleh crash app
      console.error('Telegram notification failed:', err)
    }
  }

  // Heartbeat — dipanggil periodic via setInterval
  async sendHeartbeat(status: string, uptime: number): Promise<void> {
    const uptimeStr = this.formatUptime(uptime)
    await this.sendAlert(
      `💚 Heartbeat\nStatus: ${status}\nUptime: ${uptimeStr}`
    )
  }

  private formatUptime(seconds: number): string {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return `${h}h ${m}m`
  }
}
```

### 5.2 Notifikasi yang Dikirim

| Event | Emoji | Pesan |
|-------|-------|-------|
| Connection open | ✅ | `WhatsApp connected` |
| Connection closed | ❌ | `Connection closed: {reason}` |
| Logged out | 🚫 | `WhatsApp logged out — re-scanning QR` |
| QR scan needed | 📷 | `Please scan QR code to connect` |
| Reconnecting | 🔄 | `Reconnecting...` |
| Heartbeat (periodic) | 💚 | `Status: open, Uptime: 2h 30m` |
| Send message failed | ⚠️ | `Failed to send message to {number}` |

### 5.3 Healthcheck Monitoring Setup

```typescript
// Di WhatsApp service, start heartbeat interval
private startHeartbeat(intervalMs: number = 30 * 60 * 1000) { // 30 menit
  setInterval(async () => {
    const uptime = process.uptime()
    const status = this.isConnected() ? 'connected' : 'disconnected'
    await this.telegram.sendHeartbeat(status, uptime)
  }, intervalMs)
}
```

---

## 6. Media Endpoint Knowledge

### 6.1 Supported Media Types (Baileys)

| Type | Baileys Key | MIME Types |
|------|-------------|------------|
| Image | `image` | `image/jpeg`, `image/png`, `image/webp` |
| Video | `video` | `video/mp4` |
| Audio | `audio` | `audio/mp4`, `audio/mpeg`, `audio/ogg` |
| Document | `document` | Any (`application/pdf`, `application/xlsx`, dll) |
| Sticker | `sticker` | `image/webp` |

### 6.2 Media Input Methods

```typescript
// 1. Buffer (dari file lokal atau upload)
{ image: Buffer.from(...) }

// 2. URL (Baileys akan download sendiri)
{ image: { url: 'https://example.com/photo.jpg' } }

// 3. Stream
{ image: fs.createReadStream('./photo.jpg') }
```

### 6.3 Media Route Schema

**1. `POST /api/media` (Multipart Form-Data)**
Menggunakan `@fastify/multipart`.
Fields yang diperlukan:
- `number` (string)
- `type` (string: "image" | "video" | "audio" | "document")
- `caption` (string, opsional)
- `filename` (string, wajib jika type="document")
- `file` (binary)

**2. `POST /api/media-url` (JSON)**
```typescript
{
  "number": "6281234567890",
  "type": "image",           // "image" | "video" | "audio" | "document"
  "url": "https://...",
  "caption": "Optional",
  "filename": "file.pdf"     // Wajib untuk document
}
```

---

## 7. Environment Variables

```env
# === Server ===
APP_PORT=3000
APP_NAME="wapi-gateway"
NODE_ENV=production
LOG_LEVEL=info                    # trace | debug | info | warn | error

# === Authentication ===
API_KEY="your-secure-api-key-here"

# === WhatsApp ===
WA_AUTH_PATH="./auth/baileys_auth_info"
WA_TYPING_DELAY=true              # Enable/disable typing simulation
WA_TYPING_MIN_MS=3000             # Minimum typing delay
WA_TYPING_CHAR_MS=10              # Delay per character

# === Telegram (Optional) ===
TELEGRAM_ENABLED=false
BOT_TOKEN=""
CHAT_ID=""
HEARTBEAT_INTERVAL_MS=1800000     # 30 minutes (0 = disabled)

# === Uploads ===
MAX_FILE_SIZE=10485760            # 10MB limit
```

---

## 8. Error Handling Pattern

### Consistent Response Format

```typescript
// Success
{ "success": true, "data": { ... } }

// Error
{ "success": false, "error": { "code": "WA_NOT_CONNECTED", "message": "WhatsApp is not connected" } }
```

### Error Codes

| Code | HTTP Status | Deskripsi |
|------|-------------|-----------|
| `AUTH_MISSING` | 401 | Header Authorization tidak ada |
| `AUTH_INVALID` | 401 | Token tidak valid |
| `VALIDATION_ERROR` | 400 | Request body tidak valid |
| `WA_NOT_CONNECTED` | 503 | WhatsApp belum terkoneksi |
| `WA_NUMBER_NOT_FOUND` | 422 | Nomor tidak terdaftar di WhatsApp |
| `WA_SEND_FAILED` | 500 | Gagal mengirim pesan |
| `MEDIA_INVALID` | 400 | Media tidak valid (format/ukuran) |

---

## 9. Referensi

- **Baileys GitHub**: https://github.com/WhiskeySockets/Baileys
- **Fastify Docs**: https://fastify.dev/docs/latest/
- **Fastify TypeScript**: https://fastify.dev/docs/latest/Reference/TypeScript/
- **Telegram Bot API**: https://core.telegram.org/bots/api#sendmessage
- **Pino Logger**: https://getpino.io/

---

## 10. Catatan Penting

### Anti-Ban / Anti-Detection Tips
1. **Selalu simulasikan typing** sebelum kirim pesan
2. **Jangan kirim bulk message** terlalu cepat — tambahkan delay antar pesan
3. **Gunakan nomor WhatsApp yang sudah aktif** beberapa hari sebelum digunakan sebagai gateway
4. **Jangan kirim pesan ke nomor yang tidak menyimpan nomor gateway** terlalu sering
5. **Rate limit**: Maksimal ~200-300 pesan/hari untuk nomor baru, bisa lebih untuk nomor lama

### Baileys Gotchas
1. `onWhatsApp()` mengembalikan **array**, selalu akses `[0]`
2. Auth state bisa corrupt — handle dengan hapus folder dan re-scan QR
3. Baileys tidak officially supported — bisa break kapan saja saat WhatsApp update protocol
4. `makeInMemoryStore` menyimpan data di RAM — bisa memory leak jika banyak chat
5. QR code hanya berlaku ~60 detik — handle QR timeout gracefully
