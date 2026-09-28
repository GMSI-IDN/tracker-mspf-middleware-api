# Development Guide

## Project Overview

API Gateway yang menggabungkan data dari 3 server GPS — **Traccar**, **MSPF**, dan **FoxLogger** — menjadi 1 API endpoint terpadu untuk Frontend.

> Baca `readme.md` untuk spesifikasi arsitektur lengkap.
> Baca `USER_GUIDE.md` untuk panduan dari sisi user.
> Baca `load-tests/PLAYBOOK.md` untuk panduan load testing dan optimalisasi performa.

---

## Project Structure

```
tracker-mspf-middleware-api/
├── src/                    # Source code
│   ├── config/             # Konfigurasi (env, constants, driver DB)
│   ├── db/                 # Knex connection & query builder
│   ├── middleware/         # Express middleware (auth, rateLimiter, error, logging)
│   ├── routes/             # Route handlers (devices, positions, reports, commands, dsb)
│   ├── scripts/            # Migration & seed runner
│   ├── services/           # Business logic (traccar, mspf, foxlogger, cache, positionSync)
│   ├── utils/              # Helper functions (guardedJob, sanitizer, engineControl, dsb)
│   ├── websocket/          # Socket.io server & event emitters
│   ├── app.js              # Express app definition
│   └── server.js           # Server bootstrap & background workers initialization
├── load-tests/             # Load testing harness & mock upstream
│   ├── mock-upstream/      # Mock server Traccar, MSPF, FoxLogger lokal
│   ├── scripts/            # Script skenario Artillery, WebSocket runner, & preflight check
│   ├── results/            # Laporan hasil uji beban lokal (gitignored)
│   ├── PLAYBOOK.md         # Playbook & SOP load testing
│   ├── HANDOFF.md          # Dokumen serah terima teknis
│   └── README.md           # Panduan eksekusi load test
├── migrations/             # Knex append-only migration files
├── mspf.yml                # MSPF OpenAPI spec (referensi)
├── traccar.yaml            # Traccar OpenAPI spec (referensi)
├── readme.md               # Spesifikasi arsitektur teknis
├── USER_GUIDE.md           # Panduan untuk end user
├── AGENTS.md               # Instruksi untuk AI coding assistant
└── DEVELOPMENT.md          # Panduan development ini
```

---

## Setup & Running

```bash
# Install dependencies
npm install

# Copy environment
cp .env.example .env

# Jalankan migrasi database
npm run migrate

# (Opsional) Jalankan seeding awal data admin & dummy
npm run seed

# Run development
npm run dev

# Run production
npm start

# Menjalankan unit & integration tests (selalu gunakan batas waktu)
timeout 300 npm test

# Menjalankan test dengan pelacak open handle jika menggantung
timeout 300 npx jest --detectOpenHandles --forceExit
```

---

## Key Libraries

| Library | Versi | Kegunaan |
|---------|-------|----------|
| Express.js | ^5.x | Web framework |
| Axios | ^1.x | HTTP client ke Traccar, MSPF, FoxLogger (timeout 10s pada sync path) |
| jsonwebtoken | ^9.0 | JWT auth |
| bcryptjs | ^2.4 | Password hashing |
| Socket.io | ^4.x | WebSocket server real-time position & status stream |
| Node-Cache | ^5.x | In-memory cache (`useClones: false`, deepFreeze saat testing) |
| Knex | ^3.x | Query builder & schema migration (SQLite dev, PostgreSQL prod) |
| pg | ^8.x | PostgreSQL driver (BIGINT support) |
| dotenv | ^16.x | Env configuration |
| Winston | ^3.x | Structured JSON logger |
| Helmet | ^7.x | Security headers |
| cors | ^2.8 | CORS middleware |
| express-rate-limit | ^8.x | Rate limiting API |

---

## API Reference Points

| Endpoint | Backend Source / Mekanisme |
|----------|---------------------------|
| `GET /api/groups` | Traccar `GET /groups` + MSPF `GET /v2/bc` + Custom Groups DB |
| `GET /api/devices` | In-memory cache `devices:merged` (Traccar, MSPF, FoxLogger) |
| `GET /api/positions` | In-memory cache `positions:merged` (diperbarui worker tiap 10s) |
| `POST /api/commands` | Traccar `POST /commands/send` & MSPF `PUT /activation` |
| `PUT /api/devices/:id/activation` | MSPF `PUT /v3/devices/{id}/activation` |
| `GET /api/reports/*` | Route playback, summary, events, parking, idle, trips |
| `GET /api/admin/device-groups` | Relasi manual device ke custom group (`deviceName` format) |
| `GET /health` & `/health/detailed` | Status sistem & upstream (Traccar, MSPF, FoxLogger) |

---

## Background Workers & Upstream Decoupling

Untuk mencegah blocking pada event loop dan memastikan respon instan pada request client:

1. **`positionSync` Worker:**
   - Berjalan berkala setiap 10 detik.
   - Dibungkus dengan `guardedJob` (token kepemilikan `Symbol` dan watchdog 180 detik).
   - Memanggil endpoint positions Traccar, MSPF, dan FoxLogger dengan batas timeout request **10 detik**.
   - Menyimpan hasil ke in-memory cache `positions:merged` (TTL 30 detik) dan memancarkan event WebSocket (`position`, `device-status`).
2. **`MccsWorker` Background Worker (MSPF):**
   - Didecouple sepenuhnya dari jalur kritis sinkronisasi posisi.
   - Menyimpan data telemetri tambahan MCCS ke dalam persistent `Map` store (`mccsStore`).
   - Melakukan rotasi batch secara mandiri.
   - **Jeda Otomatis:** Perangkat yang mengembalikan data kosong (`empty_data` karena unit pasif 90–367 hari) secara otomatis dijeda selama **25–35 menit** dari rotasi worker.
   - **Reaktivasi Dinamis:** Jika unit yang dijeda mengirimkan `deviceTime` baru saat posisi sync, unit tersebut langsung diaktifkan kembali ke antrean prioritas (maksimal 1 kali per masa jeda).
3. **Pengukuran Waktu & Jam Monoton:**
   - Seluruh durasi, timeout, dan interval jeda diukur menggunakan `performance.now()` dengan sentinel awal bernilai `null` agar kebal terhadap pergeseran jam sistem (NTP sync/WSL2 drift).

---

## Load Testing & Safety Harness (`load-tests/`)

Proyek menyediakan harness pengujian beban mandiri di folder `load-tests/`:
- **Mock Upstream:** Server mock lokal (`load-tests/mock-upstream/server.js`) mensimulasikan armada ~1.200 unit kendaraan.
- **Safety Preflight (`load-tests/scripts/preflight.js`):** Membatalkan eksekusi secara otomatis jika mendeteksi URL non-localhost demi keselamatan server produksi dan staging pihak ketiga.
- **Isolasi Docker:** `docker-compose.loadtest.yml` menyediakan container dengan batas resource terukur (2 vCPU, 2GB RAM).
- Panduan lengkap eksekusi dan analisis beban tersedia di `load-tests/PLAYBOOK.md` dan `load-tests/README.md`.

---

## Database Migrations & Deployment (Knex + Docker CI/CD)

### 1. Prinsip Append-Only (DILARANG MENGEDIT FILE MIGRASI LAMA)
- Seluruh file di folder `migrations/` adalah **catatan sejarah permanen (immutable)**.
- Di database server (baik SQLite maupun PostgreSQL), Knex melacak riwayat file yang sudah dijalankan di tabel sistem **`knex_migrations`**.
- **Mengapa file lama tidak boleh diedit?**
  - Saat deploy via GitHub Actions, Knex memeriksa tabel `knex_migrations`.
  - Jika nama file migrasi sudah tercatat di tabel tersebut, Knex akan **MELEWATKAN (SKIP)** file tersebut.
  - Perubahan yang Anda ketik pada file lama **TIDAK AKAN PERNAH DIJALANKAN** di server production, menyebabkan perbedaan skema (*schema drift*) yang fatal antara lokal dan production.
- **Aturan:** Setiap ada kebutuhan mengubah skema (tambah tabel, tambah kolom, ubah tipe kolom, tambah index), **SELALU BUAT FILE MIGRASI BARU** (contoh: `migrations/YYYYMMDD_deskripsi.js`).

### 2. Alur Eksekusi di GitHub Actions & Docker
Workflow deploy di `.github/workflows/ci-cd.yml` berjalan secara terisolasi dan aman:
1. GitHub Actions mem-build image Docker dan push ke GHCR.
2. Di server, sebelum container aplikasi dinyalakan, GitHub Actions menjalankan container migrasi sementara:
   ```bash
   docker run --rm ... "$IMAGE:$IMAGE_TAG" node src/scripts/migrate.js
   ```
3. Knex membaca tabel `knex_migrations`, lalu mengeksekusi hanya file-file migrasi baru yang belum pernah tercatat.
4. Container migrasi selesai dan otomatis dihapus (`--rm`).
5. Container aplikasi utama dijalankan (`docker compose up -d`).

### 3. Panduan Membuat File Migrasi Baru yang Aman
- **Menambah Kolom pada Tabel yang Sudah Memiliki Data:**
  Wajib menyertakan `.defaultTo(...)` atau `.nullable()`. Jangan membuat `.notNullable()` tanpa default value pada tabel yang sudah terisi data.
- **Mengubah Tipe Kolom (Misal TEXT ke DECIMAL):**
  Gunakan klausa SQL type casting yang aman (misal `USING (kolom::DECIMAL(10,2))` di PostgreSQL) dan bersihkan data kosong sebelum konversi.
- **Rollback Function:**
  Selalu implementasikan `exports.down = async function (knex) { ... }` agar migrasi dapat di-rollback jika diperlukan.

---

## Catatan Penting

- **Immutabilitas Cache (`useClones: false`)** — Pembacaan cache tidak meng-clone objek. DILARANG memutasi objek atau array hasil `cache.get()`. Selalu buat shallow-copy sebelum memodifikasi data.
- **Background Worker & Guard** — Semua worker berkala wajib dibungkus `guardedJob` dengan token kepemilikan dan watchdog.
- **Pengukuran Waktu** — Gunakan `performance.now()` untuk durasi, timeout, dan jeda (dengan sentinel `null`). Hindari `Date.now()` untuk timing.
- **Tidak ada prefix ID** — Device ID adalah integer, routing via group/BC atau device→source mapping di cache.
- **Gateway readonly untuk tracking** — Hanya activation (mematikan kendaraan) yang write ke MSPF.
- **Filter akses di sisi Gateway** — Customer hanya lihat device di Group/BC yang di-assign.
- **Selalu jalankan test dengan batas waktu** — Gunakan `timeout 300 npm test` dan deteksi open handle bila perlu.
- **Selalu cek dokumentasi library via Context7 MCP** sebelum implementasi.
