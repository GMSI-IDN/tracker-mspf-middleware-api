# Catatan Rekomendasi & Improvisasi Performa (Berdasarkan Hasil Load Test Jalur A)

**Dokumen Referensi:** Hasil Stress Test Jalur A (`load-tests/results/stress-report-jalur-a.md`)  
**Status Implementasi:** 
- **Prioritas 1 (Akar Masalah Nyata):** Selesai diimplementasikan via commit `4f645d6` (`useClones: false`) dan `b9c75cc` (`'use strict'`). Profiling CPU membuktikan dugaan awal 1.200 serial await keliru; 81% waktu CPU terbuang untuk deep clone NodeCache.
- **Prioritas 2–5:** Backlog / Usulan Teknis masa depan.

---

## Ringkasan Diagnosa & Klarifikasi Profiling

Pada pengujian beban awal Jalur A (`/api/devices` & `/api/positions`) dengan konfigurasi lama, titik jenuh tercapai pada **100 RPS / 100 Virtual Users bersamaan** dengan kapasitas aman operasional di **35 – 50 RPS**.

> **Pelajaran Penting dari Profiling CPU:**
> Dugaan awal bahwa kelambatan diakibatkan oleh 1.200 `await` serial terbukti **tidak akurat**. Hasil profiling CPU (`node --cpu-prof`) membuktikan **81% waktu CPU habis untuk proses deep-cloning objek** di dalam library NodeCache akibat opsi bawaan `useClones: true`.
> Setelah opsi diubah menjadi `useClones: false` (commit `4f645d6`), kapasitas aman melonjak menjadi **150–180 RPS** (titik jenuh 250–300 RPS) pada laptop lokal.

Berikut adalah evaluasi 5 rekomendasi perbaikan terstruktur berdasarkan skala prioritas (*impact vs effort*):

---

## 1. Prioritas 1: Optimasi Cache Cloning & Looping di `applyCustomAttributes`

### Masalah Awal & Temuan Riil
Di `src/routes/positions.js`, fungsi `applyCustomAttributes` melakukan iterasi array 1.200 posisi. Namun bukan microtask promise yang mendominasi, melainkan proses clone objek di NodeCache setiap kali `cache.get()` dipanggil.

### Solusi yang Telah Diterapkan
1. Konfigurasi `cache.js` disetel ke `useClones: false`, mengeliminasi 81% overhead CPU secara instan.
2. Seluruh file `src/` diamankan dengan `'use strict'` dan batas shallow-copy eksplisit di titik mutasi untuk menjaga integritas data cache.
3. Objek cache dibekukan otomatis (`deepFreeze`) saat testing/load testing integritas (`CACHE_FREEZE=1`).

```javascript
// Usulan refactor: Murni sinkron tanpa await di dalam loop
function applyCustomAttributesSync(positions, user, rulesMap) {
  if (!user || !positions?.length) return;
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    if (!pos.deviceId) continue;
    const rules = rulesMap.get(`${pos.source}:${pos.deviceId}`) || [];
    if (rules.length > 0) {
      const cloned = { ...pos, attributes: { ...pos.attributes } };
      if (user.role === 'admin') {
        enrichWithRules(cloned, rules);
      } else {
        applyRules(cloned, rules);
      }
      positions[i] = cloned;
    } else if (user.role !== 'admin') {
      positions[i] = { ...pos, attributes: {} };
    }
  }
}
```
**Estimasi Dampak:** Memangkas waktu eksekusi dari **~700 ms** menjadi **< 5 ms** per request. Throughput RPS berpotensi melonjak hingga 3x lipat.

---

## 2. Prioritas 2 (Tinggi): Aktifkan Middleware Kompresi HTTP (`compression`)

### Masalah
- Selama stress test 2,5 menit, server mentransfer **1,07 GB** teks JSON mentah tanpa kompresi.
- Payload satu request `GET /api/positions` (1.200 unit) berukuran ~300 KB – 500 KB per response.
- Di `package.json`, library `compression` (`^1.8.1`) sudah terpasang, tetapi **belum diaktifkan** di `src/app.js`.

### Solusi / Usulan Improvisasi
Pasang middleware `compression` di `src/app.js` sebelum routing:
```javascript
const compression = require('compression');
...
app.use(compression({
  threshold: 1024, // kompresi payload di atas 1 KB
}));
```
**Estimasi Dampak:** Ukuran payload terpangkas hingga **~80%** (dari ~400 KB menjadi ~50 KB per request). Mengurangi konsumsi bandwidth jaringan dan memory buffer soket secara drastis.

---

## 3. Prioritas 3 (Tinggi): Cache `device_groups` di `enrichAndFilterDevices`

### Masalah
Di `src/services/groupMembership.js`, setiap kali `GET /api/devices` dipanggil, terdapat query langsung ke database:
```javascript
const [syncRules, allGroups, manualRows] = await Promise.all([
  getActiveSyncRules(),                                       // Ter-cache
  getAllGroups(),                                             // Ter-cache
  db('device_groups').select('device_id', 'source', 'group_id') // TIDAK TER-CACHE!
]);
```
Tabel `device_groups` di-query penuh ke database pada setiap request device list. Pada saat beban tinggi, ini menghabiskan pool koneksi Knex.

### Solusi / Usulan Improvisasi
Bungkus `manualRows` ke dalam cache dengan TTL (misalnya 60 detik) atau invalidasi berbasis event (saat ada perubahan grup di admin):
```javascript
const MANUAL_GROUPS_CACHE_KEY = 'cache:manual_device_groups';

async function getManualDeviceGroups() {
  let rows = cache.get(MANUAL_GROUPS_CACHE_KEY);
  if (!rows) {
    rows = await db('device_groups').select('device_id', 'source', 'group_id');
    cache.set(MANUAL_GROUPS_CACHE_KEY, rows, 60);
  }
  return rows;
}
```
**Estimasi Dampak:** Menghilangkan 1 query database di setiap request `GET /api/devices`. Meringankan beban koneksi PostgreSQL saat ribuan user mengakses daftar unit.

---

## 4. Prioritas 4 (Sedang): Paginasi & Response Caching untuk `/api/positions`

### Masalah
- Frontend saat ini memanggil `GET /api/positions` dan menerima 1.200 unit sekaligus dalam 1 request.
- Data posisi diperbarui oleh background worker (`positionSync.js`) setiap 10 detik. Meng-generate JSON yang sama 100 kali dalam 1 detik adalah pemborosan CPU.

### Solusi / Usulan Improvisasi
1. **Dukungan Paginasi:** Terapkan `offset` dan `limit` pada response posisi (seperti pada `/api/devices`), atau parameter `view=compact` jika FE hanya membutuhkan `[id, lat, lon, speed, course]`.
2. **Short-lived Response Cache:** Cache output JSON yang sudah disanitasi selama 2–3 detik.
   > **⚠️ PERINGATAN KEAMANAN (CRITICAL INVARIANT):**
   > Kunci response cache **WAJIB PER USER ATAU CAKUPAN DEVICE** (misal `positions:user:${req.user.id}` atau hash dari `allowedDeviceIds`).
   > **DILARANG KERAS** membuat cache response per role (contoh: `positions:customer`), karena customer A dan customer B memiliki custom groups dan filter kendaraan yang berbeda. Caching per role akan membocorkan data armada antar-customer secara fatal!

---

## 5. Prioritas 5 (Arsitektur): Skalabilitas Multi-Core (Cluster Mode)

### Masalah
Node.js secara default berjalan pada **1 thread (1 core CPU)**. Pada server produksi modern dengan 2, 4, atau 8 vCPU, core lainnya menganggur saat proses utama Node.js mencapai utilisasi 100%.

### Solusi / Usulan Improvisasi
- Di production (Docker/PM2), jalankan aplikasi dengan **Cluster Mode** (`instances: 'max'` atau sejumlah vCPU server).
- **Prasyarat Wajib Sebelum Cluster Mode:**
  1. `positionSync` dan `MccsWorker` hanya boleh berjalan di 1 proses/worker utama agar tidak melakukan sync berulang ke upstream secara paralel.
  2. Cache `devices:merged` dan `positions:merged` harus menggunakan Redis atau mekanisme sinkronisasi antar-proses.
  3. Connection pool PostgreSQL Knex harus dihitung ulang agar tidak melebihi batas koneksi server.
  4. Socket.io memerlukan sticky-session dan Redis adapter aktif.

**Estimasi Dampak:** Peningkatan throughput linear:
- 1 Core: ~50–70 RPS aman.
- 2 Core: ~100–140 RPS aman.
- 4 Core: ~200–280 RPS aman.
