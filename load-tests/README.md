# Load Testing — API Gateway Unified GPS

Dokumentasi, panduan eksekusi, dan profil pengujian beban (*load & stress testing*) untuk backend `tracker-mspf-middleware-api`.

---

## Profil Aplikasi

Berdasarkan analisis kode sumber (`src/`) dan konfigurasi environment aktual (`.env`):

| Parameter | Konfigurasi Aktual | Catatan Teknis / Arsitektur |
| :--- | :--- | :--- |
| **Runtime & Bahasa** | Node.js `v24.15.0` (CommonJS), Express `v5.2.1` | Single-threaded event loop, non-blocking I/O. |
| **Database Driver** | `pg` (PostgreSQL) | Knex connection pool aktif (`min: 2, max: 10`). Database berada di *critical path* autentikasi (`users.is_active`, `users.token_version`), filtering RBAC customer (`device_groups`), dan custom attributes. Wajib menggunakan PostgreSQL yang identik dengan production (bukan SQLite) saat load test. |
| **Upstream GPS Services** | 1. **Traccar** (`TRACCAR_URL`)<br>2. **MSPF** (`MSPF_URL`)<br>3. **FoxLogger** (`api-auth` & `api-v2.foxlogger.app`) | • Traccar: Basic Auth.<br>• MSPF: OAuth2 Client Credentials (`/v1/oauth2/token`).<br>• FoxLogger: Basic Auth $\to$ JWT Bearer token.<br>Semua upstream **WAJIB** digantikan oleh Mock Server lokal saat pengujian. |
| **HTTP Client & Keep-Alive** | `axios` `v1.18.0` tanpa custom `httpAgent`/`httpsAgent` | Pada Node.js v24.15.0, `http.globalAgent.keepAlive` bernilai `true` secara default dengan `maxSockets: Infinity` dan `maxFreeSockets: 256`. Namun, connection reuse antar request upstream tetap bergantung pada pooling agent bawaan dan perilaku mock server. |
| **Request Timeout** | `REQUEST_TIMEOUT=30000` (30 detik) | Batas waktu tunggu request HTTP ke upstream sebelum abort. |
| **In-Memory Caching** | `node-cache` (`CACHE_PROVIDER=node-cache`, `useClones: false`) | • `devices:merged`: TTL 120 detik (`CACHE_DEVICE_TTL=120`).<br>• `positions:merged`: TTL 30 detik (diperbarui worker tiap 10s).<br>• `mccsStore`: Persistent in-memory `Map` (didecouple ke `MccsWorker` mandiri dengan jeda unit pasif).<br>• `useClones: false`: Menghilangkan 81% CPU overhead deep clone. Objek cache bersifat immutable.<br>• `CACHE_FREEZE=1`: Mengaktifkan deep freeze otomatis saat tes. |
| **Rate Limiter** | `express-rate-limit` `v8.5.2` | • `RATE_LIMIT_WINDOW_MS=60000` (1 menit).<br>• `RATE_LIMIT_MAX=500` request / window (global).<br>• `RATE_LIMIT_AUTH_MAX=20` request / window (login endpoint). |
| **Logging Level** | `LOG_LEVEL=info` (Winston + Morgan) | **Baseline Requirement:** `LOG_LEVEL` tidak diturunkan ke silent/error pada baseline load test agar mengukur performa riil sistem beserta beban I/O logging produksi. |
| **Background Sync & Workers** | `positionSync.js` & `MccsWorker` (`mspf.js`) | • `positionSync`: Berjalan tiap 10s dibungkus `guardedJob` (watchdog 180s, timeout request upstream 10s).<br>• `MccsWorker`: Worker latar belakang mandiri untuk rotasi telemetri MCCS, jeda 25–35 menit untuk unit `empty_data` (pasif 90–367 hari), reaktivasi dinamis maks 1x per masa jeda.<br>• Pengukuran waktu menggunakan jam monoton `performance.now()`. |
| **Kapasitas Target Device** | **~1.200 Device** | Berdasarkan data produksi: MSPF (~1.109 unit WORKING), Traccar (~90 unit), FoxLogger (~1 unit). Mock server menyimulasikan armada dengan jumlah tersebut agar beban serialisasi memori dan pencocokan cache valid. |

---

## Catatan Lingkungan Pengujian (WSL2 vs Production)

Penting untuk memahami perbedaan mendasar antara lingkungan pengetesan lokal dan lingkungan server produksi asli:

1. **Filesystem WSL2 (`/mnt/e`) vs Server Linux Asli (ext4):**
   - Pengetesan lokal ini dijalankan di dalam WSL2 dengan direktori proyek berada di `/mnt/e` (drive NTFS Windows yang dimount melalui protokol 9P/drvfs).
   - Akibat tingginya latensi I/O pembacaan metadata (*file stat*) ribuan file kecil di folder `node_modules` pada drive Windows mount, fase awal **Node bootstrap & require modules** memakan waktu **~25,5 detik**.
   - Di server staging/production (Linux native ext4/SSD di dalam container Docker), pemuatan seluruh modul aplikasi hanya memakan waktu **< 1–2 detik**.
2. **Karakteristik Mock Upstream vs Server Upstream Asli:**
   - **Mock Upstream:** Berjalan secara lokal di port 4000. Siklus sinkronisasi awal posisi (`initial sync`) selesai dalam waktu **~2,3 detik**.
   - **Upstream MSPF Asli (Staging):** Worker `mspf.js` memanggil `GET /v2/device/:id/data/history` dalam batch 10 secara serial untuk seluruh ~1.000 device aktif yang belum ter-cache di `mccsCache`. Mengingat setiap panggilan melewati internet publik (WAN), 100 batch $\times$ ~550 ms menghasilkan waktu sinkronisasi awal hingga **~57 detik** (14:46:41 $\to$ 14:47:38). Hasil lokal mencerminkan kapasitas komputasi murni middleware tanpa penalti latensi WAN pihak ketiga.

---

## Tool Load Test yang Dipilih

Sesuai aturan `skill.md` (Node.js ecosystem & larangan k6):
- **HTTP Load Testing:** **Artillery** (`artillery`) dengan plugin `artillery-plugin-ensure` (untuk assertions p95, p99, dan error rate).
- **WebSocket Concurrency & Hybrid Testing:** Custom runner Node.js berbasis **`socket.io-client`** (`ws-load-runner.js`, `run-ws-suite.js`, `run-c5-storm.js`, `soak-test.js`) untuk mengukur handshake latency, fan-out delivery, cycle time, memory footprint, dan thundering herd reconnect.

---

## Struktur Folder `load-tests/`

```
load-tests/
├── mock-upstream/
│   └── server.js               # Mock server Traccar (90), MSPF (1.109), FoxLogger (1)
├── scripts/
│   ├── preflight.js            # SAFETY GATE: Batalkan tes jika mendeteksi URL non-lokal
│   ├── generate-tokens.js      # Generator JWT token admin & customer -> tokens.csv
│   ├── seed-realistic-groups.js# Seed relasi grup & user realistis untuk benchmark
│   ├── run-test.js             # Runner otomatis Artillery (Preflight -> Token -> Report)
│   ├── smoke.yml               # Skenario HTTP 1-2 VU, 30s (sanity check)
│   ├── load.yml                # Skenario HTTP sustained target load (5 menit, 25 RPS)
│   ├── stress.yml              # Skenario HTTP bertahap (50 -> 100 -> 200 -> 400 -> 800 RPS)
│   ├── devices-only.yml        # Skenario isolasi endpoint /api/devices
│   ├── positions-only.yml      # Skenario isolasi endpoint /api/positions
│   ├── run-improved-baseline.js# Script pengujian baseline Jalur A bertahap
│   ├── run-ws-suite.js         # Orkestrator rangkaian tes WebSocket (C1 - C4)
│   ├── run-ws-tier.js          # Runner uji tangga koneksi WebSocket per tier
│   ├── ws-load-runner.js       # Worker thread simulasi client socket.io
│   ├── ws-users.json           # Fixture kredensial user untuk WebSocket runner
│   ├── run-c5-storm.js         # Skenario reconnect storm (thundering herd)
│   ├── run-c5a-tiered.js       # Runner bertingkat thundering herd reconnect
│   ├── c5b-integrity-reconnect.js # Uji kelengkapan data posisi pasca-reconnect
│   ├── test-c5b-position-completeness.js # Verifikasi integritas armada setelah restart
│   ├── soak-test.js            # Skenario soak test durasi panjang (15-45 menit)
│   ├── profile-endpoints.js    # Pengambil CPU profile (node --cpu-prof)
│   ├── analyze-profile.js      # Analisis flamegraph & pembagian waktu CPU
│   ├── prove-mccs-coverage.js  # Uji pembuktian rotasi & cakupan worker MCCS
│   ├── prove-mccs-delay-position-sync.js # Simulasi dampak latensi MCCS ke positionSync
│   ├── prove-overlapping-sync.js # Uji pembuktian risiko sync bertumpuk tanpa guard
│   ├── prove-window-zero.js    # Simulasi jendela 0 kendaraan saat cache kedaluwarsa
│   ├── test-cache-leak.js      # Uji kebocoran mutasi cache antar-request
│   ├── test-sync-guard.js      # Uji pembuktian ketahanan guardedJob watchdog
│   └── start-server.js         # Helper pemula server middleware terisolasi
├── results/                    # Output file JSON & HTML hasil tes (masuk .gitignore)
├── CATATAN_IMPROVISASI.md      # Rekomendasi teknis & evaluasi performa hasil profiling
├── HANDOFF.md                  # Status teknis & handoff antar-sesi pengembang
├── PLAYBOOK.md                 # SOP dan urutan kerja load test middleware
├── README.md                   # Dokumentasi ini
└── docker-compose.loadtest.yml # Lingkungan pengujian terisolasi (CPU: 2, RAM: 2G)
```

---

## Aturan Keselamatan & Preflight Check

Setiap kali skrip pengujian dijalankan, runner secara otomatis memanggil **`load-tests/scripts/preflight.js`**:
1. Memastikan target request adalah `localhost`, `127.0.0.1`, atau container lokal.
2. Memeriksa `TRACCAR_URL`, `MSPF_URL`, dan variabel upstream lainnya. Jika mengandung domain pihak ketiga (`fleet-management-system.co.id`, `cloud-gms.com`, `foxlogger.app`), **tes DIBATALKAN SEKETIKA (Exit 1)**.
3. Memastikan Mock Upstream aktif di `http://127.0.0.1:4000/health` dan middleware aktif di `http://127.0.0.1:3000/health`.
4. Mengecek batas open file descriptors (`ulimit -n`).

---

## Cara Menjalankan Pengujian (Jalur A)

### Opsi 1: Menjalankan Secara Lokal (Node.js)

**Langkah 1: Jalankan Mock Upstream Server (Terminal 1)**
```bash
node load-tests/mock-upstream/server.js
```
*Mock server akan berjalan di port 4000 melayani 1.200 unit synthetic devices.*

**Langkah 2: Siapkan Lingkungan Middleware (.env.loadtest)**
Buat file `.env.loadtest` (atau salin dari `.env`) dan pastikan URL diarahkan ke mock:
```env
TRACCAR_URL=http://127.0.0.1:4000/traccar/api
TRACCAR_USERNAME=mockadmin
TRACCAR_PASSWORD=mockpassword

MSPF_URL=http://127.0.0.1:4000/mspf/api
MSPF_CLIENT_ID=mock_id
MSPF_CLIENT_SECRET=mock_secret
MSPF_TOKEN_URL=http://127.0.0.1:4000/mspf/v1/oauth2/token

FOXLOGGER_EMAIL=
FOXLOGGER_PASSWORD=

# Database PostgreSQL yang sama dengan production
DB_DRIVER=pg
DB_HOST=localhost
DB_PORT=5432
DB_NAME=gateway
DB_USER=postgres
DB_PASS=postgrespassword

LOG_LEVEL=info
RATE_LIMIT_MAX=50000
```

**Langkah 3: Jalankan Middleware API (Terminal 2)**
```bash
node src/server.js
```

**Langkah 4: Jalankan Skenario Tes (Terminal 3)**
Gunakan runner otomatis yang sudah mencakup preflight check:
```bash
# Skenario Smoke (1-2 VU, 30 detik untuk sanity test)
node load-tests/scripts/run-test.js smoke

# Skenario Load (Sustained load 5 menit)
node load-tests/scripts/run-test.js load

# Skenario Stress (Mencari titik jenuh & kapasitas max)
node load-tests/scripts/run-test.js stress
```

---

### Opsi 2: Menjalankan Lewat Docker Compose (Sesuai SOP Resource Limits)

Menjalankan Middleware (CPU: 2 core, RAM: 2GB), PostgreSQL, dan Mock Upstream secara terisolasi:

```bash
# Nyalakan cluster pengujian
docker compose -f docker-compose.loadtest.yml up -d

# Eksekusi migrasi & seed database di dalam container jika baru
docker compose -f docker-compose.loadtest.yml exec middleware npm run migrate
docker compose -f docker-compose.loadtest.yml exec middleware npm run seed

# Jalankan load test dari host (di luar container agar tidak berebut CPU/RAM)
node load-tests/scripts/run-test.js smoke
node load-tests/scripts/run-test.js stress
```

---

## Analisis Hasil & Menentukan Jumlah Max Concurrent Users

Setelah skenario pengujian dieksekusi, perhatikan batasan interpretasi angka berikut:

1. **Hasil Uji Beban di Lingkungan LAPTOP (i5-12450HX, WSL2, Mock Upstream):**
   - Angka titik jenuh **250–300 RPS** dan kapasitas aman **150–180 RPS** pada Jalur A diperoleh pada mesin laptop pengembang.
   - Angka koneksi WebSocket **1.000 soket** diperoleh pada mesin laptop pengembang dengan mock upstream.
   - **PENTING:** Perkiraan kapasitas di server produksi adalah **~setengahnya (~50–60%)** dari kapasitas laptop dan belum diukur secara langsung. Jangan mengasumsikan angka laptop setara dengan kapasitas produksi.
2. **Hasil Verifikasi di Lingkungan STAGING (Armada Riil):**
   - Durasi sync posisi **4–8 detik**, server siap **~2 detik**, posisi awal siap **~12 detik**, dan siklus MCCS **~1,5 menit** tanpa error adalah hasil verifikasi aktual pada server STAGING.

**Cara Menentukan Kapasitas Maksimum dari Hasil Uji:**
1. Buka file laporan HTML atau JSON di `load-tests/results/`.
2. Periksa grafik **Response Time (p95 & p99)** vs **Arrival Rate (RPS)**:
   - **Kapasitas Puncak (Peak Saturation Point):** Tahap RPS / Concurrent VU tertinggi di mana `p95 < 800 ms` dan `error_rate < 1%`.
   - **Kapasitas Aman Rekomendasi (Safe Operating Capacity):** Ambil **70% – 80%** dari angka titik jenuh tersebut.
