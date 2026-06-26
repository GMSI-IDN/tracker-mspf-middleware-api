# API Gateway — API Reference

Base URL: `http://localhost:3000`

> **Response Convention:** Semua response Gateway menggunakan **camelCase** (kecuali field dari Traccar/MSPF yang langsung dipass-through tanpa transformasi).

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

Mengembalikan daftar device dari Traccar dan MSPF yang sudah digabung (merged). 

> **Filter:** Hanya device dengan status **WORKING** (MSPF) atau **online/offline** (Traccar) yang dikembalikan. Device SUSPENDED tidak masuk.

Untuk admin, semua device. Untuk customer, hanya device di Group/BC yang di-assign.

**Query Parameters:**

| Parameter | Tipe | Default | Deskripsi |
|-----------|------|---------|-----------|
| `group` | integer | - | Filter by custom group ID (contoh: `5`) |
| `source` | string | - | Filter by source: `traccar` atau `mspf` |
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
    }
  ],
  "total": 139,
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
| `source` | string | `traccar` atau `mspf` (membantu routing) |
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
      "addr": {}
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
| `source` | string | `traccar` atau `mspf` (membantu routing) |
| `group` | string | Group/BC ID |
| `from` | string | ISO 8601 — awal waktu (untuk history) |
| `to` | string | ISO 8601 — akhir waktu (untuk history) |
| `limit` | integer | Jumlah data (max 1000) |

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
      "gpio": 1
    }
  }
]
```

---

### GET /api/positions/latest

Mengembalikan posisi terbaru. Sama dengan `/api/positions` tanpa filter deviceId, tapi dengan limit lebih kecil.

---

### GET /api/reports/route

Mengembalikan riwayat posisi device dalam range waktu tertentu. Format mengikuti Traccar API.

> Gateway otomatis mendeteksi sumber device (Traccar/MSPF) melalui cache. Jika belum ada di cache, Gateway akan probing langsung ke kedua backend untuk menemukan device-nya.
> **Access control:** Admin mendapat enriched data + custom attributes (rename/compute). Customer hanya mendapat custom attributes sesuai aturan grup device-nya.
>
> **Query Parameters:**

| Parameter | Tipe | Wajib | Deskripsi |
|-----------|------|-------|-----------|
| `deviceId` | integer | ✅ | Device ID |
| `source` | string | - | `traccar` atau `mspf` |
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
| `compute` | Hasil kalkulasi dari formula | ✅ Opsional | ✅ Bisa JS |

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

Example formula untuk `compute`: `value != null ? (53.869 * value - 250.292).toFixed(1) : null`

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

## 8. Health

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

## 8. WebSocket

### Connection

```javascript
const socket = io('wss://hostname/api/ws', {
  auth: { token: 'JWT_TOKEN_HERE' }
});
```

### Events (Server → Client)

#### `position`

Dikirim setiap ada update posisi dari Traccar (via WebSocket real-time atau REST polling fallback) dan MSPF (via polling setiap 10 detik).

> **Filter:** Hanya device **WORKING** (MSPF) yang dikirim. Device SUSPENDED tidak masuk. Traccar: semua device dikirim.
> **Access control:** Payload disaring berdasarkan role user yang terhubung.
> - **Admin:** Mendapatkan semua enriched data + hasil custom attributes (rename/compute/passthrough).
> - **Customer:** Hanya mendapat custom attributes sesuai aturan group device-nya. Jika tidak ada aturan, `attributes: {}`.

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
  "attributes": {
    "ignition": true,
    "voltage": 13.59,
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
  "attributes": {
    "EB": 13.44,
    "AD": 0.017,
    "AD computet": 0.034
  }
}
```

#### `device-status`

Dikirim bersamaan dengan event `position`, berisi data status device yang sering berubah. Event ini **broadcast sama** ke semua user (tidak difilter per-role seperti `position`).

```json
{
  "deviceId": 10258579,
  "source": "mspf",
  "lastUpdate": "2026-06-18T04:05:12Z",
  "running": "IDLING",
  "ignition": true,
  "voltage": 13.59
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

## 9. Error Codes

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
