# Changelog

> Semua perubahan signifikan dicatat di file ini.

## 2026-09-20

### Route Playback Historical Running Status Fix

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **Koreksi Evaluasi `running` Historis di Rute MSPF (`enrichRouteWithMccsHistory`)** — `src/services/mspf.js`: Menghapus pemanggilan `calcRunningStatus(ignition, speed, p.deviceTime)` dengan argumen waktu `p.deviceTime`. Pada rute historis/playback masa lalu, running status dievaluasi murni dari telemetri kontak dan kecepatan (`calcRunningStatus(ignition, speed)`) tanpa membandingkan terhadap `Date.now()`, mencegah titik rute berumur $>24\text{ jam}$ salah diklasifikasikan sebagai `UNKNOWN`. Memperbaiki kegagalan test suite `mspf.test.js` (total 275 test pass). | `src/services/mspf.js` |

## 2026-09-18

### Route Playback True Historical Telemetry Integration & Full Attributes Preservation

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **Integrasi Telemetri Historis Asli MSPF (`enrichRouteWithMccsHistory`)** — `src/services/mspf.js`: Memperbaiki bug di mana titik rute masa lalu ditempeli live snapshot telemetri hari ini (`new Date()`). Menambahkan service `getDeviceMccsHistory` yang memanggil `GET /v2/device/{id}/data/history` dengan parameter `from` dan `to` kejadian. Menggunakan pencocokan nearest-neighbor timestamp ($\pm 120$ detik) via binary search. Titik rute kini memiliki `speed` (`kph`), `course` (`dir`), `ignition` (`addr_IGN`), `voltage` (`volt`/`addr_EB`), `odom`, dan sensor yang akurat dan unik per kejadian. | `src/services/mspf.js` |
| ~now | **24-Hour Range Chunking untuk MCCS Data History** — `src/services/mspf.js`: Mengatasi limitasi server MSPF (maksimal 24 jam per query `/data/history`) dengan memecah request rentang multi-hari menjadi batch paralel 24 jam (mendukung rute playback hingga 7 hari). | `src/services/mspf.js` |
| ~now | **Preservasi Full Attributes di `/api/reports/route`** — `src/routes/reports.js`: Menghapus logic yang me-reset `attributes: {}` bagi non-admin/customer. Baik Admin maupun Customer kini menerima atribut telemetri lengkap (bawaan provider & enriched). Custom attributes diaplikasikan via `enrichWithRules` (in-place tanpa menghapus atribut asli). | `src/routes/reports.js` |
| ~now | **Hoisting Rule Lookup pada Route History** — `src/routes/reports.js`: Rule lookup dipindahkan ke luar per-point loop. Jika tidak ada aturan custom, langsung early exit (0 ms overhead & 0 obyek kloning). | `src/routes/reports.js` |
| ~now | **Unit Tests Komprehensif** — `src/__tests__/mspf.test.js` & `src/__tests__/gateway.test.js`: Pengujian pencocokan telemetri historis MCCS, verifikasi variasi atribut per titik, penanganan toleransi waktu, dan fallback rute tanpa telemetri (total 275 test pass). | `src/__tests__/mspf.test.js`, `src/__tests__/gateway.test.js` |
| ~now | **Pembaruan Dokumentasi** — `API_REFERENCE.md` & `PROGRESS.md`: Memperbarui penjelasan enrichment rute MSPF dan ceiling batasan API. | `API_REFERENCE.md`, `PROGRESS.md` |

## 2026-09-17

### Events Lifecycle Normalization (`openedAt`, `closedAt`, `eventTime`) & FoxLogger Alarms Integration

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **Normalisasi `openedAt` & `closedAt` pada MSPF** — `src/routes/reports.js`: Memperbaiki query multi-device MSPF yang sebelumnya tidak menyertakan field `openedAt` dan `closedAt`. Menyempurnakan semantik `eventTime` pada status `CLOSE` agar menggunakan waktu penutupan (`closedAt`) sehingga pengurutan descending mencerminkan kapan insiden selesai. | `src/routes/reports.js` |
| ~now | **Standardisasi Siklus Hidup Event Traccar** — `src/routes/reports.js`: Menstandarkan kontrak data Traccar point-in-time ke unified schema: event `OPEN` (`openedAt: eventTime, closedAt: null`), event `CLOSE` (`openedAt: null, closedAt: eventTime`). | `src/routes/reports.js` |
| ~now | **Integrasi FoxLogger Alarms di Laporan Event** — `src/routes/reports.js`: Menghubungkan alarm FoxLogger (`report-cut-power`) ke `GET /api/reports/events` (single-device & multi-device). Mengonversi timestamp naif WIB ke UTC ISO dan menghitung durasi `closedAt = openedAt + cr_durt`. | `src/routes/reports.js` |
| ~now | **Penyeragaman Summary `open` & `closed` Counts** — `src/routes/reports.js`: Menyertakan statistik hitungan `open` dan `closed` pada response summary single-device dan multi-device. | `src/routes/reports.js` |
| ~now | **Unit & Integration Tests** — `src/__tests__/gateway.test.js`: Menambahkan test cases komprehensif menguji `openedAt`, `closedAt`, dan `eventTime` untuk MSPF, Traccar, serta alarm FoxLogger single dan multi-device (total 271 test pass). | `src/__tests__/gateway.test.js` |
| ~now | **Pembaruan Dokumentasi** — `API_REFERENCE.md`, `USER_GUIDE.md`, `PROGRESS.md`: Memperbarui contoh respons, panduan durasi insiden FE, dan tabel progress. | `API_REFERENCE.md`, `USER_GUIDE.md`, `PROGRESS.md` |

### Events Optimization, Table Pagination, Short Caching & Multi-Device MSPF bcId Resolution

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **Validasi Rentang Tanggal & Default 7 Hari** — `src/routes/reports.js`: Menambahkan validasi `validateReportDateRange` di seluruh endpoint reports (`/events`, `/parking`, `/idle`, `/trips`, `/route`). Jika `from`/`to` tidak diisi pada `/events`, otomatis default ke rentang 7 hari terakhir (aman untuk UI tabel tanpa DatePicker). Batas maksimal rentang waktu dibatasi 31 hari (route playback max 7 hari). | `src/routes/reports.js` |
| ~now | **In-Memory Pagination (`limit` & `offset`)** — `src/routes/reports.js`: Menambahkan dukungan `?limit=` (default: 50, max: 200) dan `?offset=` (default: 0) pada `GET /api/reports/events`. Output summary menyertakan `limit` dan `offset`. | `src/routes/reports.js` |
| ~now | **In-Memory Short-Lived Cache (TTL 30 Detik)** — `src/routes/reports.js`: Meng-cache hasil query event upstream selama 30 detik untuk navigasi pagination instan (<5ms) dan mencegah spam request ke Traccar/MSPF. Mendukung bypass via query parameter `?refresh=true`. | `src/routes/reports.js` |
| ~now | **Resolusi Dinamis MSPF bcId untuk Device Satuan** — `src/routes/reports.js`: Memperbaiki query multi-device MSPF yang sebelumnya hardcode `bcIds: [10000023]`. Sekarang mengumpulkan seluruh `bcId` unik secara dinamis dari cache device armada customer, dan menggabungkan event `OPEN` dan `CLOSE`. | `src/routes/reports.js` |
| ~now | **Destructuring Limit & Offset di Positions** — `src/routes/positions.js`: Meneruskan parameter `limit` dan `offset` pada `GET /api/positions` ke pemanggilan `traccar.getPositions`. | `src/routes/positions.js` |
| ~now | **Unit & Integration Tests** — `src/__tests__/gateway.test.js`: Menambahkan test suite baru mencakup default 7-day range, pagination limit/offset, validasi batas 31 hari, validasi urutan tanggal, in-memory caching & refresh bypass, route playback 7-day limit, dan dynamic MSPF multi-device bcIds (total 268 test pass). | `src/__tests__/gateway.test.js` |

### Admin Event Level & Alert Configuration (Dynamic Upstream Discovery & Enrichment)

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **Migrasi Schema Tabel `event_configs`** — `migrations/20260917_create_event_configs.js`: Membuat tabel `event_configs` dengan kolom `source`, `event_key`, `external_id`, `event_type`, `original_name`, `custom_label`, `level`, `color`, `is_enabled`, dan constraint unik `UNIQUE(source, event_key)`. | `migrations/20260917_create_event_configs.js` |
| ~now | **Discovery Service & In-Memory Config Cache** — `src/services/eventConfig.js`: Menggabungkan katalog event Traccar, Geofence zones, MSPF monitors (`GET /v4/monitors`), dan FoxLogger alarms ke dalam katalog terpadu dengan default fallback yang cerdas. Melakukan cache in-memory untuk lookup instan $O(1)$ saat event enrichment. | `src/services/eventConfig.js`, `src/services/mspf.js` |
| ~now | **Admin Event Endpoints** — `src/routes/eventsAdmin.js` & `src/app.js`: Menyediakan endpoint `GET /api/admin/events/catalog` (discovery), `GET /api/admin/events/configs`, `PUT /api/admin/events/configs` (bulk upsert), dan `DELETE /api/admin/events/configs/:id` (reset ke default). | `src/routes/eventsAdmin.js`, `src/app.js` |
| ~now | **Event Output Enrichment & Level Filter** — `src/routes/reports.js` & `src/routes/dashboard.js`: Menambahkan field `level` ('danger', 'warning', 'info', 'success') dan `color` di setiap item event. Mendukung penamaan kustom (`customLabel`), filtering via `?level=`, dan muting bila `is_enabled: false`. | `src/routes/reports.js`, `src/routes/dashboard.js` |
| ~now | **Integration & Unit Tests** — `src/__tests__/eventConfigs.test.js`: Menambahkan 9 test komprehensif menguji discovery katalog, otorisasi admin (401/403), bulk update level/color/customLabel, filter `?level=`, mute event, dan reset config (total 261 test pass). | `src/__tests__/eventConfigs.test.js` |

### Event & Dashboard Enrichment: Event Name, Type, Device Name & Type Filter

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **Enrichment Nama & Tipe Event di Reports (`GET /api/reports/events`)** — `src/routes/reports.js`: Menghilangkan `name: null` pada query multi-device. Menambahkan field `type` (mesin/raw) dan `name` (human-readable label) untuk seluruh event Traccar (`TRACCAR_EVENT_NAMES` + humanize fallback) dan MSPF (`monitorName`). Menambahkan field `deviceName` via in-memory cache lookup. Menambahkan dukungan filter query `?type=` di sisi server. | `src/routes/reports.js` |
| ~now | **Enrichment Recent Events di Dashboard (`GET /api/dashboard`)** — `src/routes/dashboard.js`: Menghilangkan `name: null` pada event geofence dan memformat nama event dengan rapi. Menambahkan field `type` dan `deviceName` pada setiap item di array `recentEvents`. | `src/routes/dashboard.js` |
| ~now | **Dokumentasi API & Progress** — `API_REFERENCE.md` & `PROGRESS.md`: Memperbarui dokumentasi kontrak response event dan parameter `?type=`, serta menandai backlog event types selesai. | `API_REFERENCE.md`, `PROGRESS.md` |
| ~now | **Test Suite** — `src/__tests__/gateway.test.js`: Memperbarui tes multi-device events dan menambahkan tes verifikasi nama/tipe MSPF, filter `?type=`, serta `recentEvents` dashboard (total 252 test pass). | `src/__tests__/gateway.test.js` |

## 2026-09-16

### PostgreSQL BIGINT Device ID Support (Fix Error 22003 Out of Range)

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **Migrasi Schema Kolom `device_id` ke BIGINT** — `migrations/20260916_alter_device_id_to_bigint.js`: Mengubah kolom `device_id` pada tabel `device_metadata`, `device_groups`, dan `command_logs` menjadi `BIGINT` (64-bit) untuk PostgreSQL. Memperbaiki error `500 22003: value out of range for type integer` saat melakukan pagination atau query device FoxLogger dengan ID IMEI 15 digit (contoh: `780901703170270`) | `migrations/20260916_alter_device_id_to_bigint.js` |
| ~now | **PostgreSQL BIGINT Type Parser** — `src/db/index.js` & `knexfile.js`: Menambahkan type parser driver `pg` untuk INT8 / BIGINT (OID 20) agar dikonversi otomatis ke `Number` (`parseInt(val, 10)`), menjaga konsistensi tipe integer antara SQLite dan PostgreSQL tanpa resiko precision loss di bawah `Number.MAX_SAFE_INTEGER` | `src/db/index.js`, `knexfile.js` |
| ~now | **Toleransi Pencocokan ID & FoxLogger di Device Groups** — `src/routes/deviceGroups.js`: Memperbaiki lookup `deviceExists` dan `getDeviceName` agar mendukung fleksibilitas integer dan string `(d.id === deviceId || String(d.id) === String(deviceId))`, serta mengizinkan `source: 'foxlogger'` di `POST /api/admin/device-groups` dan fallback pemeriksaan ketersediaan perangkat FoxLogger | `src/routes/deviceGroups.js` |
| ~now | **Dokumentasi API Reference** — `API_REFERENCE.md`: Menambahkan dokumentasi dukungan `source: 'foxlogger'` dan `deviceId` 64-bit pada endpoint `POST /api/admin/device-groups` dan `/batch` | `API_REFERENCE.md` |
| ~now | **Test Suite** — Menambahkan unit & integration tests di `src/__tests__/deviceMetadata.test.js` dan `src/__tests__/gateway.test.js` untuk memverifikasi operasi insert, select, update, dan delete dengan device ID 15 digit serta assign perangkat FoxLogger ke custom group (total 250 test pass) | `src/__tests__/deviceMetadata.test.js`, `src/__tests__/gateway.test.js` |

## 2026-09-14

### WebSocket Disconnect Segregation (Session Revoked vs Account Disabled)

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **WebSocket Disconnect Event Segregation** — `src/websocket/index.js` & `src/routes/users.js`: membedakan event pemutusan koneksi WebSocket antara reset password / pencabutan sesi (`session-revoked`, `code: ERR_TOKEN_REVOKED`) dengan penonaktifan akun (`account-disabled`, `code: ERR_ACCOUNT_DISABLED`). Mencegah munculnya false alarm notifikasi "Akun Dinonaktifkan" di frontend saat admin hanya mengupdate password customer | `src/websocket/index.js`, `src/routes/users.js` |
| ~now | **Test Suite** — 2 unit tests baru di `src/__tests__/statusPayload.test.js` memverifikasi payload kontrak event `session-revoked` dan `account-disabled` (total 246 test pass) | `src/__tests__/statusPayload.test.js` |

## 2026-09-11

### Live Group Session Continuity & Non-Disruptive Customer Group Assignment

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **Eliminasi Force Logout Saat Edit Group** — `src/routes/users.js`: admin menambahkan/mengubah `groups` pada akun customer tidak lagi memicu `token_version` bump ataupun pencabutan token (`shouldRevokeTokens` kini hanya aktif jika password diubah, akun dinonaktifkan, atau nilai permission berubah secara riil) | `src/routes/users.js` |
| ~now | **Live Group Resolution di Auth Middleware** — `src/services/userAuth.js` & `src/middleware/auth.js`: `getUserAuthStatus` kini meng-cache `groups` dan `permissions` terkini dari database, dan `authMiddleware` langsung meng-overlay data live tersebut ke `req.user`. Customer langsung mendapatkan hak akses ke custom group baru pada sesi token yang sedang berjalan tanpa perlu login ulang | `src/services/userAuth.js`, `src/middleware/auth.js` |
| ~now | **Live WebSocket Group Refresh** — `src/websocket/index.js`: menambahkan helper `refreshUserSockets(userId)` yang memperbarui `socket.user.groups` dan `socket.allowedDevices` secara real-time saat grup diubah oleh admin tanpa memutus koneksi socket pengguna | `src/websocket/index.js` |
| ~now | **Test Suite** — 2 unit & integration tests baru di `src/__tests__/liveUserGroups.test.js` memverifikasi bahwa penambahan grup oleh admin tidak me-logout user dan langsung memberikan akses kendaraan grup baru pada token yang sama (total 244 test pass) | `src/__tests__/liveUserGroups.test.js` |

### Segregation of Dynamic Linked Sync Groups vs Manual Devices & Privilege Hardening

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **Group Membership Service** — `src/services/groupMembership.js`: layanan sentral untuk resolusi keanggotaan grup secara dinamis (`enrichAndFilterDevices`, `isDeviceAllowedForGroups`, `getAllowedDeviceKeys`, `getActiveSyncRules`). Memisahkan secara ketat antara **Add Mandiri** (`device_groups`) dan **Dynamic Linked Sync Groups** (`group_sync_rules`) | `src/services/groupMembership.js` |
| ~now | **Strict Segregation & No Unintended Deletions** — Perangkat hasil sinkronisasi tidak lagi di-dump ke tabel `device_groups` sebagai entri statis. Di Admin UI, hanya perangkat add mandiri yang memiliki tombol hapus/unassign. Perangkat sync tunduk pada aturan link grup upstream | `src/services/autoSync.js`, `src/routes/deviceGroups.js` |
| ~now | **Instant Dynamic Unlink** — Menghapus aturan sinkronisasi di `DELETE /api/admin/group-sync/:id` seketika mencabut visibilitas dan hak akses seluruh perangkat upstream terkait tanpa meninggalkan data sampah di database | `src/routes/groupSync.js`, `src/services/groupMembership.js` |
| ~now | **Security Privilege Hardening** — Pengetatan pemeriksaan hak akses di seluruh route (`devices`, `positions`, `commands`, `reports`, `dashboard`, `websocket`). Pengguna level customer tidak dapat mengakses data koordinat, perintah remote, metadata, atau laporan perangkat di luar grup miliknya | `src/routes/*`, `src/websocket/index.js` |
| ~now | **Database Cleanup Migration** — Migrasi `20260911_clean_historical_synced_device_groups.js` membersihkan sisa baris historis yang pernah di-insert ke `device_groups` oleh auto-sync lama | `migrations/20260911_clean_historical_synced_device_groups.js` |
| ~now | **Accurate Custom Group Device Count** — `GET /api/groups` kini menghitung total kendaraan aktual secara real-time (`keys.size`) menggantikan nilai hardcoded `0` | `src/routes/groups.js` |
| ~now | **Test Suite** — 4 unit & integration tests baru di `src/__tests__/groupMembershipPrivilege.test.js` memverifikasi pencegahan kebocoran hak akses, isolasi perangkat antar-customer, pemutusan instan saat rule dihapus, dan pemisahan tabel (total 242 test pass) | `src/__tests__/groupMembershipPrivilege.test.js` |

## 2026-09-10

### Custom Groups Hybrid Sync, Deduplication & Performance Consolidation

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **Bug Fix Device Sync Listing** — `src/routes/devices.js`: memperbaiki kegagalan inisialisasi MSPF/FoxLogger pada pembuatan cache dengan menambahkan `waitForInit()`, memastikan seluruh kendaraan hasil sinkronisasi selalu termuat lengkap ke cache sentral | `src/routes/devices.js` |
| ~now | **Eliminasi N+1 Query & Fast Group Filter** — Menghapus percabangan HTTP loop lambat di `GET /api/devices?group=X`. Seluruh query filter grup kini ditarik langsung dari in-memory cache `devices:merged` (<2ms) dengan konsistensi penempelan `customGroups`, `metadata`, `liveStatus`, dan `engineControl` | `src/routes/devices.js` |
| ~now | **Strict Customer Deduplication** — Jika customer memiliki beberapa custom group yang memuat kendaraan yang sama (overlap via multi-sync atau add mandiri), kendaraan dijamin **hanya muncul 1 kali** di list dengan field `customGroups` yang memuat seluruh grup miliknya | `src/routes/devices.js` |
| ~now | **Auto-Sync Service Fixes** — `src/services/autoSync.js`: `fetchMspfDevices` meng-await `mspf.waitForInit()`; `fetchTraccarDevices` memfilter secara akurat `d.groupId === groupId`; eksekusi instan ditrigger saat rule dibuat di `POST /api/admin/group-sync` | `src/services/autoSync.js`, `src/routes/groupSync.js`, `src/server.js` |
| ~now | **Test Suite** — 4 unit & integration tests baru di `src/__tests__/customGroupSync.test.js` memverifikasi multi-sync, add mandiri, deduplikasi kendaraan, dan trigger sinkronisasi instan (total 238 test pass) | `src/__tests__/customGroupSync.test.js` |

### Unified Command Mapping & MSPF engineResume Bug Fix

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **Bug Fix MSPF engineResume** — `src/routes/commands.js`: memperbaiki bug di mana perintah `type: "engineResume"` dievaluasi salah oleh ternary `type === 'activate' ? 'ACTIVE' : 'INACTIVE'` sehingga tidak sengaja mengirim `INACTIVE` ke MSPF. Kini menggunakan set `ENGINE_RESUME_TYPES` (`engineResume`, `activate`, `ACTIVE`) yang dijamin memanggil `mspf.activateDevice(id, 'ACTIVE')` | `src/routes/commands.js` |
| ~now | **Bidirectional Command Translation** — Gateway otomatis menerjemahkan perintah secara dua arah: FE dapat mengirim perintah standar telematika (`engineResume` / `engineStop`) ke seluruh kendaraan lintas provider tanpa perlu membedakan vendor | `src/routes/commands.js` |
| ~now | **Safety Guard for Unsupported Commands** — Menolak perintah selain aktivasi/deaktivasi pada perangkat MSPF dengan `400 ERR_NOT_SUPPORTED` untuk mencegah deactivation yang tidak diinginkan | `src/routes/commands.js` |
| ~now | **Unified `GET /types/:deviceId`** — Perangkat MSPF kini mengembalikan `['engineResume', 'engineStop', 'activate', 'deactivate']` sehingga tim FE memiliki konsistensi nama perintah yang sama untuk semua armada | `src/routes/commands.js` |
| ~now | **Test Suite** — 7 unit & integration tests baru di `src/__tests__/commands.test.js` memverifikasi terjemahan `engineResume` $\rightarrow$ `'ACTIVE'` di MSPF, `engineStop` $\rightarrow$ `'INACTIVE'` di MSPF, legacy fallback, dan error handling (total 234 test pass) | `src/__tests__/commands.test.js` |

### Dynamic Database Switching (SQLite & PostgreSQL) & Production Startup Safety

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **PostgreSQL Driver** — Menambahkan dependensi `pg` (^8.23.0) di `package.json` untuk dukungan native PostgreSQL | `package.json` |
| ~now | **Dynamic Knexfile Config** — `knexfile.js`: mendukung switch dinamis berbasis `DB_DRIVER` (`sqlite`/`sqlite3` vs `pg`/`postgres`/`postgresql`), mendukung format `DATABASE_URL` (single string), discrete credentials (`DB_HOST`, `DB_PORT`, dll.), dan SSL flag (`DB_SSL`) | `knexfile.js`, `src/config/index.js` |
| ~now | **Production Startup Safety (No Auto-Seed on Reboot)** — `src/db/index.js`: menghapus eksekusi otomatis `seed.run()` saat startup server normal/rebuild. Server startup murni menjalankan `migrate.latest()`. Seed kini dipisah menjadi script manual mandiri `npm run seed` (`src/scripts/seed.js`) | `src/db/index.js`, `src/scripts/seed.js`, `package.json` |
| ~now | **Docker Compose Postgres Service** — Menambahkan service `postgres:16-alpine` dan volume `pg_data` di `docker-compose.yml` serta panduan di `.env.example` | `docker-compose.yml`, `.env.example` |
| ~now | **Test Suite** — Seluruh 227 test tetap lulus 100% (12/12 suite passed) | `src/__tests__/*` |

### Unified Telematics Immobilizer State (`engineControl`)

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **Bidirectional Transitions & Provider Rollback Detection** — `src/utils/engineControl.js`: mendukung transisi dua arah (`ACTIVE` $\leftrightarrow$ `INACTIVE`). Deteksi otomatis pembatalan/kegagalan eksekusi oleh provider: jika perintah mematikan mesin (`desired: INACTIVE`) atau menghidupkan mesin (`desired: ACTIVE`) sempat masuk fase transisi (`DEACTIVATING`/`ACTIVATING`) namun status hardware dikembalikan oleh server provider ke state sebelumnya, Backend mendeteksi rollback, membersihkan `desired`, mengembalikan status riil ke `state: ACTIVE` / `state: INACTIVE` (`isApplied: true`), dan menandai `command_logs` menjadi `FAILED` | `src/utils/engineControl.js` |
| ~now | **Fire-and-Forget (No-ACK) Auto-Reconciliation Timeout (60s)** — `src/utils/engineControl.js`: timeout rekonsiliasi 60 detik mencegah state menggantung di `DEACTIVATING`/`ACTIVATING` selamanya. Untuk tracker GPS tanpa paket ACK balasan, jika durasi melebihi 60 detik dan kontak/kecepatan sudah OFF, status otomatis terkonfirmasi (`isApplied: true`). Jika kendaraan masih melaju kencang/kontak ON, perintah dibatalkan dan dikembalikan ke state aman | `src/utils/engineControl.js` |
| ~now | **Zero-Lag Cache Mutation & Guaranteed Fresh WebSocket Delivery** — `src/routes/commands.js` & `src/websocket/index.js`: saat command sukses dikirim, cache in-memory `devices:merged` seketika dimutasi in-place dan fungsi `emitStatusFor`/`buildStatusPayload` mengalirkan objek `engineControl` segar secara eksplisit (dilengkapi fallback cold-cache derivation), menjamin 100% data fresh diterima oleh Frontend via WebSocket `device-status` tanpa risiko `null` | `src/routes/commands.js`, `src/websocket/index.js` |
| ~now | **MSPF Multi-Source Activation Status Extraction** — `src/services/mspf.js`: normalizer mengenali seluruh variasi status aktivasi (`activationStatus`, `activationCurrentStatus`, `tags.activationStatus`, nested `status.activation.currentStatus`) mencegah status `undefined` | `src/services/mspf.js` |
| ~now | **Engine Control Utility** — `src/utils/engineControl.js`: komputasi status terpadu `engineControl` (`desired`, `state`, `isApplied`, `lastAppliedAt`) yang merekonsiliasi status permintaan (*desired intent*) dengan status telemetri fisik (*hardware reported state*). Mengeliminasi potensi *false-positive* dengan mengandalkan murni `activationStatus` resmi di MSPF (menghapus pengecekan pin `relay` umum) dan murni `attributes.blocked` di Traccar (menghapus pengecekan `out1` umum) | `src/utils/engineControl.js` |
| ~now | **Device Endpoints Integration** — `GET /api/devices` dan `GET /api/devices/:id` menyertakan object `engineControl` di root level objek kendaraan untuk Admin dan Customer | `src/routes/devices.js` |
| ~now | **Command Response Feedback** — `POST /api/commands` dan `PUT /api/commands/:deviceId/activation` langsung merespons state awal pending (`state: 'DEACTIVATING'` / `'ACTIVATING'`, `isApplied: false`) | `src/routes/commands.js` |
| ~now | **WebSocket Streaming** — Event WebSocket `device-status` mengalirkan update `engineControl` secara real-time saat status relay fisik terkonfirmasi berubah di jalan raya | `src/websocket/index.js` |
| ~now | **Test Suite** — 284 test lulus 100% (17/17 test suites passed), memverifikasi resolusi murni `activationStatus` (MSPF), `blocked` (Traccar), deteksi provider rollback dua arah, timeout 60s No-ACK, pengiriman WebSocket status fresh saat cache cold/empty, API responses, dan audit log status | `src/__tests__/engineControl.test.js`, `src/__tests__/statusPayload.test.js` |
| ~now | **Dokumentasi** — Spesifikasi payload `engineControl` di `API_REFERENCE.md`, `USER_GUIDE.md`, dan `PROGRESS.md` | `API_REFERENCE.md`, `USER_GUIDE.md`, `PROGRESS.md` |

### Role-Based Upstream Vendor Sanitization (White-Label Customer View)

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **Sanitizer Utility** — `src/utils/sanitizer.js`: fungsi helper native `sanitizeDevice`, `sanitizeDevices`, `sanitizePosition`, `sanitizePositions`, `sanitizeLog`, `sanitizeLogs`, `sanitizeReportItem`, `sanitizeReportItems` untuk menyaring tag internal | `src/utils/sanitizer.js` |
| ~now | **Customer Data Masking** — Seluruh respons API (`devices`, `positions`, `commands`, `reports`, `dashboard`) dan WebSocket broadcasts (`position`, `device-status`) menyembunyikan properti `source` dan vendor `group` bagi pengguna level `customer` | `src/routes/devices.js`, `src/routes/positions.js`, `src/routes/commands.js`, `src/routes/reports.js`, `src/routes/dashboard.js`, `src/websocket/index.js` |
| ~now | **Admin Preservation** — Pengguna level `admin` 100% mempertahankan field `source` (`traccar`, `mspf`, `foxlogger`) dan vendor `group` (`traccar_5`, dll.) untuk kebutuhan grouping FE Admin, diagnostik, dan sync mapping | `src/routes/*` |
| ~now | **Test Suite** — 10 unit & integration tests baru di `src/__tests__/roleSanitization.test.js` memverifikasi bahwa admin tetap menerima field vendor sementara customer menerima payload bersih tanpa tag internal (total 215 test pass) | `src/__tests__/roleSanitization.test.js` |
| ~now | **Dokumentasi** — Update invariant di `AGENTS.md`, panduan di `API_REFERENCE.md`, `USER_GUIDE.md`, dan `PROGRESS.md` | `AGENTS.md`, `API_REFERENCE.md`, `USER_GUIDE.md`, `PROGRESS.md` |

### User Permissions Capability Model (`canCutEngine`), Safety Interlock Guard & Command Audit Trail

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **Skema DB** — Migrasi `20260910_add_user_permissions_and_command_logs.js`: kolom `permissions` JSON di tabel `users` (default `{"canCutEngine":false}`) dan tabel `command_logs` untuk pencatatan riwayat audit perintah persisten | `migrations/20260910_add_user_permissions_and_command_logs.js` |
| ~now | **Extensible Capability Model** — Dukungan field `permissions` pada profil user (`formatUser`, JWT payload, `GET /api/auth/me`, `POST /api/users`, `PUT /api/users/:id`). Token version otomatis di-bump saat permissions berubah untuk invalidasi instan | `src/routes/users.js`, `src/routes/auth.js` |
| ~now | **Device Access Boundary** — Endpoint `POST /api/commands`, `PUT /api/commands/:deviceId/activation`, dan `GET /api/commands/types/:deviceId` memverifikasi kepemilikan perangkat via `device_groups` bagi non-admin | `src/routes/commands.js` |
| ~now | **Engine Cut Capability Guard** — Perintah mematikan mesin (`engineStop`, `deactivate`, `INACTIVE`) diblokir (`403 ERR_FORBIDDEN`) jika customer tidak memiliki izin `canCutEngine: true`. Admin bypass seluruh proteksi | `src/routes/commands.js` |
| ~now | **Safety Notice & Approval Flow** — Perintah mematikan mesin wajib menyertakan `confirm: true`; jika tidak ada, API merespons `422 WARN_CONFIRMATION_REQUIRED` dengan pesan keselamatan telematika | `src/routes/commands.js` |
| ~now | **Dynamic Command Types Filter** — Endpoint `GET /api/commands/types/:deviceId` otomatis menyembunyikan tipe perintah mematikan mesin jika pengguna tidak memiliki izin `canCutEngine` | `src/routes/commands.js` |
| ~now | **Command Debounce & Support Guard** — In-memory lock 5 detik mencegah double-click/spam command per perangkat; penolakan otomatis untuk perangkat FoxLogger (`400 ERR_NOT_SUPPORTED`) | `src/routes/commands.js` |
| ~now | **Audit Trail Endpoint** — `GET /api/commands/logs` dengan filter `deviceId`, `source`, `status`, rentang tanggal, pagination, dan isolasi akses berbasis grup | `src/routes/commands.js` |
| ~now | **Test Suite** — 18 unit & integration tests baru (`src/__tests__/commands.test.js`) memverifikasi permission check, token revocation, safety warning, filtering, debounce, dan audit trail (total 205 test pass) | `src/__tests__/commands.test.js` |
| ~now | **Dokumentasi** — Update spesifikasi lengkap di `API_REFERENCE.md`, `USER_GUIDE.md`, dan `PROGRESS.md` | `API_REFERENCE.md`, `USER_GUIDE.md`, `PROGRESS.md` |

## 2026-09-09

### Top Distance / Mileage 24 Jam (`GET /api/reports/top-distance`)

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **Endpoint Baru** — `GET /api/reports/top-distance` & alias `/api/reports/top-mileage` mengembalikan ranking armada dengan jarak tempuh tertinggi dalam 24 jam terakhir | `src/routes/reports.js` |
| ~now | **Master Shared Cache 30 Menit** — Agregasi borongan Traccar (`getReportSummary`), MSPF (`getBcStatsReports`), dan FoxLogger (`getDeviceSummary`) disimpan dalam in-memory cache TTL 1800s (30m) untuk performa <2ms dan 0 beban server berulang | `src/routes/reports.js` |
| ~now | **User-Scoped RBAC** — Otomatis membatasi ranking untuk customer hanya pada perangkat di `device_groups` miliknya; admin melihat seluruh armada lintas sumber | `src/routes/reports.js` |
| ~now | **Filter Fleksibel** — Mendukung query param `limit` (default 10), `group` (filter custom group ID), dan `refresh=true` (bypass master cache) | `src/routes/reports.js` |
| ~now | **Test Suite** — 7 unit & integration tests baru: autentikasi, sorting descending, limit, alias `/top-mileage`, customer group filtering, dan validasi 403/404 (total 187 test pass) | `src/__tests__/gateway.test.js` |
| ~now | **Dokumentasi** — Update spesifikasi lengkap di `API_REFERENCE.md` dan `PROGRESS.md` | `API_REFERENCE.md`, `PROGRESS.md` |

### User Enable/Disable (`isActive`) & Immediate Session Revocation (`token_version`)

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **Skema DB** — Migrasi `20260909_add_user_active_and_token_version.js`: kolom `is_active` (boolean, default true) & `token_version` (integer, default 1) | `migrations/20260909_add_user_active_and_token_version.js` |
| ~now | **User Auth Service & Cache** — `src/services/userAuth.js`: `getUserAuthStatus` dengan fast cache 60s + instant invalidation `invalidateUserAuthStatus` | `src/services/userAuth.js` |
| ~now | **Auth Middleware Enforcement** — `authMiddleware` memeriksa status aktif & versi token: disabled $\rightarrow$ `403 ERR_ACCOUNT_DISABLED`; versi token lama $\rightarrow$ `401 ERR_TOKEN_REVOKED` | `src/middleware/auth.js` |
| ~now | **WebSocket Disconnect & Guard** — Handshake `io.use` tolak akun nonaktif/revoked; helper `disconnectUserSockets(userId)` memutus paksa koneksi socket user saat dinonaktifkan/password direset | `src/websocket/index.js` |
| ~now | **Login Guard** — `POST /api/auth/login` tolak login akun nonaktif dengan `403 ERR_ACCOUNT_DISABLED`; token payload menyertakan `isActive` & `tokenVersion` | `src/routes/auth.js` |
| ~now | **Self-Profile Password Bump** — `PUT /api/auth/me` menaikkan `token_version` saat ganti password untuk invalidasi sesi lama | `src/routes/auth.js` |
| ~now | **Admin Toggle `isActive`** — `POST /api/users` & `PUT /api/users/:id` mendukung `isActive`: saat di-disable, otomatis menaikkan `token_version`, menghapus cache, dan memutus WebSocket | `src/routes/users.js` |
| ~now | **Test Suite** — Tambahan test penolakan login user nonaktif, pemutusan instan token lama saat disable/re-enable (total 180 test pass) | `src/__tests__/gateway.test.js` |
| ~now | **Dokumentasi** — Update `API_REFERENCE.md` dan `PROGRESS.md` | `API_REFERENCE.md`, `PROGRESS.md` |

### User Profile Expansion & Self-Update (`PUT /api/auth/me`) + Dual-Identifier Login

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **Skema DB** — Migrasi `20260909_add_user_profile_and_email.js` menambahkan kolom `email` (nullable, unique), `first_name`, dan `last_name` pada tabel `users` | `migrations/20260909_add_user_profile_and_email.js` |
| ~now | **Dual-Identifier Login** — `POST /api/auth/login` mengenali `username` ATAU `email` (case-insensitive) dalam satu kolom input fleksibel | `src/routes/auth.js` |
| ~now | **Endpoint `PUT /api/auth/me`** — Self-profile update khusus user yang login: mengizinkan update `firstName`, `lastName`, `timezone`, dan `password` (dengan konfirmasi password); field `role` dan `groups` diabaikan/dilindungi | `src/routes/auth.js` |
| ~now | **Admin User Management** — `POST /api/users` mewajibkan semua field (`username`, `email`, `firstName`, `lastName`, `password`, `confirmPassword`, `timezone`); `PUT /api/users/:id` mendukung edit field profil dengan validasi konfirmasi password | `src/routes/users.js` |
| ~now | **Enrichment Profil User** — `GET /api/auth/me`, `GET /api/users`, `GET /api/users/:id`, dan login response mengembalikan `email`, `firstName`, `lastName` | `src/routes/auth.js`, `src/routes/users.js` |
| ~now | **Test Suite** — Tambahan pengujian dual login, `PUT /api/auth/me`, validasi konfirmasi password, proteksi role, dan error handling (total 178 test pass) | `src/__tests__/gateway.test.js` |
| ~now | **Dokumentasi** — Update `API_REFERENCE.md` dan `PROGRESS.md` | `API_REFERENCE.md`, `PROGRESS.md` |

## 2026-08-07

### Device Metadata — 2 Kepemilikan (Admin vs Customer) + Rule Akses

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **Schema split** — `device_metadata` direcreate: tambah kolom `owner` (`admin`/`customer`) + `updated_by` (user id, audit); PK baru `(device_id, source, owner)` → 2 baris per device; data lama dimigrasikan ke `owner='admin'` | `migrations/20260807_split_device_metadata_owner.js` |
| ~now | **Helper `mergeMetadataBlobs`** — gabungkan blob admin + customer jadi `metadata` flat + `metadataOwners` map per-key; admin menang saat key bentrok | `src/utils/deviceMetadata.js` |
| ~now | **`enrichMetadata`** — output `metadata` flat + `metadataOwners` di `GET /api/devices` & `/api/devices/:id` | `src/routes/devices.js` |
| ~now | **Rule akses PUT** — admin default `owner=admin` (bisa pilih `owner=customer`); customer selalu `owner=customer`, jika kirim `owner=admin` → **403**; `updated_by` dicatat | `src/routes/devices.js` |
| ~now | **Rule akses DELETE** — admin hapus admin (default) / customer via `?owner=`; customer hanya `owner=customer`, jika `owner=admin` → **403** | `src/routes/devices.js` |
| ~now | **Test** — unit `deviceMetadata.test.js` (4) + integration Device Metadata di `gateway.test.js` (rule 403, blob admin tak tersentuh, admin edit customer) | `src/__tests__/` |
| ~now | **Dokumentasi** — `API_REFERENCE.md` PUT/DELETE + contoh response `metadata`/`metadataOwners` | `API_REFERENCE.md` |

## 2026-08-06

### Playback `/api/reports/route` — Traccar `/reports/route` + default range per-user timezone + urutan ASC

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **`traccar.getReportRoute()`** — wrapper `GET /reports/route` (endpoint resmi route history; `/positions` tidak dipakai lagi untuk playback agar tidak 400 saat `from`/`to` kosong). Konversi `speed` knots→km/h sama seperti `getPositions`. Helper murni **`toKmh()`** diextract & di-export | `src/services/traccar.js` |
| ~now | **Default range "hari ini" per-user** — saat `from`/`to` kosong di `/api/reports/route`: `from = startOfDayIso(now, req.user.timezone)` (jam 00:00 zona user), `to = now`. Berlaku untuk **semua source** (Traccar/MSPF/FoxLogger) | `src/routes/reports.js`, `src/utils/timestamp.js` |
| ~now | **Urutan playback konsisten ASC** — sort by `deviceTime` naik di gateway sebagai pengaman (MSPF sudah ASC via `reverse()`, Traccar/FoxLogger dipastikan naik) | `src/routes/reports.js` |
| ~now | **Timezone per user** — kolom `users.timezone` (nullable, migrasi `20260806_add_user_timezone`); config `DEFAULT_USER_TIMEZONE` (default `Asia/Jakarta`) sebagai fallback user lama; **`timezone` required** saat add user, optional saat edit, divalidasi IANA (`isValidTimeZone`); login & `/me` mengembalikan `timezone` | `migrations/`, `src/config/index.js`, `src/routes/auth.js`, `src/routes/users.js`, `.env.example` |
| ~now | **Validasi add/edit user diselaraskan** — POST kini validasi `password` min 6, `role` `isIn(['admin','customer'])`, `groups` `isArray` (konsisten dengan PUT) | `src/routes/users.js` |
| ~now | **Test** — `traccar.test.js` (toKmh), `timestamp.test.js` (isValidTimeZone + startOfDayIso), gateway Route Reports + user timezone — total **159 test pass** | `src/__tests__/` |

## 2026-08-06

### Live Tracking Redesign (single worker + online/offline detection)

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **StatusTracker** — `src/utils/liveStatus.js`: change-detection posisi (key lat/lon/speed/course/deviceTime/ignition), status online/offline dengan **hysteresis** (`OFFLINE_THRESHOLD_MS` + `ONLINE_THRESHOLD_MS` + `STATUS_COOLDOWN_MS`), debounce device baru, threshold per-device (`reportIntervalMinutes` → 2× interval) / per-source / global, snapshot & heartbeat | `src/utils/liveStatus.js` |
| ~now | **Single worker `positionSync`** — hapus duplikasi polling MSPF/FoxLogger di WS. Worker kini: fetch+enrich → cache → feed tracker → emit `position` change-only (MSPF/FoxLogger) via `setEmitHooks` → deteksi offline (edge-triggered) → heartbeat `device-status` | `src/services/positionSync.js` |
| ~now | **WebSocket** — hapus `startMspfPolling`/`startFoxLoggerPolling` (dobel kerja), tambah field **`status`** di `device-status`, **snapshot status saat connect/reconnect**, proses Traccar WS `events` (deviceOnline/deviceOffline), `emitStatusFor`/`buildStatusPayload` | `src/websocket/index.js` |
| ~now | **Wiring** — `positionSync.setEmitHooks({ onPosition, onStatus })` dihubungkan ke WS | `src/server.js` |
| ~now | **`GET /api/devices` akurat** — overlay `status` dari StatusTracker (konsisten REST ↔ WS), `running` tidak disentuh | `src/routes/devices.js` |
| ~now | **Config** — `OFFLINE_THRESHOLD_MS` (10m), `ONLINE_THRESHOLD_MS` (10m), `STATUS_COOLDOWN_MS` (60s), `TRACCAR_/MSPF_/FOXLOGGER_OFFLINE_THRESHOLD_MS`, `DEVICE_STATUS_HEARTBEAT_MS` (90s), `POSITION_EMIT_CHANGE_ONLY` (true) | `src/config/index.js`, `.env.example` |
| ~now | **Test** — `liveStatus.test.js` (12) + `positionSync.test.js` (3) — total 123 test pass | `src/__tests__/` |

### Kontrak `device-status` & Threshold (final, dengan FE)

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **`buildStatusPayload` dinormalisasi** — 5 field sensor (`ignition`, `voltage`, `internalBattery`, `batteryLevel`, `running`) **selalu ada** (nilai/`null`); `null` = data tidak tersedia. **Offline** → sensor `null` + `running: "UNKNOWN"`; `lastUpdate` = waktu data terakhir diterima device. `emitDeviceStatusFrom` juga diseragamkan. `buildStatusPayload` di-export untuk test | `src/websocket/index.js` |
| ~now | **Connection `status` = `online`/`offline` saja** (tanpa `unknown`); sinyal "device mati/basi" diwakili `running: UNKNOWN` (>24 jam) | `src/websocket/index.js`, `src/utils/deviceStatus.js` (semantik) |
| ~now | **Threshold hierarki extensible** — `resolveThresholds(source, meta, overrides)`: per-device (`device_metadata.offlineThresholdMs`/`reportIntervalMinutes`) → per-group (`overrides.perGroup`, future) → per-type (`overrides.perType`, future) → per-source → global | `src/utils/liveStatus.js` |
| ~now | **Default threshold 10 menit** — `OFFLINE_THRESHOLD_MS` & `ONLINE_THRESHOLD_MS` = 600000 (definisi: online = data < 10m, offline = tidak ada data > 10m) | `src/config/index.js`, `.env.example` |
| ~now | **Test** — `statusPayload.test.js` (4) + update liveStatus/positionSync utk threshold 10m — total **130 test pass** | `src/__tests__/` |

### Bugfix — Timezone Request FoxLogger (`time1`/`time2` shift +7 jam)

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **Root cause** — `fmtFoxTime` hanya mereformat ISO `"…T17:00:00.000Z"` → `"… 17:00:00"` **tanpa konversi zona**. FE kirim UTC, tapi FoxLogger menginterpretasikan `time1/time2` sebagai zona lokal (WIB) → jendela request meleset **-7 jam** | `src/services/foxlogger.js` |
| ~now | **`toSourceNaive(value, timeZone)`** — util baru di `timestamp.js` (kebalikan `toUtcIso`): konversi UTC ISO → string naif `"YYYY-MM-DD HH:mm:ss"` di zona `config.foxlogger.timezone` (default `FOXLOGGER_TIMEZONE`/`Asia/Jakarta`) | `src/utils/timestamp.js` |
| ~now | **`fmtFoxTime` diperbaiki** — input ISO ber-zona → konversi ke naif zona source; input sudah naif → passthrough (fallback `time1/time2`). Default range (`24h` lalu → sekarang) juga ikut dikonversi via `foxTimeRange(params)` | `src/services/foxlogger.js` |
| ~now | **Diterapkan ke semua endpoint FoxLogger ber-range** — `getDeviceRoute` (report-history+rollback), `getDeviceParking`, `getDeviceSummary` | `src/services/foxlogger.js` |
| ~now | **Test** — `toSourceNaive` (timestamp.test.js) + `fmtFoxTime` (foxlogger.test.js) — total **141 test pass** | `src/__tests__/` |

**Konfirmasi:** `from=2026-08-05T17:00:00Z` → `time1=2026-08-06 00:00:00` (WIB). Sisi response sudah benar sebelumnya (naif→UTC via `toUtcIso`).

### Playback FoxLogger — enrich `course` + `nopol` via `report-rollback`

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **`getDeviceRollback()`** — service baru untuk `GET /web-tracker-staging/report-rollback` (param imei, user_id, time1, time2) | `src/services/foxlogger.js` |
| ~now | **`enrichHistoryWithRollback()`** — normalisasi `report-history` + merge `report-rollback` per waktu: `dir` → root `course` (fallback 0), `nopol` → `attributes.nopol`. Murni & di-export untuk test | `src/services/foxlogger.js` |
| ~now | **`getDeviceRoute` fetch paralel** — `report-history` + `report-rollback` via `Promise.allSettled` (salah satu gagal tidak memutus playback) | `src/services/foxlogger.js` |
| ~now | **Test** — `foxlogger.test.js` (5) — total **135 test pass** | `src/__tests__/` |

### Catatan Keputusan (dengan FE)
- `status` = komunikasi; `running` = mesin/gerak — dipisah. Parkir diam + komunikasi normal = `online` + `running: STOP/IDLING`.
- `device-status` field `status` wajib; dikirim on-change + heartbeat (~90s) + snapshot saat reconnect.
- `position` change-only; tetap bawa `speed`/`course`; urutan untuk device baru: `position` dulu, baru `device-status: online`.
- **`null` = data tidak tersedia**; 5 field sensor selalu ada (FE toleran terhadap payload lama yang absent).
- **Offline → sensor `null` + `running: "UNKNOWN"`** (bukan nilai basi cache).
- **Connection `unknown` tidak dipakai** — `running: UNKNOWN` (>24 jam) cukup sebagai penanda device mati/basi.
- **Threshold offline default 10 menit**; hierarki override: device > group > type > source > global (level group/type = future extension point).
- Device sleep (1 jam) / deep sleep (24 jam) tampil `offline` di sela laporan — sesuai definisi koneksi; `running` tetap dari data terakhir (<24 jam).

## 2026-08-05

### Fitur Baru — Summary Time-Series (Driving Report per Hari/Minggu/Bulan/Tahun)

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **`granularity` di `/api/reports/summary`** — `day` \| `week` \| `month` \| `year` untuk breakdown per periode (per device & per custom group, agregasi lintas source). Tanpa `granularity` → response lama (backward compatible) | `src/routes/reports.js` |
| ~now | **Sumber data time-series** — MSPF native `/v3/stats/devices/{id}/reports` + `/v3/stats/devices/reports?bcId=` (DAILY/UTC, pagination, cache 1 jam), Traccar agregasi `/reports/trips`, FoxLogger agregasi `/web-tracker/report-summary` | `src/services/mspf.js`, `src/routes/reports.js` |
| ~now | **Bucket kosong diisi 0/null** supaya grafik kontinu dari `from` s.d. `to`. Key: `day`→`YYYY-MM-DD`, `week`→`YYYY-Www` (ISO), `month`→`YYYY-MM`, `year`→`YYYY` | `src/utils/periodStats.js` |
| ~now | **Akses kontrol** — customer hanya bisa series untuk device/group di assign-nya (403), group custom wajib ada di DB (404) | `src/routes/reports.js` |

### Normalisasi Timestamp — Semua Endpoint ke UTC

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **Util `toUtcIso()`** — titik tunggal konversi ke UTC ISO. Naif FoxLogger `"YYYY-MM-DD HH:mm:ss"` diinterpretasi sebagai zona `FOXLOGGER_TIMEZONE` (default `Asia/Jakarta`) lalu dikonversi ke UTC. Tanggal-only dianggap UTC. Sentinel `0000-00-00` → null | `src/utils/timestamp.js`, `src/config/index.js`, `.env.example` |
| ~now | **FoxLogger** — `normalizeDevice`, `normalizeReportPosition`, `normalizeHistoryPosition` (**fix bocoran timestamp raw** di `/reports/route`), fallback builder, `normalizeFoxLoggerPositionForDevice` — semua via `toUtcIso` | `src/services/foxlogger.js` |
| ~now | **MSPF** — `normalizePosition`, `normalizeDevice` (lastUpdate), `enrichPositions` (serverTime/insDtm), MCCS attributes/detail (createdAt/insDtm), `normalizeDeviceStatus` — defensive `toUtcIso` | `src/services/mspf.js` |
| ~now | **Routes** — `/parking` (`from_time`/`to_time`/`parkingStartTime`), `/trips` (`timeStart`/`timeEnd`), `/idle`, `/events` (`eventTime`/`openedAt`/`closedAt`), dashboard `recentEvents` — semua output timestamp dijamin UTC | `src/routes/reports.js`, `src/routes/dashboard.js` |

### Test

| Waktu | Perubahan |
|-------|-----------|
| ~now | Unit test `timestamp.test.js` (10) + `periodStats.test.js` (15) + integration summary time-series (9) — total 108 test pass |

## 2026-08-04

### Perbaikan Semantik Timestamp MSPF

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **Envelope MCCS dipertahankan** — `getLatestMccsData` kini mengembalikan `{ data, createdAt, insDtm }` alih-alih hanya `.data` (sebelumnya `createdAt`/`insDtm` dibuang) | `src/services/mspf.js` |
| ~now | **`serverTime` MSPF = `insDtm`** — `enrichPositions` mengisi `serverTime` dari `insDtm` (waktu MSPF menerima data), fallback ke jam gateway; hanya untuk posisi terbaru per device agar tidak menyesatkan pada route history | `src/services/mspf.js` |
| ~now | **Expose `createdAt`/`insDtm`** — ditambahkan ke `attributes` posisi (`normalizeMccsToAttributes`) dan `mobilityData` device detail (`normalizeMccsForDeviceDetail`) | `src/services/mspf.js` |
| ~now | **Fiks referensi cache** — `normalizeDevice` baca `mccsCache.get(id)?.data?.addr?.IB` (envelope), bukan `?.addr?.IB` | `src/services/mspf.js` |
| ~now | **Dokumentasi** — semantik `deviceTime`/`serverTime`/`fixTime` per source dijelaskan; contoh response diperbarui | `API_REFERENCE.md` |
| ~now | **WS FoxLogger polling** — tambah `startFoxLoggerPolling()` (mirror pola MSPF): `foxlogger.getPositions()` tiap `POLL_INTERVAL`, filter device aktif dari cache, emit `position` + `device-status` dengan `source:'foxlogger'` | `src/websocket/index.js` |
| ~now | **WS customer access filter FoxLogger** — helper `isDeviceAllowed()` menangani `device_groups` FoxLogger (IMEI string atau numeric simulated ID) di `emitPosition` & `emitDeviceStatus` | `src/websocket/index.js` |

## 2026-07-01

### Fitur Baru

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **Source group list** — `GET /api/admin/groups/sources` untuk dropdown assign device di FE admin | `src/routes/groupsAdmin.js` |
| ~08:00 | **Parking endpoint** — `GET /api/reports/parking` unified Traccar + MSPF | `src/routes/reports.js` |
| ~08:30 | **Idle endpoint** — `GET /api/reports/idle` per-device | `src/routes/reports.js` |
| ~09:00 | **Trip reports** — `GET /api/reports/trips` per-device | `src/routes/reports.js` |
| ~09:30 | **Summary report** — `GET /api/reports/summary` per-device/group/all | `src/routes/reports.js` |
| ~10:00 | **Event history** — `GET /api/reports/events` | `src/routes/reports.js` |
| ~10:30 | **Dashboard** — `GET /api/dashboard` ringkasan device | `src/routes/dashboard.js`, `src/app.js` |
| ~11:00 | **Voltage, internalBattery, batteryLevel, ignition** di root WS + REST | `src/websocket/index.js`, `src/routes/positions.js`, `src/routes/devices.js`, `src/services/mspf.js` |

### Perbaikan

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **Security: ganti `new Function()` → `mathjs.evaluate()`** di compute formula untuk cegah RCE via formula injection | `src/services/customAttributes.js`, `API_REFERENCE.md` |
| ~now | **Duplicate group name validation** — `PUT /api/admin/groups/:id` cek nama duplikat sebelum update, return `409 ERR_CONFLICT` ke FE | `src/routes/groupsAdmin.js` |
| ~07:00 | **WS per-user filter** — filter position & device-status per customer group | `src/websocket/index.js` |
| ~07:30 | **Positions + Reports route filter** — filter `device_groups` untuk non-admin | `src/routes/positions.js`, `src/routes/reports.js` |
| ~08:00 | **MSPF positions pagination + BC filter** — `getPositions` pagination loop + filter `bc[]` dari cache | `src/services/mspf.js`, `src/routes/positions.js`, `src/websocket/index.js` |
| ~08:30 | **MCCS concurrency limit** — batch 10 request cegah 504 timeout | `src/services/mspf.js` |
| ~09:00 | **Course enrichment MSPF** — pakai `mccs.dir` untuk root `course` | `src/services/mspf.js` |
| ~10:00 | **Background position sync** — `positionSync.js` fetch+enrich tiap 10 detik | `src/services/positionSync.js`, `src/server.js` |
| ~10:30 | **Position cache** — `positions:merged` cache, REST baca dari cache (instan) | `src/routes/positions.js` |
| ~10:45 | **Device cache eager startup** — build `devices:merged` sebelum positionSync | `src/server.js` |
| ~11:00 | **PositionSync guards** — skip jika BC kosong, MSPF fail log, cache lama dipertahankan | `src/services/positionSync.js` |
| ~11:15 | **MCCS cache → NodeCache** — ganti Map manual ke NodeCache (stdTTL 10s) | `src/services/mspf.js` |
| ~12:10 | **waitForInit** — tunggu OAuth siap sebelum build device cache | `src/services/mspf.js`, `src/server.js` |
| ~12:10 | **PositionSync per-source log** — `cached: traccar X/exp, mspf Y/exp` | `src/services/positionSync.js` |
| ~13:45 | **Route date range validation** — MSPF max 7 hari, error `ERR_VALIDATION` | `src/routes/reports.js` |

### Bug Fix

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~07:15 | Race condition WS allowedDevices — inisialisasi Set sinkron sebelum await DB | `src/websocket/index.js` |
| ~08:10 | `traccarResult.value` guard — cegah `.map()` pada undefined | `src/routes/devices.js` |
| ~11:30 | `if (activeIds)` guard — cegah TypeError `null.has()` | `src/services/positionSync.js` |

## 2026-07-29

### Perbaikan FoxLogger Integration

| Waktu | Perubahan | File |
|-------|-----------|------|
| ~now | **Simulated numeric ID** — FoxLogger device ID pakai `parseInt(IMEI)` (integer, 15-16 digit). Bukan IMEI string. `imeiMap` cache mapping simulatedId ↔ IMEI asli. `resolveImei()` helper untuk API calls | `src/services/foxlogger.js` |
| ~now | **Positions live API** — `/api/positions` dan `/api/positions/latest` untuk FoxLogger panggil langsung `foxlogger.getPositions()`, bukan filter dari cache stale | `src/routes/positions.js` |
| ~now | **Positions backward compat** — filter device_groups untuk FoxLogger handle old (IMEI string) dan new (simulated ID) entries | `src/routes/positions.js` |
| ~now | **Summary report fix** — hapus `foxlogger.getDeviceSummary('all')` yang selalu gagal (IMEI='all' invalid). Tambah single-device FoxLogger summary handler | `src/routes/reports.js` |
| ~now | **Health check aktif** — `/health/detailed` untuk FoxLogger panggil `/geo-fences/0`, bukan cuma cek `getApi()` exists | `src/routes/health.js` |
| ~now | **Test-friendly init** — skip auto-init + `waitForInit` jika credentials kosong | `src/services/foxlogger.js`, `src/__tests__/jest.setup.js` |
| ~now | **Auth bypass fix P0** — `if (!isAdmin && userGroups.length > 0)` → `if (!isAdmin)`. Customer tanpa group assignment sekarang lihat 0 device (sebelumnya lihat semua). Fix di semua routes: devices, positions, reports, dashboard | `src/routes/devices.js`, `src/routes/positions.js`, `src/routes/reports.js`, `src/routes/dashboard.js` |
