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

- **Tidak ada prefix ID** — Device ID adalah integer, routing via group/BC atau device→source mapping di cache
- **Gateway readonly untuk tracking** — Hanya activation (mematikan kendaraan) yang write ke MSPF
- **Filter akses di sisi Gateway** — Customer hanya lihat device di Group/BC yang di-assign
- **Selalu cek dokumentasi library via Context7 MCP** sebelum implementasi
