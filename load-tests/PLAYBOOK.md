# Playbook Pengujian Beban & Optimasi Performa

Dokumen panduan eksekusi skenario dan pelacak status pengujian middleware API.

---

## Status Saat Ini (September 2026)

- **Commit Lokal:**
  - `4f645d6`: `useClones: false` + shallow copy boundary + deep freeze guard.
  - `b9c75cc`: `'use strict';` di semua file `src/` + ESLint global + Object.freeze.
  - `24035ae`: Pilar 1 sync guard + Pilar 3 decouple MCCS background worker.
- **Status Staging:** Ketiga commit di atas **BELUM diuji di staging**.
- **Jalur A (Cache Endpoints):** Selesai. Kapasitas aman naik dari 35–50 RPS ke 150–180 RPS. Lolos 6.000 req/2m di 50 RPS dengan latensi p50: 5 ms, p95: 10–19 ms.
- **Fase C (WebSocket Concurrency):** Selesai bertingkat. Lolos hingga 1.000 user simultan (handshake p95: 28 ms, fan-out p95: 185 ms, siklus p95: 401 ms, error: 0%). Tingkat 2.000 user tidak valid (bottleneck runner CPU 90%).
- **C5a (Thundering Herd 5s):** Lolos di 50 user (p95: 44 ms) dan 150 user (p95: 37 ms). Gagal di 500 user.
- **C5b (Hard Restart 500 Sockets):** Selesai diuji. Recovery server 27,8 s (WSL2), 97,8% soket reconnect otomatis dengan setting frontend.
- **Soak Test 45 Menit (150 Sockets):** Selesai 100%. Memori flat (RSS 348.8–351.5 MB), 0 disconnect, 283.500 event.
- **Test Suite:** 24 test suites passed, 307 tests passed (100% green).

---

## Rencana Pilar Arsitektur

| Pilar | Deskripsi | Status | Catatan / Tindak Lanjut |
| :---: | :--- | :---: | :--- |
| **Pilar 1** | PositionSync Guard & Watchdog | ⚠️ Parsial | Perlu token kepemilikan agar sync menggantung tidak menimpa data baru & mereset guard |
| **Pilar 2** | `devices:merged` Stale-While-Revalidate + Single-Flight | ⏳ Pending | Soft TTL 120s, hard TTL 24h, shared rebuild promise |
| **Pilar 3** | Decouple MCCS dari Fast Position Sync | ⚠️ Parsial | Fast path selesai (sync 30–45ms). Perlu sesuaikan TTL MCCS > 1 putaran & audit pemanggil |
| **Pilar 4** | Snapshot Posisi saat Connect + Full Sync Awal | ⏳ Pending | Mengatasi client telat connect kehilangan posisi kendaraan parkir |

---

## Backlog di Luar Pilar

- [ ] Konfigurasi reconnect frontend: naikkan `reconnectionAttempts` dari 5 ke 10 atau tak terbatas, tambah indikator visual koneksi putus di UI, refetch `/api/positions` setelah reconnect.
- [ ] Deploy zero-downtime (rolling update / blue-green) agar client tidak mengalami disconnect massal saat update rilis.
- [ ] Investigasi error WebSocket Traccar di staging (`Unexpected server response: 200`).
- [ ] Validasi error FoxLogger `/device-lists` 404 agar fallback ke `report-position` tetap terjaga.
- [ ] Pemeriksaan log production untuk keberadaan pesan `[PositionSync] concurrent execution detected`.
- [ ] Skrip benchmark CPU (`cpu-bench.js`) untuk membandingkan kapasitas per core mesin dev (i5-12450HX) vs server production (Xeon Ice Lake 2,19 GHz).
- [ ] Pengujian beban Jalur B: Endpoint upstream proxy (`/api/reports/route`, `/api/reports/parking`, `/api/commands`).
- [ ] Soak test ulang 15–20 menit dengan mock realistis setelah perbaikan masalah terbuka di Pilar 1 & 3.
