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
| **Unit tests** — 36 tests (incl. stable pagination test) | ✅ |
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
