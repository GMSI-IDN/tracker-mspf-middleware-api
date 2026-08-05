# API Gateway — API Reference

Base URL: `http://localhost:3000`

> **Response Convention:** Semua response Gateway menggunakan **camelCase** (kecuali field dari Traccar/MSPF yang langsung dipass-through tanpa transformasi).
>
> **Timestamp Convention:** Semua field timestamp yang dikeluarkan Gateway adalah **UTC ISO 8601** (format `YYYY-MM-DDTHH:mm:ss.sssZ`). Data sumber dinormalisasi:
> - **Traccar:** sudah UTC (ISO `Z`), diteruskan apa adanya.
> - **MSPF:** `timestamp` (unix seconds) / `insDtm` / `createdAt` / `lastCommunicatedAt` → UTC ISO.
> - **FoxLogger:** timestamp naif `"YYYY-MM-DD HH:mm:ss"` (waktu lokal Jakarta) → dikonversi ke UTC. Zona default `Asia/Jakarta` (bisa diubah via env `FOXLOGGER_TIMEZONE`).
>
> Frontend bebas melakukan konversi ke zona lokalnya sendiri (mis. `Intl.DateTimeFormat`).

Semua endpoint (kecuali `/health` dan `/api/auth/login`) memerlukan **JWT token** di header:

```
Authorization: Bearer <token>
```

---

## 1. Authentication

### POST /api/auth/login

Login dengan username dan password. Token berlaku 8 jam (default).

**Request:**
```json
{
  "username": "admin",
  "password": "admin123"
}
```

**Response 200:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin",
  "groups": [1, 5]
  },
  "expiresIn": "8h"
}
```

**Response 401:**
```json
{ "error": "Invalid credentials", "code": "ERR_UNAUTHORIZED", "requestId": "req-xxx", "timestamp": "..." }
```

---

### GET /api/auth/me

Mengembalikan profile user yang sedang login.

**Response 200:**
```json
{
  "id": 1,
  "username": "admin",
  "role": "admin",
  "groups": ["traccar_5", "mspf_3"]
}
```

---

## 2. Custom Groups

### GET /api/groups

Mengembalikan daftar **custom groups** dari database middleware. Tidak ada group Traccar/MSPF. Admin melihat semua, customer hanya melihat yang di-assign.

**Response 200:**
```json
{
  "groups": [
    {
      "id": 1,
      "name": "tim_logistik",
      "description": "Group untuk tim logistik",
      "source": "custom",
      "deviceCount": 0
    }
  ]
}
```

---

## 3. Devices

### GET /api/devices

Mengembalikan daftar device dari Traccar, MSPF, dan FoxLogger yang sudah digabung (merged). 

> **Filter:** Hanya device dengan status **WORKING** (MSPF), **online/offline** (Traccar/FoxLogger) yang dikembalikan. Device SUSPENDED tidak masuk.

Untuk admin, semua device. Untuk customer, hanya device di Group/BC yang di-assign.

**Query Parameters:**

| Parameter | Tipe | Default | Deskripsi |
|-----------|------|---------|-----------|
| `group` | integer | - | Filter by custom group ID (contoh: `5`) |
| `source` | string | - | Filter by source: `traccar`, `mspf`, atau `foxlogger` |
| `status` | string | - | Filter by status: `online` atau `offline` |
| `keyword` | string | - | Cari berdasarkan name atau uniqueId |
| `search` | string | - | Alias untuk `keyword` |
| `offset` | integer | 0 | Offset untuk pagination |
| `limit` | integer | 50 | Jumlah data per halaman (max 200) |

**Response 200:**
```json
{
  "devices": [
    {
      "id": 2,
      "name": "Concox et200 - pak aep",
      "uniqueId": "862292055680904",
      "status": "offline",
      "phone": "628123456789",
      "model": "MCCS III",
      "source": "traccar",
      "group": "traccar_5",
      "customGroups": [
        { "id": 1, "name": "tim_logistik" }
      ],
      "lastUpdate": "2026-05-15T10:00:30Z",
      "attributes": {},
      "metadata": {}
    },
    {
      "id": 10258579,
      "name": "",
      "uniqueId": "10258579",
      "status": "online",
      "phone": "89620190000078226262",
      "model": "MCCS III A01",
      "source": "mspf",
      "group": "mspf_10000023",
      "customGroups": [
        { "id": 1, "name": "tim_logistik" }
      ],
      "lastUpdate": "2026-06-18T04:05:12Z",
      "attributes": {
        "VIN": "BACKUP",
        "mobilityNo": "B2038SEA",
        "deviceSerialNo": "MS03012108003185",
        "sim number": "89620190000078226262",
        "terminalId": "89620190000078226262",
        "activationStatus": "ACTIVE",
        "activationReservation": "OFF",
        "firmwareVersion": "IIIA1.06"
      },
      "metadata": {}
    },
    {
      "id": 780901703170270,
      "name": "780901703170270",
      "uniqueId": "0780901703170270",
      "status": "offline",
      "phone": "780901703170270",
      "source": "foxlogger",
      "group": null,
      "customGroups": [],
      "lastUpdate": "2026-07-28T07:47:11.000Z",
      "attributes": {
        "imei": "0780901703170270",
        "movementStatus": "OFF",
        "address": "Jalan Wibawa Mukti II...",
        "simcard": "780901703170270",
        "registrationDate": "2026-07-07",
        "mileage": 259.66
      },
      "metadata": {}
    }
  ],
  "total": 140,
  "offset": 0,
  "limit": 50
}
```

---

### GET /api/devices/:id

Mengembalikan detail device. Untuk MSPF device, data diperkaya dengan DeviceStatus (`running`, `ignition`, `voltage`) dan MCCS data history (`mobilityData`).

**Query Parameters:**

| Parameter | Tipe | Deskripsi |
|-----------|------|-----------|
| `source` | string | `traccar`, `mspf`, atau `foxlogger` (membantu routing) |
| `group` | string | Group/BC ID (membantu routing) |

**Response 200 (MSPF device):**
```json
{
  "id": 10258579,
  "name": "",
  "uniqueId": "10258579",
  "status": "online",
  "phone": "89620190000078226262",
  "model": "MCCS III A01",
  "source": "mspf",
  "group": "mspf_10000023",
  "lastUpdate": "2026-06-18T04:05:12Z",
  "running": "IDLING",
  "ignition": true,
  "voltage": 13.59,
  "firmwareVersion": "IIIA1.06",
  "customGroups": [
    { "id": 1, "name": "tim_logistik" }
  ],
  "metadata": {
    "jenis": "Box Cooler",
    "merek": "Mitsubishi",
    "tahun": "2024",
    "warna": "Putih"
  },
  "attributes": {
    "VIN": "BACKUP",
    "mobilityNo": "B2038SEA",
    "deviceSerialNo": "MS03012108003185",
    "sim number": "89620190000078226262",
    "terminalId": "89620190000078226262",
    "activationStatus": "ACTIVE",
    "activationReservation": "OFF",
    "firmwareVersion": "IIIA1.06",
    "mobilityData": {
      "kph": 0,
      "odom": 17.388,
      "gpio": 1,
      "addr": {},
      "createdAt": "2026-06-18T04:05:12Z",
      "insDtm": "2026-06-18T04:05:29Z"
    }
  }
}
```

---

## 4. Positions

### GET /api/positions

Mengembalikan data posisi device.

> **Filter:** Tanpa `deviceId`, hanya device **WORKING** (MSPF) + semua Traccar yang dikembalikan. Device SUSPENDED tidak masuk.

Tanpa filter, mengembalikan posisi terbaru dari semua device yang aktif.

**Query Parameters:**

| Parameter | Tipe | Deskripsi |
|-----------|------|-----------|
| `deviceId` | integer | Filter by device ID |
| `source` | string | `traccar`, `mspf`, atau `foxlogger` (membantu routing) |
| `group` | string | Group/BC ID |
| `from` | string | ISO 8601 — awal waktu (untuk history) |
| `to` | string | ISO 8601 — akhir waktu (untuk history) |
| `offset` | integer | Offset untuk pagination (default: 0) |
| `limit` | integer | Jumlah data per halaman (max 1000, default: 100) |

> **Note:** Data positions di-refresh otomatis setiap 10 detik oleh background sync. Request FE tinggal baca dari cache — response dalam <10ms.

> **Access control:** Admin mendapat enriched data + custom attributes. Customer hanya mendapat custom attributes sesuai aturan grup (sama seperti WebSocket `position`).

**Response 200 (admin):**
```json
[
  {
    "id": 9981,
    "deviceId": 10258579,
    "latitude": -7.323517,
    "longitude": 112.740992,
    "speed": 0,
    "course": 0,
    "altitude": 0,
    "deviceTime": "2026-06-18T04:05:12Z",
    "serverTime": "2026-06-18T04:05:29Z",
    "source": "mspf",
    "attributes": {
      "ignition": true,
      "voltage": 13.59,
      "sats": 16,
      "rssi": -57,
      "running": "IDLING",
      "kph": 0,
      "odom": 17.388,
      "gpio": 1,
      "createdAt": "2026-06-18T04:05:12Z",
      "insDtm": "2026-06-18T04:05:29Z"
    }
  }
]
```

> **Semantik timestamp per source:**
> - `deviceTime` = waktu device membuat data lokasi (dari `Position.timestamp`/`createdAt` MSPF, `last_upd` FoxLogger, atau Traccar asli).
> - `serverTime` = waktu **server** menerima data. Traccar: dari Traccar server. **MSPF: dari `insDtm`** (waktu MSPF menerima, fallback ke jam gateway jika kosong — berlaku untuk posisi terbaru per device). FoxLogger: jam gateway saat fetch (FoxLogger tidak menyediakan server timestamp).
> - `fixTime` = waktu GPS fix (≈ `deviceTime`).
> - Atribut `createdAt`/`insDtm` hanya muncul untuk device MSPF (data MCCS). Root fields tetap identik di semua source.

---

### GET /api/positions/latest

Mengembalikan posisi terbaru. Sama dengan `/api/positions` tanpa filter deviceId, tapi dengan limit lebih kecil.

---

### GET /api/reports/route

Mengembalikan riwayat posisi device dalam range waktu tertentu. Format mengikuti Traccar API.

> Gateway otomatis mendeteksi sumber device (Traccar/MSPF/FoxLogger) melalui cache. Jika belum ada di cache, Gateway akan probing langsung ke semua backend untuk menemukan device-nya.
> **Access control:** Admin mendapat enriched data + custom attributes (rename/compute). Customer hanya mendapat custom attributes sesuai aturan grup device-nya.
>
> **⚠️ Limitasi MSPF:** Range `from` dan `to` maksimal **7 hari**. Jika lebih, return `ERR_VALIDATION`.
>
> **Query Parameters:**

| Parameter | Tipe | Wajib | Deskripsi |
|-----------|------|-------|-----------|
| `deviceId` | integer | ✅ | Device ID |
| `source` | string | - | `traccar`, `mspf`, atau `foxlogger` |
| `group` | string | - | Group/BC ID |
| `from` | string | - | ISO 8601 — awal range |
| `to` | string | - | ISO 8601 — akhir range |

**Response 200 (admin — MSPF device enriched + custom attributes):**
```json
[
  {
    "id": 9981,
    "deviceId": 10258579,
    "latitude": -7.323517,
    "longitude": 112.740992,
    "speed": 0,
    "course": 0,
    "deviceTime": "2026-06-18T04:05:12Z",
    "source": "mspf",
    "attributes": {
      "ignition": true,
      "voltage": 13.59,
      "sats": 16,
      "rssi": -57,
      "running": "IDLING",
      "kph": 0,
      "odom": 17.388,
      "gpio": 1
    }
  }
]
```

**Response 200 (FoxLogger device):**
```json
[
  {
    "deviceId": 780901703170270,
    "latitude": -6.319752,
    "longitude": 106.948769,
    "speed": 0,
    "course": 0,
    "deviceTime": "2026-07-28T07:47:11Z",
    "source": "foxlogger",
    "attributes": {
      "address": "Jalan Wibawa Mukti II...",
      "movementStatus": "OFF",
      "mileage": 211.78,
      "ignition": false
    }
  }
]
```

**Response 200 (customer — hanya custom attributes):**
```json
[
  {
    "deviceId": 10258579,
    "latitude": -7.323517,
    "longitude": 112.740992,
    "speed": 0,
    "source": "mspf",
    "attributes": {
      "EB": 13.44,
      "AD": 0.017,
      "AD computet": 0.034
    }
  }
]
```

---

### GET /api/reports/parking

Mengembalikan riwayat parking device dalam range waktu tertentu. Data dari Traccar difilter hanya `engineHours == 0` (parkir, mesin mati). Idle (mesin hidup tapi diam) tidak termasuk.

> Gateway otomatis mendeteksi sumber device (Traccar/MSPF/FoxLogger) melalui cache atau probing.
> **Access control:** Admin melihat semua data. Customer hanya bisa akses device yang ada di group assign-nya (403 jika tidak punya akses).

**Query Parameters:**

| Parameter | Tipe | Wajib | Deskripsi |
|-----------|------|-------|-----------|
| `deviceId` | integer | ✅ | Device ID |
| `group` | string | - | Group/BC ID (membantu routing) |
| `from` | string | ✅ | ISO 8601 — awal range |
| `to` | string | - | ISO 8601 — akhir range (default: sekarang) |

**Response 200 — Traccar device:**
```json
{
  "deviceId": 2,
  "source": "traccar",
  "period": { "from": "2026-06-01T00:00:00Z", "to": "2026-06-30T00:00:00Z" },
  "parking": [
    {
      "startTime": "2026-06-15T10:00:00Z",
      "endTime": "2026-06-15T10:30:00Z",
      "duration": 1800,
      "latitude": -6.2088,
      "longitude": 106.8456,
      "address": "Jl. Sudirman, Jakarta"
    }
  ],
  "summary": {
    "total": 1,
    "totalDuration": 1800
  }
}
```

**Response 200 — MSPF device:**
```json
{
  "deviceId": 10258579,
  "source": "mspf",
  "period": { "from": "2026-06-01T00:00:00Z", "to": "2026-06-30T00:00:00Z" },
  "parking": [
    {
      "startTime": "2026-06-15T12:00:00Z",
      "endTime": "2026-06-15T13:30:00Z",
      "duration": 5400,
      "latitude": -7.3235,
      "longitude": 112.7410,
      "address": null
    }
  ],
  "summary": {
    "total": 1,
    "totalDuration": 5400
  }
}
```

**Response 200 — FoxLogger device:**
```json
{
  "deviceId": 780901703170270,
  "source": "foxlogger",
  "period": { "from": "2026-07-28T00:00:00Z", "to": "2026-07-30T00:00:00Z" },
  "parking": [
    {
      "startTime": "2026-07-28 08:00:00",
      "endTime": "2026-07-28 17:30:00",
      "duration": 34200,
      "latitude": -6.24403,
      "longitude": 107.05133,
      "address": "Setiamekar, Kabupaten Bekasi..."
    }
  ],
  "summary": {
    "total": 1,
    "totalDuration": 34200
  }
}
```

---

### GET /api/reports/idle

Mengembalikan riwayat idle device (mesin hidup, kendaraan diam) dalam range waktu tertentu.

> **Traccar:** Akurat — filter `engineHours > 0` dari endpoint `/api/reports/stops`.
> **MSPF:** Approximate — dihitung dari route history (posisi dengan `speed=0` & `ignition=true`).
>
> Gateway otomatis mendeteksi sumber device (Traccar/MSPF) melalui cache atau probing.
> **Access control:** Admin melihat semua data. Customer hanya bisa akses device yang ada di group assign-nya (403 jika tidak punya akses).

**Query Parameters:**

| Parameter | Tipe | Wajib | Deskripsi |
|-----------|------|-------|-----------|
| `deviceId` | integer | ✅ | Device ID |
| `group` | string | - | Group/BC ID (membantu routing) |
| `from` | string | ✅ | ISO 8601 — awal range |
| `to` | string | - | ISO 8601 — akhir range (default: sekarang) |

**Response 200 — Traccar device:**
```json
{
  "deviceId": 2,
  "source": "traccar",
  "period": { "from": "2026-06-01T00:00:00Z", "to": "2026-06-30T00:00:00Z" },
  "idle": [
    {
      "startTime": "2026-06-15T11:00:00Z",
      "endTime": "2026-06-15T11:15:00Z",
      "duration": 900,
      "latitude": -6.2090,
      "longitude": 106.8460,
      "address": "Jl. Thamrin, Jakarta"
    }
  ],
  "summary": {
    "total": 1,
    "totalDuration": 900
  }
}
```

**Response 200 — MSPF device:**
```json
{
  "deviceId": 10258579,
  "source": "mspf",
  "period": { "from": "2026-06-01T00:00:00Z", "to": "2026-06-30T00:00:00Z" },
  "idle": [
    {
      "startTime": "2026-06-15T09:05:00Z",
      "endTime": "2026-06-15T09:15:00Z",
      "duration": 600,
      "latitude": -7.3235,
      "longitude": 112.7410,
      "address": null
    }
  ],
  "summary": {
    "total": 1,
    "totalDuration": 600
  }
}
```

---

### GET /api/reports/trips

Mengembalikan riwayat perjalanan device dalam range waktu tertentu.

> **Traccar:** Data lengkap dari `/api/reports/trips` dengan speed (knots→km/h) dan distance (meters→km).
> **MSPF:** Data trip dari `/v4/stats/devices/{id}/trip` diperkaya dengan distance (akumulasi Haversine via route), averageSpeed, dan maxSpeed.
>
> Gateway otomatis mendeteksi sumber device (Traccar/MSPF) melalui cache atau probing.
> **Access control:** Admin melihat semua data. Customer hanya bisa akses device yang ada di group assign-nya (403 jika tidak punya akses).

**Query Parameters:**

| Parameter | Tipe | Wajib | Deskripsi |
|-----------|------|-------|-----------|
| `deviceId` | integer | ✅ | Device ID |
| `group` | string | - | Group/BC ID (membantu routing) |
| `from` | string | ✅ | ISO 8601 — awal range |
| `to` | string | - | ISO 8601 — akhir range (default: sekarang) |

**Response 200 — Traccar device:**
```json
{
  "deviceId": 2,
  "source": "traccar",
  "period": { "from": "2026-06-01T00:00:00Z", "to": "2026-06-30T00:00:00Z" },
  "trips": [
    {
      "startTime": "2026-06-15T08:00:00Z",
      "endTime": "2026-06-15T09:30:00Z",
      "duration": 5400,
      "startLatitude": -6.2088,
      "startLongitude": 106.8456,
      "endLatitude": -6.4032,
      "endLongitude": 106.8183,
      "startAddress": "Jl. A, Jakarta",
      "endAddress": "Jl. B, Jakarta",
      "distance": 25.5,
      "averageSpeed": 45.2,
      "maxSpeed": 80.5,
      "spentFuel": 5.2,
      "driverName": "John"
    }
  ],
  "summary": {
    "total": 1,
    "totalDuration": 5400,
    "totalDistance": 25.5
  }
}
```

**Response 200 — MSPF device:**
```json
{
  "deviceId": 10258579,
  "source": "mspf",
  "period": { "from": "2026-06-01T00:00:00Z", "to": "2026-06-30T00:00:00Z" },
  "trips": [
    {
      "startTime": "2026-06-15T08:00:00Z",
      "endTime": "2026-06-15T09:00:00Z",
      "duration": 3600,
      "startLatitude": -6.2088,
      "startLongitude": 106.8456,
      "endLatitude": -6.4032,
      "endLongitude": 106.8183,
      "distance": 24.8,
      "averageSpeed": 24.8,
      "maxSpeed": 50
    }
  ],
  "summary": {
    "total": 1,
    "totalDuration": 3600,
    "totalDistance": 24.8
  }
}
```

---

### GET /api/reports/summary

Mengembalikan ringkasan device dalam range waktu tertentu. Bisa per-device, per-group, atau semua device.

> **Traccar:** Data lengkap dari `/api/reports/summary` — distance, maxSpeed, averageSpeed, spentFuel, engineHours.
> **MSPF:** Single device — enriched dari route (distance, maxSpeed, averageSpeed, duration). Multi-device — dari `stats/summary` (totalMileage, totalDrivingTime). `maxSpeed`/`averageSpeed` = null untuk multi-device.
> **FoxLogger:** Dari `/web-tracker/report-summary` per-device. Multi-device tidak support (per-device API, no aggregate endpoint).
>
> Gateway otomatis mendeteksi sumber device (Traccar/MSPF/FoxLogger) melalui cache atau probing.
> **Access control:** Admin melihat semua data. Customer hanya melihat device yang ada di group assign-nya.

**Query Parameters:**

| Parameter | Tipe | Wajib | Deskripsi |
|-----------|------|-------|-----------|
| `deviceId` | integer | - | Filter by single device |
| `group` | integer | - | Filter by custom group ID |
| `from` | string | ✅ | ISO 8601 — awal range |
| `to` | string | - | ISO 8601 — akhir range |
| `granularity` | string | - | `day` \| `week` \| `month` \| `year` — kembalikan time-series (lihat di bawah) |

> Jika `deviceId` dan `group` tidak diberikan, mengembalikan semua device (difilter sesuai role).

---

### GET /api/reports/summary — Time-Series (Daily/Weekly/Monthly/Yearly Driving Report)

Dengan param `granularity`, endpoint mengembalikan **breakdown summary per periode waktu** untuk **1 device** (`deviceId`) atau **1 custom group** (`group` = ID integer, agregasi semua device lintas source). Bucket kosong diisi 0/null supaya grafik kontinu dari `from` s.d. `to`.

| Parameter | Tipe | Wajib | Deskripsi |
|-----------|------|-------|-----------|
| `deviceId` | integer | - | Series per device |
| `group` | integer | - | Series per custom group (agregasi Traccar + MSPF + FoxLogger) |
| `granularity` | string | ✅ | `day` \| `week` \| `month` \| `year` |
| `from` | string | - | ISO 8601 — awal range (default: 30 hari lalu) |
| `to` | string | - | ISO 8601 — akhir range (default: sekarang) |

> ⚠️ `granularity` **wajib disertai** `deviceId` atau `group` (custom group ID integer). Jika tidak → `400 ERR_VALIDATION`.
>
> **Sumber data per source:**
> - **MSPF:** native `/v3/stats/devices/{id}/reports` (device) & `/v3/stats/devices/reports?bcId=` (group) — `mileage`/`drivingtime` per hari, `dimensions=DAILY&timezone=UTC`, di-cache 1 jam. `maxSpeed`/`averageSpeed`/`spentFuel` = `null` (tidak tersedia native).
> - **Traccar:** agregasi `/reports/trips` per bucket.
> - **FoxLogger:** agregasi `/web-tracker/report-summary` (per trip) per bucket.
>
> **Key bucket:** `day`→`YYYY-MM-DD`, `week`→`YYYY-Www` (ISO week, mulai Senin), `month`→`YYYY-MM`, `year`→`YYYY`. `averageSpeed` = `distance / drivingTime * 3600` (weighted).

**Response 200 — device (granularity=day):**
```json
{
  "type": "device",
  "deviceId": 10258579,
  "deviceName": "Box Cooler 5",
  "granularity": "day",
  "period": { "from": "2026-06-10T00:00:00Z", "to": "2026-06-12T00:00:00Z" },
  "timezone": "UTC",
  "series": [
    { "key": "2026-06-10", "date": "2026-06-10", "distance": 45.2, "drivingTime": 3600, "maxSpeed": 80.5, "averageSpeed": 45.2, "spentFuel": 2.5, "count": 3 },
    { "key": "2026-06-11", "date": "2026-06-11", "distance": 0, "drivingTime": 0, "maxSpeed": null, "averageSpeed": null, "spentFuel": 0, "count": 0 },
    { "key": "2026-06-12", "date": "2026-06-12", "distance": 12.1, "drivingTime": 600, "maxSpeed": 50, "averageSpeed": 72.6, "spentFuel": 0.8, "count": 1 }
  ],
  "total": { "distance": 57.3, "drivingTime": 4200, "maxSpeed": 80.5, "averageSpeed": 49.1, "spentFuel": 3.3, "count": 4 }
}
```

**Response 200 — custom group (granularity=week):**
```json
{
  "type": "group",
  "group": { "id": 1, "name": "tim_logistik" },
  "granularity": "week",
  "period": { "from": "2026-06-01T00:00:00Z", "to": "2026-06-30T00:00:00Z" },
  "timezone": "UTC",
  "series": [
    { "key": "2026-W23", "date": "2026-06-01", "distance": 320.5, "drivingTime": 18000, "maxSpeed": 90, "averageSpeed": 64.1, "spentFuel": 12.4, "count": 14 },
    { "key": "2026-W24", "date": "2026-06-08", "distance": 0, "drivingTime": 0, "maxSpeed": null, "averageSpeed": null, "spentFuel": 0, "count": 0 }
  ],
  "total": { "distance": 320.5, "drivingTime": 18000, "maxSpeed": 90, "averageSpeed": 64.1, "spentFuel": 12.4, "count": 14 }
}
```

> **Access control:** Customer hanya bisa akses `deviceId`/`group` yang ada di group assign-nya (403 jika tidak). Tanpa `granularity`, response tetap mengikuti format lama (`summaries` + `total`) — backward compatible.

**Response 200 — Traccar single device:**
```json
{
  "deviceId": 2,
  "source": "traccar",
  "period": { "from": "2026-06-01T00:00:00Z", "to": "2026-06-30T00:00:00Z" },
  "summaries": [
    {
      "deviceId": 2,
      "deviceName": "Concox et200",
      "source": "traccar",
      "distance": 1250.5,
      "maxSpeed": 120.3,
      "averageSpeed": 45.2,
      "duration": 54000,
      "engineHours": 42,
      "spentFuel": 85.5
    }
  ],
  "total": { "devices": 1, "distance": 1250.5, "duration": 54000 }
}
```

**Response 200 — MSPF single device (enriched):**
```json
{
  "deviceId": 10258579,
  "source": "mspf",
  "period": { "from": "2026-06-01T00:00:00Z", "to": "2026-06-30T00:00:00Z" },
  "summaries": [
    {
      "deviceId": 10258579,
      "deviceName": "Box Cooler 5",
      "source": "mspf",
      "distance": 890.2,
      "maxSpeed": 80.5,
      "averageSpeed": 35.0,
      "duration": 36000,
      "engineHours": 36000,
      "spentFuel": null
    }
  ],
  "total": { "devices": 1, "distance": 890.2, "duration": 36000 }
}
```

**Response 200 — FoxLogger single device:**
```json
{
  "deviceId": 780901703170270,
  "source": "foxlogger",
  "period": { "from": "2026-07-28T00:00:00Z", "to": "2026-07-30T00:00:00Z" },
  "summaries": [
    {
      "deviceId": 780901703170270,
      "deviceName": "",
      "source": "foxlogger",
      "distance": 0,
      "maxSpeed": 0,
      "averageSpeed": 0,
      "duration": 0,
      "engineHours": null,
      "spentFuel": 0
    }
  ],
  "total": { "devices": 1, "distance": 0, "duration": 0 }
}
```

**Response 200 — All devices (admin):**
```json
{
  "period": { "from": "2026-06-01T00:00:00Z", "to": "2026-06-30T00:00:00Z" },
  "summaries": [
    { "deviceId": 1, "deviceName": "Device A", "source": "traccar", "distance": 500, "maxSpeed": 80, "averageSpeed": 40, "duration": 20000, "engineHours": 10, "spentFuel": 30 },
    { "deviceId": 2, "deviceName": "Device B", "source": "mspf", "distance": 300, "maxSpeed": null, "averageSpeed": null, "duration": 8000, "engineHours": 8000, "spentFuel": null }
  ],
  "total": { "devices": 2, "distance": 800, "duration": 28000 }
}
```

---

### GET /api/reports/events

Mengembalikan riwayat event device dalam range waktu tertentu. Mendukung Traccar (event built-in) dan MSPF (monitor-based events).

> **Traccar:** Event dari `/api/reports/events` — type built-in (`geofenceEnter`, `ignitionOn`, dll). Status `OPEN`/`CLOSE` did derive dari type. Nama geofence di-enrich dari `GET /geofences` (single device).
> **MSPF:** Event dari `/v4/events` + `/v4/closed-events` — `monitorName` sebagai type, native `openedAt`/`closedAt`.
>
> **Multi-device:** Cepat, tanpa enrich nama. **Single device:** Lengkap dengan nama event & device.
> **Access control:** Admin semua, customer hanya device di group assign-nya.

**Query Parameters:**

| Parameter | Tipe | Wajib | Deskripsi |
|-----------|------|-------|-----------|
| `deviceId` | integer | - | Single device (enriched) |
| `group` | integer | - | Filter by custom group ID |
| `from` | string | ✅ | ISO 8601 — awal range |
| `to` | string | - | ISO 8601 — akhir range |
| `status` | string | - | Filter: `OPEN` atau `CLOSE` |
| `name` | string | - | Cari event berdasarkan nama |

**Response 200 — single device (Traccar):**
```json
{
  "deviceId": 2,
  "source": "traccar",
  "period": { "from": "...", "to": "..." },
  "events": [
    {
      "name": "Gudang A",
      "eventTime": "2026-06-15T10:00:00Z",
      "status": "OPEN",
      "deviceId": 2,
      "source": "traccar",
      "geofenceId": 5
    },
    {
      "name": "Ignition ON",
      "eventTime": "2026-06-15T11:00:00Z",
      "status": "OPEN",
      "deviceId": 2,
      "source": "traccar"
    }
  ],
  "summary": { "total": 2, "open": 2, "closed": 0 }
}
```

**Response 200 — single device (MSPF):**
```json
{
  "deviceId": 10258579,
  "source": "mspf",
  "period": { "from": "...", "to": "..." },
  "events": [
    {
      "name": "Voltage Alert",
      "eventTime": "2026-06-15T12:00:00Z",
      "status": "OPEN",
      "deviceId": 10258579,
      "source": "mspf",
      "monitorId": 3,
      "openedAt": "2026-06-15T12:00:00Z",
      "closedAt": null
    }
  ],
  "summary": { "total": 1, "open": 1, "closed": 0 }
}
```

**Response 200 — multi-device (admin):**
```json
{
  "period": { "from": "...", "to": "..." },
  "events": [
    { "name": null, "eventTime": "2026-06-15T10:00:00Z", "status": "OPEN", "deviceId": 2, "source": "traccar" }
  ],
  "summary": { "total": 1 }
}
```

---

## 5. Commands

### POST /api/commands

Mengirim perintah ke device. Gateway otomatis routing ke backend yang tepat (Traccar atau MSPF).

**Request:**
```json
{
  "deviceId": 2,
  "type": "engineStop",
  "data": {},
  "group": "traccar_5",
  "source": "traccar"
}
```

**Response 200:**
```json
{
  "success": true,
  "message": "Command sent",
  "deviceId": 2,
  "commandType": "engineStop",
  "source": "traccar"
}
```

---

### GET /api/commands/types/:deviceId

Mengembalikan daftar tipe command yang didukung oleh device.

**Query Parameters:** `source`, `group`

**Response 200 (Traccar):**
```json
{
  "types": ["engineStop", "engineResume", "positionPeriodic", ...],
  "source": "traccar"
}
```

**Response 200 (MSPF):**
```json
{
  "types": ["activate", "deactivate"],
  "source": "mspf"
}
```

---

### PUT /api/devices/:id/activation

Unified activation endpoint — berfungsi untuk Traccar dan MSPF.

**Request:**
```json
{
  "desiredStatus": "ACTIVE",
  "source": "mspf"
}
```

| Status | Traccar | MSPF |
|--------|---------|------|
| `ACTIVE` | Kirim `engineResume` | Activation → ACTIVE |
| `INACTIVE` | Kirim `engineStop` | Activation → INACTIVE |

**Response 200:**
```json
{
  "success": true,
  "deviceId": 10258579,
  "desiredStatus": "ACTIVE",
  "source": "mspf"
}
```

---

### PUT /api/devices/:id/metadata

Menyimpan metadata device (jenis kendaraan, merek, tahun, warna, dll). Data disimpan di middleware database, bukan dikirim via WebSocket.

Bisa diakses oleh **admin** dan **customer** (customer hanya bisa edit device yang ada di group-nya).

**Request:**
```json
{
  "source": "traccar",
  "metadata": {
    "jenis": "Box Cooler",
    "merek": "Mitsubishi",
    "tahun": "2024",
    "warna": "Putih"
  }
}
```

**Response 200:**
```json
{
  "deviceId": 10258579,
  "source": "mspf",
  "metadata": {
    "jenis": "Box Cooler",
    "merek": "Mitsubishi",
    "tahun": "2024",
    "warna": "Putih"
  }
}
```

Metadata muncul di response `GET /api/devices` dan `GET /api/devices/:id` sebagai field `metadata`.

### DELETE /api/devices/:id/metadata

Menghapus metadata device. Query param `source` wajib.

Akses: admin bebas, customer hanya bisa hapus device di group-nya.

**Request:**
```http
DELETE /api/devices/10258579/metadata?source=mspf
Authorization: Bearer <token>
```

**Response 200:**
```json
{
  "deviceId": 10258579,
  "source": "mspf",
  "deleted": true
}
```

---

## 6. Users (Admin Only)

### GET /api/users

Mengembalikan daftar semua user.

### GET /api/users/:id

Mengembalikan detail user.

### POST /api/users

Membuat user baru.

**Request:**
```json
{
  "username": "customer@company.com",
  "password": "pass123",
  "role": "customer",
  "groups": [1, 5]
}
```

**Response 201:**
```json
{
  "id": 2,
  "username": "customer@company.com",
  "role": "customer",
  "groups": [1, 5]
}
```

### PUT /api/users/:id

Update data user. Semua field opsional — kirim hanya field yang ingin diubah.

**Request:**
```json
{
  "username": "customer@company.com",
  "password": "newpass123",
  "role": "customer",
  "groups": [1, 5, 3]
}
```

**Response 200:**
```json
{
  "id": 2,
  "username": "customer@company.com",
  "role": "customer",
  "groups": [1, 5, 3]
}
```

---

## 7. Custom Groups (Admin Only)

Mengelola grup kustom untuk filter device customer. Grup dapat berisi device dari Traccar dan MSPF sekaligus.

### GET /api/admin/groups

Mengembalikan daftar semua grup kustom.

### POST /api/admin/groups

Membuat grup baru.

**Request:**
```json
{
  "name": "tim_logistik",
  "description": "Group untuk tim logistik"
}
```

**Response 201:**
```json
{
  "id": 1,
  "name": "tim_logistik",
  "description": "Group untuk tim logistik"
}
```

### PUT /api/admin/groups/:id

Mengupdate nama/deskripsi grup.

### DELETE /api/admin/groups/:id

Menghapus grup. Semua mapping device ke grup ini otomatis terhapus.

### GET /api/admin/groups/sources

Mengembalikan daftar source groups dari backend (Traccar groups + MSPF BCs) untuk dropdown filter/assign device di halaman admin.

**Response 200:**
```json
{
  "sources": [
    { "id": "traccar_5", "name": "Warehouse Jakarta", "source": "traccar" },
    { "id": "traccar_8", "name": "Depot Bandung", "source": "traccar" },
    { "id": "mspf_3", "name": "BC Surabaya", "source": "mspf" },
    { "id": "mspf_7", "name": "BC Medan", "source": "mspf" }
  ]
}
```

> **Cache:** Response di-cache 5 menit di server. Data diambil dari Traccar (`/groups`) dan MSPF (`/v2/bc`).
>
> **Usage:** Gunakan `id` dari response ini untuk filter device via `?group=traccar_5` atau assign ke custom group.

### GET /api/admin/device-groups

Melihat semua mapping device ke grup. Filter dengan `?groupId=x`.

**Response:**
```json
{
  "deviceGroups": [
    {
      "id": 4,
      "deviceId": 10258579,
      "source": "mspf",
      "groupId": 3,
      "deviceName": "Box Cooler 5",
      "createdAt": "2026-06-23T04:30:18Z"
    }
  ]
}
```

### POST /api/admin/device-groups

Assign 1 device ke grup.

**Request:**
```json
{
  "deviceId": 10258579,
  "source": "mspf",
  "groupId": 1
}
```

**Response 201:**
```json
{
  "id": 4,
  "deviceId": 10258579,
  "deviceName": "Box Cooler 5",
  "source": "mspf",
  "groupId": 1
}
```

### POST /api/admin/device-groups/batch

Assign banyak device sekaligus ke 1 grup.

**Request:**
```json
{
  "groupId": 1,
  "devices": [
    { "deviceId": 2, "source": "traccar" },
    { "deviceId": 10258579, "source": "mspf" }
  ]
}
```

**Response 201:**
```json
{
  "message": "2 device(s) assigned to group 1",
  "devices": [
    { "deviceId": 2, "source": "traccar", "deviceName": "Concox et200" },
    { "deviceId": 10258579, "source": "mspf", "deviceName": "Box Cooler 5" }
  ]
}
```

### DELETE /api/admin/device-groups/:id

Hapus mapping device dari grup.

### POST /api/admin/group-sync

Membuat aturan auto-sync. Device dari source group/BC akan otomatis masuk ke middleware group.

**Request:**
```json
{
  "middlewareGroupId": 1,
  "source": "mspf",
  "sourceGroupId": "mspf_10000023"
}
```

### GET /api/admin/group-sync

Melihat semua aturan auto-sync.

### DELETE /api/admin/group-sync/:id

Menghapus aturan auto-sync.

### POST /api/admin/custom-attributes

Membuat aturan custom attribute untuk grup. Aturan diterapkan **per-device** berdasarkan `device_groups` — device hanya kena aturan dari group tempat device itu berada.

Ada 3 mode:

| Mode | Fungsi | `sourceField` | `formula` |
|------|--------|---------------|-----------|
| `passthrough` | Field asli muncul di FE | ✅ Wajib | ❌ |
| `rename` | Field asli diganti nama | ✅ Wajib | ❌ |
| `compute` | Hasil kalkulasi dari formula (ekspresi mathjs — aman, tanpa akses global) | ✅ Opsional | ✅ Ekspresi mathjs |

**Request:**
```json
{
  "groupId": 1,
  "name": "plat_nomor",
  "sourceField": "mobilityNo",
  "mode": "rename"
}
```

**Response 201:**
```json
{
  "id": 1,
  "groupId": 1,
  "name": "plat_nomor",
  "sourceField": "mobilityNo",
  "mode": "rename"
}
```

Example formula untuk `compute`: `value != null ? round(53.869 * value - 250.292, 1) : null`

Variable yang tersedia di ekspresi: `value`, `attrs`, dan semua key dari attributes (misal `kph`, `volt`). Fungsi mathjs seperti `round()`, `floor()`, `ceil()`, `abs()`, `min()`, `max()` tersedia.

### GET /api/admin/custom-attributes

Melihat semua aturan custom attribute. Filter dengan `?groupId=x`.

### PUT /api/admin/custom-attributes/:id

Update aturan (name, sourceField, mode, formula, enabled, priority).

### DELETE /api/admin/custom-attributes/:id

Hapus aturan.

### GET /api/admin/custom-attributes/available-fields

Mengembalikan daftar semua field yang tersedia dari device cache, untuk dropdown selector admin.

```json
{
  "fields": [
    { "name": "adc1", "type": "number", "sources": ["traccar"] },
    { "name": "mobilityNo", "type": "string", "sources": ["mspf"] }
  ]
}
```

### GET /api/groups/:id/preview

Mengembalikan daftar atribut yang akan muncul di FE untuk group tertentu. Atribut yang muncul ditentukan oleh `device_groups` — setiap device hanya menampilkan atribut dari groupnya sendiri.

> **Access control:** Customer hanya bisa preview group yang di-assign ke akunnya. Jika tidak punya akses, response 403.

> **Access control:** Admin melihat default enriched attributes + custom rules. Customer hanya melihat custom rules.

**Response 200 (admin):**
```json
{
  "group": { "id": 1, "name": "rental" },
  "rootFields": ["id", "name", "uniqueId", "status", ...],
  "visibleAttributes": ["ignition", "voltage", "sats", "addr_IGN", ..., "EB", "AD"],
  "totalVisible": 48
}
```

**Response 200 (customer):**
```json
{
  "group": { "id": 1, "name": "rental" },
  "rootFields": ["id", "name", "uniqueId", "status", ...],
  "visibleAttributes": ["EB", "AD"],
  "totalVisible": 20
}
```

---

## 8. Dashboard

### GET /api/dashboard

Mengembalikan ringkasan dashboard untuk tampilan awal aplikasi. Menggabungkan device stats, running status, summary period, dan recent events dalam 1 response.

> **Data device** dari cache (device:merged). **Summary** hanya jika `from` diberikan.
> **Access control:** Admin semua device. Customer hanya device di group assign-nya.

**Query Parameters:**

| Parameter | Tipe | Wajib | Deskripsi |
|-----------|------|-------|-----------|
| `from` | string | - | ISO 8601 — untuk summary period |
| `to` | string | - | ISO 8601 — akhir range |

**Response 200:**
```json
{
  "period": { "from": "2026-06-01T00:00:00Z", "to": "2026-06-30T00:00:00Z" },
  "devices": {
    "total": 139,
    "online": 85,
    "offline": 54,
    "bySource": { "traccar": 45, "mspf": 94, "foxlogger": 1 }
  }
}
```

**Response 200 (tanpa `from` — summary = null):**
```json
{
  "period": { "from": null, "to": "..." },
  "devices": { "total": 140, "online": 85, "offline": 55, "bySource": { "traccar": 45, "mspf": 94, "foxlogger": 1 } },
  "runningStatus": { "RUN": 32, "IDLING": 12, "STOP": 86, "TOWING": 3, "UNKNOWN": 7 },
  "summary": null,
  "recentEvents": []
}
```

---

## 9. Health

### GET /health

**Response 200:**
```json
{
  "status": "healthy",
  "timestamp": "2026-06-18T04:00:00Z"
}
```

### GET /health/detailed

**Response 200:**
```json
{
  "status": "healthy",
  "dependencies": [
    { "name": "traccar", "status": "healthy" },
    { "name": "mspf", "status": "healthy" }
  ]
}
```

---

## 10. WebSocket

### Connection

```javascript
const socket = io('wss://hostname/api/ws', {
  auth: { token: 'JWT_TOKEN_HERE' }
});
```

### Events (Server → Client)

#### `position`

Dikirim setiap ada update posisi dari **Traccar** (via WebSocket real-time atau REST polling fallback), **MSPF** (via polling setiap 10 detik), dan **FoxLogger** (via polling `report-position` setiap 10 detik, hanya jika kredensial FoxLogger dikonfigurasi).

> **Filter:** Hanya device **WORKING** (MSPF) yang dikirim. Device SUSPENDED tidak masuk. Traccar: semua device dikirim. FoxLogger: hanya device yang tercatat di cache `devices:merged` (source `foxlogger`) yang dikirim.
> **Access control:** Payload disaring berdasarkan role user yang terhubung.
> - **Admin:** Mendapatkan semua enriched data + hasil custom attributes (rename/compute/passthrough).
> - **Customer:** Hanya mendapat custom attributes sesuai aturan group device-nya. Jika tidak ada aturan, `attributes: {}`.
> - FoxLogger: kecocokan device customer didasarkan pada `device_groups` (mendukung `device_id` berupa IMEI string atau numeric simulated ID).

**Root fields (selalu ada untuk semua role):** `deviceId`, `latitude`, `longitude`, `speed`, `course`*, `altitude`, `deviceTime`, `valid`, `source`, **`voltage`**, **`internalBattery`**, **`batteryLevel`**, **`ignition`**.

> \* `course` untuk MSPF device di-enrich dari MCCS `mobilityData.dir` jika data raw position tidak ada.

**Admin — enriched + custom attributes:**
```json
{
  "deviceId": 10258579,
  "latitude": -7.323517,
  "longitude": 112.740992,
  "speed": 0,
  "course": 0,
  "deviceTime": "2026-06-18T04:05:12Z",
  "valid": true,
  "source": "mspf",
  "voltage": 13.59,
  "internalBattery": 3.98,
  "batteryLevel": 75,
  "ignition": true,
  "attributes": {
    "sats": 16,
    "rssi": -57,
    "running": "IDLING",
    "addr_IGN": 1,
    "addr_FIX": 3,
    "addr_EB": 13.44,
    "EB": 13.44,
    "addr_AD": 0.017,
    "AD": 0.017,
    "AD computet": 0.034
  }
}
```

**Customer — hanya custom attributes:**
```json
{
  "deviceId": 10258579,
  "latitude": -7.323517,
  "longitude": 112.740992,
  "speed": 0,
  "course": 0,
  "deviceTime": "2026-06-18T04:05:12Z",
  "valid": true,
  "source": "mspf",
  "voltage": 13.59,
  "internalBattery": 3.98,
  "batteryLevel": 75,
  "ignition": true,
  "attributes": {
    "EB": 13.44,
    "AD": 0.017,
    "AD computet": 0.034
  }
}
```

> `voltage`, `internalBattery`, dan `batteryLevel` selalu muncul di root level, tidak terpengaruh aturan custom attributes.

#### `device-status`

Dikirim bersamaan dengan event `position`, berisi data status device yang sering berubah.

```json
{
  "deviceId": 10258579,
  "source": "mspf",
  "lastUpdate": "2026-06-18T04:05:12Z",
  "running": "IDLING",
  "ignition": true,
  "voltage": 13.59,
  "internalBattery": 3.98,
  "batteryLevel": 75
}
```

**Running status:**
| Status | Ignition | Speed | Last Update | Keterangan |
|--------|----------|-------|-------------|------------|
| `RUN` | ON | > 0 | < 24 jam | Mesin nyala, berjalan |
| `IDLING` | ON | = 0 | < 24 jam | Mesin nyala, berhenti |
| `STOP` | OFF | = 0 | < 24 jam | Mesin mati |
| `TOWING` | OFF | > 0 | < 24 jam | Mesin mati, kendaraan bergerak (diderek) |
| `UNKNOWN` | - | - | **> 24 jam** | Data basi / tidak ada data terbaru |

> **MSPF:** `running` dari DeviceStatus asli (jika ada), fallback ke kalkulasi. `voltage` dari attributes.
> **Traccar:** `running` dari kalkulasi `ignition` + `speed`. `voltage` dari `attributes.power`.

#### `command-result`

Dikirim sebagai konfirmasi eksekusi command.

```json
{
  "deviceId": 2,
  "commandType": "engineStop",
  "success": true,
  "message": "Command sent",
  "source": "traccar"
}
```

---

## 11. Error Codes

| HTTP | Code | Arti |
|------|------|------|
| 400 | `ERR_VALIDATION` | Request validation failed |
| 401 | `ERR_UNAUTHORIZED` | Token invalid / expired |
| 403 | `ERR_FORBIDDEN` | Tidak punya akses |
| 404 | `ERR_NOT_FOUND` | Resource tidak ditemukan |
| 409 | `ERR_CONFLICT` | Duplicate / konflik data |
| 429 | `ERR_RATE_LIMIT` | Too many requests |
| 500 | `ERR_INTERNAL` | Internal server error |
| 502 | `ERR_BAD_GATEWAY` | Upstream server (Traccar/MSPF) error |
| 504 | `ERR_TIMEOUT` | Upstream timeout |

**Format error response:**
```json
{
  "error": "Invalid credentials",
  "requestId": "req-mqhoev3w-c4d2b27a",
  "timestamp": "2026-06-18T04:00:00Z",
  "code": "ERR_UNAUTHORIZED"
}
```
