# Handoff Session: Load Testing & Performance Optimization

Dokumen serah terima teknis untuk agent sesi berikutnya. Tanpa pujian, padat fakta.

---

## 0. File yang Diubah per Iterasi

| Iterasi | Status | File Diubah |
|---|---|---|
| **Pilar 1 & 3 Fondasi** | ✅ Commit `24035ae` | `src/services/positionSync.js`, `src/services/mspf.js`, `src/__tests__/positionSyncGuard.test.js`, `src/__tests__/mccsDecoupling.test.js` |
| **3a** | ✅ Commit `d9b0e2a` | `src/utils/guardedJob.js`, `src/services/positionSync.js`, `src/__tests__/guardedJob.test.js`, `src/__tests__/positionSyncGuard.test.js`, `src/__tests__/positionSyncMetrics.test.js` |
| **3b & 3d** | ✅ Commit `c519381` | `src/services/mspf.js`, `src/utils/guardedJob.js`, `src/__tests__/mccsWorkerCoverage.test.js`, `load-tests/scripts/prove-mccs-coverage.js` |
| **3c** | ✅ Audit selesai | Tidak ada kode diubah (semua pemanggil aman) |
| **3e** | ✅ Commit `7759324` & `65f4aee` | `src/services/positionSync.js`, `src/services/traccar.js`, `src/services/foxlogger.js`, `src/services/mspf.js`, `src/utils/guardedJob.js`, `src/__tests__/positionSyncGuard.test.js`, `src/__tests__/mccsDecoupling.test.js` |
| **3f** | ✅ Commit `5795590` & `844f277` | `src/services/mspf.js`, `src/__tests__/mccsWorkerCoverage.test.js` |
| **3g** | ✅ Commit `5659af1` | `src/utils/guardedJob.js`, `src/services/positionSync.js`, `src/services/mspf.js`, `src/__tests__/guardedJob.test.js`, `src/__tests__/positionSync.test.js`, `src/__tests__/mccsWorkerCoverage.test.js` |
| **Perbaikan Tes device-groups** | ✅ Commit `d03b51e` | `src/__tests__/gateway.test.js` |

---

## 1. Status Commit Git (Pilar 1 + 3 Lengkap)

Daftar seluruh commit Pilar 1 + 3 (fondasi, optimasi, hardening, dan perbaikan tes) yang sudah masuk ke `development`, `staging`, dan **SUDAH di-deploy ke production**:

1. `4f645d6` — `perf(cache): disable useClones with safe shallow-copy boundaries`
2. `b9c75cc` — `refactor: add use strict to all src files and enforce with eslint`
3. `24035ae` — `feat(sync): add sync guard and decouple mccs into background worker`
4. `d9b0e2a` — `fix(sync): guarded job with ownership token for position sync (3a)`
5. `c519381` — `fix(mccs): persistent MCCS store, guardedJob worker, missingCount (3b+3d)`
6. `7759324` — `fix(sync): 10s request timeout on position sync path (3e)`
7. `65f4aee` — `fix(sync): raise position sync watchdog to 180s (3e follow-up)`
8. `5795590` — `feat(mccs): classify MCCS fetch failures, log summary once per cycle`
9. `844f277` — `feat(mccs): pause devices with empty MCCS data, one-time reactivation (3f)`
10. `5659af1` — `fix(timing): use monotonic clock for durations, watchdogs, and pauses (3g)`
11. `d03b51e` — `test: fix stale device-groups assertion (deviceName), seed data deterministically`

**Status Produksi:** ✅ **Pilar 1 + Pilar 3 LENGKAP SUDAH AKTIF DI PRODUCTION.**

---

## 2. Ringkasan Pekerjaan Iterasi Terakhir

### Iterasi 3f: Penanganan Jeda Device `empty_data` & Reaktivasi Dinamis
- **Temuan Staging & Lokal:** 100% kegagalan MCCS di staging adalah `empty_data` (~450 device). Cek manual membuktikan kendaraan tersebut terakhir mengirim data 90–367 hari lalu (bukan error API MSPF, melainkan unit pasif/mati).
- **Mekanisme Jeda (`25–35 menit` acak):** Device yang mengembalikan `empty_data` dilewati dari rotasi worker selama 25–35 menit. Data MCCS lama di `mccsStore` tetap dipertahankan.
- **Pencegahan Siklus Bolak-Balik (Hard Jeda):** Satu device hanya diizinkan aktif kembali maksimal 1 kali per masa jeda (`reactivatedOnce`). Jika setelah diprioritaskan hasilnya tetap `empty_data`, device masuk "jeda penuh" (`hardJeda = true`) dan sinyal `deviceTime` diabaikan sampai jeda 25–35 menit habis.
- **Reaktivasi Dinamis:** Jika sync posisi GPS menerima `deviceTime` yang lebih baru untuk device yang jeda normal, device langsung dikeluarkan dari jeda dan diprioritaskan di batch terdepan berikutnya.
- **Pembersihan Log:** `empty_data` tidak lagi memicu warning `missingCount` atau `staleCount`. Warning kegagalan siklus hanya muncul jika terdapat error jaringan/server nyata (`timeout`, `http_404`, `http_429`, `http_5xx`, `other`). Ringkasan satu baris dicatat per putaran: `[MccsWorker] cycle devices: X with data, Y paused`.

### Iterasi 3g: Migrasi ke Jam Monoton (`performance.now()`)
- Mengganti seluruh pengukuran durasi, elapsed time, timeout watchdog, dan interval jeda di `guardedJob`, `positionSync`, dan `MccsWorker` ke jam monoton `performance.now()`.
- Menghindari bug durasi negatif atau false timeout saat jam dinding melompat maju/mundur akibat NTP sync atau WSL2 time-drift.
- `Date.now()` tetap dipertahankan untuk timestamp telemetri dunia nyata (`mccsFetchTimes`, `deviceTime`).
- **Audit Sentinel Awal (`null`):** Karena `performance.now()` dimulai mendekati 0 saat startup, variabel penanda (`mspfBcCache.ts`, `lastHeartbeatAt`, `guardedJob.startedAt`, `mccsCycleStats.cycleStartedAt`, `mccsFirstFullAt`) menggunakan sentinel eksplisit `null` (bukan 0) agar evaluasi pertama pasca-startup selalu langsung mengeksekusi fetch/heartbeat/siklus.

### Perbaikan Tes `device-groups` (`src/__tests__/gateway.test.js`)
- **Penyebab:** Endpoint `GET /api/admin/device-groups` sudah mengembalikan `deviceName` (camelCase) sejak dibuat (Juni 2026), selaras dengan frontend `AdminGroups.tsx`. Tes sebelumnya memakai assertion usang `toHaveProperty('device_name')` dan lolos hanya karena tertutup oleh guard `if (length > 0)`.
- **Perbaikan:** Hanya file tes `src/__tests__/gateway.test.js` yang diubah. Guard `if (length > 0)` dihapus, data device-group di-seed secara deterministik di awal tes, assertion diganti ke `deviceName`, dan pembersihan data DB diletakkan di blok `finally` agar selalu tereksekusi.

### Catatan Khusus Open Handle / Jest Menggantung
- Eksperimen perbaikan open handle sempat dibuat lalu **SENGAJA DIHAPUS**, karena penggunaan pengaman `process.env.NODE_ENV !== 'test'` pada kode aplikasi produksi menciptakan divergensi perilaku yang berbahaya antar environment.
- Masalah open handle tetap dicatat di backlog untuk diselesaikan secara arsitektural tanpa branching `NODE_ENV`.

---

## 3. Hasil Verifikasi Lapangan di Server STAGING

Verifikasi aktual pada server **STAGING** (armada riil ~1.083 MSPF + 90 Traccar + 1 FoxLogger):
1. **Durasi Sync Posisi:** Berjalan sangat cepat dan teratur di **4–8 detik** dengan interval yang konsisten (turun drastis dari sebelumnya yang mencapai ~57 detik).
2. **Kesiapan Server & Ketersediaan Posisi Pasca-Restart:** Server siap menerima koneksi dalam **~2 detik**, dan posisi pertama siap melayani REST serta WebSocket dalam **~12 detik** setelah container aktif (sebelumnya client harus menunggu ~57 detik).
3. **Kinerja MCCS Worker:**
   - Melaporkan secara konsisten: `627 with data, ~456 paused` per putaran **~1,5 menit** (turun dari ~2,6 menit).
   - **0 cycle failures**, tidak ada warning palsu missing/stale.
   - Reaktivasi device aktif kembali dibatasi maksimal 1x per masa jeda (maksimal 1x per jam) per device.
   - Pengecekan manual membuktikan ~450 device `empty_data` adalah unit kendaraan yang memang tidak aktif selama 90–367 hari, bukan error pada API upstream MSPF.
4. **WebSocket & Frontend:** Koneksi ke staging terverifikasi stabil, armada bergerak real-time di peta, dan antarmuka web frontend terasa jauh lebih responsif.

---

## 4. Hasil Pengujian Kunci & Keterbatasan Lokal (LAPTOP)

*(Catatan: Seluruh angka kapasitas di bawah adalah hasil pengujian di **LAPTOP (i5-12450HX, WSL2, mock upstream)**. Perkiraan kapasitas di server adalah ~setengahnya dan belum diukur langsung).*

1. **Jalur A (Cache Endpoints — Hasil di LAPTOP):**
   - Sebelum (`useClones: true`): p95 1.863 ms (20 RPS), jenuh di 100 RPS (p95 4.676 ms), kapasitas aman 35–50 RPS.
   - Sesudah (`useClones: false`): p95 7,9 ms (20 RPS), 12,1 ms (50 RPS), 12–30 ms (100 RPS), 125–232 ms (200 RPS). Jenuh di 250–300 RPS. Kapasitas aman naik ke 150–180 RPS.
2. **Fase C (WebSocket Concurrency & C4 Hybrid — Hasil di LAPTOP):**
   - Lolos sampai 1.000 soket pada pengujian awal di laptop (handshake p95 28 ms, fan-out p95 185 ms, siklus p95 401 ms, error 0%).
   - Tingkat 2.000 user **TIDAK VALID**: CPU runner load tester mencapai 90%, handshake 10,3 s, error 4,85%.
   - **Temuan Verifikasi C4 @150 user (Mock Realistis di LAPTOP):** Waktu siklus p95 naik dari 60–203 ms ke **1.923 ms**. Penyebab: mock lama hanya menggerakkan kendaraan di sebagian grup (~7 vs ~96 event/client/siklus), sehingga hasil Fase C sebelumnya terlalu optimis.
   - **Perkiraan di server (~2x lebih lambat):** Pada 150 user, waktu siklus p95 di server berpotensi melewati ambang batas SLA 3 detik (3.000 ms). Beban produksi saat ini (~50 user) masih berada dalam batas aman.
   - **Penyesuaian Ambang Batas Backlog:** Pemicu optimasi emit diturunkan ke **~100 user bersamaan**. Tangga WebSocket (C2–C3) perlu diulang dengan mock realistis sebelum jumlah user mendekati angka tersebut.
3. **C5a (Thundering Herd 5 detik — Hasil di LAPTOP):**
   - 50 user: Handshake p95 44 ms, HTTP p95 < 27 ms (Lolos).
   - 150 user: Handshake p95 37 ms, HTTP p95 < 22 ms (Lolos).
   - 500 user: Gagal target (handshake p95 3,6 s, HTTP p95 3,3 s).
4. **Soak Test (150 Soket, 15 & 45 Menit — Hasil di LAPTOP):**
   - Memori stabil: RSS 342,6 $\to$ 354,4 MB (flat, delta +11,8 MB dalam 15 menit dan 1,3 juta event), 0 disconnect, 0 error.

---

## 5. Rencana Pilar Tersisa

1. **Pilar 2: `devices:merged` Stale-While-Revalidate & Single-Flight Rebuild:**
   - Soft TTL 120s, Hard TTL 24 jam. Jika soft TTL habis, kembalikan data lama seketika, picu background rebuild.
   - Single-flight mutex (`activeRebuildPromise`): puluhan request bersamaan hanya memicu 1x fetch upstream.
   - Memisahkan device rebuild sepenuhnya dari jalur sync posisi.
2. **Pilar 4: Snapshot Posisi saat Connect & First Full Sync:**
   - Emit snapshot posisi saat client connect (mirip status snapshot) agar kendaraan parkir tidak hilang pada client yang terlambat connect.

---

## 6. Aturan Kerja & SOP Pengujian

1. Satu perubahan per iterasi. Dilarang mengubah `src/` tanpa persetujuan dan diff.
2. Tes fungsional wajib di `src/__tests__/` mengimpor modul asli.
3. Target hanya localhost / container lokal. Preflight check wajib aktif.
4. Pengukuran: `CACHE_FREEZE=0` untuk kapasitas, `CACHE_FREEZE=1` untuk verifikasi integritas.
5. Threshold SLA: Handshake p95 < 200 ms, Fan-out p95 < 500 ms, Siklus p95 < 3.000 ms, Error < 0.1%, HTTP p95 < 800 ms. Runner lag p95 < 50 ms, CPU runner < 80%.
6. Selalu gunakan batas waktu eksekusi saat menjalankan pengujian, misalnya: `timeout 300 npm test`.

---

## 6b. Backlog Teknis (jangan dikerjakan tanpa persetujuan)

1. ~~**Total timeout request berurutan di jalur sync posisi:**~~ ✅ Selesai di 3e (timeout jalur sync diturunkan ke 10s, total terburuk ~40s << 120s watchdog).
2. **Retry 401 tanpa penanda anti-loop:** Interceptor MSPF dan FoxLogger melakukan `await axios(err.config)` pada 401. Jika token baru juga 401 (misal client credentials revoked), ini bisa infinite loop. Perlu penanda `_retry` di config atau batas 1x retry.
3. **Batas jumlah halaman di loop pagination:** `getDevices`, `getDeviceMccsHistory`, `getDeviceStatsReports`, `getBcStatsReports` — semua loop `do/while(start)`. Jika upstream mengembalikan `next` tak terhingga, loop tak berhenti. Perlu batas max pages (misal 100).
4. **Device baru terhitung missingCount sampai rotasi mencapainya:** Jika device baru ditambahkan ke `devices:merged` saat aplikasi berjalan, device tersebut dapat terhitung sebagai `missingCount` sementara sampai rotasi background MCCS menjangkaunya (warning palsu sementara, prioritas rendah).
5. **Paralelisasi pagination status MSPF:** Pemanggilan status MSPF di `enrichPositions` saat ini berjalan sekuensial (6 halaman berurutan). Jika upstream API MSPF mendukung paging paralel via start/offset, pengambilan status berpotensi diparalelkan untuk memangkas waktu dari ~60s ke ~10s (prioritas rendah).
6. **Penyaringan device tidak aktif berbulan-bulan (keputusan produk):** ~40% device (~450 unit) tidak aktif berbulan-bulan (90–367 hari) tetapi tetap dimuat di `devices:merged`, `/api/devices`, dan `/api/positions`. Opsi menyembunyikan atau memisahkan device yang tidak aktif > N hari dapat mengurangi payload HTTP/WS ~40% dan menghemat memori.
7. **Jest menggantung tanpa `--forceExit` karena open handle:**
   - Perbaikan berikutnya TIDAK boleh memakai pengaman `NODE_ENV !== 'test'` di kode aplikasi produksi karena menciptakan divergensi perilaku antar environment.
   - Alternatif arsitektur bersih:
     - Modul tidak memulai worker latar belakang atau koneksi websocket otomatis saat file di-require (worker dijalankan eksplisit dari `server.js`).
     - Modul mengekspor fungsi stop/teardown yang dapat dipanggil secara eksplisit oleh unit test di blok `afterAll`.
     - Semua timer/interval latar belakang wajib memakai `.unref()`.
8. **Metrik `[WS Metrics]` selalu bernilai 0:** Log event loop monitor mencatat `messages=0 devices=0 positions=0 events=0` karena counter hanya di-increment oleh pesan WS Traccar langsung, sedangkan broadcast posisi mayoritas dipancarkan via `positionSync` (MSPF & FoxLogger).
9. **Tes `device-groups` memutasi `devices:merged` tanpa pemulihan:** `src/__tests__/gateway.test.js` memanggil `cache.set('devices:merged', ...)` untuk fixture uji tanpa menyimpan dan mengembalikan state cache sebelumnya, berpotensi memengaruhi tes berikutnya jika urutan berubah.
10. **Fallback `course` ke `dir` MCCS:** Pada `enrichPositions`, jika koordinat posisi tidak menyediakan course, nilainya mengambil `dir` MCCS yang berpotensi memicu emisi posisi berubah pada `emitChangeOnly`.
11. **Voltase kendaraan parkir tidak ter-update via WebSocket:** Karena `emitChangeOnly` menyaring posisi kendaraan yang diam/parkir, pembaruan atribut baterai/voltase pada kendaraan parkir tidak terkirim via event `position` sampai kendaraan bergerak atau halaman di-refresh.
12. **Log warning `GET /v2/bc/1 404` saat startup:** Panggilan `syncSourceGroupNames` di `autoSync.js` mencoba mengambil detail BC per ID numerik, namun endpoint `/v2/bc/:id` mengembalikan 404 pada upstream MSPF (hanya `/v2/bc` list yang valid).

---

## 7. Status & Tugas Berikutnya untuk Sesi Baru

1. **Status Saat Ini:** Pilar 1 + Pilar 3 SUDAH aktif di staging dan production serta terbukti stabil. Dokumentasi proyek (.md) telah diperbarui secara menyeluruh.
2. **Tugas Berikutnya:**
   - Memulai pengerjaan **Pilar 2: `devices:merged` Stale-While-Revalidate & Single-Flight Rebuild**.
