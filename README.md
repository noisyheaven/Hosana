# Sistem Toko Asesoris Rohani

Satu sistem terpadu: **toko online untuk pelanggan**, **panel kasir & admin** (website, bisa dipasang seperti aplikasi di HP), **paket aplikasi Android**, dan **server** dengan satu database. Semua perangkat memakai data yang sama, jadi stok selalu sinkron.

| Bagian | Alamat (setelah server jalan) | Untuk siapa |
|---|---|---|
| Toko online | `http://localhost:3000/` | Pelanggan: lihat barang, pesan, lacak pesanan |
| Panel kasir & admin | `http://localhost:3000/admin/` | Staf, admin, superadmin |
| Aplikasi Android | folder `android-app/` | Staf/admin (bungkus panel di atas, plus cetak native) |

Server tidak butuh pustaka tambahan: hanya **Node.js 22.13 atau lebih baru** (unduh versi LTS di https://nodejs.org).

---

## 1. Menjalankan di komputer (lokal)

1. Ekstrak folder `toko-rohani`.
2. Jalankan server:
   - **Windows:** klik dua kali `start.bat`
   - **Mac/Linux:** `./start.sh` (sekali saja: `chmod +x start.sh`)
   - atau di terminal: `npm start`
3. Buka `http://localhost:3000/admin/` dan masuk dengan akun awal:

| Username | Password | Peran |
|---|---|---|
| `superadmin` | `super123` | Superadmin |
| `admin` | `admin123` | Admin |
| `staf` | `staf123` | Staf kasir |

**Segera ganti password** (tombol *Ganti password* di kiri bawah, atau superadmin lewat menu *Pengguna & Role*).

Pertama kali jalan, sistem membuat 11 barang contoh. Untuk memulai dengan data kosong: hapus folder `data/`, lalu jalankan dengan `SEED_DEMO=0` (Windows PowerShell: `$env:SEED_DEMO=0; npm start`).

Semua data tersimpan di folder `data/` (database `toko.db` + foto produk). **Backup = salin folder itu**, atau pakai tombol *Unduh backup database* di menu Pengaturan.

## 2. Mencoba dari HP (satu Wi-Fi)

Saat server jalan, terminal menampilkan alamat seperti `http://192.168.1.10:3000/admin/`. Buka di Chrome HP, lalu menu ⋮ → *Tambahkan ke layar utama* (atau tombol *Pasang aplikasi* di panel).

**Kamera untuk scan barcode hanya mau aktif lewat HTTPS.** Jika memakai HP lewat Wi-Fi:

```
npm run cert      # butuh OpenSSL (sudah ada di Mac/Linux & Git for Windows)
npm start         # server otomatis pindah ke https://...
```

Buka `https://192.168.1.10:3000/admin/`; browser akan memperingatkan "tidak aman" (wajar untuk sertifikat buatan sendiri), pilih *Lanjutkan*. Alternatif tanpa peringatan: pasang [mkcert](https://github.com/FiloSottile/mkcert) (perintahnya ditampilkan jika OpenSSL tidak ada).

Tanpa kamera pun scan tetap bisa: **scanner barcode USB/Bluetooth** bekerja seperti keyboard, cukup klik kolom *Scan barcode* di Kasir lalu tembak barangnya.

Scan kamera memakai fitur bawaan browser; untuk browser/WebView yang tidak punya, ada pustaka cadangan. Agar tidak butuh internet: `npm install` lalu `npm run vendor` (sekali saja).

## 3. Peta fitur ke permintaan Anda

| # | Permintaan | Di mana |
|---|---|---|
| 1 | Pemesanan | Toko online → pesanan masuk ke menu **Pemesanan**. Staf juga bisa membuat pesanan dari telepon/WhatsApp. Status: Baru → Diproses → Dikirim → Selesai / Batal. Pelanggan bisa **Lacak pesanan** dengan nomor pesanan + nomor HP |
| 2 | Penjualan | **Kasir** (grid barang, kategori, diskon, uang pas / pecahan cepat, kembalian) dan **Riwayat Penjualan** (batalkan/void dengan alasan, stok otomatis kembali) |
| 3 | Stok barang | **Data Barang** (tambah, edit, hapus/arsip, foto, harga beli & jual, stok minimum) dan **Stok Toko / Gudang** (koreksi, stok opname, riwayat mutasi) |
| 4 | Stok gudang | Stok dipisah per lokasi: toko dan gudang |
| 5 | Scan barcode | Kasir, pencarian barang, PO, transfer, pesanan. Kamera atau scanner USB. Barcode otomatis dibuat (EAN-13) bila kosong, dan bisa **cetak label barcode** |
| 6 | Dashboard | Omzet hari ini/bulan ini, grafik 14 hari, metode bayar, terlaris, stok menipis, pesanan aktif, PO berjalan, nilai stok |
| 7 | Role | Superadmin, Admin, Staf (tabel di bawah) |
| 8 | Purchase order | Menu **Purchase Order** + **Supplier**: draft → diajukan → disetujui → barang diterima (boleh sebagian) |
| 9 | Gudang → toko | Barang dari PO masuk ke **stok gudang**; menu **Transfer Gudang→Toko** memindahkannya ke toko (tercatat, tidak bisa melebihi stok gudang) |
| 10 | Pembayaran | Tunai, QRIS, transfer, debit, COD. Pesanan online dicatat lunas oleh staf setelah uang diterima; tiap pembayaran tercatat |
| 11 | Cetak struk/invoice | Struk 58/80 mm, invoice A4, cetak PO, label barcode |
| 12 | Laporan | **Laporan**: penjualan per hari/metode/kanal/kasir/produk, laba kotor, nilai stok, ekspor CSV (bisa dibuka di Excel) |
| 13 | Revisi PO, tambah/edit/hapus barang | PO bisa **direvisi** (tambah, ubah qty/harga, hapus baris) dengan alasan. Revisi PO yang sudah disetujui kembali ke *Diajukan* untuk disetujui ulang. Setiap revisi tersimpan dengan perbandingan sebelum/sesudah. Barang di PO bisa ditambah, bahkan barang baru yang belum terdaftar |
| 14 | Rekomendasi | Bagian 7 di bawah |

### Hak akses per peran

| | Staf | Admin | Superadmin |
|---|:--:|:--:|:--:|
| Kasir, pesanan, lihat barang & stok, dashboard | ✔ | ✔ | ✔ |
| Riwayat penjualan | 3 hari terakhir | semua | semua |
| Melihat **harga beli** & laba | ✘ | ✔ | ✔ |
| Tambah/edit/hapus barang, koreksi stok, transfer | ✘ | ✔ | ✔ |
| Void penjualan, batalkan pesanan yang sudah dibayar | ✘ | ✔ | ✔ |
| Purchase order, supplier, laporan | ✘ | ✔ | ✔ |
| Kelola pengguna, pengaturan toko, log aktivitas, backup | ✘ | ✘ | ✔ |

Hak akses dijaga di **server**, bukan hanya disembunyikan di tampilan.

### Alur barang yang disarankan

`PO dibuat → diajukan → disetujui → barang datang (terima ke gudang) → transfer ke toko → dijual di kasir / toko online`

## 4. Menyesuaikan toko

Menu **Pengaturan** (superadmin): nama toko, alamat, nomor WhatsApp (format `62812…`), info rekening dan catatan QRIS (tampil di toko online setelah pelanggan memesan), tulisan kaki struk, lebar kertas, izin jual saat stok 0, dan batas waktu pembatalan otomatis pesanan online.

Foto produk: edit barang → unggah foto (JPG/PNG/WebP, maks. 3 MB). Hanya barang dengan opsi *tampil di toko online* yang muncul di toko online.

## 5. Aplikasi Android

Aplikasi Android membungkus panel kasir/admin (Capacitor) dan menambah **cetak lewat layanan cetak Android** (printer Wi-Fi/Bluetooth/USB atau simpan PDF). Panel yang sama juga bisa dipasang dari Chrome (bagian 2) tanpa membuat APK; pilihan itu paling cepat untuk uji coba.

> **Status jujur:** paket Android ini **belum saya build** karena lingkungan kerja saya tidak punya Android SDK dan tidak bisa mengunduhnya. Skrip penambalnya diuji pada proyek tiruan dan kode Java-nya diperiksa sintaksnya, tetapi **APK belum pernah dijalankan di perangkat**. Panel web di baliknya sudah diuji penuh. Jika ada error saat build, kirimkan pesannya ke saya.

Yang dibutuhkan di komputer Anda: Node.js 22+, **Android Studio** (sekali pasang; sudah termasuk Android SDK & JDK), internet saat `npm install`.

```
cd android-app
npm install
npm run add          # membuat proyek android/, menambah izin kamera, plugin cetak
npm run open         # membuka Android Studio → Build > Build Bundle(s)/APK(s) > Build APK(s)
```

APK ada di `android-app/android/app/build/outputs/apk/debug/app-debug.apk`; salin ke HP dan pasang (izinkan *pasang dari sumber tak dikenal*). Atau tanpa membuka Android Studio: `npm run apk` (butuh `ANDROID_HOME` terisi).

Saat pertama kali membuka aplikasi, isi **Alamat server** di layar login, misalnya `http://192.168.1.10:3000` (IP komputer server, satu Wi-Fi dengan HP). Alamat diingat. Jika panel web diubah, jalankan `npm run sync` lalu build ulang. Scan kamera di aplikasi tidak butuh HTTPS.

## 6. Keamanan dan pengujian

- Password disimpan ter-hash (scrypt), sesi berlaku 7 hari, login dibatasi 10 percobaan gagal per 10 menit.
- Pesanan online dibatasi 8 per 10 menit per perangkat (ubah dengan `ORDER_LIMIT`).
- **Pesanan online yang belum dibayar otomatis dibatalkan setelah 24 jam** dan stok dikembalikan (COD dan pesanan yang sudah diproses tidak disentuh; atur jamnya di Pengaturan, `0` untuk mematikan).
- Setiap aksi penting masuk **Log aktivitas** (siapa, apa, kapan).
- Pengujian otomatis: `npm test` (51 pemeriksaan API termasuk hak akses, stok, PO, pesanan, laporan; 8 pemeriksaan pengaman). Alur tampilan (3 peran, semua halaman, kasir, siklus PO penuh, toko online) juga sudah diuji di Chromium. `npm test` bagian API butuh `bash` (Windows: Git Bash atau WSL).
- **Belum diuji dengan perangkat nyata:** kamera untuk scan, printer, dan APK.

## 7. Rekomendasi

**Sebelum dipakai sungguhan**
1. Ganti ketiga password awal dan isi data toko (nama, WhatsApp, rekening) di Pengaturan.
2. Jangan buka server langsung ke internet tanpa HTTPS. Untuk toko online publik, cara termudah dan aman: **Cloudflare Tunnel** atau taruh di VPS kecil di belakang Caddy/Nginx (HTTPS otomatis), lalu jalankan server sebagai layanan (pm2 di Linux, NSSM di Windows) supaya hidup lagi setelah restart.
3. Jadwalkan backup folder `data/` harian ke flashdisk atau Google Drive.
4. Lakukan **stok opname awal** (menu Stok → koreksi, mode "set") sebelum mulai berjualan, lalu cetak label barcode untuk barang yang belum punya barcode.

**Pengembangan berikutnya (urut manfaat)**
- **Pembayaran otomatis** (Midtrans/Xendit) agar QRIS/transfer online lunas tanpa dicek manual. Saat ini pembayaran dicatat manual oleh staf.
- **Ongkos kirim** (RajaOngkir/Biteship) dan nomor resi.
- **Notifikasi WhatsApp** ke pelanggan saat status pesanan berubah.
- **Varian barang** (ukuran cincin, warna): saat ini tiap varian dibuat sebagai barang terpisah dengan SKU sendiri.
- **Retur/refund sebagian**, hutang ke supplier, dan promo/diskon per barang.
- **Data pelanggan & poin loyalitas**, terutama jika banyak pembeli langganan.
- **Printer thermal Bluetooth langsung (ESC/POS)** di Android untuk struk tanpa dialog cetak.
- **Mode offline kasir** bila listrik/Wi-Fi sering putus.
- Jika kelak ada lebih dari satu cabang: tambahkan lokasi stok per cabang (struktur stok sudah per-lokasi).

## 8. Struktur folder

```
toko-rohani/
├─ server.js, db.js        server & database (SQLite bawaan Node)
├─ public/index.html …     toko online pelanggan
├─ public/admin/           panel kasir & admin (PWA)
├─ android-app/            pembungkus Android (Capacitor)
├─ tests/                  pengujian otomatis
├─ scripts/                pembuat sertifikat HTTPS, penyalin pustaka scanner
└─ data/                   dibuat otomatis: database & foto (JANGAN dihapus)
```

Variabel lingkungan opsional: `PORT` (default 3000), `DATA_DIR`, `SEED_DEMO=0`, `HTTPS=0`, `ORDER_LIMIT`.
