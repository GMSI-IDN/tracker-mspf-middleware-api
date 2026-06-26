# API Gateway - User Guide

Selamat datang di API Gateway! API ini adalah satu pintu akses untuk mengambil data kendaraan dari dua server GPS — **Traccar** dan **MSPF** — cukup melalui satu alamat API.

> **Format data** yang dikeluarkan Gateway mengikuti format **Traccar API**. Data dari MSPF dinormalisasi secara otomatis, jadi FE tidak perlu handle perbedaan struktur data antara kedua sumber.

---

## 1. Autentikasi

Semua request harus menyertakan **JWT token** di header. Dapatkan token dengan login terlebih dahulu.

**Login:**

```bash
POST /api/auth/login
Content-Type: application/json

{
  "username": "email@example.com",
  "password": "password123"
}
```

**Response:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "username": "email@example.com",
    "role": "customer",
    "groups": ["traccar_5", "mspf_3"]
  },
  "expiresIn": "8h"
}
```

Token ini harus disertakan di setiap request berikutnya:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

**Cek profile sendiri** (untuk lihat role & groups yang diakses):

```bash
GET /api/auth/me
Authorization: Bearer <token>
```

**Response:**

```json
{
  "id": 1,
  "username": "email@example.com",
  "role": "customer",
  "groups": ["traccar_5", "mspf_3"]
}
```

> Field `groups` menunjukkan Group/BC mana saja yang bisa diakses oleh akun ini.

---

## 2. Hak Akses

| Role | Akses |
|------|-------|
| **Admin (Internal)** | Melihat **semua** kendaraan dari Traccar dan MSPF, semua Group dan BC |
| **Customer** | Hanya melihat kendaraan yang berada di **Group** (Traccar) atau **BC** (MSPF) yang di-assign ke akunnya |

**Aturan:**
- Setiap akun customer memiliki daftar Group/BC yang bisa diakses (field `groups`)
- Admin bisa melihat semua Group dan BC tanpa batasan
- Filter akses dilakukan otomatis di sisi Gateway

**Group vs BC:**

| Sistem | Nama | Contoh ID |
|--------|------|-----------|
| Traccar | **Group** | `traccar_5` |
| MSPF | **BC** | `mspf_3` |

---

## 3. Endpoint

### 3.1 Daftar Group / BC

Gunakan ini untuk mendapatkan daftar Group/BC yang bisa diakses, lalu pakai `id`-nya untuk filter kendaraan.

```bash
GET /api/groups
Authorization: Bearer <token>
```

**Response:**

```json
{
  "groups": [
    {
      "id": "traccar_5",
      "name": "Logistik",
      "source": "traccar",
      "deviceCount": 12
    },
    {
      "id": "mspf_3",
      "name": "Cold Chain",
      "source": "mspf",
      "deviceCount": 8
    }
  ]
}
```

> Admin melihat semua Group/BC. Customer hanya melihat yang di-assign ke akunnya.

### 3.2 Daftar Kendaraan

```bash
# Semua kendaraan (admin)
GET /api/devices
Authorization: Bearer <token>

# Filter berdasarkan Group/BC
GET /api/devices?group=traccar_5
Authorization: Bearer <token>

# Cari berdasarkan nama
GET /api/devices?search=Mobil
Authorization: Bearer <token>
```

**Response:**

```json
{
  "devices": [
    {
      "id": 101,
      "name": "Mobil Operasional 1",
      "uniqueId": "861234567890123",
      "status": "online",
      "source": "traccar",
      "group": "traccar_5"
    },
    {
      "id": 2045,
      "name": "Box Cooler 5",
      "uniqueId": "MSPF-045-BODY",
      "status": "online",
      "source": "mspf",
      "group": "mspf_3"
    }
  ]
}
```

**Parameter opsional:**

| Parameter | Deskripsi |
|-----------|-----------|
| `group` | Filter berdasarkan Group/BC ID (contoh: `traccar_5`, `mspf_3`) |
| `search` | Cari berdasarkan nama atau uniqueId |
| `status` | Filter: `online` atau `offline` |
| `source` | Filter: `traccar` atau `mspf` |
| `page` | Halaman (default: 1) |
| `limit` | Jumlah per halaman (default: 50) |

> Untuk **customer**, data akan otomatis terfilter hanya menampilkan kendaraan di Group/BC miliknya.

### 3.3 Detail Kendaraan

```bash
GET /api/devices/2045?group=mspf_3
Authorization: Bearer <token>
```

### 3.4 Posisi Kendaraan

```bash
GET /api/positions?deviceId=2045&group=mspf_3
Authorization: Bearer <token>
```

**Response:**

```json
{
  "positions": [
    {
      "id": 9981,
      "deviceId": 2045,
      "latitude": -6.2088,
      "longitude": 106.8456,
      "speed": 45.2,
      "deviceTime": "2026-06-17T08:30:00Z",
      "source": "mspf"
    }
  ]
}
```

**Parameter opsional:**

| Parameter | Deskripsi |
|-----------|-----------|
| `deviceId` | ID kendaraan (wajib) |
| `group` | Group/BC ID (membantu routing) |
| `source` | `traccar` atau `mspf` |
| `from` | Filter dari tanggal (ISO 8601) |
| `to` | Filter sampai tanggal (ISO 8601) |
| `limit` | Jumlah data (default: 100) |

> Posisi **real-time** bisa didapatkan melalui **WebSocket** — lebih efisien daripada polling HTTP.

### 3.5 WebSocket Real-time

Untuk mendapatkan update posisi secara real-time, FE bisa connect ke WebSocket Gateway.

**Koneksi:**

```javascript
const socket = io('wss://api-gateway.example.com/api/ws', {
  auth: { token: 'JWT_TOKEN_HERE' }
});
```

**Event yang diterima:**

| Event | Dikirim saat | Data |
|-------|-------------|------|
| `position` | Ada update posisi dari Traccar/MSPF | `{ deviceId, latitude, longitude, speed, source }` |
| `device-status` | Device online/offline berubah | `{ deviceId, status, source }` |
| `command-result` | Hasil eksekusi command | `{ deviceId, commandType, success, message }` |

**Contoh:**

```javascript
socket.on('position', (data) => {
  console.log('Posisi terbaru:', data);
  // update marker di map
});

socket.on('device-status', (data) => {
  console.log('Status berubah:', data);
});
```

> WebSocket adalah 1 koneksi persistent — FE tidak perlu polling HTTP untuk dapat data real-time.

### 3.6 Kirim Perintah ke Kendaraan

```bash
POST /api/commands
Authorization: Bearer <token>
Content-Type: application/json

{
  "deviceId": 101,
  "group": "traccar_5",
  "type": "engineStop",
  "data": {}
}
```

**Response:**

```json
{
  "success": true,
  "message": "Command sent successfully",
  "deviceId": 101,
  "commandType": "engineStop",
  "source": "traccar"
}
```

### 3.7 Aktifkan / Nonaktifkan Kendaraan (Unified Activation)

Satu endpoint untuk menghidupkan atau mematikan kendaraan, baik dari **Traccar** maupun **MSPF**.

```bash
PUT /api/devices/2045/activation
Authorization: Bearer <token>
Content-Type: application/json

{
  "desiredStatus": "INACTIVE"
}
```

| Status | Arti | Traccar | MSPF |
|--------|------|---------|------|
| `ACTIVE` | Aktifkan / hidupkan mesin | Kirim perintah `engineResume` | Activation → ACTIVE |
| `INACTIVE` | Nonaktifkan / matikan mesin | Kirim perintah `engineStop` | Activation → INACTIVE |

> Gateway otomatis menentukan perintah yang tepat berdasarkan sumber device (Traccar atau MSPF).

---

## 4. Alur Penggunaan

**Untuk customer:**
1. Login → dapat token
2. `GET /api/auth/me` → cek role & groups yang diakses
3. `GET /api/groups` → lihat daftar Group/BC yang bisa diakses
4. `GET /api/devices?group=traccar_5` → lihat kendaraan di group tersebut
5. `GET /api/positions?deviceId=101&group=traccar_5` → lihat posisi
6. `POST /api/commands` → kirim perintah
7. `PUT /api/devices/:id/activation` → matikan/hidupkan (khusus MSPF)

**Untuk admin (tambahan):**
1. `GET /api/users` → lihat daftar semua user
2. `GET /api/users/:id` → lihat detail user & groups-nya
3. `PUT /api/users/:id/groups` → atur Group/BC mana saja yang bisa diakses customer

---

## 5. Error yang Sering Terjadi

| HTTP Code | Arti | Penyebab |
|-----------|------|----------|
| **401** | Unauthorized | Token tidak valid atau expired. Login ulang. |
| **403** | Forbidden | Tidak punya akses ke Group/BC tersebut. |
| **404** | Not Found | ID kendaraan tidak ditemukan. |
| **502** | Bad Gateway | Server Traccar atau MSPF sedang bermasalah. |

---

## 6. Contoh Lengkap (cURL)

```bash
# Login
curl -X POST https://api-gateway.example.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "customer@company.com", "password": "pass123"}'

# Simpan token
TOKEN="eyJhbGciOiJIUzI1NiIs..."

# Lihat daftar Group/BC
curl -H "Authorization: Bearer $TOKEN" \
  https://api-gateway.example.com/api/groups

# Lihat kendaraan di Group tertentu
curl -H "Authorization: Bearer $TOKEN" \
  https://api-gateway.example.com/api/devices?group=traccar_5

# Lihat posisi kendaraan
curl -H "Authorization: Bearer $TOKEN" \
  "https://api-gateway.example.com/api/positions?deviceId=2045&group=mspf_3"

# Matikan kendaraan MSPF
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"desiredStatus": "INACTIVE"}' \
  https://api-gateway.example.com/api/devices/2045/activation
```

---

## 7. Dukungan

| Kebutuhan | Kontak |
|-----------|--------|
| Lupa password / akun baru | Hubungi admin internal |
| Kendala akses data | Hubungi tim support |
| Dokumentasi teknis | Lihat `readme.md` |

---

*Last Updated: June 17, 2026*
