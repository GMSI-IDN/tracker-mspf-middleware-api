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

> Untuk **customer**, data otomatis terfilter hanya menampilkan kendaraan di grup miliknya, dan field `source` serta vendor `group` disembunyikan (*white-labeled*).
> 
> **Aturan Custom Groups & Deduplikasi:**
> - Satu custom group dapat memuat kendaraan dari **lebih dari 1 aturan sinkronisasi** (Traccar / MSPF) digabung dengan **tambah unit mandiri**.
> - **Pemisahan Add Mandiri vs Group Sync:** Perangkat hasil group sync terhubung secara dinamis dan tidak dimasukkan ke dalam daftar perangkat manual (tidak dapat dihapus per unit di UI custom group). Jika aturan sync dihapus dari custom group, seluruh perangkat terkait otomatis hilang seketika.
> - Jika customer memiliki beberapa custom group yang memiliki kendaraan yang sama (overlap), kendaraan tersebut **dijamin hanya muncul 1 kali** di list kendaraan, dengan atribut `customGroups` yang mencantumkan semua grup miliknya.
> - Field `source` dan vendor `group` hanya tampil untuk akun **admin** (digunakan untuk pengelompokan teknis di Dashboard Admin).

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

> **PENTING (Unified Command Interface):**
> - FE dapat mengirim perintah standar yang sama untuk **SEMUA KENDARAAN** lintas provider:
>   - Menghidupkan mesin $\rightarrow$ gunakan `type: "engineResume"`
>   - Mematikan mesin $\rightarrow$ gunakan `type: "engineStop"` (dengan `"confirm": true`)
> - Gateway otomatis menerjemahkan perintah ke protokol backend masing-masing (Traccar $\rightarrow$ `engineResume`/`engineStop`, MSPF $\rightarrow$ `desiredStatus: "ACTIVE"`/`"INACTIVE"`). FE tidak perlu membuat *if-else* vendor.
> - User dengan role `customer` hanya dapat mengirim perintah ke kendaraan yang berada di dalam `groups` miliknya.
> - Perintah mematikan mesin membutuhkan izin `permissions.canCutEngine === true` dari Admin.
> - Perintah mematikan mesin wajib menyertakan flag konfirmasi `"confirm": true`. Jika dikirim tanpa konfirmasi, server mengembalikan status `422 WARN_CONFIRMATION_REQUIRED`.
> - Setiap eksekusi perintah otomatis tersimpan dalam audit log.

**Contoh Request (Matikan Mesin dengan Konfirmasi & Alasan):**

```bash
POST /api/commands
Authorization: Bearer <token>
Content-Type: application/json

{
  "deviceId": 101,
  "group": "traccar_5",
  "type": "engineStop",
  "confirm": true,
  "reason": "Kendaraan keluar wilayah operasional",
  "data": {}
}
```

**Response 200 (Sukses):**

```json
{
  "success": true,
  "message": "Command sent",
  "deviceId": 101,
  "commandType": "engineStop",
  "source": "traccar",
  "data": { ... }
}
```

**Response 422 (Dialog Konfirmasi Diperlukan):**
Jika dikirim tanpa `"confirm": true`, FE dapat menangkap respons ini untuk menampilkan konfirmasi ke user:
```json
{
  "success": false,
  "code": "WARN_CONFIRMATION_REQUIRED",
  "requiresConfirmation": true,
  "message": "Confirmation required: Stopping vehicle engine carries safety risks. Set confirm: true to proceed.",
  "safetyNotice": "Kendaraan hanya dapat dimatikan saat kondisi aman. Pastikan konfirmasi disetujui.",
  "deviceId": 101,
  "commandType": "engineStop"
}
```

### 3.7 Aktifkan / Nonaktifkan Kendaraan (Unified Activation)

Satu endpoint untuk menghidupkan atau mematikan kendaraan, baik dari **Traccar** maupun **MSPF**.

```bash
PUT /api/commands/2045/activation
Authorization: Bearer <token>
Content-Type: application/json

{
  "desiredStatus": "INACTIVE",
  "confirm": true,
  "reason": "Penyalahgunaan kendaraan"
}
```

| Status | Arti | Traccar | MSPF | Syarat Keamanan |
|--------|------|---------|------|-----------------|
| `ACTIVE` | Aktifkan / hidupkan mesin | Kirim perintah `engineResume` | Activation → ACTIVE | Normal |
| `INACTIVE` | Nonaktifkan / matikan mesin | Kirim perintah `engineStop` | Activation → INACTIVE | Wajib `canCutEngine: true` & `confirm: true` |

> Gateway otomatis menentukan perintah yang tepat berdasarkan sumber device (Traccar atau MSPF).

### 3.8 Memantau Status Eksekusi Mesin (Unified Immobilizer Feedback)

Ketika perintah mematikan mesin (`engineStop` / `INACTIVE`) dikirim, kendaraan tidak selalu mati seketika (menunggu unit berhenti atau kondisi hardware aman).

Backend menyediakan field seragam **`engineControl`** di dalam data device (`GET /api/devices`, `GET /api/devices/:id`), respons command, dan event WebSocket `device-status`:

```json
{
  "engineControl": {
    "desired": "INACTIVE",
    "state": "INACTIVE",
    "isApplied": true,
    "lastAppliedAt": "2026-09-10T11:20:00.000Z"
  }
}
```

| Field | Tipe | Nilai | Arti |
|-------|------|-------|------|
| `desired` | string / null | `"ACTIVE"` / `"INACTIVE"` | Status yang diinginkan oleh pengguna |
| `state` | string | `"ACTIVE"`, `"DEACTIVATING"`, `"INACTIVE"`, `"ACTIVATING"` | Status operasional immobilizer saat ini |
| `isApplied` | boolean | `true` / `false` | **`true` jika relay fisik di kendaraan sudah terkonfirmasi terputus/tersambung** |
| `lastAppliedAt` | string / null | ISO timestamp | Waktu konfirmasi fisik terakhir dari telemetri perangkat |

**Panduan Tampilan di Frontend:**
- `isApplied: false` & `state: "DEACTIVATING"` $\rightarrow$ Tampilkan badge kuning / spinner: **"Memproses Pemutusan Mesin..."** (tombol terkunci sementara).
- `isApplied: false` & `state: "ACTIVATING"` $\rightarrow$ Tampilkan badge kuning / spinner: **"Memproses Pengaktifan Mesin..."** (tombol terkunci sementara).
- `isApplied: true` & `state: "INACTIVE"` $\rightarrow$ Tampilkan badge merah: **"Mesin Dinonaktifkan (Terkonfirmasi)"** $\rightarrow$ tombol terbuka untuk perintah nyalakan (`engineResume`).
- `isApplied: true` & `state: "ACTIVE"` $\rightarrow$ Tampilkan badge hijau: **"Mesin Normal / Aktif"** $\rightarrow$ tombol terbuka untuk perintah matikan (`engineStop`).

**Mekanisme Pencegahan UI Terkunci Permanen (Auto-Reconciliation & Rollback Detection):**
1. **Deteksi Pembatalan Upstream (Provider Rollback):**
   - Jika perintah pemutusan (`INACTIVE`) atau pengaktifan (`ACTIVE`) sempat masuk fase transisi (`DEACTIVATING`/`ACTIVATING`) namun upstream server membatalkan perintah tersebut (misal GPS menolak pemutusan karena mobil melaju kencang), Backend seketika mendeteksi rollback ini.
   - Target `desired` otomatis dibersihkan dan status dikembalikan ke kondisi fisik riil (`isApplied: true`, `state: "ACTIVE"` atau `"INACTIVE"`). Spinner berhenti dan tombol di UI langsung terbuka kembali.
2. **Penanganan Tracker Fire-and-Forget (No-ACK):**
   - Beberapa tipe tracker GPS tidak mengirim paket ACK konfirmasi relay balik ke server.
   - Backend menerapkan batas toleransi rekonsiliasi **60 detik**. Jika setelah 60 detik kontak mesin sudah OFF atau kecepatan 0, Backend otomatis mengonfirmasi status menjadi `isApplied: true`. Jika kendaraan masih melaju kencang / kontak ON, perintah dibatalkan dan status dikembalikan ke `ACTIVE` demi keselamatan.
3. **Pembaruan Real-Time WebSocket:**
   - Setiap kali terjadi perubahan status relay atau timeout rekonsiliasi, Backend mem-broadcast event WebSocket `device-status` dengan blob `engineControl` terbaru, sehingga Frontend tidak perlu meminta user me-refresh browser.

### 3.9 Riwayat Perintah Kendaraan (Audit Trail)

Melihat log histori eksekusi perintah (siapa yang mengirim, waktu, target unit, konfirmasi, alasan, dan status eksekusi):

```bash
GET /api/commands/logs?deviceId=101&limit=20
Authorization: Bearer <token>
```

### 3.10 Riwayat Event & Peringatan Insiden (Events & Alerts)

Melihat log event armada (overspeed, geofence, engine on/off, alarm SOS, cut-power, fuel steal, dsb) lintas provider (**Traccar, MSPF, FoxLogger**) secara terpadu:

```bash
GET /api/reports/events?limit=50&offset=0
Authorization: Bearer <token>
```

**Panduan Integrasi Khusus Frontend (FE):**
1. **Buka Tabel Langsung Tanpa Wajib Tanggal:**
   - FE tidak perlu memaksa user memilih tanggal saat tabel pertama kali dibuka. Cukup request `?limit=50&offset=0`.
   - Backend otomatis memberikan data **7 hari terakhir**.
2. **Pahami Semantik Status `OPEN` vs `CLOSE` & Detail Waktu:**
   - **`OPEN` (Active Incident):** Event yang **saat ini masih berlangsung / belum terselesaikan** (`closedAt: null`). Misalnya event *"Out pool pondok cabe"* dengan `openedAt` 6 bulan lalu menandakan bahwa unit keluar dari pool sejak tanggal itu dan **hingga saat ini belum kembali ke pool**.
   - **`CLOSE` (Resolved History):** Event yang sudah tuntas dalam jendela waktu filter.
     - **MSPF & FoxLogger:** Memiliki durasi nyata. Field `openedAt` berisi kapan insiden mulai, `closedAt` berisi kapan insiden selesai, dan `eventTime = closedAt` (agar kronologis aktivitas terbaru muncul paling atas).
     - **Traccar:** Bersifat *point-in-time discrete*. Untuk event open (`ignitionOn`, `geofenceEnter`), `openedAt = eventTime` dan `closedAt = null`. Untuk event close (`ignitionOff`, `geofenceExit`), `openedAt = null` dan `closedAt = eventTime`.
3. **Penyajian Badge & Durasi di UI:**
   - Event `OPEN` $\rightarrow$ Tampilkan badge mencolok: **`AKTIF / ONGOING`** beserta durasi berjalan (contoh: *"Sejak 25 Mar 2026 (176 hari lalu)"*).
   - Event `CLOSE` $\rightarrow$ Tampilkan badge netral: **`SELESAI / RESOLVED`**.
   - Hitung durasi insiden:
     ```javascript
     if (event.openedAt && event.closedAt) {
       const durationMs = new Date(event.closedAt) - new Date(event.openedAt);
       // Tampilkan format durasi: "X jam Y menit"
     } else {
       // Kejadian sesaat (point-in-time)
     }
     ```
4. **Timezone User:**
   - Semua timestamp yang dikirim backend (`eventTime`, `openedAt`, `closedAt`) selalu berupa **UTC ISO 8601** (berakhiran `Z`).
   - Frontend memformat waktu tersebut ke jam lokal user sesuai `user.timezone` (misal: `"Asia/Jakarta"`) yang diperoleh dari `GET /api/auth/me`.
5. **Investigasi Peta (On-Demand Location):**
   - Respon tabel event sengaja tidak menyertakan koordinat GPS per baris untuk menjaga performa tabel tetap instan (<50ms).
   - Saat user menekan tombol **"Lihat di Peta"**, FE cukup memanggil endpoint rute dengan jendela waktu $\pm 2$ menit dari waktu kejadian:
     ```bash
     GET /api/reports/route?deviceId={deviceId}&from={openedAt_or_eventTime_minus_2m}&to={closedAt_or_now_plus_2m}
     ```
     Lalu gambar polyline pendek dan beri Pin Marker di titik terdekat insiden.
6. **Navigasi Cepat & Tombol Reload:**
   - Pindah halaman (Page 1 $\rightarrow$ 2 $\rightarrow$ 3) didukung oleh in-memory cache 30 detik (<5ms). Summary menyertakan hitungan `{ total, open, closed, offset, limit }`.
   - Jika membuat tombol "Refresh", tambahkan parameter `?refresh=true` untuk mem-bypass cache.

---

## 4. Alur Penggunaan

**Untuk customer:**
1. Login → dapat token & object `permissions` (contoh: `{ canCutEngine: false }`)
2. `GET /api/auth/me` → cek role, permissions & groups yang diakses
3. `GET /api/groups` → lihat daftar Group/BC yang bisa diakses
4. `GET /api/devices?group=traccar_5` → lihat kendaraan di group tersebut
5. `GET /api/commands/types/:deviceId` → lihat tipe perintah yang diizinkan (tipe `engineStop` otomatis tersembunyi jika `canCutEngine: false`)
6. `GET /api/positions?deviceId=101&group=traccar_5` → lihat posisi
7. `POST /api/commands` → kirim perintah (sertakan `confirm: true` jika mematikan mesin)
8. `GET /api/commands/logs` → lihat riwayat eksekusi perintah kendaraan

**Untuk admin (tambahan):**
1. `GET /api/users` → lihat daftar semua user
2. `POST /api/users` / `PUT /api/users/:id` → atur izin `permissions: { canCutEngine: true/false }` untuk customer
3. `GET /api/commands/logs` → audit trail seluruh armada lintas user & device
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
