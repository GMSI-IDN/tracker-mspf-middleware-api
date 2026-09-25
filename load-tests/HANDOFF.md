# Handoff Session: Load Testing & Performance Optimization

Dokumen serah terima teknis untuk agent sesi berikutnya. Tanpa pujian, padat fakta.

---

## 0. File yang Diubah per Iterasi

| Iterasi | Status | File Diubah |
|---|---|---|
| **3a** | ✅ Commit `d9b0e2a` | `src/utils/guardedJob.js`, `src/services/positionSync.js`, `src/__tests__/guardedJob.test.js`, `src/__tests__/positionSyncGuard.test.js`, `src/__tests__/positionSyncMetrics.test.js` |
| **3b & 3d** | ✅ Commit `f659556` | `src/services/mspf.js`, `src/utils/guardedJob.js`, `src/__tests__/mccsWorkerCoverage.test.js`, `load-tests/scripts/prove-mccs-coverage.js` |
| **3c** | ✅ Audit selesai | Tidak ada kode diubah (semua pemanggil aman) |
| **3e** | ✅ Selesai, siap commit | `src/services/positionSync.js`, `src/services/traccar.js`, `src/services/foxlogger.js`, `src/services/mspf.js`, `src/utils/guardedJob.js`, `src/__tests__/positionSyncGuard.test.js`, `src/__tests__/mccsDecoupling.test.js` |

---

## 1. Status Commit Git (Local Development Branch)

Tiga commit telah dibuat di branch `development`, **BELUM diuji di staging/production**:
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

**Perubahan lokal (belum commit):**
- **3b & 3d**: Redesign worker MCCS — persistent store (tanpa TTL), fetch-time tracking, `guardedJob` wrapper dengan ownership token, boundary purge, tracking `missingCount` & `staleCount`, cycle stats.
- **3c**: Audit pemanggil `getPositions` selesai — tidak ada kode yang perlu diubah.

---

## 2. Hasil Tes Kunci & Keterbatasan

1. **Jalur A (Cache Endpoints):**
   - Sebelum (`useClones: true`): p95 1.863 ms (20 RPS), jenuh di 100 RPS (p95 4.676 ms), kapasitas aman 35–50 RPS.
   - Sesudah (`useClones: false`): p95 7,9 ms (20 RPS), 12,1 ms (50 RPS), 12–30 ms (100 RPS), 125–232 ms (200 RPS). Jenuh di 250–300 RPS. Kapasitas aman naik ke 150–180 RPS.
2. **Fase C (WebSocket Concurrency):**
   - Lolos sampai 1.000 soket (handshake p95 28 ms, fan-out p95 185 ms, siklus p95 401 ms, error 0%).
   - Tingkat 2.000 user **TIDAK VALID**: CPU runner load tester mencapai 90%, handshake 10,3 s, error 4,85%.
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

## 3. Masalah TERBUKA

1. **3a — Watchdog Pilar 1: ✅ SELESAI (lokal, belum commit)**
   - Dibuat helper `src/utils/guardedJob.js`: mutex + watchdog + token kepemilikan (Symbol per run).
   - `positionSync.js` direfaktor: manual `isSyncing` → `guardedJob`, 3 titik `isActive()` guard.
   - 9 unit test guardedJob + 5 integration test positionSync.
2. **3b — Rotasi MCCS & 3d — guardedJob Worker MCCS: ✅ SELESAI (lokal, belum commit)**
   - NodeCache (TTL 30–60s) diganti persistent Map store + fetch-time tracking.
   - Menggunakan helper `guardedJob` (`timeoutMs: 60000`, name: `MccsWorker`).
   - Boundary purge: hapus device yang tidak lagi ada di `devices:merged` setiap awal siklus.
   - Warning & tracking `staleCount` (>5 min) dan `missingCount` (device tanpa MCCS setelah putaran 1 selesai).
   - 23 chunks × 7s = 161s per cycle, max age 154s < 180s.
   - ~7,1 req/s ke MSPF. Tes di `src/__tests__` menggunakan fake timers (~3,6s).
   - Script pembuktian delay 500ms di `load-tests/scripts/prove-mccs-coverage.js`.
3. **3c — Audit Pemanggil `getPositions`: ✅ SELESAI**
   - Satu-satunya pemanggil production untuk `mspf.getPositions` adalah `positionSync.js`.
   - Endpoint HTTP `/api/positions` membaca dari cache `positions:merged`.
   - Fitur lain yang butuh MCCS (`enrichDevice`, `getDeviceRoute`) memanggil endpoint upstream khusus langsung (`/data/history`), bukan via `getPositions`.
   - Kesimpulan: Default `fetchMccs: false` 100% aman dan data dari `mccsStore` (umur maks 2,7 menit) cukup untuk seluruh kebutuhan live tracking.

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
- Soak test ulang 15–20 menit dengan mock moving ratio merata setelah perbaikan poin 3.
- Backlog di `load-tests/PLAYBOOK.md`.

---

## 6b. Backlog Teknis (jangan dikerjakan tanpa persetujuan)

1. ~~**Total timeout request berurutan di jalur sync posisi:**~~ ✅ Selesai di 3e (timeout jalur sync diturunkan ke 10s, total terburuk ~40s << 120s watchdog).
2. **Retry 401 tanpa penanda anti-loop:** Interceptor MSPF dan FoxLogger melakukan `await axios(err.config)` pada 401. Jika token baru juga 401 (misal client credentials revoked), ini bisa infinite loop. Perlu penanda `_retry` di config atau batas 1x retry.
3. **Batas jumlah halaman di loop pagination:** `getDevices`, `getDeviceMccsHistory`, `getDeviceStatsReports`, `getBcStatsReports` — semua loop `do/while(start)`. Jika upstream mengembalikan `next` tak terhingga, loop tak berhenti. Perlu batas max pages (misal 100).
4. **Device baru terhitung missingCount sampai rotasi mencapainya:** Jika device baru ditambahkan ke `devices:merged` saat aplikasi berjalan, device tersebut dapat terhitung sebagai `missingCount` sementara sampai rotasi background MCCS menjangkaunya (warning palsu sementara, prioritas rendah).

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

1. ~~Perbaiki poin **3a** (token kepemilikan sync watchdog).~~ ✅ Selesai (`d9b0e2a`).
2. ~~Selesaikan **3b & 3d** (rotasi MCCS, persistent store, guardedJob, missingCount, tes).~~ ✅ Selesai (siap commit).
3. ~~Perbaiki poin **3c** (audit pemanggil `getPositions`).~~ ✅ Selesai (audit membuktikan tidak perlu perubahan kode).
4. Deploy dan uji commit di staging, pantau log `[PositionSync]` dan `[MccsWorker]`.
5. Kerjakan Pilar 2 (`devices:merged` Stale-While-Revalidate & Single-Flight Rebuild).
