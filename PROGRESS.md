# Progress Tracker

> Update file ini saat ada progres implementasi.

## Phase 1 — Selesai: ✅

| Step | Task | Status |
|------|------|--------|
| 1 | Initialize Gateway Auth DB (SQLite + seed admin) | ✅ |
| 2 | Auth Module (login, JWT, middleware) | ✅ |
| 3 | User Management (admin — group assignment) | ✅ |
| 4 | Group Aggregator (`GET /api/groups`) | ✅ |
| 5 | Device Proxy & Cache (`GET /api/devices`) | ✅ |
| 6 | Command Router + Unified Activation (Traccar & MSPF) | ✅ |
| 7 | Activation Proxy (MSPF `PUT /activation`) | ✅ |
| 8 | WebSocket Bridge (Socket.io + MSPF polling) | ✅ |
| 9 | Normalisasi MSPF → Traccar format | ✅ |
| 10 | MCCS Mobility Data atribut dokumentasi | ✅ |
| 11 | Error handling 502/504 (classifyAxiosError) | ✅ |
| 12 | Graceful shutdown (SIGTERM/SIGINT) | ✅ |

## Phase 2 — Selesai: ⬜

| Task | Status |
|------|--------|
| Rate limiting & throttling (`express-rate-limit`) | ✅ |
| Enhanced structured logging (Winston JSON + correlation ID) | ✅ |
| **MSPF auth: OAuth2 client_credentials** (auto-get token + refresh) | ✅ |
| **Traccar auth: Basic Auth** (username:password) | ✅ |
| Redis adapter for Socket.io (@socket.io/redis-adapter + ioredis) | ✅ |
| Integration tests (Jest + Supertest, 15 tests all passed) | ✅ |
| **express-validator** — validasi deklaratif di semua route | ✅ |
| **http-errors** — standardized error throwing | ✅ |
| **knex.js** — database abstraction (SQLite dev / PostgreSQL prod) | ✅ |
| **Dockerfile + docker-compose** (Gateway + Redis) | ✅ |
| **Tracking enriched** — DeviceStatus + MCCS MobilityData di attributes | ✅ |
| **Route history** — `GET /api/reports/route` merged Traccar + MSPF | ✅ |
| **Positions enriched** — speed/ignition/voltage dari DeviceStatus | ✅ |
| **Device detail enriched** — MCCS data (kph, volt, hdop, sats, odom, addr.*) | ✅ |
| **WS position** — event kirim ignition, voltage, sats, running | ✅ |
| **MCCS atribut lengkap** — tid, mid, ts, code, ver, sno, volt, addr_AD, addr_AD2, addr_NT | ✅ |
| Prometheus metrics | ⬜ |
| **Pagination loop MSPF** — fetch semua device (1109) via multiple pages | ✅ |
| **Traccar WebSocket** — ganti polling REST dengan WS real-time | ✅ |
| **Memory fix** — MCCS cache limited (200 max, 30s TTL), device cache TTL 120s | ✅ |
| **Filter WORKING only** — device list, positions, WS hanya device WORKING | ✅ |
| **lastKnown filter** — posisi & WS tetap filter walau cache expired | ✅ |
| **Traccar WS** — fix URL, max retry 3, fallback REST polling | ✅ |
| **Logging** — Device cache count, WS position count with raw/allowed | ✅ |
| **Running status** — RUN/IDLING/STOP/TOWING/UNKNOWN (24h stale) | ✅ |
| **device-status event** — includes running, ignition, voltage, lastUpdate | ✅ |
| **Traccar running** — kalkulasi dari ignition + speed | ✅ |
| **UNKNOWN stale** — running status UNKNOWN jika lastUpdate > 24 jam | ✅ |
| **Custom Groups** — groups + device_groups tabel di DB middleware | ✅ |
| **Customer filter via device_groups** — bukan group/BC backend | ✅ |
| **Admin endpoints** — CRUD groups + assign device batch | ✅ |
| **Group auto-sync** — otomatis import device dari Traccar/MSPF ke group | ✅ |
| **Device existence validation** — validasi device sebelum assign ke group | ✅ |
| **Device name enrichment** — device-groups return deviceName | ✅ |
| **camelCase consistency** — semua response normal ke camelCase | ✅ |
| **customGroups enrichment** — device list & detail include custom group info | ✅ |
| **Custom Attributes** — passthrough/rename/compute per custom group | ✅ |
| **Admin CRUD** — custom-attributes endpoint | ✅ |
| **Apply rules** — devices list, detail, positions, WS (per-device via cache) | ✅ |
| **Device rules cache** — 120s TTL, 0 DB query per request | ✅ |
| **Root fields** — id, name, status, speed tetap muncul (tidak terpengaruh) | ✅ |
| **Pagination stable** — device list sorted by ID (no duplicate/leak on cache refresh) | ✅ |
| **Unit tests** — 74 tests (incl. stable pagination test) | ✅ |
| **Available fields** — GET /api/admin/custom-attributes/available-fields | ✅ |
| **Group preview** — GET /api/groups/:id/preview (daftar atribut yang muncul di FE) | ✅ |
| **Reports route fix** — auto-probe cache miss, tidak intermittent 404 | ✅ |
| **Route history enriched** — custom attributes diterapkan di `/api/reports/route` & `/api/positions` single-device | ✅ |
| **Attribute filter** — REST & WS hanya kirim atribut yang dikonfigurasi (custom rules), sisanya `{}` | ✅ |
| **User update** — PUT /api/users/:id (username, password, role, groups) | ✅ |
| **Group preview access** — customer hanya bisa preview group yang di-assign (403 jika tidak punya akses) | ✅ |
| **Test cleanup** — beforeAll/afterAll hapus test groups, prevent data leak antartest | ✅ |
| **WS per-user filter** — Socket.io emit filtered position per role (admin enriched + custom attr, customer custom attr only) | ✅ |
| **WS debug log** — console.log position payload dengan perbandingan admin vs customer | ✅ |
| **getField fix** — ganti lodash.get dengan bracket notation biar source_field bertitik (addr.IB) bisa di-resolve | ✅ |
| **Group preview admin** — visibleAttributes untuk admin include enriched default attributes + custom rules | ✅ |
| **Reports/positions admin** — `/api/reports/route` & `/api/positions` admin lihat enriched + custom rename/compute | ✅ |
| **Device metadata** — tabel `device_metadata`, PUT /api/devices/:id/metadata, enrich di device list & detail | ✅ |
| **WS customer access filter** — perbaiki race condition, filter position & device-status per customer group | ✅ |
| **Positions customer filter** — `GET /api/positions` & `/latest` filter by `device_groups` untuk non-admin | ✅ |
| **Reports route customer filter** — `GET /api/reports/route` check access `device_groups` untuk non-admin | ✅ |
| **Parking endpoint** — `GET /api/reports/parking` unified Traccar (stops) + MSPF (parking) per-device | ✅ |
| **Traccar getReportStops** — service function `GET /reports/stops` dengan filter engineHours=0 (parking only) | ✅ |
| **MSPF getDeviceParkingAll** — service function `GET /v3/stats/devices/{id}/parking` dengan auto-pagination via next token | ✅ |
| **Idle endpoint** — `GET /api/reports/idle` per-device, Traccar (engineHours>0) + MSPF (kalkulasi dari route positions) | ✅ |
| **calculateIdleSegments utility** — fungsi kalkulasi segmen idle dari array positions (speed=0 + ignition=true) | ✅ |
| **Trip reports** — `GET /api/reports/trips` per-device, Traccar (data lengkap) + MSPF (enriched via route: distance, speed) | ✅ |
| **Haversine distance utility** — kalkulasi jarak antar koordinat untuk enrichment MSPF trip | ✅ |
| **MSPF trip enrichment** — distance (akumulasi Haversine via route), maxSpeed, averageSpeed dari route positions | ✅ |
| **Traccar getReportTrips** — service function `GET /reports/trips` dengan konversi knots→km/h, meters→km | ✅ |
| **MSPF getDeviceTrip** — service function `GET /v4/stats/devices/{id}/trip` | ✅ |
| **Summary report** — `GET /api/reports/summary` per-device, per-group, atau semua device | ✅ |
| **Traccar getReportSummary** — service `GET /reports/summary` dengan konversi knots→km/h, meters→km | ✅ |
| **MSPF getStatsSummary** — service `GET /v3/stats/devices/summary` untuk multi-device summary | ✅ |
| **MSPF single device enrichment** — route-based kalkulasi distance, maxSpeed, averageSpeed, duration | ✅ |
| **Event history** — `GET /api/reports/events` per-device (enriched) + multi-device (fast) | ✅ |
| **Traccar events** — service `GET /reports/events` + `GET /geofences` untuk enrich nama geofence | ✅ |
| **MSPF events** — service `GET /v4/events` + `GET /v4/closed-events` via bcId | ✅ |
| **Event status derivation** — mapping Traccar event type → OPEN/CLOSE | ✅ |
| **Event name derivation** — Traccar: nama geofence atau human-readable name. MSPF: monitorName | ✅ |
| **Dashboard endpoint** — `GET /api/dashboard` ringkasan device stats, running status, summary, recent events | ✅ |
| **Dashboard route** — `src/routes/dashboard.js` + registered di `app.js` | ✅ |
| **Voltage & internalBattery di root** — WS position, device list/detail, positions endpoint | ✅ |
| **WebSocket root battery** — `emitPosition` extract voltage + internalBattery ke root payload | ✅ |
| **REST battery enrichment** — device list (normalize), device detail (enrichDevice), positions (enrichPositionRootFields) | ✅ |
| **batteryLevel** — root field baru di WS + REST, dari Traccar `attributes.batteryLevel` (0-100%) | ✅ |
| **Course enrichment MSPF** — `enrichPositions` pakai `mccs.dir` untuk root `course` jika raw position 0 | ✅ |
| **Ignition di root** — semua endpoint (WS, positions, devices) extract `ignition` ke root level | ✅ |
| **Fix MSPF positions limit** — hapus cap 200, pakai `limit` dari query langsung (max 1000) | ✅ |
| **MSPF positions pagination + BC filter** — `getPositions` pagination loop page 1000 + filter `bc[]` dari cache device | ✅ |
| **MSPF BC extract** — `getMspfBcIds()` helper di positions route + websocket, extract bcId unik dari cache `devices:merged` | ✅ |
| **MCCS concurrency limit** — `getBatchMccsData` batch 10 request per Promise.allSettled, cegah 504 timeout | ✅ |
| **Background position sync** — `positionSync.js` fetch+enrich setiap 10 detik, cache `positions:merged` TTL 30s | ✅ |
| **Positions pagination** — `GET /api/positions` pake `offset` + `limit`, baca dari cache (instan) | ✅ |
| **Backup posision mute** — `console.log` WS BLOCKED di-disable, `PositionSync` count log ganti memory stats | ✅ |
| **Traccar positions tanpa limit** — hapus `limit: 1000` di `getPositions()` biar aman >1000 device | ✅ |
| **MCCS cache → NodeCache** — NodeCache stdTTL 10s, try-catch guard, tanpa maxKeys | ✅ |
| **EnrichPositions graceful** — `getBatchMccsData` di try-catch, error tidak propagasi ke positions | ✅ |
| **PositionSync guard** — cek `mspfResult.status !== 'fulfilled'`, bukan `positions.length === 0` (yang lolos saat Traccar sukses) | ✅ |
| **Device cache eager startup** — `server.js` build `devices:merged` sebelum `startPositionSync`, tidak perlu nunggu hit FE | ✅ |
| **PositionSync skip** — jika BC IDs kosong (device cache belum ready), skip sync + log warning | ✅ |
| **PositionSync log MSPF error** — log `[PositionSync] MSPF failed: ...` saat MSPF gagal | ✅ |
| **PositionSync BC fallback** — jika device cache kosong, fetch `getBcList()` dari MSPF API langsung | ✅ |
| **PositionSync per-source log** — `cached: traccar X/exp, mspf Y/exp` untuk monitoring | ✅ |
| **waitForInit** — `server.js` tunggu OAuth siap sebelum `mspf.getDevices()` di build cache | ✅ |
| **PositionSync device cache expired guard** — jika `activeIds = null`, **rebuild otomatis** device cache + retry sync | ✅ |
| **Route date range validation** — MSPF max 7 hari, error jelas `Date range max 7 days for MSPF devices` | ✅ |
| **Traccar lastUpdate fallback** — pakai `attributes.motionTime` jika `lastUpdate` null | ✅ |
