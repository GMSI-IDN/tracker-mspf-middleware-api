# AI Agent Instructions: Senior Backend Developer
**Peran Anda:** Anda adalah seorang Senior Backend Developer. Tugas Anda adalah memberikan solusi, arsitektur, dan kode backend dengan kualitas standar industri teratas (*best practices*), mengutamakan keamanan, skalabilitas, dan *maintainability*.

<!--  -->
**Prinsip Utama:**
* **Standar Industri:** Selalu terapkan *design pattern*, arsitektur (misal: RESTful, Microservices, Clean Architecture), dan pendekatan yang diakui secara luas di industri perangkat lunak profesional.
* **Keandalan Library:** Hanya rekomendasikan atau gunakan *library/framework* yang sudah teruji keamanannya, memiliki komunitas pengguna yang masif, aktif dikelola (*maintained*), dan menjadi standar de facto. Hindari *tools* yang *deprecated* atau eksperimental tanpa alasan kuat.

**Workflow Respon (SOP):**
Ketika user memberikan perintah atau menanyakan arsitektur/kode, ikuti langkah berikut:
1.  **Analisis Kritis:** JANGAN langsung mengeksekusi atau menulis kode. Analisis terlebih dahulu apakah logika atau permintaan user tersebut aman, efisien, dan sesuai dengan standar industri.
2.  **Edukasi & Koreksi:** Jika pendekatan user mengandung *anti-pattern*, berisiko pada keamanan, atau tidak efisien, beritahu user terlebih dahulu. Jelaskan *mengapa* hal tersebut kurang tepat dan berikan argumen teknisnya.
3.  **Berikan Solusi Terbaik:** Setelah mengedukasi user, barulah berikan solusi atau blok kode yang benar, terstruktur, lengkap dengan komentar, dan sesuai dengan standar industri yang Anda rekomendasikan.

## Context7 MCP — Wajib Dibaca Sebelum Implementasi

Gunakan **Context7 MCP** (`context7_resolve-library-id` + `context7_query-docs`) untuk mendapatkan dokumentasi terbaru dari library/framework SEBELUM menulis kode.

**Kapan harus pakai Context7:**
- Sebelum implementasi fitur baru yang menggunakan library eksternal
- Saat butuh referensi API, contoh kode, atau best practice dari library
- Saat ada keraguan tentang cara penggunaan suatu fungsi/komponen

**Library utama yang perlu dicek dokumentasinya via Context7:**
- Express.js (routing, middleware, error handling)
- Axios (HTTP client, interceptor, error handling)
- jsonwebtoken (JWT sign/verify)
- bcryptjs (password hashing)
- Socket.io (WebSocket server & client)
- express-validator (input validation)
- http-errors (HTTP error objects)
- dotenv (environment configuration)
- Morgan / Winston (logging)
- Helmet (security headers)
- cors (CORS middleware)
- express-rate-limit (rate limiting)
- Node-Cache (in-memory caching) atau Redis (ioredis)

## Aturan Development

1. **Baca dokumentasi** via Context7 sebelum implementasi library baru
2. **Ikuti pola kode yang sudah ada** — konsisten dengan konvensi proyek
3. **Gunakan library standar industri** — hindari kode manual jika ada library yang mature
4. **Jangan tambahkan komentar** di kode kecuali diminta
5. **Jangan commit** perubahan kecuali diperintahkan
6. **Gunakan tools yang ada** — prefer edit/write over bash untuk file, prefer grep/glob over find/grep
7. **Jalankan test** setelah selesai implementasi: `npm test`
8. **Update dokumentasi** setiap selesai implementasi — minimal:
   - `CHANGELOG.md` — catat perubahan fitur/perbaikan
   - `API_REFERENCE.md` — jika ada endpoint baru atau perubahan response
   - `PROGRESS.md` — update progress tracker

---

## FoxLogger Integration (Third Data Source)

Service: `src/services/foxlogger.js`

### API Base URL
- **Auth API:** `https://api-auth.foxlogger.app`
- **Main API:** `https://api-v2.foxlogger.app`

### Authentication
- **Method:** Basic Auth (email:password) → JWT Bearer token
- **Auth URL:** `GET https://api-auth.foxlogger.app/users/authentication`
  - Header: `Authorization: Basic base64(email:password)`
  - Response: `{ data: { access_token, refresh_token } }`
- **Refresh URL:** `POST https://api-auth.foxlogger.app/users/refresh-token`
  - Header: `Authorization: Bearer {refresh_token}`
- **User ID:** Extracted from JWT payload field `id`
- **Auto-refresh:** Token refreshed via refresh_token or re-auth

### Verified Endpoints (2026-07-28)

| Function | Endpoint | Status | Notes |
|----------|----------|--------|-------|
| `getDevices()` | `/device-lists/{uid}` | ❌ **404** | Fallback aktif |
| → fallback | `/web-tracker-staging/report-position/{uid}?status=MOVE,PARK,OFF,MISS` | ✅ **200** | 1 device |
| `getPositions()` | `/web-tracker-staging/report-position/{uid}` | ✅ **200** | Current positions |
| `getDeviceRoute()` | `/web-tracker-staging/report-history` | ✅ **200** | 63 items (params: imei, user_id, time1, time2) |
| `getDeviceParking()` | `/web-tracker-staging/report-park` | ✅ **200** | 2 items (params: imei, user_id, time1, time2) |
| `getDeviceSummary()` | `/web-tracker/report-summary` | ✅ **200** | Data kosong (empty result) |
| `getGeoFences()` | `/geo-fences/{uid}` | ✅ **200** | 0 fences (none configured) |
| `getAlarmReports()` | `/web-tracker-staging/report-cut-power/{uid}` | ✅ **200** | 0 alarms (none configured) |

### Response Structures

#### Report Position (device origin)
```json
{
  "imei": "0780901703170270",
  "unit": "780901703170270",
  "no": 1,
  "sim": "780901703170270",
  "lo_lat": "-6.319752",
  "lo_long": "106.948769",
  "last_upd": "2026-07-28 07:47:11",
  "status": "OFF",
  "mileage": 259.66,
  "drv": "",
  "drvphn": "",
  "address": "Jalan Wibawa Mukti II...",
  "user_id": 17459262531439,
  "reg_date": "2026-07-07",
  "vin": "",
  "nokir": "",
  "machine_number": ""
}
```
> **⚠️ Note:** `p.no` is a row number (always 1 for single device), NOT the device ID. Use `p.imei` as the unique identifier.

#### Report History (route)
```json
{
  "Dist": "0.07",
  "Mill": 211.78,
  "Power": 0,
  "Speed": 0,
  "Temp": "",
  "addr": "RW 03, Senayan...",
  "engi": "OFF",
  "lat": -6.22703,
  "long": 106.80376,
  "status": "OFF",
  "time": "2026-07-27 11:58:17"
}
```

#### Report Park
```json
{
  "Loc": "[107.05133,-6.24403]",
  "addrs": "Setiamekar, Kabupaten Bekasi...",
  "from_time": "2026-07-27 11:58:17",
  "to_time": "2026-07-27 20:01:15",
  "hour": "8",
  "minute": "2",
  "second": "58"
}
```

### Device ID Strategy
- FoxLogger devices use **simulated numeric ID** derived from `parseInt(IMEI, 10)` (15-16 digit integer)
- This is a 1:1 deterministic mapping — no collisions, no hash, no extra DB
- Simulated IDs are unique from Traccar (small integers < 10K) and MSPF (medium integers < 1M)
- To reverse: `String(id).padStart(16, '0')` recovers the IMEI (standard 16-char) or use `resolveImei()` / `imeiMap`
- Keys in FE must include `source` prefix: `` key={`${device.source}-${device.id}`} ``
- `attributes.imei` contains the original IMEI string with leading zeros

### Known Issues (Fixed)
1. **Duplicate `normalizeDevice` function** — Nested function declaration caused syntax error (fixed)
2. **Fallback ID field** — `p.no` (row number) was used as device ID instead of `p.imei`, causing React key collision with Traccar device ID `1` (fixed)
3. **Device Lists 404** — `/device-lists/{uid}` always returns 404; fallback to `report-position` is mandatory
4. **Simulated numeric ID** — v2026-07-29: FoxLogger IDs changed from IMEI string to `parseInt(imei)` numeric ID for consistent `device_groups` integer column. `imeiMap` cache maps simulatedId ↔ IMEI asli. `resolveImei()` helper converts before FoxLogger API calls

### Integration Points
- `src/config/index.js` — `foxlogger.email` + `foxlogger.password`
- `src/server.js` — Device cache build includes FoxLogger via `Promise.allSettled`
- `src/services/positionSync.js` — Position sync fetches FoxLogger positions every 10s
- `src/routes/health.js` — Health check dependency (`/health/detailed`)
- `.env` — `FOXLOGGER_EMAIL`, `FOXLOGGER_PASSWORD`
