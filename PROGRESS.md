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
|| **User update** — PUT /api/users/:id (username, password, role, groups) | ✅ |
|| **Group preview access** — customer hanya bisa preview group yang di-assign (403 jika tidak punya akses) | ✅ |
|| **Test cleanup** — beforeAll/afterAll hapus test groups, prevent data leak antartest | ✅ |
|| **WS per-user filter** — Socket.io emit filtered position per role (admin enriched + custom attr, customer custom attr only) | ✅ |
|| **WS debug log** — console.log position payload dengan perbandingan admin vs customer | ✅ |
|| **getField fix** — ganti lodash.get dengan bracket notation biar source_field bertitik (addr.IB) bisa di-resolve | ✅ |
|| **Group preview admin** — visibleAttributes untuk admin include enriched default attributes + custom rules | ✅ |
|| **Reports/positions admin** — `/api/reports/route` & `/api/positions` admin lihat enriched + custom rename/compute | ✅ |
|| **Device metadata** — tabel `device_metadata`, PUT /api/devices/:id/metadata, enrich di device list & detail | ✅ |
|| **WS customer access filter** — perbaiki race condition, filter position & device-status per customer group | ✅ |
|| **Positions customer filter** — `GET /api/positions` & `/latest` filter by `device_groups` untuk non-admin | ✅ |
|| **Reports route customer filter** — `GET /api/reports/route` check access `device_groups` untuk non-admin | ✅ |
|| **Parking endpoint** — `GET /api/reports/parking` unified Traccar (stops) + MSPF (parking) per-device | ✅ |
|| **Traccar getReportStops** — service function `GET /reports/stops` dengan filter engineHours=0 (parking only) | ✅ |
|| **MSPF getDeviceParkingAll** — service function `GET /v3/stats/devices/{id}/parking` dengan auto-pagination via next token | ✅ |
|| **Idle endpoint** — `GET /api/reports/idle` per-device, Traccar (engineHours>0) + MSPF (kalkulasi dari route positions) | ✅ |
|| **calculateIdleSegments utility** — fungsi kalkulasi segmen idle dari array positions (speed=0 + ignition=true) | ✅ |
|| **Trip reports** — `GET /api/reports/trips` per-device, Traccar (data lengkap) + MSPF (enriched via route: distance, speed) | ✅ |
|| **Haversine distance utility** — kalkulasi jarak antar koordinat untuk enrichment MSPF trip | ✅ |
|| **MSPF trip enrichment** — distance (akumulasi Haversine via route), maxSpeed, averageSpeed dari route positions | ✅ |
|| **Traccar getReportTrips** — service function `GET /reports/trips` dengan konversi knots→km/h, meters→km | ✅ |
|| **MSPF getDeviceTrip** — service function `GET /v4/stats/devices/{id}/trip` | ✅ |
|| **Summary report** — `GET /api/reports/summary` per-device, per-group, atau semua device | ✅ |
|| **Traccar getReportSummary** — service `GET /reports/summary` dengan konversi knots→km/h, meters→km | ✅ |
|| **MSPF getStatsSummary** — service `GET /v3/stats/devices/summary` untuk multi-device summary | ✅ |
|| **MSPF single device enrichment** — route-based kalkulasi distance, maxSpeed, averageSpeed, duration | ✅ |
|| **Event history** — `GET /api/reports/events` per-device (enriched) + multi-device (fast) | ✅ |
|| **Traccar events** — service `GET /reports/events` + `GET /geofences` untuk enrich nama geofence | ✅ |
|| **MSPF events** — service `GET /v4/events` + `GET /v4/closed-events` via bcId | ✅ |
|| **Event status derivation** — mapping Traccar event type → OPEN/CLOSE | ✅ |
|| **Event name derivation** — Traccar: nama geofence atau human-readable name. MSPF: monitorName | ✅ |
|| **Dashboard endpoint** — `GET /api/dashboard` ringkasan device stats, running status, summary, recent events | ✅ |
|| **Dashboard route** — `src/routes/dashboard.js` + registered di `app.js` | ✅ |
|| **Voltage & internalBattery di root** — WS position, device list/detail, positions endpoint | ✅ |
|| **WebSocket root battery** — `emitPosition` extract voltage + internalBattery ke root payload | ✅ |
|| **REST battery enrichment** — device list (normalize), device detail (enrichDevice), positions (enrichPositionRootFields) | ✅ |
|| **batteryLevel** — root field baru di WS + REST, dari Traccar `attributes.batteryLevel` (0-100%) | ✅ |
|| **Course enrichment MSPF** — `enrichPositions` pakai `mccs.dir` untuk root `course` jika raw position 0 | ✅ |
|| **Ignition di root** — semua endpoint (WS, positions, devices) extract `ignition` ke root level | ✅ |
|| **Fix MSPF positions limit** — hapus cap 200, pakai `limit` dari query langsung (max 1000) | ✅ |
|| **MSPF positions pagination + BC filter** — `getPositions` pagination loop page 1000 + filter `bc[]` dari cache device | ✅ |
|| **MSPF BC extract** — `getMspfBcIds()` helper di positions route + websocket, extract bcId unik dari cache `devices:merged` | ✅ |
|| **MCCS concurrency limit** — `getBatchMccsData` batch 10 request per Promise.allSettled, cegah 504 timeout | ✅ |
|| **Background position sync** — `positionSync.js` fetch+enrich setiap 10 detik, cache `positions:merged` TTL 30s | ✅ |
|| **Positions pagination** — `GET /api/positions` pake `offset` + `limit`, baca dari cache (instan) | ✅ |
|| **Backup posision mute** — `console.log` WS BLOCKED di-disable, `PositionSync` count log ganti memory stats | ✅ |
|| **Traccar positions tanpa limit** — hapus `limit: 1000` di `getPositions()` biar aman >1000 device | ✅ |
|| **MCCS cache → NodeCache** — NodeCache stdTTL 10s, try-catch guard, tanpa maxKeys | ✅ |
|| **EnrichPositions graceful** — `getBatchMccsData` di try-catch, error tidak propagasi ke positions | ✅ |
|| **PositionSync guard** — cek `mspfResult.status !== 'fulfilled'`, bukan `positions.length === 0` (yang lolos saat Traccar sukses) | ✅ |
|| **Device cache eager startup** — `server.js` build `devices:merged` sebelum `startPositionSync`, tidak perlu nunggu hit FE | ✅ |
|| **PositionSync skip** — jika BC IDs kosong (device cache belum ready), skip sync + log warning | ✅ |
|| **PositionSync log MSPF error** — log `[PositionSync] MSPF failed: ...` saat MSPF gagal | ✅ |
|| **PositionSync BC fallback** — jika device cache kosong, fetch `getBcList()` dari MSPF API langsung | ✅ |
|| **PositionSync per-source log** — `cached: traccar X/exp, mspf Y/exp` untuk monitoring | ✅ |
|| **waitForInit** — `server.js` tunggu OAuth siap sebelum `mspf.getDevices()` di build cache | ✅ |
|| **PositionSync device cache expired guard** — jika `activeIds = null`, **rebuild otomatis** device cache + retry sync | ✅ |
|| **Route date range validation** — MSPF max 7 hari, error jelas `Date range max 7 days for MSPF devices` | ✅ |
|| **Traccar lastUpdate fallback** — pakai `attributes.motionTime` jika `lastUpdate` null | ✅ |
|| **Source group list** — `GET /api/admin/groups/sources` daftar Traccar groups + MSPF BCs untuk dropdown FE admin | ✅ |
|| **FoxLogger integration** — service, config, device cache, position sync, health check | ✅ |
|| **MSPF timestamp semantics** — `serverTime` = `insDtm` (waktu MSPF menerima) untuk posisi terbaru; expose `createdAt`/`insDtm` di attributes & `mobilityData` | ✅ |
|| **WS FoxLogger polling** — emiter `position`/`device-status` FoxLogger via `report-position` tiap 10s (mirror pola MSPF), filter device aktif, guard kredensial | ✅ |
|| **WS FoxLogger access filter** — `isDeviceAllowed()` handle `device_groups` FoxLogger (IMEI string / numeric simulated ID) untuk customer | ✅ |

## Phase 3 — Sedang Berjalan: ⬜

| Task | Status |
|------|--------|
| **Normalisasi timestamp UTC** — util `toUtcIso()` (naif FoxLogger → `FOXLOGGER_TIMEZONE` default Asia/Jakarta), diterapkan di service foxlogger/mspf + routes reports/dashboard | ✅ |
| **Fix bocoran timestamp raw FoxLogger** — `/reports/route` & `/parking` kini keluarkan UTC ISO, bukan `"YYYY-MM-DD HH:mm:ss"` | ✅ |
| **Summary time-series** — `GET /api/reports/summary?granularity=day\|week\|month\|year` per device & per custom group (agregasi Traccar + MSPF + FoxLogger), bucket kosong diisi 0, backward compatible | ✅ |
| **MSPF stats reports** — service `getDeviceStatsReports` + `getBcStatsReports` (DAILY/UTC, pagination, cache 1 jam) | ✅ |
| **Unit + integration test** — `timestamp.test.js`, `periodStats.test.js`, summary time-series (total 108 test pass) | ✅ |
| **Live Tracking Redesign** — StatusTracker (`liveStatus.js`) + single worker `positionSync` + WS change-only + online/offline + heartbeat + snapshot reconnect (detail di CHANGELOG 2026-08-06) | ✅ |
| **Unit + integration test v2** — `liveStatus.test.js` (12) + `positionSync.test.js` (3) — total 123 test pass | ✅ |
| **Kontrak `device-status` final** — 5 field sensor selalu ada (nilai/`null`); offline → sensor `null` + `running: "UNKNOWN"`; `lastUpdate` = waktu data terakhir; `status` connection = `online`/`offline` saja (tanpa `unknown`) | ✅ |
| **Threshold hierarki extensible** — `resolveThresholds`: per-device → per-group (future) → per-type (future) → per-source → global (default **10 menit**) | ✅ |
| **Unit + integration test v3** — `statusPayload.test.js` (4) + update liveStatus/positionSync (threshold 10m) — total **130 test pass** | ✅ |
| **Playback FoxLogger enrich `course`+`nopol`** — `getDeviceRollback()` + `enrichHistoryWithRollback()` (merge `report-rollback` per waktu: `dir`→course, `nopol`→attributes), `getDeviceRoute` fetch paralel — **135 test pass** | ✅ |
| **Bugfix timezone request FoxLogger** — `fmtFoxTime` tanpa konversi zona → `time1/time2` meleset -7 jam. Fix: `toSourceNaive()` + `foxTimeRange()`, semua endpoint ber-range (history/rollback/park/summary) — **141 test pass** | ✅ |
| **Playback Traccar → `/reports/route`** — `traccar.getReportRoute()` (wrapper `GET /reports/route`, speed knots→km/h via `toKmh`), default range "hari ini" (00:00 zona user → now) saat `from`/`to` kosong, berlaku semua source | ✅ |
| **Urutan playback konsisten ASC** — sort by `deviceTime` naik di gateway (safety net; MSPF sudah ASC via `reverse()`) | ✅ |
| **Timezone per user** — kolom `users.timezone`, `timezone` **required** saat add user & optional saat edit (validasi IANA), fallback `DEFAULT_USER_TIMEZONE` (.env), login/`/me` + GET users mengembalikan `timezone`, default range report memakai zona user — **159 test pass** | ✅ |

## Catatan Waktu FoxLogger (jangan diulang)

- **Response FoxLogger** = naif WIB → gateway konversi ke UTC (`toUtcIso`, pakai `FOXLOGGER_TIMEZONE`).
- **Request `time1`/`time2` ke FoxLogger** = harus dikirim sebagai **naif zona `FOXLOGGER_TIMEZONE`** (default Asia/Jakarta), BUKAN UTC. FE kirim UTC → gateway konversi via `toSourceNaive`.
- Zona dikendalikan env `FOXLOGGER_TIMEZONE` (config dibaca saat startup → restart bila diubah).

## Definisi Status (catatan — jangan diubah tanpa persetujuan)

**`running` — status DEVICE (kondisi mesin/gerak):**

| Nilai | Kondisi |
|-------|---------|
| `RUN` | engine on, speed > 0 |
| `IDLE` | engine on, speed 0 |
| `STOP` | engine off, speed 0 |
| `TOWING` | engine off, speed > 0 |
| `UNKNOWN` | device tidak terhubung / update data **> 24 jam** (boundary deep sleep) |

**`status` — status KONEKSI device:**

| Nilai | Kondisi |
|-------|---------|
| `online` | masih komunikasi, data terakhir **< 10 menit** (`OFFLINE_THRESHOLD_MS` = 600000) |
| `offline` | tidak ada data baru **> 10 menit** |
| ~~`unknown`~~ | **tidak dipakai** — penanda "device mati/basi" diwakili `running: UNKNOWN` (> 24 jam) |

**Catatan penting:**
- Dua konsep ini **dipisah** — parkir diam + komunikasi normal = `status: online` + `running: STOP/IDLE`.
- Device **sleep (1 jam)** / **deep sleep (24 jam)** tampil `offline` di sela laporan — wajar sesuai definisi koneksi; `running` tetap dari data terakhir (< 24 jam).
- `null` pada field sensor (`ignition`, `voltage`, `internalBattery`, `batteryLevel`) = **data tidak tersedia**; saat offline → sensor `null`.
- `lastUpdate` saat offline = **waktu data terakhir diterima device** (BUKAN waktu deteksi offline).

## Phase 3 — Backlog Live Tracking, Playback & Events `type`

> Prioritas saat ini: **live tracking & playback lancar & benar**, events menyusul.

| Task | Status |
|------|--------|
| **Analisis live tracking** — Traccar: WS real-time (`/api/socket`) + fallback REST polling 10s; MSPF & FoxLogger: polling 10s (`report-position`). Semua posisi ter-normalisasi UTC. | ✅ |
| **Duplikasi polling MSPF** — WS poller ganda + positionSync → **fixed**: single worker `positionSync` emit via hook | ✅ |
| **Offline detection** — hysteresis (`OFFLINE`/`ONLINE`/`COOLDOWN`), debounce device baru, threshold per-device/per-source/global, field `status` di `device-status`, snapshot saat reconnect, Traccar WS `events` (deviceOnline/Offline) | ✅ |
| **Playback Traccar memakai `/positions`** — spec Traccar: `deviceId` **wajib disertai `from`+`to`** (tanpa → 400). Gateway `/api/reports/route` belum default range → Traccar bisa 400. **Harus ganti ke `/reports/route`** (endpoint resmi untuk route history) + default range (mis. 24 jam terakhir) bila kosong | ✅ **SELESAI 2026-08-06** — pakai `traccar.getReportRoute()`, default = **hari ini (00:00 zona user → now)** |
| **Service `traccar.getReportRoute()`** — tambah wrapper `GET /reports/route` (dipakai `/api/reports/route`) | ✅ **SELESAI 2026-08-06** |
| **Urutan posisi playback konsisten ASC** — MSPF `getDeviceRoute` sudah `reverse()` (MSPF balas DESC); Traccar & FoxLogger perlu dipastikan urut naik. Tambah sort by `deviceTime` di gateway sebagai pengaman | ✅ **SELESAI 2026-08-06** |
| **Deteksi gap / offline di playback** — FE butuh info segmen tanpa data (device off) biar playback tidak "loncat"; potensi tambah field `gap`/`status` per titik | ⬜ Backlog |
| **Events `type` (request FE)** — `/api/reports/events` **tidak punya field `type`**; data mentah ada (`e.type` Traccar, `e.monitorName` MSPF) tapi dibuang saat mapping. Rencana: tambah `type` di SEMUA response (single & multi-device) — Traccar raw type, MSPF `monitorName`; `name` tetap label enrich (null multi-device); envelope seragam (`geofenceId`/`monitorId`/`openedAt`/`closedAt` = null bila tak relevan). **Backlog — bukan prioritas sekarang** | ⬜ Backlog |
| **Filter `?type=` server-side** — simetris dengan `?status=`/`?name=` (opsional, ikut saat implementasi events) | ⬜ Backlog |
| **FoxLogger live speed/course 0** — limitasi source (`report-position` tidak sediakan kecepatan/arah); marker statis untuk **live** — sudah dikomunikasikan ke FE. (Playback kini punya `course`+`nopol` via `report-rollback`.) | ✅/partial |
