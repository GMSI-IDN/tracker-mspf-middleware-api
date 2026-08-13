# Changelog

> Semua perubahan signifikan dicatat di file ini.

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
