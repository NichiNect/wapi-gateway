# wapi-gateway

> WhatsApp API Gateway — REST API untuk mengirim pesan WhatsApp (text & media) menggunakan TypeScript, Fastify, dan Baileys.

---

## 🚀 Fitur

- ✅ Kirim pesan **text** via REST API
- ✅ Kirim **media** (image, video, document) via REST API
- ✅ **Auto-reconnect** saat koneksi terputus
- ✅ **Typing simulation** — anti-bot detection
- ✅ **Bearer token** authentication (standar `Authorization: Bearer xxx`)
- ✅ **Health check** endpoint
- ✅ **Telegram monitoring** (opsional) — notifikasi status & heartbeat
- ✅ **Schema validation** — validasi request otomatis via JSON Schema
- ✅ **Security headers** via Helmet
- ✅ Built-in **Pino** structured logging

---

## 📦 Tech Stack

| Teknologi | Versi |
|-----------|-------|
| Node.js | ≥ 18 LTS |
| TypeScript | 5.x |
| Fastify | 5.x |
| @whiskeysockets/baileys | ^6.6.0 |
| Pino | Built-in (Fastify) |

---

## 📁 Struktur Project

```
wapi-gateway/
├── src/
│   ├── index.ts                    # Entry point
│   ├── app.ts                      # Fastify app factory
│   ├── config/
│   │   └── env.ts                  # Environment config & validation
│   ├── controllers/
│   │   ├── health.controller.ts    # Health endpoint handler
│   │   ├── status.controller.ts    # Status nomor handler
│   │   ├── message.controller.ts   # Send text message handler
│   │   └── media.controller.ts     # Media upload & URL handler
│   ├── hooks/
│   │   └── auth.hook.ts            # preHandler Bearer auth check
│   ├── routes/
│   │   ├── api.ts                  # Register semua route /api + auth hook
│   │   └── health.route.ts         # GET /health
│   ├── services/
│   │   ├── whatsapp.service.ts     # Core WhatsApp logic (Baileys)
│   │   └── telegram.service.ts     # Telegram Bot API client
│   └── types/
│       ├── env.d.ts                # Env type declarations
│       └── fastify.d.ts            # Fastify instance decoration types
├── auth/                           # (gitignored) WhatsApp session
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```
---

## ⚙️ Setup & Installation

### 1. Clone & Install

```bash
git clone <repo-url>
cd wapi-gateway
npm install
```

### 2. Environment Variables

Copy `.env.example` ke `.env` dan sesuaikan:

```bash
cp .env.example .env
```

```env
# === Server ===
APP_PORT=3000
APP_NAME="wapi-gateway"
NODE_ENV=development
LOG_LEVEL=info

# === Authentication ===
API_KEY="generate-a-secure-random-key-here"

# === WhatsApp ===
WA_AUTH_PATH="./auth/baileys_auth_info"
WA_TYPING_DELAY=true
WA_TYPING_MIN_MS=3000
WA_TYPING_CHAR_MS=10

# === Telegram Monitoring (Optional) ===
TELEGRAM_ENABLED=false
BOT_TOKEN=""
CHAT_ID=""
HEARTBEAT_INTERVAL_MS=1800000

# === Uploads ===
MAX_FILE_SIZE=10485760            # 10MB default limit
```

### 3. Jalankan

```bash
# Development (hot-reload)
npm run dev

# Production
npm run build
npm start
```

### 4. Scan QR Code

Saat pertama kali dijalankan, QR code akan muncul di terminal. Scan dengan WhatsApp di ponsel Anda:
1. Buka WhatsApp → Settings → Linked Devices
2. Tap "Link a Device"
3. Scan QR code di terminal

Session akan tersimpan di folder `auth/` dan tidak perlu scan ulang selama session masih valid.

---

## 📡 API Endpoints

### Health Check

```http
GET /health
```

**Response** `200`:
```json
{
  "success": true,
  "data": {
    "status": "connected",
    "user": "6281234567890:1@s.whatsapp.net",
    "uptime": 3600
  }
}
```

---

### Cek Status Nomor

```http
GET /api/status/:number
Authorization: Bearer <API_KEY>
```

**Success Response** `200`:
```json
{
  "success": true,
  "data": {
    "exists": true,
    "jid": "6281234567890@s.whatsapp.net"
  }
}
```

---

### Kirim Pesan Text

```http
POST /api/message
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

**Request Body:**
```json
{
  "number": "6281234567890",
  "message": "Halo, ini pesan dari API gateway!"
}
```

**Success Response** `200`:
```json
{
  "success": true,
  "data": {
    "id": "ABCDEF123456",
    "status": 1
  }
}
```

**Error Responses:**

| Status | Code | Pesan |
|--------|------|-------|
| `401` | `AUTH_MISSING` | Missing or invalid Authorization header |
| `401` | `AUTH_INVALID` | Unauthorized |
| `400` | `VALIDATION_ERROR` | Request body validation failed |
| `422` | `WA_NUMBER_NOT_FOUND` | Nomor tidak terdaftar di WhatsApp |
| `503` | `WA_NOT_CONNECTED` | WhatsApp is not connected |
| `500` | `WA_SEND_FAILED` | Gagal mengirim pesan |

---

### Kirim Media (Upload File)

```http
POST /api/media
Authorization: Bearer <API_KEY>
Content-Type: multipart/form-data
```

**Form Fields:**
- `number`: "6281234567890" (wajib)
- `type`: "image" | "video" | "audio" | "document" (wajib)
- `caption`: "Foto produk terbaru" (opsional)
- `filename`: "invoice.pdf" (wajib jika type="document")
- `file`: `<binary file>` (wajib)

---

### Kirim Media (via URL)

```http
POST /api/media-url
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

**Request Body:**
```json
{
  "number": "6281234567890",
  "type": "image",
  "url": "https://example.com/photo.jpg",
  "caption": "Foto produk terbaru"
}
```

**Supported Media Types:**

| Type | `type` value | Notes |
|------|-------------|-------|
| Image | `image` | JPEG, PNG, WebP |
| Video | `video` | MP4 |
| Audio | `audio` | MP3, OGG, M4A |
| Document | `document` | Any file — wajib `filename` |

**Success Response** `200`:
```json
{
  "success": true,
  "data": {
    "id": "ABCDEF789012",
    "status": 1
  }
}
```

---

## 🔐 Authentication

API menggunakan standar **Bearer Token** di header `Authorization`:

```
Authorization: Bearer your-api-key-here
```

- Semua endpoint di bawah `/api/*` memerlukan autentikasi
- Endpoint `GET /health` TIDAK memerlukan autentikasi
- API key dikonfigurasi via environment variable `API_KEY`

---

## 📲 Telegram Monitoring (Opsional)

Aktifkan monitoring via Telegram untuk menerima notifikasi:

1. Buat bot Telegram via [@BotFather](https://t.me/BotFather)
2. Dapatkan `BOT_TOKEN` dan `CHAT_ID`
3. Set `TELEGRAM_ENABLED=true` di `.env`

**Notifikasi yang dikirim:**

| Event | Emoji | Contoh |
|-------|-------|--------|
| Connected | ✅ | `WhatsApp connected` |
| Disconnected | ❌ | `Connection closed: timeout` |
| Logged out | 🚫 | `WhatsApp logged out — scanning new QR` |
| QR needed | 📷 | `Please scan QR code to connect` |
| Heartbeat | 💚 | `Status: connected, Uptime: 2h 30m` |

**Heartbeat** — periodic health report (default: setiap 30 menit). Set `HEARTBEAT_INTERVAL_MS=0` untuk disable.

---

## 📝 Format Nomor

Nomor WhatsApp harus dalam format **internasional tanpa `+`**:

| ✅ Benar | ❌ Salah |
|----------|---------|
| `6281234567890` | `081234567890` |
| `6281234567890` | `+6281234567890` |
| `6281234567890` | `81234567890` |

---

## 🛡️ Security Notes

- **Bearer Token auth** — standar `Authorization` header
- **Helmet** — security headers aktif (X-Frame-Options, CSP, dll)
- **CORS** — konfigurasikan `origin` di production (jangan wildcard `*`)
- **Schema validation** — request body divalidasi otomatis
- **Rate limiting** — pertimbangkan tambahkan `@fastify/rate-limit` untuk production
- **HTTPS** — gunakan reverse proxy (nginx/caddy) untuk TLS di production

---

## ⚠️ Limitations & Disclaimer

- Project ini menggunakan **unofficial WhatsApp API** (Baileys). Penggunaan ini tidak didukung secara resmi oleh WhatsApp/Meta.
- WhatsApp bisa **memblokir nomor** yang terdeteksi mengirim pesan massal atau spam.
- **Baileys bisa break** kapan saja ketika WhatsApp mengubah protokol mereka.
- Untuk penggunaan bisnis resmi, pertimbangkan **WhatsApp Business API** dari Meta.
- Tidak support multi-session (1 instance = 1 nomor WhatsApp).

---

## 📄 License

ISC
