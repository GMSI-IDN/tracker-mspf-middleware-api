---
name: middleware-load-test
description: Aturan dan alur kerja untuk membuat, menjalankan, dan menganalisis load test / stress test pada aplikasi middleware API di project ini (middleware yang mengambil data dari server upstream lalu meneruskannya ke pemanggil). Gunakan skill ini setiap kali user menyebut stress test, load test, performance test, uji beban, kapasitas, RPS, throughput, "berapa user yang bisa di-handle", mock upstream, bottleneck, atau ingin mengukur/memperbaiki performa endpoint.
---

# Load test middleware

## Konteks

Aplikasi ini adalah middleware: menerima request dari client, memanggil server upstream, lalu meneruskan hasilnya. Kapasitasnya dipengaruhi oleh middleware itu sendiri dan oleh kecepatan upstream. Tujuan tes di project ini adalah mengukur kapasitas middleware, jadi upstream selalu digantikan mock server kecuali user secara eksplisit meminta sebaliknya.

Project ini tidak memakai k6. Jangan memasang atau menyarankan k6.

## Aturan keselamatan

1. Target tes hanya localhost atau container lokal. Jangan pernah menembak server upstream asli, staging, atau production. Jika user meminta target non-lokal, konfirmasi dulu dan jelaskan risikonya: server milik pihak lain bisa down dan IP bisa diblokir.
2. Jangan menaruh token atau secret asli di script. Baca dari environment variable dan file `.env` yang masuk `.gitignore`.
3. Sebelum menjalankan tes yang lebih dari 5 menit (stress panjang, soak), sebutkan estimasi durasi dan minta konfirmasi user.
4. Jangan mengubah kode aplikasi saat menyiapkan tes. Jika menemukan bottleneck, laporkan dan usulkan perbaikannya; ubah kode hanya setelah user setuju.
5. Sebelum memasang tool atau dependency baru, sebutkan apa yang akan dipasang dan minta persetujuan user.

## Langkah 1: Pahami aplikasi

Sebelum menulis apa pun, baca kode dan catat:

- Bahasa dan runtime project (menentukan tool di Langkah 2).
- Endpoint yang tersedia: method, path, body, header, dan autentikasi.
- Cara middleware memanggil upstream: library HTTP client, dari mana URL upstream dibaca (env/config), timeout, ukuran connection pool atau max sockets, keep-alive, dan retry.
- Cara menjalankan aplikasi dalam mode production.

Tulis ringkasannya ke bagian "Profil aplikasi" di `load-tests/README.md`. Jika ada yang tidak bisa dipastikan dari kode, tanyakan ke user, jangan menebak.

## Langkah 2: Pilih tool

Pilih tool yang sejalan dengan bahasa project, supaya tim tidak perlu memasang runtime baru:

- **Node.js / TypeScript** → Artillery. Tahapan beban lewat `phases`, threshold lewat plugin `ensure` (p95 dan error rate).
- **Python** → Locust. Mode `--headless`, tahapan beban lewat class `LoadTestShape`, hasil lewat `--csv` dan `--html`.
- **Go** → Vegeta. Berbasis rate (request per detik), cocok untuk mencari kapasitas; tahapan dibuat dengan script yang menjalankan beberapa rate berurutan.
- **Java / Kotlin** → Gatling. Tahapan lewat injection profile, threshold lewat assertions.
- **Bahasa lain atau ragu** → oha (single binary, tanpa runtime). Tahapan dibuat dengan script shell yang menjalankan beberapa rate berurutan.

Jika user sudah menyebut tool pilihannya, pakai itu. Sebelum menulis script, cek sintaks dari dokumentasi atau `--help` tool yang terpasang, karena opsi bisa berbeda antar versi. Tulis tool dan versi yang dipakai di `load-tests/README.md`.

Syarat minimal tool yang dipilih: bisa mengatur beban bertahap (via fitur bawaan atau script), melaporkan RPS, latency p50/p95/p99, dan error rate, serta menyimpan hasil ke file.

## Langkah 3: Struktur folder

```
load-tests/
├── scripts/
│   ├── config.*           # BASE_URL, header, threshold bersama
│   ├── smoke.*
│   ├── load.*
│   ├── stress.*
│   ├── spike.*
│   └── soak.*
├── mock-upstream/         # mock server pengganti upstream
├── results/               # output tes (masukkan ke .gitignore)
└── README.md              # profil aplikasi, tool, cara menjalankan
docker-compose.loadtest.yml
```

Ekstensi file mengikuti tool yang dipilih. Isi folder ini tidak boleh ikut ter-build, ter-deploy, atau masuk dependency production aplikasi.

## Langkah 4: Mock upstream

- Tulis dalam bahasa yang sama dengan project.
- Tiru bentuk respons upstream asli. Ambil contohnya dari kode, fixture, atau tanyakan ke user.
- Buat delay bisa diatur lewat env: `MOCK_DELAY_MS` (default 200) dan `MOCK_JITTER_MS` (default 50), supaya bisa mensimulasikan upstream cepat maupun lambat.
- Sediakan `MOCK_ERROR_RATE` (default 0) untuk menguji perilaku middleware saat upstream error.
- Mock harus jauh lebih ringan dari middleware agar tidak menjadi bottleneck. Jika ragu, jalankan tes langsung ke mock sekali untuk memastikan kapasitasnya jauh di atas middleware.
- Arahkan middleware ke mock lewat env atau config yang sudah ada, bukan dengan mengubah kode.

## Langkah 5: Lingkungan tes

- Jalankan middleware dan mock lewat `docker-compose.loadtest.yml` dengan batas resource. Default `cpus: "2"` dan `memory: 2g`; sesuaikan jika user memberi tahu spesifikasi server.
- Jalankan middleware dalam mode production: debug, hot reload, dan log level debug dimatikan.
- Jalankan tool load test di luar container aplikasi agar tidak berebut resource dengan middleware.
- Sebelum tes, cek `ulimit -n` dan laporkan jika nilainya di bawah 10000.
- Selama tes berjalan, rekam pemakaian resource secara berkala dengan `docker stats --no-stream` dan simpan ke folder `results/`.

## Langkah 6: Skenario

Threshold default (user boleh menggantinya):

- Latency p95 < 800 ms, p99 < 1500 ms
- Error rate < 1%

Jika tool tidak punya fitur threshold bawaan, periksa angka-angka ini dari file hasil saat analisis.

Skenario yang disediakan:

- **smoke**: 1–2 user selama 30 detik untuk memastikan script dan environment benar. Selalu jalankan ini lebih dulu sebelum skenario lain.
- **load**: naik ke beban target lalu tahan selama 5 menit.
- **stress**: naik bertahap, misalnya 50 → 100 → 200 → 400 → 800 RPS (atau user bersamaan) dengan tiap tahap 2–3 menit, sampai threshold gagal atau error melonjak. Untuk mencari kapasitas, pengaturan berbasis rate (RPS) lebih disukai daripada jumlah user.
- **spike**: lonjakan mendadak dari beban rendah ke tinggi dalam hitungan detik, lalu turun lagi. Amati apakah sistem pulih.
- **soak**: beban sedang, sekitar 60% dari kapasitas hasil stress test, selama 1–4 jam. Wajib minta konfirmasi dulu.

Simpan hasil setiap run ke `results/<skenario>-<timestamp>.*` dalam format yang bisa dibaca ulang (JSON atau CSV). Setiap skenario harus bisa dijalankan dengan satu perintah yang tercatat di `load-tests/README.md`.

## Langkah 7: Analisis dan laporan

Setelah setiap run, tulis laporan singkat di chat dan di `results/<skenario>-<timestamp>.md` yang berisi:

- Skenario, durasi, tool, dan konfigurasi (rate atau jumlah user, delay mock, batas resource).
- RPS maksimum yang tercapai selama threshold masih lolos.
- Latency p50, p95, p99, error rate, dan jenis error (timeout, 5xx, connection refused/reset).
- Pemakaian CPU dan memori middleware saat beban puncak.
- Titik jenuh: tahap ketika RPS berhenti naik sementara latency melonjak.
- Kapasitas aman: 70–80% dari RPS di titik jenuh.
- Dugaan bottleneck beserta buktinya.

Periksa checklist bottleneck khas middleware sebelum menarik kesimpulan:

- Connection pool atau max sockets HTTP client ke upstream terlalu kecil. Tandanya: CPU rendah tetapi latency tinggi, karena request mengantre di pool.
- Keep-alive tidak aktif, sehingga setiap request membuka koneksi TCP baru.
- Timeout ke upstream tidak diset atau terlalu panjang.
- Batas worker, thread, atau event loop.
- Batas file descriptor (error `too many open files`).
- Logging sinkron yang berat.

Gunakan Hukum Little untuk memeriksa kewajaran angka: jumlah request bersamaan ≈ RPS × latency upstream.

## Langkah 8: Iterasi

- Run pertama adalah baseline. Catat hasilnya.
- Ubah hanya satu hal per iterasi, jalankan ulang skenario yang sama, lalu bandingkan dengan baseline dalam bentuk tabel.
- Ulangi setiap skenario 2–3 kali. Jika hasilnya berbeda lebih dari 10%, laporkan sebagai hasil yang tidak stabil.

## Batasan hasil lokal

Hasil dari mesin lokal hanya berguna untuk menemukan masalah dan membandingkan kondisi sebelum dan sesudah perubahan. Angka itu bukan kapasitas production. Sebutkan batasan ini di setiap laporan.