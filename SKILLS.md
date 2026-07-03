# SKILLS.md - WhatsApp Gateway Development Guide

> Panduan teknis utama untuk membangun `wapi-gateway` dengan TypeScript, Fastify, dan Baileys.
> Dokumen ini mengikuti struktur project aktual: `controllers + routes/api.ts + services`.

---

## 1. Tech Stack

| Layer | Teknologi | Catatan |
|-------|-----------|---------|
| Runtime | Node.js >= 18 | Cocok untuk native `fetch` dan Baileys |
| Language | TypeScript 5.x | Strict typing |
| Framework | Fastify 5.x | Cepat, schema-first, TS-friendly |
| WhatsApp | `@whiskeysockets/baileys` ^6.6.0 | Unofficial WA Web multi-device |
| Logger | Pino | Built-in Fastify logger |
| Multipart | `@fastify/multipart` | Upload media |
| Security | `@fastify/helmet`, `@fastify/cors` | Header dan CORS |
| Env Loader | `dotenv` | Load `.env` |

---

## 2. Arsitektur Project

### Struktur Folder

```text
wapi-gateway/
+-- src/
¦   +-- index.ts                    # Entry point
¦   +-- app.ts                      # Fastify app factory
¦   +-- config/
¦   ¦   +-- env.ts                  # Environment config & validation
¦   +-- controllers/
¦   ¦   +-- health.controller.ts    # Health endpoint handler
¦   ¦   +-- status.controller.ts    # Status nomor handler
¦   ¦   +-- message.controller.ts   # Send text message handler
¦   ¦   +-- media.controller.ts     # Media upload & URL handler
¦   +-- hooks/
¦   ¦   +-- auth.hook.ts            # Bearer auth hook untuk grup /api
¦   +-- routes/
¦   ¦   +-- api.ts                  # Register semua route /api + auth hook
¦   ¦   +-- health.route.ts         # GET /health
¦   +-- services/
¦   ¦   +-- whatsapp.service.ts     # Core WhatsApp service (Baileys)
¦   ¦   +-- telegram.service.ts     # Telegram notification service
¦   +-- types/
¦       +-- env.d.ts                # Env type declarations
¦       +-- fastify.d.ts            # Fastify instance decoration types
+-- auth/                           # Baileys auth state
+-- .env.example
+-- package.json
+-- tsconfig.json
+-- README.md
```

### Architectural Pattern

```text
[HTTP Request]
    |
    v
[Fastify Route]
    |
    +-- [Route Group /api] -> authHook
    |
    +-- [Controller] -> validasi input + format response
    |
    +-- [WhatsAppService] -> koneksi Baileys + send/check status
    |
    +-- [TelegramService] -> alert opsional
```

### Routing Convention

- `GET /health` diregister di `src/routes/health.route.ts` tanpa auth.
- Semua endpoint `/api/*` diregister terpusat di `src/routes/api.ts`, termasuk endpoint logout sesi.
- Middleware `authHook` dipasang sekali di `routes/api.ts` pada level group.
- Logic handler dipindah ke folder `src/controllers`.

---

## 3. Response Contract

### Success Format

```json
{ "success": true, "data": { } }
```

### Error Format

```json
{ "success": false, "error": { "code": "SOME_CODE", "message": "Some message" } }
```

### Error Codes

| Code | HTTP Status | Deskripsi |
|------|-------------|-----------|
| `AUTH_INVALID` | 401 | Header/token bearer tidak valid |
| `VALIDATION_ERROR` | 400 | Request tidak valid |
| `MEDIA_INVALID` | 400 | Media/file/field tidak valid |
| `WA_NUMBER_NOT_FOUND` | 422 | Nomor tidak terdaftar di WhatsApp |
| `WA_NOT_CONNECTED` | 503 | Koneksi WhatsApp belum siap |
| `WA_SEND_FAILED` | 500 | Gagal mengirim pesan/media |

---

## 4. Fastify Patterns

### 4.1 App Factory Pattern

```typescript
// src/app.ts
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import Fastify from 'fastify'
import { config } from './config/env.js'
import apiRoute from './routes/api.js'
import healthRoute from './routes/health.route.js'
import { WhatsAppService } from './services/whatsapp.service.js'

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
  })

  await app.register(cors, { origin: true })
  await app.register(helmet)
  await app.register(multipart, {
    limits: {
      fileSize: config.uploads.maxFileSize,
    },
  })

  const waService = new WhatsAppService()
  await waService.init()
  app.decorate('waService', waService)

  await app.register(healthRoute)
  await app.register(apiRoute, { prefix: '/api' })

  app.addHook('onClose', async () => {
    await app.waService.disconnect()
  })

  return app
}
```

### 4.2 Bearer Auth Hook

```typescript
// src/hooks/auth.hook.ts
import type { FastifyReply, FastifyRequest } from 'fastify'
import { config } from '../config/env.js'

export async function authHook(request: FastifyRequest, reply: FastifyReply) {
  const authorization = request.headers.authorization

  if (!authorization?.startsWith('Bearer ')) {
    return reply.status(401).send({
      success: false,
      error: {
        code: 'AUTH_INVALID',
        message: 'Unauthorized',
      },
    })
  }

  const token = authorization.slice('Bearer '.length).trim()

  if (!token || token !== config.auth.apiKey) {
    return reply.status(401).send({
      success: false,
      error: {
        code: 'AUTH_INVALID',
        message: 'Unauthorized',
      },
    })
  }
}
```

### 4.3 API Group Route Pattern

```typescript
// src/routes/api.ts
import type { FastifyPluginAsync } from 'fastify'
import { messageController } from '../controllers/message.controller.js'
import { authHook } from '../hooks/auth.hook.js'

const messageBodySchema = {
  type: 'object',
  required: ['number', 'message'],
  properties: {
    number: { type: 'string', minLength: 10, maxLength: 15, pattern: '^[0-9]+$' },
    message: { type: 'string', minLength: 1 },
  },
} as const

const apiRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authHook)

  app.post('/message', {
    schema: {
      body: messageBodySchema,
    },
  }, messageController)
}

export default apiRoute
```

---

## 5. Baileys Service Patterns

### 5.1 Inisialisasi Koneksi

- Gunakan `useMultiFileAuthState(config.whatsapp.authPath)`.
- Gunakan `makeWASocket({ printQRInTerminal: true, auth: state })`.
- Simpan kredensial melalui event `creds.update`.
- Handle `connection.update` untuk:
  - kirim alert Telegram saat QR muncul
  - set status `connected` saat `open`
  - reconnect saat `close` dan bukan shutdown
  - hapus folder auth saat `DisconnectReason.loggedOut`

### 5.2 Validasi Nomor

```typescript
const jid = `${number}@s.whatsapp.net`
const [result] = await sock.onWhatsApp(jid)
```

- `onWhatsApp()` mengembalikan array.
- Jika `result.exists !== true`, lempar error `Number is not registered on WhatsApp`.

### 5.3 Send Text Pattern

```typescript
await sock.presenceSubscribe(jid)
await sock.sendPresenceUpdate('composing', jid)
await delay(3000)
await sock.sendMessage(jid, { text })
```

### 5.4 Send Media Pattern

Supported `type`:
- `image`
- `video`
- `audio`
- `document`

Input method:
- Buffer: untuk upload multipart
- URL: untuk endpoint `media-url`

Untuk `document`, `filename` wajib ada.

---

## 6. Controller Responsibilities

### health.controller.ts
- Return `process.uptime()`.
- Return status dari `request.server.waService.getConnectionStatus()`.
- Tidak memakai auth.

### status.controller.ts
- Ambil `number` dari route params.
- Panggil `isNumberRegistered(number)`.
- Return `{ exists: true, jid }` saat sukses.
- Mapping error ke `422`, `503`, atau `500`.

### message.controller.ts
- Ambil `number` dan `message` dari body.
- Panggil `sendText(number, message)`.
- Mapping error konsisten ke response contract.

### media.controller.ts
- mediaUrlController() untuk body JSON.
- mediaUploadController() untuk multipart.
- Validasi 	ype, 
umber, dan ilename untuk document.
- Ubah file upload menjadi Buffer sebelum dikirim ke service.

### logout.controller.ts
- Panggil logoutAndClearAuth() dari service.
- Return status sukses setelah sesi logout dan auth state dihapus.

---

## 7. Environment Variables

```env
APP_PORT=3000
APP_NAME="wapi-gateway"
API_KEY="your-secure-api-key-here"
WA_AUTH_PATH="./auth/baileys_auth_info"
TELEGRAM_ENABLED=false
BOT_TOKEN=""
CHAT_ID=""
HEARTBEAT_INTERVAL_MS=1800000
MAX_FILE_SIZE=10485760
```

---

## 8. Nomor WhatsApp

- Format wajib internasional tanpa `+`.
- Contoh benar: `6281234567890`
- Contoh salah: `081234567890`, `+6281234567890`

JID personal selalu berbentuk:

```text
{number}@s.whatsapp.net
```

---

## 9. Catatan Implementasi

- Gunakan `import`, bukan `require`.
- Semua route wajib dalam Fastify plugin.
- Semua response wajib mengikuti success/error contract.
- Jangan crash app jika Telegram gagal mengirim notifikasi.
- Graceful shutdown harus memanggil `waService.disconnect()`.
- `routes/api.ts` adalah satu-satunya entry register untuk endpoint API terautentikasi.

