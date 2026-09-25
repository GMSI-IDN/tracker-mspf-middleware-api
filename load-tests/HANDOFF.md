# Handoff Session: Load Testing & Performance Optimization

Dokumen serah terima teknis untuk agent sesi berikutnya. Tanpa pujian, padat fakta.

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

## 3. Masalah TERBUKA di Commit 24035ae (Wajib Diperbaiki Sebelum Staging)

1. **Watchdog Pilar 1:**
   - Jika sync menggantung dan watchdog membuka paksa kunci (`isSyncing = false`), proses sync lama masih berjalan di background.
   - Ketika proses lama akhirnya selesai, ia menulis data usang ke cache dan blok `finally`-nya mereset `isSyncing = false` saat sync baru sedang berjalan.
   - Solusi: Token kepemilikan / run-ID per siklus. Hanya pemegang token aktif yang boleh menulis ke cache dan mereset kunci. Pastikan semua call upstream memiliki timeout eksplisit.
2. **Rotasi MCCS Pilar 3 & TTL:**
   - Rotasi 50 device / 15 s membutuhkan ~5,4 menit untuk 1.109 device (1.109 ÷ 50 × 15s).
   - TTL saat ini 30–60 s, sehingga sebagian besar device tidak memiliki data MCCS di cache (~5 menit setelah startup dan saat berjalan).
   - Solusi: Naikkan TTL MCCS > 1 putaran (misal 10–15 menit) atau pertahankan data lama sampai pembaruan selesai. Tambahkan tes kelengkapan: % device dengan data MCCS dan umur data maksimum.
3. **Audit Pemanggil `getPositions`:**
   - Default `fetchMccs: false` di `mspf.getPositions` berlaku untuk semua pemanggil.
   - Periksa pemanggil lain (`/api/reports/*`, detail rute single-device) apakah memerlukan data MCCS.
4. **Guard Worker MCCS:**
   - `syncMccsBackground` memakai `setInterval` tanpa guard re-entrancy. Samakan pengamannya dengan Pilar 1.

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

## 7. Daftar File Penting

- **Laporan:**
  - `load-tests/results/stress-report-jalur-a.md`
  - `load-tests/results/ws-phase-c-report.md`
  - `load-tests/results/soak-150vu-45m.json` & `.log`
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
  - `positionSyncGuard.test.js`
  - `mccsDecoupling.test.js`

---

## 8. Langkah Berikutnya untuk Sesi Baru

1. Perbaiki poin **3a** (token kepemilikan sync watchdog).
2. Perbaiki poin **3b** (rotasi MCCS, TTL > 1 putaran, tes kelengkapan data).
3. Perbaiki poin **3c** (audit pemanggil `getPositions`).
4. Perbaiki poin **3d** (re-entrancy guard worker MCCS).
5. Deploy dan uji ketiga commit di staging, pantau log `[PositionSync]`.
