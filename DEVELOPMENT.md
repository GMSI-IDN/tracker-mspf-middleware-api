# Development Guide

## Project Overview

API Gateway yang menggabungkan data dari 2 server GPS — **Traccar** dan **MSPF** — menjadi 1 API endpoint untuk Frontend.

> Baca `readme.md` untuk spesifikasi arsitektur lengkap.
> Baca `USER_GUIDE.md` untuk panduan dari sisi user.

---

## Project Structure

```
middleware-api-gps/
├── src/                    # Source code (akan dibuat)
│   ├── config/             # Konfigurasi (env, constants)
│   ├── middleware/          # Express middleware (auth, logging, etc)
│   ├── routes/             # Route handlers
│   ├── services/           # Business logic (Traccar, MSPF, Gateway)
│   ├── utils/              # Helper functions
│   └── app.js              # Express app entry point
├── mspf.yml                # MSPF OpenAPI spec (referensi)
├── traccar.yaml            # Traccar OpenAPI spec (referensi)
├── readme.md               # Spesifikasi arsitektur teknis
├── USER_GUIDE.md           # Panduan untuk end user
├── AGENTS.md               # Instruksi untuk AI coding assistant
└── DEVELOPMENT.md          # Panduan development ini
```

---

## Setup & Running

*(Akan diisi setelah implementasi dimulai)*

```bash
# Install dependencies
npm install

# Copy environment
cp .env.example .env

# Run development
npm run dev

# Run production
npm start
```

---

## Key Libraries

| Library | Versi | Kegunaan |
|---------|-------|----------|
| Express.js | ^4.18 | Web framework |
| Axios | ^1.5 | HTTP client ke Traccar & MSPF |
| jsonwebtoken | ^9.0 | JWT auth |
| bcryptjs | ^2.4 | Password hashing |
| Socket.io | ^4.x | WebSocket server |
| Node-Cache | ^5.x | In-memory cache (dev) |
| dotenv | ^16.3 | Env config |
| Morgan + Winston | - | Logging |
| Helmet | ^7.0 | Security headers |
| cors | ^2.8 | CORS |

---

## API Reference Points

| Endpoint | Backend Source |
|----------|---------------|
| `GET /api/groups` | Traccar `GET /groups` + MSPF `GET /v2/bc` |
| `GET /api/devices` | Traccar `GET /devices` + MSPF `GET /v3/devices` |
| `GET /api/positions` | Traccar `GET /positions` + MSPF `GET /v3/devices/positions` / `GET /v3/devices/{id}/route` |
| `POST /api/commands` | Traccar `POST /commands/send` |
| `PUT /api/devices/:id/activation` | MSPF `PUT /v3/devices/{id}/activation` |


## Catatan Penting

- **Tidak ada prefix ID** — Device ID adalah integer, routing via group/BC atau device→source mapping di cache
- **Gateway readonly untuk tracking** — Hanya activation (mematikan kendaraan) yang write ke MSPF
- **Filter akses di sisi Gateway** — Customer hanya lihat device di Group/BC yang di-assign
- **Selalu cek dokumentasi library via Context7 MCP** sebelum implementasi
