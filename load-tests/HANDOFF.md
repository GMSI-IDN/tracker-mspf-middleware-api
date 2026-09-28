# Handoff Session: Load Testing & Performance Optimization

Dokumen serah terima teknis untuk agent sesi berikutnya. Tanpa pujian, padat fakta.

---

## 0. File yang Diubah per Iterasi

| Iterasi | Status | File Diubah |
|---|---|---|
| **3a** | ✅ Commit `d9b0e2a` | `src/utils/guardedJob.js`, `src/services/positionSync.js`, `src/__tests__/guardedJob.test.js`, `src/__tests__/positionSyncGuard.test.js`, `src/__tests__/positionSyncMetrics.test.js` |
| **3b & 3d** | ✅ Commit `c519381` | `src/services/mspf.js`, `src/utils/guardedJob.js`, `src/__tests__/mccsWorkerCoverage.test.js`, `load-tests/scripts/prove-mccs-coverage.js` |
| **3c** | ✅ Audit selesai | Tidak ada kode diubah (semua pemanggil aman) |
| **3e** | ✅ Commit `7759324` & `65f4aee` | `src/services/positionSync.js`, `src/services/traccar.js`, `src/services/foxlogger.js`, `src/services/mspf.js`, `src/utils/guardedJob.js`, `src/__tests__/positionSyncGuard.test.js`, `src/__tests__/mccsDecoupling.test.js` |

---

## 1. Status Commit Git (Local Development Branch)

Commit fondasi dan Pilar 1+3 telah dibuat di branch `development`, **BELUM diuji di staging/production**:
1. `4f645d6` — `perf(cache): disable useClones with safe shallow-copy boundaries`
   - `useClones: false` di `src/services/cache.js`.
   - Shallow copy di titik mutasi: `groupMembership.js` (`customGroups`), `positions.js`, `reports.js` (`master.devices`), `engineControl.js` (`transitionSeen`, `updateMergedDeviceCache`).
2. `b9c75cc` — `refactor: add use strict to all src files and enforce with eslint`
   - `'use strict';` di semua 73 file `src/`. Aturan `.eslintrc.json`.
   - `deepFreeze` rekursif dengan `Object.freeze` biasa saat `NODE_ENV=test` atau `CACHE_FREEZE=1`.
   - Unit test pembuktian `src/__tests__/cacheImmutability.test.js`.
3. `24035ae` — `feat(sync): add sync guard and decouple mccs into background worker`
   - Pilar 1: `isSyncing` guard + watchdog timeout 120s di `positionSync.js`.
   - Pilar 3: Fast position sync (positions + status, tanpa MCCS history) + background MCCS worker (chunk 50, interval 15s, jittered TTL 30–60s).
   - Unit test `positionSyncGuard.test.js` dan `mccsDecoupling.test.js`.
4. `d9b0e2a` — `fix(sync): guarded job with ownership token for position sync (3a)`
   - Helper `guardedJob` dengan token kepemilikan dan timeout watchdog untuk mencegah tumpang tindih sync dan race condition.
5. `c519381` — `fix(mccs): persistent MCCS store, guardedJob worker, missingCount (3b+3d)`
   - Redesign worker MCCS: persistent store (tanpa TTL), fetch-time tracking, `guardedJob` wrapper dengan token kepemilikan, boundary purge, tracking `missingCount` & `staleCount`, cycle stats.
6. `7759324` — `fix(sync): 10s request timeout on position sync path (3e)`
   - Batas timeout 10s untuk pemanggilan upstream di jalur sync posisi agar skenario worst-case terkendali.
7. `65f4aee` — `fix(sync): raise position sync watchdog to 180s (3e follow-up)`
   - Watchdog dinaikkan ke 180s untuk memberikan headroom aman bagi worst-case sync (rebuild device + enrich status + network jitter) tanpa false timeout.

**Working tree:** Bersih (`working tree clean`). Semua perubahan kode Pilar 1 + 3 (3a–3e) sudah ter-commit.

---

## 2. Hasil Tes Kunci & Keterbatasan

1. **Jalur A (Cache Endpoints):**
   - Sebelum (`useClones: true`): p95 1.863 ms (20 RPS), jenuh di 100 RPS (p95 4.676 ms), kapasitas aman 35–50 RPS.
   - Sesudah (`useClones: false`): p95 7,9 ms (20 RPS), 12,1 ms (50 RPS), 12–30 ms (100 RPS), 125–232 ms (200 RPS). Jenuh di 250–300 RPS. Kapasitas aman naik ke 150–180 RPS.
2. **Fase C (WebSocket Concurrency) & Hasil C4 Terkini:**
   - Lolos sampai 1.000 soket pada pengujian awal (handshake p95 28 ms, fan-out p95 185 ms, siklus p95 401 ms, error 0%).
   - Tingkat 2.000 user **TIDAK VALID**: CPU runner load tester mencapai 90%, handshake 10,3 s, error 4,85%.
   - **Temuan Verifikasi C4 @150 user (Mock Realistis):** Waktu siklus p95 naik dari 60–203 ms ke **1.923 ms**. Penyebab: mock lama hanya menggerakkan kendaraan di sebagian grup (~7 vs ~96 event/client/siklus), sehingga hasil Fase C sebelumnya terlalu optimis.
   - **Perkiraan di server (~2x lebih lambat):** Pada 150 user, waktu siklus p95 di server berpotensi melewati ambang batas SLA 3 detik (3.000 ms). Beban produksi saat ini (~50 user) masih berada dalam batas aman.
   - **Penyesuaian Ambang Batas Backlog:** Pemicu optimasi emit diturunkan ke **~100 user bersamaan**. Tangga WebSocket (C2–C3) perlu diulang dengan mock realistis sebelum jumlah user mendekati angka tersebut.
3. **C5a (Thundering Herd 5 detik):**
   - 50 user: Handshake p95 44 ms, HTTP p95 < 27 ms (Lolos).
   - 150 user: Handshake p95 37 ms, HTTP p95 < 22 ms (Lolos).
   - 500 user: Gagal target (handshake p95 3,6 s, HTTP p95 3,3 s).
4. **Soak 45 Menit (150 Soket):**
   - Memori stabil: RSS 348.8–351.5 MB (flat, zero leak), 0 disconnect, 283.500 event.
   - Keterbatasan: Mock saat itu hanya menggerakkan kendaraan di grup 1–5 (diperbaiki setelahnya ke modulo seragam 30% per grup).
5. **Keterbatasan Lingkungan:**
   - WSL2 dari `/mnt/e`: I/O modul memakan waktu 25,5 s vs ~2 s di Linux native ext4 staging.
   - Perangkat keras: Laptop i5-12450HX vs Xeon Ice Lake 2,19 GHz (server diperkirakan ~2x lebih lambat per core, belum diukur).
   - Pilar 1+3 dengan `MOCK_MCCS_DELAY_MS=500`: Sync posisi selesai dalam 30–45 ms, interval tepat 10 detik.

---

## 3. Analisis Worst-Case Sync & Keputusan Watchdog 180 s

### Tabel Akumulasi Waktu Terburuk Satu Siklus Sync:

| Komponen | Sifat | Halaman / Request | Timeout | Waktu Terburuk |
|---|---|---|---|---|
| **BC Fallback** | Sekuensial (jika cache kosong) | 1 req `/v2/bc` | 10 s | 10 s |
| **Fetch Positions Upstream** | Paralel `Promise.allSettled` | Traccar (1) + Fox (1) + MSPF (2 hal.) | 10 s | 20 s (bottleneck MSPF) |
| **Enrich Status MSPF** | Sekuensial (`do..while`) | 6 halaman (1.109 dev ÷ 200) | 10 s | 60 s |
| **Device Rebuild** (jika cache habis) | Paralel `Promise.allSettled` | Traccar (1) + Fox (1) + MSPF (6 hal.) | 10 s | 60 s (bottleneck MSPF) |

- **Siklus Normal (tanpa rebuild):** $20\text{s (positions)} + 60\text{s (status)} = \mathbf{80\text{ detik}}$ (atau **90 s** jika ditambah BC fallback).
- **Siklus Ekstrem (sync lambat + device cache habis):** $80\text{s} + 60\text{s} = \mathbf{140\text{ detik}}$ (atau **150 s** jika ditambah BC fallback).
- **Retry 401:** Menambah $+20\text{ s}$ per kejadian refresh + retry.

**Alasan Memilih Watchdog 180 s:**
1. Menampung skenario ekstrem (140–150 s) dengan *headroom* aman ~30 s tanpa risiko false timeout yang memutus sync valid.
2. Sangat sederhana dan minim risiko regresi dibanding memotong timeout per request menjadi terlalu agresif (<5s) yang rentan terputus saat network jitter.
3. **Catatan Pilar 2:** Setelah Pilar 2 diterapkan (*stale-while-revalidate* pada `devices:merged`), proses device rebuild akan sepenuhnya keluar dari jalur sync posisi. Worst-case sync posisi akan otomatis turun ke $\sim 80\text{--}90\text{ s}$, dan batas watchdog dapat ditinjau ulang untuk diturunkan kembali saat itu.

---

## 3b. Status Pilar 1 & Pilar 3 (3a–3e)

**Status:** ✅ **Pilar 1 + Pilar 3 (3a–3e) SELESAI LENGKAP**, siap diuji di staging.
- **3a:** Token kepemilikan sync watchdog (`guardedJob`).
- **3b:** Persistent store MCCS Map, boundary purge, rotasi ~2,7 menit (7s interval, ~7,1 req/s).
- **3c:** Audit pemanggil `getPositions` membuktikan default `fetchMccs: false` aman bagi seluruh endpoint.
- **3d:** `guardedJob` pada worker MCCS + warning `missingCount` jika ada device tanpa MCCS setelah putaran 1.
- **3e:** Timeout request jalur sync diturunkan ke 10 s, watchdog disesuaikan ke 180 s, `_resetForTests` aman.

---

## 4. Rencana Pilar Tersisa

1. **Pilar 2: `devices:merged` Stale-While-Revalidate & Single-Flight Rebuild:**
   - Soft TTL 120s, Hard TTL 24 jam. Jika soft TTL habis, kembalikan data lama seketika, picu background rebuild.
   - Single-flight mutex (`activeRebuildPromise`): 50 request bersamaan hanya memicu 1x fetch upstream.
2. **Pilar 4: Snapshot Posisi saat Connect & First Full Sync:**
   - Emit snapshot posisi saat client connect (mirip status snapshot) agar kendaraan parkir tidak hilang pada client yang terlambat connect.
   - Catatan: Readiness gating di `/health` tidak cukup karena production adalah satu container tanpa load balancer.

---

## 5. Aturan Kerja & SOP Pengujian

1. Satu perubahan per iterasi. Dilarang mengubah `src/` tanpa persetujuan dan diff.
2. Tes fungsional wajib di `src/__tests__/` mengimpor modul asli.
3. Target hanya localhost / container lokal. Preflight check wajib aktif.
4. Pengukuran: `CACHE_FREEZE=0` untuk kapasitas, `CACHE_FREEZE=1` untuk verifikasi integritas.
5. Threshold SLA: Handshake p95 < 200 ms, Fan-out p95 < 500 ms, Siklus p95 < 3.000 ms, Error < 0.1%, HTTP p95 < 800 ms. Runner lag p95 < 50 ms, CPU runner < 80%.
6. Laporan ringkas di chat, detail teknis di `load-tests/results/`.

---

## 6. Pekerjaan Tertunda di Luar Pilar

- Frontend reconnect config: attempts tak terbatas / 10+, indikator koneksi di UI, refetch data pasca reconnect.
- Deploy zero-downtime (rolling / blue-green).
- Investigasi error WebSocket Traccar di staging (unexpected HTTP 200).
- Penanganan FoxLogger `/device-lists` 404 (fallback aktif).
- Pemeriksaan log production untuk pola `concurrent execution detected`.
- Skrip benchmark CPU (`cpu-bench.js`) pembanding laptop vs server.
- Pengujian beban Jalur B (upstream reports & commands).
- Soak test ulang 15–20 menit dengan mock moving ratio merata: ✅ Selesai (15 menit @150 VU, 1,3 juta event, 0 disconnect, 0 error, RSS stabil 342,6 $\to$ 354,4 MB).
- Pengujian ulang tangga WebSocket (C2–C3) dengan mock realistis sebelum user mendekati ~100.
- Backlog di `load-tests/PLAYBOOK.md`.

---

## 6b. Backlog Teknis (jangan dikerjakan tanpa persetujuan)

1. ~~**Total timeout request berurutan di jalur sync posisi:**~~ ✅ Selesai di 3e (timeout jalur sync diturunkan ke 10s, total terburuk ~40s << 120s watchdog).
2. **Retry 401 tanpa penanda anti-loop:** Interceptor MSPF dan FoxLogger melakukan `await axios(err.config)` pada 401. Jika token baru juga 401 (misal client credentials revoked), ini bisa infinite loop. Perlu penanda `_retry` di config atau batas 1x retry.
3. **Batas jumlah halaman di loop pagination:** `getDevices`, `getDeviceMccsHistory`, `getDeviceStatsReports`, `getBcStatsReports` — semua loop `do/while(start)`. Jika upstream mengembalikan `next` tak terhingga, loop tak berhenti. Perlu batas max pages (misal 100).
4. **Device baru terhitung missingCount sampai rotasi mencapainya:** Jika device baru ditambahkan ke `devices:merged` saat aplikasi berjalan, device tersebut dapat terhitung sebagai `missingCount` sementara sampai rotasi background MCCS menjangkaunya (warning palsu sementara, prioritas rendah).
5. **Paralelisasi pagination status MSPF:** Pemanggilan status MSPF di `enrichPositions` saat ini berjalan sekuensial (6 halaman berurutan). Jika upstream API MSPF mendukung paging paralel via start/offset, pengambilan status berpotensi diparalelkan untuk memangkas waktu dari ~60s ke ~10s (prioritas rendah).
6. **Penyaringan device tidak aktif berbulan-bulan (keputusan produk, jangan dikerjakan):** ~40% device (~450 unit) tidak aktif berbulan-bulan (90–367 hari) tetapi tetap dimuat di `devices:merged`, `/api/devices`, dan `/api/positions`. Opsi menyembunyikan atau memisahkan device yang tidak aktif > N hari dapat mengurangi payload HTTP/WS ~40% dan menghemat memori.

---

## 7. Daftar File Penting

- **Laporan:**
  - `load-tests/results/stress-report-jalur-a.md`
  - `load-tests/results/ws-phase-c-report.md`
  - `load-tests/results/soak-150vu-45m.json` & `.log`
  - `load-tests/results/3a-guarded-job-report.md`
  - `load-tests/results/3b-mccs-worker-coverage-report.md`
- **Skrip Tes & Pembuktian:**
  - `load-tests/scripts/run-improved-baseline.js`
  - `load-tests/scripts/run-ws-tier.js`
  - `load-tests/scripts/run-c5-storm.js`
  - `load-tests/scripts/run-c5a-tiered.js`
  - `load-tests/scripts/c5b-integrity-reconnect.js`
  - `load-tests/scripts/prove-overlapping-sync.js`
  - `load-tests/scripts/prove-window-zero.js`
  - `load-tests/scripts/prove-mccs-delay-position-sync.js`
  - `load-tests/scripts/test-sync-guard.js`
  - `load-tests/scripts/seed-realistic-groups.js`
- **Mock & Config:**
  - `load-tests/mock-upstream/server.js`
  - `load-tests/scripts/preflight.js`
  - `load-tests/.env.loadtest`
  - `docker-compose.loadtest.yml`
- **Unit Test Baru di `src/__tests__/`:**
  - `cacheImmutability.test.js`
  - `guardedJob.test.js` (3a)
  - `positionSyncGuard.test.js` (3a rewrite)
  - `positionSyncMetrics.test.js` (3a update)
  - `mccsDecoupling.test.js`
  - `mccsWorkerCoverage.test.js` (3b, baru)

---

## 8. Langkah Berikutnya untuk Sesi Baru

1. **Uji di Staging:** Deploy dan pantau log container (`[PositionSync]`, `[MccsWorker]`) terhadap warning timeout, durasi siklus, dan kelengkapan data.
2. **Pilar 2 di Session Baru:** Implementasikan *Stale-While-Revalidate* + *Single-Flight Rebuild* pada `devices:merged`. Setelah Pilar 2 aktif, rebuild device tidak lagi membebani jalur sync posisi, dan batas watchdog dapat ditinjau ulang kembali ke ~90–120 s.
