# Changelog

> Semua perubahan signifikan dicatat di file ini.

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
