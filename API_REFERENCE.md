# API Gateway — API Reference

Base URL: `http://localhost:3000`

> **Response Convention:** Semua response Gateway menggunakan **camelCase** (kecuali field dari Traccar/MSPF yang langsung dipass-through tanpa transformasi).
>
> **Role-Based Vendor Tag Masking (White-Label):**
> - **Role `admin`:** Respons API dan WebSocket menyertakan field `source` (`'traccar'`, `'mspf'`, `'foxlogger'`) dan vendor `group` (contoh `'traccar_5'`) untuk grouping di Admin FE, diagnostik, dan sync mapping.
> - **Role `customer`:** Field `source` dan vendor `group` otomatis **dihilangkan (stripped)** di seluruh endpoint (`devices`, `positions`, `commands`, `reports`, `dashboard`) dan WebSocket. Customer hanya berinteraksi dengan identitas unit dan `customGroups` miliknya tanpa kebocoran nama vendor pihak ketiga.
>
> **Timestamp Convention:** Semua field timestamp yang dikeluarkan Gateway adalah **UTC ISO 8601** (format `YYYY-MM-DDTHH:mm:ss.sssZ`). Data sumber dinormalisasi:
> - **Traccar:** sudah UTC (ISO `Z`), diteruskan apa adanya.
> - **MSPF:** `timestamp` (unix seconds) / `insDtm` / `createdAt` / `lastCommunicatedAt` → UTC ISO.
> - **FoxLogger:** timestamp naif `"YYYY-MM-DD HH:mm:ss"` (waktu lokal Jakarta) → dikonversi ke UTC. Zona default `Asia/Jakarta` (bisa diubah via env `FOXLOGGER_TIMEZONE`).
>
> **Request ke FoxLogger (`time1`/`time2`):** FE mengirim range dalam **UTC**; Gateway **mengonversi ke zona `FOXLOGGER_TIMEZONE` (default WIB)** sebelum dikirim ke FoxLogger sebagai `"YYYY-MM-DD HH:mm:ss"` (karena FoxLogger menginterpretasikan parameter waktu sebagai zona lokalnya). Berlaku untuk semua endpoint FoxLogger yang menerima range: `/api/reports/route`, `/parking`, `/summary`, dan enrich rollback. Jadi: `from=2026-08-05T17:00:00Z` → `time1=2026-08-06 00:00:00` (WIB).
>
> Frontend bebas melakukan konversi ke zona lokalnya sendiri (mis. `Intl.DateTimeFormat`).

Semua endpoint (kecuali `/health` dan `/api/auth/login`) memerlukan **JWT token** di header:

```
Authorization: Bearer <token>
```

---

## 1. Authentication

### POST /api/auth/login

Login dengan username atau email, beserta password. Token berlaku 8 jam (default). Sistem otomatis mengenali apakah input berupa username atau email.

**Request:**
```json
{
  "username": "admin",
  "password": "admin123"
}
```
*Atau menggunakan email:*
```json
{
  "email": "customer@example.com",
  "password": "password123"
}
```

**Response 200:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "username": "admin",
    "email": "admin@system.local",
    "firstName": "Admin",
    "lastName": "System",
    "role": "admin",
    "isActive": true,
    "tokenVersion": 1,
    "groups": [1, 5],
    "timezone": "Asia/Jakarta"
  },
  "expiresIn": "8h"
}
```

**Response 401:**
```json
{ "error": "Invalid credentials", "code": "ERR_UNAUTHORIZED", "requestId": "req-xxx", "timestamp": "..." }
```

**Response 403 (Akun Dinonaktifkan):**
```json
{ "error": "Account has been disabled. Please contact administrator", "code": "ERR_ACCOUNT_DISABLED", "requestId": "req-xxx", "timestamp": "..." }
```

---

### GET /api/auth/me

Mengembalikan profile user yang sedang login.

**Response 200:**
```json
{
  "id": 1,
  "username": "admin",
  "email": "admin@system.local",
  "firstName": "Admin",
  "lastName": "System",
  "role": "admin",
  "isActive": true,
  "tokenVersion": 1,
  "groups": [1, 5],
  "timezone": "Asia/Jakarta"
}
```

**Response 401 / 403 (Session Revocation / Account Disabled):**
- Jika akun dinonaktifkan: `403 ERR_ACCOUNT_DISABLED`
- Jika token telah dicabut (misal password diubah / admin reset sesi): `401 ERR_TOKEN_REVOKED` ("Session has been terminated or revoked")

---

### PUT /api/auth/me

Update profil user yang sedang login (Self-Profile Update). Dapat dipanggil oleh semua role (`customer` maupun `admin`).
User hanya diizinkan memperbarui data profil personal: **nama, timezone, dan password**. Field `role` dan `groups` tidak dapat dimodifikasi di endpoint ini.

Semua field opsional. Jika field `password` dikirim, maka `confirmPassword` wajib dikirim dan harus bernilai identik.

**Request:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "timezone": "Asia/Makassar",
  "password": "newpassword123",
  "confirmPassword": "newpassword123"
}
```

*(Atau tanpa ubah password)*
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "timezone": "Asia/Makassar"
}
```

**Response 200:**
```json
{
  "id": 2,
  "username": "rental",
  "email": "rental@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "role": "customer",
  "groups": [1, 5],
  "timezone": "Asia/Makassar",
  "token": "eyJhbGciOiJIUzI1NiIs..."
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

> **Catatan Custom Groups & Deduplikasi:**
> - Parameter `group` menerima ID custom group integer (contoh: `?group=1`).
> - Satu custom group dapat memuat kendaraan dari berbagai aturan sinkronisasi (multi-sync rules) dan penambahan manual.
> - Jika user level customer memiliki beberapa custom group yang memuat kendaraan yang sama, daftar kendaraan **dijamin hanya menampilkan kendaraan tersebut sebanyak 1 kali (ter-deduplikasi)**, dan atribut `customGroups` akan mencantumkan semua grup terkait.

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
      "engineControl": {
        "desired": "ACTIVE",
        "state": "ACTIVE",
        "isApplied": true,
        "lastAppliedAt": "2026-05-15T10:00:30Z"
      },
      "lastUpdate": "2026-05-15T10:00:30Z",
      "attributes": {},
      "metadata": {},
      "metadataOwners": {}
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
      "engineControl": {
        "desired": "ACTIVE",
        "state": "ACTIVE",
        "isApplied": true,
        "lastAppliedAt": "2026-06-18T04:05:12Z"
      },
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
      "metadata": {},
      "metadataOwners": {}
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
      "engineControl": null,
      "lastUpdate": "2026-07-28T07:47:11.000Z",
      "attributes": {
        "imei": "0780901703170270",
        "movementStatus": "OFF",
        "address": "Jalan Wibawa Mukti II...",
        "simcard": "780901703170270",
        "registrationDate": "2026-07-07",
        "mileage": 259.66
      },
      "metadata": {},
      "metadataOwners": {}
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
  "metadataOwners": {
    "jenis": "admin",
    "merek": "admin",
    "tahun": "admin",
    "warna": "admin"
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
> **Default range:** Jika `from`/`to` kosong, Gateway memakai **"hari ini"** → `from = 00:00 zona waktu user`, `to = waktu request`. Zona user diambil dari `users.timezone` (ditetapkan saat user dibuat, wajib IANA); fallback ke `DEFAULT_USER_TIMEZONE` (.env, default `Asia/Jakarta`) untuk user lama.
>
> **Urutan response:** Posisi diurutkan **ascending by `deviceTime`** (konsisten lintas source). Traccar diambil dari endpoint resmi `/reports/route` (bukan `/positions`), kecepatan dikonversi knots → km/h.
>
> **Query Parameters:**

| Parameter | Tipe | Wajib | Deskripsi |
|-----------|------|-------|-----------|
| `deviceId` | integer | ✅ | Device ID |
| `source` | string | - | `traccar`, `mspf`, atau `foxlogger` |
| `group` | string | - | Group/BC ID |
| `from` | string | - | ISO 8601 — awal range (default: 00:00 hari ini, zona user) |
| `to` | string | - | ISO 8601 — akhir range (default: waktu request) |

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
    "course": 89,
    "deviceTime": "2026-07-28T07:47:11Z",
    "source": "foxlogger",
    "attributes": {
      "address": "Jalan Wibawa Mukti II...",
      "movementStatus": "OFF",
      "mileage": 211.78,
      "ignition": false,
      "nopol": "B 2412 PFQ"
    }
  }
]
```

> **Enrichment FoxLogger:** `course` diisi dari `/report-rollback` (`dir`) dan `attributes.nopol` (plat nomor) dari endpoint yang sama, dicocokkan per waktu dengan `/report-history`. Jika tidak ada kecocokan rollback, `course` tetap 0 dan `nopol` tidak ada.

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

### GET /api/reports/top-distance

Mengembalikan daftar peringkat armada dengan jarak tempuh (kilometer) tertinggi dalam **24 jam terakhir** (Leaderboard Top KM). Endpoint ini memiliki alias URL: **`GET /api/reports/top-mileage`**.

> **Strategi Master Cache (Zero Server Overhead):**
> Data 24 jam dihitung secara agregasi borongan lintas server (Traccar, MSPF per-BC, FoxLogger) dan disimpan ke dalam **Master In-Memory Cache (TTL 30 menit / 1800 detik)**.
> Panggilan dari FE langsung disajikan dari RAM Gateway (< 2ms) tanpa membebani server upstream.
>
> **Access Control (RBAC):**
> - **Admin:** Menampilkan ranking dari seluruh armada yang terhubung di sistem.
> - **Customer:** Otomatis dibatasi hanya meranking armada yang di-assign ke custom groups miliknya (`device_groups`).

**Query Parameters:**

| Parameter | Tipe | Default | Deskripsi |
|-----------|------|---------|-----------|
| `limit` | integer | `10` | Jumlah maksimal armada peringkat teratas yang ingin diambil (1 - 100) |
| `group` | integer | - | Opsional: filter ranking hanya di dalam custom group ID tertentu |
| `refresh` | boolean | `false` | Opsional: bypass/invalidate master cache dan kalkulasi ulang data terbaru |

**Response 200:**
```json
{
  "period": {
    "from": "2026-09-08T14:30:00.000Z",
    "to": "2026-09-09T14:30:00.000Z",
    "hours": 24
  },
  "totalDevicesEvaluated": 12,
  "topDevices": [
    {
      "rank": 1,
      "deviceId": 10385015,
      "name": "B2265PKV - TRIAL TYPE T",
      "source": "mspf",
      "distance": 67.7,
      "duration": 6597
    },
    {
      "rank": 2,
      "deviceId": 888802,
      "name": "Traccar Truck 2",
      "source": "traccar",
      "distance": 45.2,
      "duration": 4800
    },
    {
      "rank": 3,
      "deviceId": 780901703170270,
      "name": "FoxLogger Unit 1",
      "source": "foxlogger",
      "distance": 25.6,
      "duration": 2100
    }
  ]
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

### Kontrol Hak Akses & Safety Interlock

Perintah mematikan mesin kendaraan (`engineStop`, `deactivate`, atau `desiredStatus: INACTIVE`) dilindungi oleh 3 lapis pengamanan:
1. **Device Access Boundary:** Pengguna non-admin wajib memiliki perangkat di dalam salah satu `groups` miliknya. Jika tidak -> `403 ERR_FORBIDDEN`.
2. **Capability Check (`canCutEngine`):** Pengguna customer wajib memiliki izin `permissions.canCutEngine === true`. Admin otomatis bypass. Jika customer tidak berizin -> `403 ERR_FORBIDDEN`.
3. **Safety Confirmation & Notice Flow:** Perintah mematikan mesin mewajibkan parameter `"confirm": true`. Jika dikirim tanpa konfirmasi, server mengembalikan status `422 WARN_CONFIRMATION_REQUIRED` tanpa mengeksekusi perintah.
4. **Debounce (Anti-Spam):** Jeda 5 detik per perangkat diberlakukan untuk mencegah penekanan tombol ganda (`429 ERR_RATE_LIMIT`).
5. **Audit Logging:** Seluruh riwayat pengiriman perintah (sukses, gagal, maupun ditolak) dicatat secara persisten ke database tabel `command_logs`.

---

### POST /api/commands

Mengirim perintah ke device. Gateway secara cerdas melakukan routing dan **terjemahan otomatis dua arah (Unified Command Translation)**:
- Perintah hidupkan mesin (`engineResume`, `activate`) $\rightarrow$ otomatis dikirim sebagai `engineResume` ke Traccar dan `desiredStatus: 'ACTIVE'` ke MSPF.
- Perintah matikan mesin (`engineStop`, `deactivate`) $\rightarrow$ otomatis dikirim sebagai `engineStop` ke Traccar dan `desiredStatus: 'INACTIVE'` ke MSPF.
- FE cukup mengirim perintah standar yang seragam (`type: "engineResume"` / `type: "engineStop"`) untuk semua jenis kendaraan tanpa perlu membedakan vendor backend.
- Perangkat FoxLogger tidak mendukung pengiriman remote command (`400 ERR_NOT_SUPPORTED`).

**Request Body:**
- `deviceId` (wajib, integer/string): ID perangkat target
- `type` (wajib, string): Tipe perintah (`engineStop`, `engineResume`, `activate`, `deactivate`, dll.)
- `data` (opsional, object): Parameter payload tambahan untuk Traccar
- `source` (opsional, string): `traccar` atau `mspf`
- `group` (opsional, string): prefix group ID jika spesifik
- `confirm` (opsional boolean): Wajib bernilai `true` untuk perintah mematikan mesin (`engineStop` / `deactivate`)
- `reason` (opsional string): Catatan atau alasan eksekusi (tersimpan dalam audit log)

**Request Contoh (Mematikan Mesin):**
```json
{
  "deviceId": 1001,
  "type": "engineStop",
  "confirm": true,
  "reason": "Kendaraan diduga dicuri",
  "source": "traccar"
}
```

**Response 200 (Sukses):**
```json
{
  "success": true,
  "message": "Command sent",
  "deviceId": 1001,
  "commandType": "engineStop",
  "source": "traccar",
  "engineControl": {
    "desired": "INACTIVE",
    "state": "DEACTIVATING",
    "isApplied": false,
    "lastAppliedAt": null
  },
  "data": { "id": 101, "type": "engineStop" }
}
```
*(Catatan: field `source` hanya tampil untuk role `admin`)*

**Response 422 (Konfirmasi Diperlukan):**
Jika `confirm` belum diset `true` pada perintah cut engine:
```json
{
  "success": false,
  "code": "WARN_CONFIRMATION_REQUIRED",
  "requiresConfirmation": true,
  "message": "Confirmation required: Stopping vehicle engine carries safety risks. Set confirm: true to proceed.",
  "safetyNotice": "Kendaraan hanya dapat dimatikan saat kondisi aman. Pastikan konfirmasi disetujui.",
  "deviceId": 1001,
  "commandType": "engineStop"
}
```

**Response 403 (Izin Kurang):**
```json
{
  "error": "Forbidden: You do not have permission to stop vehicle engine",
  "code": "ERR_FORBIDDEN"
}
```

---

### GET /api/commands/types/:deviceId

Mengembalikan daftar tipe command yang didukung oleh device. Jika customer tidak memiliki izin `canCutEngine: true`, tipe perintah mematikan mesin (`engineStop`, `deactivate`) otomatis difilter keluar agar UI tidak menampilkan tombol yang tidak berhak diakses.

**Query Parameters:** `source`, `group`

**Response 200 (Customer berizin / Admin):**
```json
{
  "types": ["engineStop", "engineResume", "positionPeriodic"],
  "source": "traccar"
}
```

**Response 200 (Customer tanpa canCutEngine):**
```json
{
  "types": ["engineResume", "positionPeriodic"],
  "source": "traccar"
}
```

---

### PUT /api/commands/:deviceId/activation

Unified activation endpoint — berfungsi untuk Traccar dan MSPF.

**Request Body:**
- `desiredStatus` (wajib, string): `"ACTIVE"` atau `"INACTIVE"`
- `source` (opsional, string): `traccar` atau `mspf`
- `group` (opsional, string)
- `confirm` (opsional boolean): Wajib `true` jika `desiredStatus: "INACTIVE"`
- `reason` (opsional string): Catatan/alasan eksekusi yang dicatat ke audit log

| Status | Traccar | MSPF | Syarat Keamanan |
|--------|---------|------|-----------------|
| `ACTIVE` | Kirim `engineResume` | Activation → ACTIVE | Normal |
| `INACTIVE` | Kirim `engineStop` | Activation → INACTIVE | Wajib `canCutEngine: true` & `confirm: true` |

**Request Contoh:**
```json
{
  "desiredStatus": "INACTIVE",
  "confirm": true,
  "reason": "Penarikan unit tertunggak",
  "source": "traccar"
}
```

**Response 200:**
```json
{
  "success": true,
  "deviceId": 1001,
  "desiredStatus": "INACTIVE",
  "commandType": "engineStop",
  "source": "traccar",
  "engineControl": {
    "desired": "INACTIVE",
    "state": "DEACTIVATING",
    "isApplied": false,
    "lastAppliedAt": null
  },
  "data": { ... }
}
```
*(Catatan: field `source` hanya tampil untuk role `admin`)*

---

### GET /api/commands/logs

Melihat riwayat audit log seluruh pengiriman perintah.
- **Admin:** Melihat riwayat seluruh armada atau filter bebas.
- **Customer:** Otomatis dibatasi hanya untuk perangkat yang berada di dalam `groups` miliknya.

**Query Parameters:**
- `deviceId` (opsional integer): Filter berdasarkan ID perangkat
- `source` (opsional string): `traccar` | `mspf`
- `userId` (opsional integer, admin only): Filter berdasarkan user pelaksana
- `status` (opsional string): `SUCCESS` | `FAILED` | `REJECTED`
- `commandType` (opsional string): Contoh `engineStop`, `ACTIVE`, dll.
- `from` (opsional ISO string): Filter tanggal awal
- `to` (opsional ISO string): Filter tanggal akhir
- `offset` (opsional integer, default 0)
- `limit` (opsional integer, default 50, max 200)

**Response 200:**
```json
{
  "logs": [
    {
      "id": 1,
      "userId": 2,
      "username": "budi_s",
      "role": "customer",
      "deviceId": 1001,
      "deviceName": null,
      "source": "traccar",
      "commandType": "engineStop",
      "payload": {},
      "confirmed": true,
      "reason": "Kendaraan keluar rute",
      "status": "SUCCESS",
      "errorMessage": null,
      "ipAddress": "127.0.0.1",
      "createdAt": "2026-09-10T04:12:00.000Z"
    }
  ],
  "total": 1,
  "offset": 0,
  "limit": 50
}
```

---

### PUT /api/devices/:id/metadata

Menyimpan metadata device (jenis kendaraan, merek, tahun, warna, dll). Data disimpan di middleware database, bukan dikirim via WebSocket.

Metadata dibagi **2 kepemilikan (owner)**: `admin` dan `customer`.

| Owner | Siapa yang bisa tulis | Siapa yang bisa hapus |
|-------|----------------------|----------------------|
| `admin` | Admin saja (customer → **403**) | Admin saja (customer → **403**) |
| `customer` | Customer & Admin | Customer & Admin |

Aturan:
- **Admin** default menulis ke `owner: 'admin'`; bisa menulis/hapus metadata customer via `owner: 'customer'`.
- **Customer** selalu menulis ke `owner: 'customer'`; jika mencoba `owner: 'admin'` → **403 ERR_FORBIDDEN**.
- Customer hanya bisa edit device yang ada di group-nya.
- `updated_by` (user id) otomatis dicatat saat menulis.

**Request (admin):**
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

**Request (customer):**
```json
{
  "source": "traccar",
  "metadata": {
    "catatan": "tolong cek AC sebelum dipakai"
  }
}
```

**Response 200:**
```json
{
  "deviceId": 10258579,
  "source": "mspf",
  "owner": "admin",
  "metadata": {
    "jenis": "Box Cooler",
    "merek": "Mitsubishi",
    "tahun": "2024",
    "warna": "Putih"
  }
}
```

Metadata muncul di response `GET /api/devices` dan `GET /api/devices/:id` sebagai field `metadata` (flat, gabungan admin + customer) + `metadataOwners` (peta pemilik per-key):

```json
{
  "id": 10258579,
  "name": "Box 1",
  "metadata": {
    "jenis": "Box Cooler",
    "catatan": "tolong cek AC sebelum dipakai"
  },
  "metadataOwners": {
    "jenis": "admin",
    "catatan": "customer"
  }
}
```

> `metadataOwners` memberi tahu FE key mana yang di-lock (milik `admin`, tidak bisa diedit customer) vs milik `customer`. Jika key sama di kedua blob, nilai milik **admin** yang tampil.

### DELETE /api/devices/:id/metadata

Menghapus metadata device. Query param `source` wajib.

| Param | Deskripsi |
|-------|-----------|
| `source` | Wajib. `traccar` / `mspf` / `foxlogger` |
| `owner` | Opsional. `admin` (default utk admin) / `customer`. Customer diabaikan → selalu `customer`; jika customer kirim `owner=admin` → **403** |

Akses: admin bebas (hapus admin maupun customer via `owner`), customer hanya bisa hapus metadata **miliknya sendiri** (`owner=customer`) di device group-nya.

**Request:**
```http
DELETE /api/devices/10258579/metadata?source=mspf&owner=customer
Authorization: Bearer <token>
```

**Response 200:**
```json
{
  "deviceId": 10258579,
  "source": "mspf",
  "owner": "customer",
  "deleted": true
}
```

---

## 6. Users (Admin Only)

### GET /api/users

Mengembalikan daftar semua user.

**Response 200:**
```json
[
  {
    "id": 1,
    "username": "admin",
    "email": "admin@system.local",
    "firstName": "Admin",
    "lastName": "System",
    "role": "admin",
    "isActive": true,
    "tokenVersion": 1,
    "groups": [1, 5],
    "timezone": "Asia/Jakarta",
    "permissions": { "canCutEngine": true },
    "createdAt": "2026-06-17T00:00:00.000Z"
  }
]
```

### GET /api/users/:id

Mengembalikan detail user.

**Response 200:**
```json
{
  "id": 2,
  "username": "customer@company.com",
  "email": "customer@company.com",
  "firstName": "Budi",
  "lastName": "Santoso",
  "role": "customer",
  "isActive": true,
  "tokenVersion": 1,
  "groups": [1, 5],
  "timezone": "Asia/Jakarta",
  "permissions": { "canCutEngine": false },
  "createdAt": "2026-06-17T00:00:00.000Z"
}
```

### POST /api/users

Membuat user baru. **Semua field berikut wajib diisi**:
- `username`: username unik
- `email`: email unik dan format valid
- `firstName`: nama depan
- `lastName`: nama belakang
- `password`: password minimal 6 karakter
- `confirmPassword`: konfirmasi password (wajib identik dengan `password`)
- `timezone`: timezone IANA valid (contoh: `Asia/Jakarta`, `Asia/Tokyo`, `UTC`)
- `role`: opsional (default: `customer`)
- `groups`: opsional array integer custom group ID (default: `[]`)
- `isActive`: opsional boolean (default: `true`)
- `permissions`: opsional object capability (default: `{"canCutEngine": false}`)

**Request:**
```json
{
  "username": "budi_s",
  "email": "budi@company.com",
  "firstName": "Budi",
  "lastName": "Santoso",
  "password": "pass123",
  "confirmPassword": "pass123",
  "role": "customer",
  "groups": [1, 5],
  "timezone": "Asia/Jakarta",
  "isActive": true,
  "permissions": {
    "canCutEngine": false
  }
}
```

**Response 201:**
```json
{
  "id": 2,
  "username": "budi_s",
  "email": "budi@company.com",
  "firstName": "Budi",
  "lastName": "Santoso",
  "role": "customer",
  "groups": [1, 5],
  "timezone": "Asia/Jakarta",
  "isActive": true,
  "tokenVersion": 1,
  "permissions": {
    "canCutEngine": false
  }
}
```

### PUT /api/users/:id

Update data user oleh Admin. Semua field opsional — kirim hanya field yang ingin diubah:
- `username` (opsional, jika diubah harus unik)
- `email` (opsional, jika diubah harus format email valid dan unik)
- `firstName` / `lastName` (opsional)
- `password` (opsional, minimal 6 karakter) $\rightarrow$ **jika field password diisi, maka field `confirmPassword` wajib diisi dan harus cocok**. Mengubah password otomatis mencabut seluruh sesi token aktif user (`tokenVersion` naik).
- `isActive`: boolean (`true` / `false`). **Jika di-set `false` (disabled)**, user otomatis tidak bisa login, seluruh sesi token JWT aktif langsung hangus seketika, dan koneksi WebSocket user langsung diputus paksa.
- `permissions`: object capability, contoh: `{"canCutEngine": true}`. Mengubah permissions otomatis menaikkan `tokenVersion` dan mencabut sesi token aktif agar izin baru langsung diterapkan saat login berikutnya.
- `role` (`admin` / `customer`)
- `groups` (array integer ID)
- `timezone` (IANA timezone valid)

**Request (Disable User):**
```json
{
  "isActive": false
}
```

**Request (Update Profil & Password):**
```json
{
  "username": "budi_baru",
  "email": "budi_baru@company.com",
  "firstName": "Budi",
  "lastName": "Pratama",
  "password": "newpass123",
  "confirmPassword": "newpass123",
  "role": "customer",
  "groups": [1, 5, 3],
  "timezone": "Asia/Tokyo",
  "isActive": true
}
```

**Response 200:**
```json
{
  "id": 2,
  "username": "budi_baru",
  "email": "budi_baru@company.com",
  "firstName": "Budi",
  "lastName": "Pratama",
  "role": "customer",
  "groups": [1, 5, 3],
  "timezone": "Asia/Tokyo",
  "isActive": true,
  "tokenVersion": 2,
  "createdAt": "2026-06-17T00:00:00.000Z"
}
```

> **Catatan timezone:** `GET /api/users`, `GET /api/users/:id`, `POST /api/auth/login`, dan `GET /api/auth/me` mengembalikan `timezone`. User lama (kolom `timezone` kosong) otomatis dilaporkan dengan nilai `DEFAULT_USER_TIMEZONE` dari `.env` (default `Asia/Jakarta`). Zona ini dipakai untuk default range "hari ini" di endpoint report (mis. `/api/reports/route`).

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

Dikirim saat ada **perubahan** data posisi device dari **Traccar** (via WebSocket real-time atau REST polling fallback), **MSPF** & **FoxLogger** (via background worker `positionSync` setiap 10 detik).

> **Emit change-only:** `position` hanya dikirim saat data device berubah (dibandingkan key `lat/lon/speed/course/deviceTime/ignition`). Device diam tanpa data baru **tidak** menerima `position` berulang. Saat dikirim, `speed` & `course` tetap disertakan (MSPF course dari `mobilityData.dir`).
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

Berisi **status koneksi device** + **status device (running)**. Field `status` dan 5 field sensor **wajib selalu ada** (nilai atau `null`). Dikirim dalam 3 kondisi:
1. **Saat status berubah** (online → offline, offline → online) — edge-triggered.
2. **Heartbeat** setiap `DEVICE_STATUS_HEARTBEAT_MS` (default 90 detik) untuk semua device aktif — menjaga `lastUpdate` tetap segar.
3. **Snapshot saat koneksi WS connect/reconnect** — FE langsung mendapat status terkini (termasuk device offline) tanpa perlu refetch.

> **`status` = status KONEKSI** (hanya `online` | `offline`):
>
> | Nilai | Kondisi |
> |-------|---------|
> | `online` | data terakhir diterima **< 10 menit** (`OFFLINE_THRESHOLD_MS`) |
> | `offline` | tidak ada data baru **> 10 menit** |
>
> - **Tidak ada nilai `unknown`** — penanda "device mati/basi" memakai `running: UNKNOWN` (24 jam).
> - Device **sleep (1 jam) / deep sleep (24 jam)** akan tampil `offline` di sela laporannya — ini sesuai definisi koneksi, bukan bug.
> - `lastUpdate` saat offline = **waktu data terakhir diterima device** (BUKAN waktu deteksi offline).
>
> **Semantik field sensor (`ignition`, `voltage`, `internalBattery`, `batteryLevel`):**
> - **Selalu ada** di payload (nilai atau `null`). `null` = data tidak tersedia (source tak sediakan / belum tahu).
> - Saat **offline** → kelima field sensor **`null`** dan `running: "UNKNOWN"` (data basi).
> - Saat **online** → nilai dari data terbaru (cache/enrich), `null` bila tak tersedia.
>
> **`running` = status DEVICE** (kondisi mesin/gerak), terpisah dari `status`. Parkir diam + komunikasi normal = `status: online` + `running: STOP/IDLE`.
>
> **Hysteresis:** offline setelah stale > `OFFLINE_THRESHOLD_MS` (10 menit); online kembali saat data fresh < `ONLINE_THRESHOLD_MS` (10 menit) + cooldown flip (`STATUS_COOLDOWN_MS`, 60 detik) — mencegah status berkedip.
>
> **Threshold offline configurable (hierarki, yang lebih spesifik menang):**
> `device_metadata.offlineThresholdMs` / `reportIntervalMinutes` (>2× interval) **→ per-custom-group → per-device-type → per-source** (`TRACCAR_/MSPF_/FOXLOGGER_OFFLINE_THRESHOLD_MS`) **→ global** (`OFFLINE_THRESHOLD_MS`, default 10 menit). Level per-group/per-type siap diisi di masa depan (extension point resolver).

```json
{
  "deviceId": 10258579,
  "source": "mspf",
  "status": "offline",
  "lastUpdate": "2026-06-18T04:05:12Z",
  "running": "UNKNOWN",
  "ignition": null,
  "voltage": null,
  "internalBattery": null,
  "batteryLevel": null,
  "engineControl": {
    "desired": "INACTIVE",
    "state": "INACTIVE",
    "isApplied": true,
    "lastAppliedAt": "2026-06-18T04:05:12Z"
  }
}
```
*(Catatan: field `source` hanya tampil pada socket milik role `admin`)*

**Running status (status device):**
| Status | Ignition | Speed | Last Update | Keterangan |
|--------|----------|-------|-------------|------------|
| `RUN` | ON | > 0 | < 24 jam | Mesin nyala, berjalan |
| `IDLING` (IDLE) | ON | = 0 | < 24 jam | Mesin nyala, berhenti |
| `STOP` | OFF | = 0 | < 24 jam | Mesin mati |
| `TOWING` | OFF | > 0 | < 24 jam | Mesin mati, kendaraan bergerak (diderek) |
| `UNKNOWN` | - | - | **> 24 jam** | Device tidak terhubung / data basi (> 24 jam, boundary deep sleep) |

> **`IDLING`** = nama field di API (konsisten dengan kode); **`IDLE`** = istilah definisi.

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
