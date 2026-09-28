# Playbook Load Test Middleware dengan Agent

Dokumen ini mencatat alur kerja load test yang sudah dijalankan pada `tracker-mspf-middleware-api` bersama agent Pi, supaya bisa diulang untuk iterasi berikutnya atau diterapkan di project lain.

Letakkan file ini di `load-tests/PLAYBOOK.md`. Skill `middleware-load-test` berisi aturan untuk agent; playbook ini berisi urutan kerja dan titik-titik keputusan untuk manusia yang mengarahkan agent. Status terkini dan detail teknis serah terima ada di `load-tests/HANDOFF.md`.

---

## Prinsip utama

1. **Ukur dulu, baru perbaiki.** Tanpa baseline, dampak perbaikan tidak bisa dibuktikan.
2. **Satu perubahan per iterasi.** Kalau dua hal diubah sekaligus, tidak ada yang tahu mana yang berpengaruh.
3. **Agent tidak mengubah `src/` tanpa persetujuan.** Setiap perubahan kode ditunjukkan dulu sebagai diff beserta tesnya.
4. **Target tes hanya lokal.** Upstream diganti mock, database memakai PostgreSQL lokal. Preflight check membatalkan tes kalau URL upstream atau database bukan localhost.
5. **Minta bukti, bukan dugaan.** Setiap klaim penyebab bottleneck harus didukung pengukuran (profiling, hitungan query, benchmark, atau tes yang mereproduksi masalah).
6. **Lingkungan tes semirip mungkin dengan production**: jenis database, log level, versi Node, jumlah data, batas resource, dan **waktu respons upstream**.
7. **Bandingkan dengan log asli.** Mock yang terlalu cepat bisa menyembunyikan masalah terbesar. Log staging/production adalah pembanding wajib.

---

## Prasyarat

- Agent Pi dengan skill `middleware-load-test` di `.pi/skills/middleware-load-test/SKILL.md`.
- Tool load test sesuai bahasa project. Untuk project Node.js: Artillery (HTTP) dan script `socket.io-client` (WebSocket).
- Docker untuk menjalankan middleware, mock upstream, dan PostgreSQL lokal dengan batas resource.
- Jika memakai WSL2: simpan project di filesystem Linux (`~/...`), bukan di `/mnt/c` atau `/mnt/e`. Membaca `node_modules` lewat mount Windows membuat startup ~25 detik dan mengotori hasil tes.
- Laptop tersambung charger dan di mode daya performa tinggi, supaya proses tidak dijadwalkan ke E-core atau diperlambat mode hemat daya.
- Untuk memaksa skill dipakai, awali prompt dengan `/skill:middleware-load-test`.

---

## Alur kerja

### Fase 1: Analisis project terhadap skill

Tujuan: agent memahami arsitektur project dan menemukan perbedaan antara asumsi skill dan kenyataan di kode.

```
/skill:middleware-load-test baca kode dan dokumentasi project ini, lalu bandingkan dengan asumsi di skill. Laporkan arsitektur, endpoint mana yang memanggil upstream dan mana yang membaca cache, apa saja yang ada di jalur setiap request (auth, DB), worker latar belakang, dan potensi bottleneck. Jangan menulis kode dulu.
```

Yang perlu dicek dari laporan agent:

- Apakah agent membedakan endpoint yang membaca cache dan endpoint yang memanggil upstream secara sinkron?
- Apakah worker latar belakang (seperti `positionSync`) ikut tercatat, termasuk cara penjadwalannya?
- Klaim teknis yang bergantung versi atau konfigurasi harus diverifikasi, bukan diterima begitu saja.

### Fase 2: Kumpulkan fakta production

Tujuan: menyamakan lingkungan tes dengan production.

```
Sebelum membuat rencana load test, cari dari repo informasi production berikut: versi Node, database (SQLite/Postgres), log level, jumlah instance, cache (NodeCache/Redis), dan perkiraan jumlah device & user.

Untuk setiap poin, sebutkan nilainya dan file sumbernya. Tandai dengan jelas mana yang pasti dari config production dan mana yang hanya dugaan dari config development atau contoh. Yang tidak bisa ditemukan, tulis "perlu konfirmasi". Jangan lanjut ke tahap berikutnya sebelum saya konfirmasi.
```

Lengkapi sendiri data yang hanya diketahui dari server nyata:

- Jumlah user bersamaan di jam sibuk, jumlah device, jumlah instance.
- Spesifikasi CPU server (`lscpu`) dan steal time (`top`, kolom `st`).
- **Log staging atau production** (`docker logs --timestamps <container>`): waktu dari start sampai listening, durasi sync pertama, jarak antar siklus sync, dan warning yang berulang.
- Persentase kendaraan yang bergerak di jam sibuk.

> Pelajaran: tulis "jenis database sama dengan production, instance lokal". Kalimat "pakai DB yang sama dengan production" pernah diartikan agent sebagai menembak database staging di IP publik.

> Pelajaran: log staging mengungkap masalah terbesar project ini (sync 57 detik, sync bertumpuk, daftar device kosong berkala) setelah berjam-jam pengujian dengan mock yang terlalu cepat. Ambil log ini di awal, bukan di akhir.

### Fase 3: Bangun fondasi

Tujuan: menyiapkan semua yang dipakai bersama oleh tes HTTP dan WebSocket.

- `load-tests/mock-upstream/`: meniru semua upstream, dengan delay, jitter, dan error rate yang bisa diatur lewat env.
  - **Delay per endpoint disamakan dengan hasil pengukuran upstream asli**, bukan tebakan. Contoh di project ini: `MOCK_MCCS_DELAY_MS=500` agar sync ~50 detik seperti staging.
  - Jumlah device realistis (di project ini ~1.200 unit).
  - Kendaraan bergerak (`MOCK_MOVING_RATIO`) disebar acak ke semua grup, bukan hanya sebagian grup.
- Seed database lokal khusus load test: admin dan customer dengan jumlah grup yang realistis.
- `docker-compose.loadtest.yml`: middleware, mock, dan PostgreSQL dengan batas resource sesuai server production.
- `load-tests/scripts/preflight.js`: membatalkan tes jika URL upstream atau database bukan localhost/mock.
- Rate limiter dinaikkan lewat env khusus tes (`RATE_LIMIT_MAX`) dan dicatat di setiap laporan.
- Log level sama dengan production. Jangan diturunkan untuk baseline.
- `CACHE_FREEZE=0` untuk run kapasitas, `CACHE_FREEZE=1` untuk run integritas.

### Fase 4: Tes HTTP baseline

Pisahkan endpoint menjadi jalur dengan karakteristik berbeda, lalu kerjakan satu per satu:

- **Jalur A**: endpoint yang membaca cache (di project ini `/api/devices`, `/api/positions`).
- **Jalur B**: endpoint yang memanggil upstream secara sinkron (di project ini `/api/reports/*`, `/api/commands`).

```
Rencanakan dan jalankan stress test Jalur A. Laporkan metrik per endpoint, tahapan beban 2–3 menit per tahap, ulangi 2 kali, catat CPU proses load tester dan middleware, dan bedakan arrivalRate dengan req/s nyata. Tunjukkan rencananya dulu sebelum menjalankan.
```

> Peringatan untuk Jalur B: `/api/commands` mengirim perintah ke perangkat GPS sungguhan melalui Traccar, termasuk kemungkinan perintah mesin. Pastikan preflight lolos sebelum tes jalur ini.

### Fase 5: Review laporan agent

Periksa setiap laporan dengan checklist di bagian "Checklist review laporan". Jangan lanjut ke perbaikan sebelum angka baseline bisa dipercaya.

### Fase 6: Buktikan penyebab bottleneck

```
Sebelum mengubah kode, buktikan penyebab lambatnya endpoint [nama endpoint]: hitung cache hit/miss, jumlah query DB per request, cek konfigurasi cache, dan ambil CPU profile (node --cpu-prof) saat beban tinggi. Laporkan temuan; jangan ubah src/ dulu.
```

> Pelajaran: dugaan awal agent (1.200 `await` serial memakan 700 ms) ternyata salah. Profiling menunjukkan 81% CPU habis untuk deep clone karena `useClones: true` di NodeCache.

### Fase 7: Hitung beban nyata

```
Cari seberapa sering frontend memanggil setiap endpoint (polling berapa detik, atau hanya saat halaman dibuka karena update lewat WebSocket), lalu hitung estimasi req/s nyata dari jumlah user aktif.
```

Rumus kasar: req/s ≈ jumlah user aktif ÷ rata-rata detik antar request per user. Bandingkan dengan kapasitas aman (70–80% dari titik jenuh).

Sesuaikan angka dari laptop dengan kecepatan CPU server. Aplikasi Node yang berjalan sebagai satu proses hanya memakai satu core, jadi kecepatan per core yang menentukan, bukan jumlah core. Rasio pastinya didapat dari `cpu-bench.js` yang dijalankan di laptop dan di server.

### Fase 8: Perbaikan dengan gerbang keamanan

Syarat sebelum diff disetujui:

1. Audit semua titik yang terdampak (untuk cache: `cache.get` dan `cache.set`, termasuk mutasi setelah data disimpan).
2. Pasang pengaman otomatis yang terbukti bekerja. Untuk cache: `'use strict'` di semua file `src/` + `Object.freeze` pada nilai cache saat `NODE_ENV=test` atau `CACHE_FREEZE=1`. Tanpa strict mode, mutasi objek beku diam-diam diabaikan.
3. Tes isolasi data antar role (admin → customer A → admin → customer B), cek jumlah dan ID data.
4. Semua temuan dari pengaman otomatis ikut diperbaiki di diff.
5. Tes lama yang bertentangan dengan perubahan dicek riwayatnya (`git log`/`git blame`) sebelum diubah.
6. Tes berada di `src/__tests__/` dan mengimpor modul asli, bukan salinan logika di script terpisah.
7. Untuk pengaman konkurensi (flag "sedang berjalan"): pastikan flag tidak bisa tersangkut. Uji kasus error dan kasus request yang menggantung.
8. `npm test` lengkap lolos.
9. Pertimbangkan dampak ke user. Contoh: pengaman sync saja membuat peta ter-update ~1 menit sekali selama sync masih lambat, jadi harus di-deploy bersama perbaikan yang mempercepat sync.

```
Usulkan perbaikan untuk [penyebab]. Audit semua titik yang terdampak, pasang pengaman otomatis, tulis tes di src/__tests__ yang mengimpor modul asli, dan jalankan npm test lengkap. Tunjukkan diff dan hasil tes sebelum diterapkan. Jangan gabungkan dengan perubahan lain.
```

### Fase 9: Terapkan dan ukur ulang

1. Terapkan sebagai commit terpisah supaya mudah di-revert.
2. Jalankan ulang skenario yang sama persis dengan baseline. Hanya kodenya yang berubah.
3. Bandingkan dalam tabel sebelum/sesudah.
4. Uji alur yang terdampak di staging, lalu periksa log staging (warning baru, durasi sync, error).
5. Ulangi Fase 6–9 untuk bottleneck berikutnya, sampai target dari Fase 7 tercapai.

### Fase 10: Tes WebSocket

Dikerjakan setelah HTTP, karena memakai fondasi yang sama.

```
Rencanakan load test WebSocket. Cek dulu library yang dipakai, autentikasi saat handshake, cara server mengirim event (per device/batch, per socket/room, serialisasi per socket), dan konfigurasi transport serta reconnection di frontend. Tunjukkan rencananya dulu sebelum menulis script.
```

Skenario:

- **C1 smoke**: 10 koneksi, 30 detik.
- **C2 koneksi bertahan**: memori per koneksi di tiap tingkat.
- **C3 fan-out**: selisih client pertama vs terakhir menerima update yang sama, dan waktu lengkap satu siklus per client.
- **C4 hybrid**: WebSocket + HTTP dengan rate dari jumlah user; pisahkan p95 HTTP saat broadcast dan di antara broadcast.
- **C5 reconnect storm**: (a) banyak client konek dalam 5–10 detik sambil memuat halaman, (b) restart middleware dengan koneksi aktif; cek kelengkapan data posisi setiap client setelah pulih, bukan hanya "berhasil tersambung".
- **Soak**: 30–60 menit di tingkat realistis, dijalankan terpisah di background setelah C2–C5.

Tingkatan beban: jumlah user sekarang → 3x → pertumbuhan → naik terus sampai titik jenuh.

Kriteria berhenti: handshake p95 > 200 ms, fan-out p95 > 500 ms, waktu siklus p95 > 3 detik, error > 0,1%, atau CPU runner > 80% (hasil tingkat itu tidak valid).

Runner dibagi ke beberapa proses jika perlu. Campuran role harus menyertakan admin.

---

## Checklist review laporan

Tanda bahaya yang pernah muncul:

- **Threshold diabaikan.** Contoh: p95 2.059 ms atau 3,6 detik dilaporkan "lolos".
- **Satuan tercampur.** `arrivalRate` dilaporkan sebagai RPS, lalu diterjemahkan menjadi "user bersamaan".
- **Metrik tidak dipecah per endpoint.**
- **Tahapan terlalu pendek.** 30 detik per tahap dengan 10 detik pertama habis untuk cold cache.
- **Load tester tidak dipantau.** Batas throughput atau kegagalan bisa berasal dari runner (CPU, port, file descriptor), bukan server.
- **Penyebab tanpa bukti.**
- **Angka estimasi tanpa pengukuran.** Contoh: "naik 3x lipat", "< 800 ms di production".
- **Laporan bertentangan dengan dirinya sendiri.**
- **Target tes berubah diam-diam.** Contoh: database lokal di tes pertama, database staging di tes berikutnya.
- **Klaim kesiapan berlebihan.** Contoh: "100% siap cluster".
- **Perbaikan "paling aman" yang mengubah perilaku.**
- **Beberapa perubahan digabung dalam satu iterasi.**
- **Angka agregat yang tidak masuk akal.** Hitung ulang secara kasar. Contoh: 7 event per client per siklus padahal admin seharusnya menerima ~360, yang ternyata akibat mock hanya menggerakkan kendaraan di sebagian grup.
- **Pengaman yang tidak dibuktikan bekerja.** Contoh: `Object.freeze` di kode non-strict, atau Proxy yang hanya membungkus objek terluar.
- **Artefak mock disebut "realistis".**
- **Overhead pengaman ikut di angka kapasitas.** Contoh: baseline diambil dengan `CACHE_FREEZE=1`.

---

## Mengelola session agent

- Ganti session di setiap tonggak (misalnya setelah satu atau dua pilar perbaikan), atau saat context sudah sangat besar.
- Sebelum menutup session, minta agent menulis atau memperbarui `load-tests/HANDOFF.md` (status commit, hasil tes beserta keterbatasannya, masalah terbukti, rencana, aturan kerja, pekerjaan tertunda, daftar file, langkah berikutnya) dan bagian "Status" di playbook ini.
- Tutup session hanya di titik aman: tes lolos dan perubahan sudah di-commit atau tersimpan di branch.
- Prompt pembuka session baru:

```
/skill:middleware-load-test Lanjutkan pekerjaan load test dan perbaikan project ini. Baca hanya: load-tests/PLAYBOOK.md dan load-tests/HANDOFF.md. Jangan membaca file laporan di results/ kecuali dibutuhkan untuk tugas tertentu.

Rangkum pemahamanmu dalam maksimal 10 poin (status, keputusan yang sudah diambil, dan langkah berikutnya), lalu tunggu konfirmasi saya sebelum mengerjakan apa pun.
```

- Minta laporan ringkas di chat dan detail lengkap di file `results/`, supaya context tidak cepat membengkak.

---

## Template laporan sebelum/sesudah

| Metrik | Baseline | Setelah perubahan | Selisih |
|---|---|---|---|
| Req/s nyata di titik jenuh | | | |
| Kapasitas aman (70–80%) | | | |
| p50 / p95 / p99 per endpoint | | | |
| Error rate | | | |
| CPU middleware saat puncak | | | |
| CPU load tester saat puncak | | | |
| Memori middleware saat puncak | | | |

Sertakan juga: commit yang dites, skenario, durasi per tahap, jumlah pengulangan, batas resource, delay mock, nilai rate limiter, dan nilai `CACHE_FREEZE`.

---

## Catatan project: tracker-mspf-middleware-api

### Konteks

- Production: satu container (`node src/server.js`), server 4 vCPU Intel Xeon Ice Lake 2,19 GHz. Kode JavaScript hanya memakai 1 core.
- Laptop tes: i5-12450HX, WSL2. Perkiraan satu core laptop ~1,5–2,4x lebih cepat dari server (belum diukur).
- User bersamaan saat ini ±50, diperkirakan bertambah.
- Posisi dikirim lewat WebSocket (Socket.io, transport polling lalu upgrade). HTTP `/api/positions` dan `/api/devices` hanya dipanggil saat halaman dibuka dan saat user berinteraksi.

### Hasil tes (lokal, mock cepat)

- Jalur A setelah perbaikan `useClones`: titik jenuh ~250–300 req/s (perkiraan di server ~110–190 req/s). Beban nyata jauh di bawah itu.
- WebSocket: lolos semua target sampai 1.000 koneksi (perkiraan di server ~450–650). Tingkat 2.000 tidak valid karena CPU runner 90%.
- Reconnect storm: lolos di 50 dan 150 user, gagal target di 500.
- Soak 45 menit, 150 koneksi: memori datar, 0 disconnect (dengan mock yang hanya menggerakkan kendaraan di sebagian grup).

### Temuan yang sudah diperbaiki

- Deep clone NodeCache (`useClones: true`) memakan 81% CPU. Diperbaiki dengan `useClones: false` + salinan dangkal di titik mutasi (commit `4f645d6`).
- Mutasi cache tersembunyi di `groupMembership.js`, `reports.js`, `engineControl.js`. Dijaga dengan `'use strict'` di semua `src/` + ESLint + deep freeze saat tes (commit `b9c75cc`).

### Masalah terbukti yang sedang dikerjakan (dari log staging dan tes)

1. `positionSync` memakai `setInterval` tanpa pengaman: sync bertumpuk dan data lama bisa menimpa data baru.
2. `devices:merged` dibiarkan kedaluwarsa (TTL 120 detik): customer bisa melihat 0 kendaraan selama 20–30 detik, dan setiap request di jeda itu memicu rebuild redundan ke upstream.
3. Setelah restart, `/api/positions` kosong ~57 detik. Tidak ada snapshot posisi saat client tersambung, dan hanya posisi berubah yang dikirim, sehingga kendaraan parkir bisa hilang dari peta sampai refresh.
4. MCCS diambil per device (~1.000 request per siklus), cache TTL 30 detik kedaluwarsa bersamaan. Ini penyebab sync ~57 detik.

Rencana perbaikan (satu per iterasi):

- **Pilar 1**: pengaman sync (tidak bertumpuk, flag tidak bisa tersangkut, timeout, batas waktu per sync).
- **Pilar 3**: pisahkan MCCS dari sync posisi; refresh MCCS bertahap. **Di-deploy bersama Pilar 1.**
- **Pilar 2**: `devices:merged` stale-while-revalidate + single-flight rebuild.
- **Pilar 4**: snapshot posisi saat connect + pastikan sync pertama setelah startup mengirim semua kendaraan.

### Status

- Commit terdahulu `4f645d6` (useClones) dan `b9c75cc` ('use strict') belum diuji di staging.
- Masalah terbuka 3a–3d pada commit `24035ae` sudah diperbaiki:
  - **3a**: Token kepemilikan watchdog `guardedJob` pada `positionSync` (commit `d9b0e2a`).
  - **3b & 3d**: Persistent MCCS Map store, boundary purge, `missingCount`, dan worker `guardedJob` (commit `c519381`).
  - **3c**: Audit pemanggil `getPositions` selesai (terbukti aman tanpa perubahan kode).
- **3e**: Timeout request jalur sync 10 s (commit `7759324`) selesai dengan watchdog dinaikkan ke 180 s.
- **Pilar 1 + Pilar 3** siap diuji di staging.
- **Pilar 2 dan Pilar 4** belum dikerjakan.

### Pekerjaan tertunda

- Frontend: `reconnectionAttempts` tak terbatas (saat ini 5), indikator koneksi terputus, ambil ulang `/api/positions` setelah reconnect.
- Deploy tanpa downtime (container baru siap dulu, baru matikan yang lama).
- Staging: WebSocket Traccar gagal (`Unexpected server response: 200`, jatuh ke polling REST); FoxLogger `/device-lists` 404. Cek apakah terjadi di production.
- Cek log production untuk warning `concurrent execution detected` dan pola "/0".
- `cpu-bench.js` untuk rasio kecepatan laptop vs server.
- Jalur B (`/api/reports/*`, `/api/commands`) belum dites.
- Soak ulang 15–20 menit dengan mock realistis setelah Pilar 1+3.

### Backlog (dikerjakan hanya jika tes atau pertumbuhan user menunjukkan kebutuhan)

- Optimasi emit WebSocket (hanya yang berubah sudah ada; berikutnya emit per grup lewat room atau batch per siklus). Pemicu: diturunkan ke ~100 user bersamaan (waktu siklus C4 @150 user naik dari 60–203 ms ke 1.923 ms di laptop dengan mock realistis karena mock lama hanya menggerakkan kendaraan di sebagian grup; di server ~2x lebih lambat, 150 user bisa melewati batas SLA 3 s, sementara 50 user saat ini masih aman). Tangga WebSocket (C2–C3) perlu diulang dengan mock realistis sebelum user mendekati angka itu.
- Aktifkan `compression`, diukur sebagai iterasi terpisah. Cek dulu reverse proxy di production.
- Cache `device_groups` dengan TTL atau invalidasi berbasis event.
- Response cache `/api/positions` 2–3 detik. Kunci cache wajib per user atau cakupan device, tidak boleh per role.
- Cluster mode. Syarat: `positionSync` hanya di satu worker, cache ke Redis atau invalidasi lintas proses, total koneksi DB dihitung ulang, Socket.io dengan sticky session dan Redis adapter aktif.
- Rate limiter 100 request/menit per IP: tinjau untuk banyak user di balik satu IP kantor.
- Keamanan: PostgreSQL staging dan production tidak boleh terbuka ke internet publik.