# Changelog

> Semua perubahan signifikan dicatat di file ini.

## 2026-07-01

### Fitur Baru

| Waktu | Perubahan | File |
|-------|-----------|------|
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
