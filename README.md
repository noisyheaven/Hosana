# Sistem Hosana

Satu sistem terpadu yang **dirancang untuk jaringan lokal tanpa internet**, termasuk **toko dan gudang di gedung terpisah**: satu server dengan satu database, diakses dari kasir (kabel LAN) dan HP/tablet staf (Wi-Fi). Semua perangkat memakai data yang sama, jadi stok toko dan gudang selalu sinkron. Pemasangan dua gedung ada di **bagian 6**.

| Bagian | Alamat (setelah server jalan) | Untuk siapa |
|---|---|---|
| Toko online (opsional) | `http://localhost:3000/` | Pelanggan: lihat barang, pesan, lacak pesanan. Bisa dimatikan di Pengaturan bila sistem hanya dipakai internal |
| Panel kasir & admin | `http://localhost:3000/admin/` | Kasir, staf, Sales Admin, Admin Gudang, Tim SO, superadmin |

Server tidak butuh pustaka tambahan: hanya **Node.js 22.13 atau lebih baru** (unduh versi LTS di https://nodejs.org).

---

## 1. Menjalankan di komputer (lokal)

1. Ekstrak folder `hosana`.
2. Jalankan server:
   - **Windows:** klik dua kali `start.bat`
   - **Mac/Linux:** `./start.sh` (sekali saja: `chmod +x start.sh`)
   - atau di terminal: `npm start`
3. Buka `http://localhost:3000/admin/` dan masuk dengan akun awal:

| Username | Password | Peran |
|---|---|---|
| `superadmin` | `super123` | Superadmin |
| `salesadmin` | `sales123` | Sales Admin |
| `staf` | `staf123` | Staf kasir |
| `admingudang` | `gudang123` | Admin Gudang |
| `kasir` | `kasir123` | Kasir (hanya jual-beli) |
| `timso` | `timso123` | Tim SO (Sales Order) |

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
| 1 | Sales Order (SO) | Toko online → pesanan masuk ke menu **Sales Order (SO)**. **Tim SO** juga bisa membuat SO dari telepon/WhatsApp. Status: Baru → Diproses → Dikirim → Selesai / Batal. Pelanggan bisa **Lacak pesanan** dengan nomor pesanan + nomor HP |
| 2 | Penjualan | **Kasir** bergaya "cari dulu" (kolom scan/cari besar dengan hasil singkat, keranjang sebagai pusat layar, panel bayar dengan uang pas / pecahan cepat dan kembalian, pintasan **F2** cari dan **F9** bayar, tombol *Jelajah* per kategori bila perlu) dan **Riwayat Penjualan** (batalkan/void dengan alasan, stok otomatis kembali) |
| 3 | Stok barang | **Data Barang** (tambah, edit, hapus/arsip, foto, harga beli & jual, stok minimum) dan **Stok per Lokasi** (koreksi, stok opname, riwayat mutasi) |
| 3b | Kartu Stok | Menu **Kartu Stok**: pilih satu barang (ketik nama / SKU atau scan barcode), lalu kartunya tampil. Halaman tidak menampilkan semua barang sekaligus. Kartu rinci (tampilan disamakan dengan kartu stok aplikasi lama): kolom **No, Tanggal, Jenis, ID** (no. invoice / SO / PO / transfer), **Keterangan** (nama customer atau supplier), **Masuk, Keluar, Saldo, Harga, Lokasi**, dengan kotak nama/deskripsi/satuan barang di atas dan **Total masuk, Total keluar, Tersedia** di bawah. Filter: **Jenis** (Pembelian, Penjualan, Transfer, Koreksi/opname), **Lokasi**, **Bulan** (pilih bulan) atau rentang tanggal, dan **Tampilkan transfer**. Bawaannya menampilkan **semua riwayat** barang (tanpa centang Bulan) dengan transfer antar lokasi disembunyikan, karena pada lokasi *Semua* transfer saling meniadakan; pada lokasi tertentu transfer selalu tampil agar saldo lokasi itu bisa ditelusuri. Menyaring baris tidak mengubah angka Saldo. Harga pada baris Pembelian adalah harga beli dan hanya tampil bagi pemegang hak *Lihat harga beli*; baris lain menampilkan harga jual. Baris terakhir otomatis ter-highlight dan tabel langsung menggulir ke mutasi terbaru. Berisi penjualan, void, retur, Sales Order, transfer, terima PO, dan koreksi. Bisa dicetak (A4 landscape) dan diekspor CSV. Satuan hanya ditampilkan; konversi satuan (Unit Qty) belum ada karena barang hanya punya satu satuan. Bila saldo akhir tidak sama dengan stok tercatat sekarang, muncul peringatan. Tombol **📒 Kartu** juga ada di Stok per Lokasi dan Data Barang |
| 4 | 3 lokasi stok | Stok dipisah per lokasi: **Display Toko** (etalase, yang dijual di kasir), **Gudang Toko**, dan **Gudang Ruko**. Tampil di Cek Stok, Data Barang, Stok per Lokasi, dan laporan nilai stok |
| 5 | Scan barcode | Kasir, pencarian barang, PO, transfer, pesanan. Kamera atau scanner USB. Barcode otomatis dibuat (EAN-13) bila kosong, dan bisa **cetak label barcode** |
| 6 | Dashboard (hanya superadmin) | Omzet hari ini/bulan ini, grafik 14 hari, metode bayar, terlaris, stok menipis, pesanan aktif, PO berjalan, nilai stok |
| 7 | Role | Superadmin, **Sales Admin**, **Admin Gudang** (dua pecahan dari Admin lama), Staf toko, Kasir, Tim SO (tabel di bawah). Detail tugas terbaru: Kasir (+ pengeluaran kas, laporan), Sales Admin (SO, edit nota, finalkan SO, cetak Sales Invoice), Admin Gudang (cek stok, permintaan toko, terima supplier) |
| 8 | Purchase order | Menu **Purchase Order** + **Supplier**: draft → diajukan → disetujui → barang diterima (boleh sebagian) |
| 9 | Antar lokasi | Barang dari PO masuk ke **Gudang Ruko** atau **Gudang Toko** (dipilih saat terima barang); menu **Transfer Antar Lokasi** memindahkan stok antar ketiga lokasi (tercatat, tidak bisa melebihi stok asal). **Permintaan Barang** memilih asal (Gudang Toko / Gudang Ruko) dan tujuan (Display Toko / Gudang Toko). Penjualan kasir memotong Display Toko; SO memotong lokasi yang dipilih di form SO (awalnya Display Toko) |
| 10 | Pembayaran | Tunai, QRIS, transfer, debit, COD. Pesanan online dicatat lunas oleh staf setelah uang diterima; tiap pembayaran tercatat |
| 11 | Cetak struk/invoice | Struk 58/80 mm, invoice A4, cetak PO, label barcode |
| 12 | Laporan | **Laporan**: penjualan per hari/metode/kanal/kasir/produk, laba kotor, nilai stok, ekspor CSV (bisa dibuka di Excel) |
| 13 | Revisi PO, tambah/edit/hapus barang | PO bisa **direvisi** (tambah, ubah qty/harga, hapus baris) dengan alasan. Revisi PO yang sudah disetujui kembali ke *Diajukan* untuk disetujui ulang. Setiap revisi tersimpan dengan perbandingan sebelum/sesudah. Barang di PO bisa ditambah, bahkan barang baru yang belum terdaftar |
| 14 | Rekomendasi | Bagian 9 di bawah |

### Cek stok gudang dari toko (menu **Cek Stok**)

Skenario: pelanggan bertanya "patung Bunda Maria ada berapa?". Staf toko membuka **Cek Stok** (menu kiri, bisa dibuka dari HP), lalu:

- menekan **📷 Scan barcode barang**, atau menembak barcode dengan scanner USB/Bluetooth, atau mengetik nama (mis. `patung bunda maria`);
- langsung melihat **tiga kotak besar: Display Toko, Gudang Toko, dan Gudang Ruko**, harga jual, dan keterangan: *Tersedia di display toko*, *Display menipis*, *Habis di display, ada di Gudang …*, atau *Habis di semua lokasi*;
- bila barang hanya ada di gudang, admin mendapat tombol **Pindahkan dari gudang ke toko**; staf mendapat saran meminta admin memindahkan atau mengambil ke gudang. Bila habis di kedua tempat, staf diarahkan membuat pesanan.

Data diambil langsung dari server saat itu juga, bukan salinan lama. **Harga beli tidak tampil untuk staf.**

**Agar bisa discan, setiap barang harus punya barcode.** Barang berbarcode pabrik: scan sekali di form *Data Barang* agar tercatat. Barang tanpa barcode (patung, rosario curah, dll.): sistem membuat barcode sendiri, lalu cetak labelnya lewat *Data Barang → Label terpilih* dan tempel di barang atau kotaknya. Bila barcode tidak terbaca, ketik namanya.

### Hak akses per peran

| | Kasir | Staf toko | Admin Gudang | Tim SO | Sales Admin | Superadmin |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| **Dashboard** | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ |
| **Manajemen › Data Pelanggan** (kelola daftar pelanggan; memilih pelanggan di Kasir/SO tidak butuh hak ini) | ✘ | ✘ | ✘ | ✘ | ✔ | ✔ |
| **Manajemen › Laporan Kas** (hak `kas.laporan`, terpisah dari hak input kas) | ✔ | ✘ | ✘ | ✘ | ✘ | ✔ |
| **Kasir**: input penjualan, cetak struk / invoice customer | ✔ | ✘ | ✘ | ✘ | ✘ | ✔ |
| Riwayat penjualan | milik sendiri, 3 hari | ✘ | ✘ | ✘ | ✘ | semua |
| **Pengeluaran Kas**: input pengeluaran kas | ✔ | ✘ | ✘ | ✘ | ✘ | ✔ |
| **Retur Barang**: catat retur, stok kembali, refund kas | ✔ | ✘ | ✘ | ✘ | ✘ | ✔ |
| **Laporan Kas**: laporan pengeluaran kas | ✔ | ✘ | ✘ | ✘ | ✘ | ✔ |
| **Laporan Penjualan** (tanpa HPP / laba) | ✔ | ✘ | ✘ | ✘ | ✘ | ✔ |
| **Sales Order (SO)**: input SO | ✘ | ✘ | ✘ | ✔ | ✔ | ✔ |
| **Selesai packing** SO | ✘ | ✘ | ✘ | ✔ | ✘ | ✔ |
| **Edit nota** SO (sebelum final) | ✘ | ✘ | ✘ | ✔ | ✔ | ✔ |
| **Finalkan SO** (menerbitkan Sales Invoice) | ✘ | ✘ | ✘ | ✔ | ✔ | ✔ |
| **Cetak Sales Invoice** SO (setelah final) | ✘ | ✘ | ✘ | ✔ | ✔ | ✔ |
| **Cek Stok** (3 lokasi) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Lihat Data Barang & Stok per Lokasi | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ |
| **Kartu Stok** (hak `stok.kartu`, atau hak Stok per Lokasi) | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ |
| **Minta barang ke gudang** & konfirmasi terima | ✘ | ✔ | ✘ | ✘ | ✘ | ✔ |
| **Proses permintaan toko** (siapkan, kirim, tolak) | ✘ | ✘ | ✔ | ✘ | ✘ | ✔ |
| **Terima barang dari supplier (PO)** (tanpa harga beli) | ✘ | ✘ | ✔ | ✘ | ✘ | ✔ |
| Transfer antar lokasi, koreksi / opname stok | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ |
| Melihat **harga beli** & laba, laporan nilai stok | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ |
| Tambah/edit/hapus barang | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ |
| Void penjualan, batalkan SO yang sudah dibayar | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ |
| Purchase order ke supplier, supplier | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ |
| Kelola pengguna, pengaturan toko, log aktivitas, backup | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ |

Hak yang tidak ada di kolom role bawaan bisa ditambahkan Super Admin di **Pengguna & Role → Role** (mis. *Void transaksi* untuk Kasir senior).

**Detail tugas tiap peran**

- **Kasir**: input penjualan, input pengeluaran kas, cetak invoice / struk belanja customer, laporan pengeluaran kas, laporan penjualan, dan cek stok. Laporan penjualan Kasir tidak memuat HPP/laba dan tidak ada ekspor CSV per item maupun stok. Pengeluaran kas yang sudah disimpan tidak bisa diubah atau dihapus oleh Kasir (tercatat di log aktivitas).
- **Sales Admin**: input Sales Order (SO), edit nota, finalkan SO (menerbitkan Sales Invoice), cetak Sales Invoice, dan cek stok.
- **Admin Gudang**: cek stok, terima dan proses permintaan barang dari toko, serta terima barang masuk dari supplier ke Gudang Ruko / Gudang Toko.
- **Staf**: cek stok, **mengajukan permintaan barang ke gudang**, dan **mengonfirmasi barang yang diterima**. Staf tidak melihat menu Sales Order, Data Barang, maupun Stok per Lokasi.
- **Tim SO**: cek stok, mengerjakan SO dari Sales Admin (edit nota, ubah status, catat pembayaran), **menandai SO selesai packing**, **finalkan SO**, dan **mencetak Sales Invoice untuk customer**.

**Alur Sales Order (SO) → edit nota → Finalkan → Sales Invoice (SI)**

1. **SO dibuat** (online, telepon, atau WhatsApp). Statusnya *Draft nota*: stok langsung dipesan dari lokasi pengambilan.
2. **Edit nota** (tombol ✏ di detail SO, hak `pesanan.edit`): ubah data pelanggan, barang, qty, harga satuan, dan diskon nota. Selisih qty langsung menyesuaikan stok yang dipesan, dan semua perubahan tercatat di log aktivitas. Selama belum final, nota bebas diedit.
3. **Finalkan SO** (tombol ✔ *Finalkan & terbitkan SI*, hak `pesanan.final`): nota **terkunci** dan **Sales Invoice terbit** dengan nomor `SI-YYYYMMDD-0001`. Tidak ada syarat packing atau pembayaran. Status SO yang masih *Baru* otomatis menjadi *Diproses*.
4. **Cetak Sales Invoice** (🧾, hak `pesanan.invoice`): aktif setelah final. Stempel di invoice mengikuti kondisi bayar saat dicetak: **BELUM LUNAS**, **DIBAYAR SEBAGIAN** (lengkap dengan sisa tagihan), atau **LUNAS**.
5. **Pembayaran bebas kapan saja**, sebelum maupun sesudah final, dan boleh bertahap (DP / cicilan): isi jumlah di kotak *Catat pembayaran*. Jumlah yang diterima tersimpan terpisah dari total nota, jadi mengedit nota setelah sebagian dibayar otomatis menghitung ulang status bayarnya (lunas / sebagian / belum).
6. **Masuk laporan penjualan**: transaksi penjualan (channel *order*) baru tercatat saat SO sudah **final dan lunas**, mana pun yang terjadi belakangan. Nomor invoice transaksinya sama dengan nomor SI, sehingga bisa dicari di Riwayat Penjualan dan dipakai untuk retur.
7. **Salah input setelah final?** Pakai *Buka kembali final* (hak `pesanan.final`, wajib alasan): SI lama berstatus **void** (nomornya tidak dipakai lagi), nota bisa diedit, lalu difinalkan lagi dengan nomor SI baru. Tidak bisa dibuka kembali bila SO sudah lunas dan tercatat sebagai penjualan; dalam kasus itu batalkan SO (butuh hak *Batalkan SO yang sudah dibayar*). Membatalkan SO otomatis mem-void SI-nya.
8. **📦 Selesai packing** (Tim SO) tetap ada sebagai penanda kerja gudang, tetapi bukan lagi syarat menerbitkan SI.

Untuk SO lama (sebelum fitur ini) yang sudah dibayar: otomatis dianggap sudah final, dan **nomor invoice lamanya (`INV-…`) dipakai sebagai nomor SI**. SO lama yang belum dibayar tetap berstatus draft dan bisa diedit. Role Sales Admin dan Tim SO yang belum pernah Anda ubah otomatis mendapat hak baru (*Edit nota SO*, *Finalkan SO*) saat server dijalankan ulang; role yang sudah Anda kustomisasi tidak disentuh, jadi centang hak itu manual di **Pengguna & Role**.

**Retur barang customer**: buka *Riwayat Penjualan → transaksi → Retur barang*. Pilih barang dan jumlah yang dikembalikan, tentukan lokasi stok tujuan, tandai apakah barang layak dijual kembali, lalu isi alasan. Sistem membuat nomor `RET-YYYYMMDD-0001`, mencatat mutasi stok untuk barang yang layak dijual, dan otomatis membuat pengeluaran kas kategori *Refund Retur Barang* dengan nomor `KAS-YYYYMMDD-0001`. Retur parsial dan beberapa kali retur untuk satu invoice didukung selama kuantitas dan nilai refund belum terlampaui. Riwayat retur tersedia di menu *Retur Barang*.

**Pengeluaran kas**: menu *Pengeluaran Kas* (tanggal, kategori, keterangan, jumlah; nomor otomatis `KAS-YYYYMMDD-0001`) dan *Laporan Kas* (total, per kategori, rekap harian, rincian, ekspor CSV, cetak).

**Migrasi database lama (otomatis saat server dijalankan, data tidak hilang):** stok lama *toko* menjadi **Display Toko**, stok lama *gudang* menjadi **Gudang Ruko**, **Gudang Toko** mulai kosong (isi lewat transfer / terima barang / opname). Role *Gudang* menjadi *Admin Gudang* (pengguna ikut pindah). Role *Admin* yang masih punya pengguna diganti namanya menjadi *Admin (lama)* dengan hak yang sama seperti sebelumnya, supaya tidak ada yang kehilangan akses; pindahkan penggunanya ke Sales Admin / Admin Gudang di *Pengguna & Role*, lalu hapus role itu. Bila tidak ada penggunanya, role Admin dihapus.

Peran **Tim SO** dibuat untuk tim yang menangani **Sales Order (SO)**: membuat SO (telepon/WhatsApp), mengubah status (Baru → Diproses → Dikirim → Selesai), mencatat pembayaran, menandai SO selesai packing, mencetak Sales Invoice untuk customer, serta mengecek stok toko & gudang. Tim SO tidak melihat harga beli, tidak bisa berjualan di Kasir, dan tidak bisa membatalkan SO yang sudah dibayar (hak itu bisa ditambahkan di **Pengguna & Role → Role → Tim SO**). Halaman awalnya adalah **Sales Order (SO)**. Akun contoh untuk database baru: `timso` / `timso123` (segera ganti password). Pada database yang sudah berjalan, role Tim SO dibuat otomatis saat server dijalankan ulang; tinggal buat pengguna baru dengan role tersebut.

**Pembaruan detail role (otomatis saat server dijalankan ulang):** hak role bawaan Kasir, Sales Admin, Admin Gudang, Staf, dan Tim SO dipindah ke detail terbaru **hanya bila hak-nya masih persis sama dengan bawaan lama**. Role yang sudah Anda ubah sendiri di *Pengguna & Role* tidak ditimpa; tekan *Kembalikan ke awal* di role tersebut bila ingin memakai detail terbaru. Tabel `cash_expenses` dan kolom packing pada `orders` dibuat otomatis, data lama tidak berubah.

Hak akses dijaga di **server**, bukan hanya disembunyikan di tampilan.

### Role kustom & hak akses (Super Admin)

Tabel di atas adalah pengaturan **awal** role bawaan. Super Admin bisa mengubahnya di menu **Pengguna & Role → tab Role & Hak Akses**:

- **Buat role baru** dengan nama bebas (mis. *Kasir Onboarding*), lalu centang fitur yang boleh dipakai. Bisa mulai dari salinan role lain.
- **Ubah hak role bawaan** (Sales Admin, Admin Gudang, Staf, Kasir, Tim SO) bila kebutuhan toko berbeda. Tombol *Kembalikan ke awal* mengembalikannya.
- **Hapus role kustom** (hanya jika tidak ada pengguna yang memakainya). Role bawaan tidak bisa dihapus. Super Admin selalu memegang semua hak dan tidak bisa diubah.
- Pengguna memilih role-nya di tab *Pengguna*. Perubahan hak **langsung berlaku** (menu pengguna menyegarkan diri sekitar semenit atau saat tab dibuka lagi, tanpa login ulang).

Menu di panel hanya tampil sesuai hak role, dan server menolak (403) akses ke fitur yang bukan hak role itu. Hak yang bertingkat (mis. *Void transaksi* butuh *Riwayat Penjualan*) otomatis ikut tercentang. Hak **Pengguna & Role, Pengaturan, Log aktivitas, dan Backup** hanya untuk Super Admin dan tidak bisa dibagikan. Daftar hak ada di `permissions.js`.

### Alur barang yang disarankan

### Permintaan Barang (toko → gudang)

Permintaan internal toko ke gudang, **bukan PO** (PO hanya untuk membeli dari supplier). Menu *Permintaan Barang*, atau tombol **Minta dari gudang** di Cek Stok saat barang habis di toko tapi ada di gudang.

1. **Toko** membuat permintaan (barang, jumlah, catatan, tanda *mendesak*). Tidak perlu persetujuan admin.
2. **Gudang** melihat daftar (halaman awal peran Gudang; daftar menyegarkan diri tiap 20 detik), menekan **Mulai siapkan**, lalu **Kirim** dengan jumlah yang benar-benar dikirim. Bila kurang dari permintaan, wajib isi alasan (mis. stok gudang kurang; permintaan ditandai agar admin membuat PO ke supplier). Gudang juga bisa **Tolak** dengan alasan.
3. **Toko** menekan **Terima barang** dan mengisi jumlah yang sampai. Bila ada selisih, wajib isi catatan; permintaan ditandai *Ada selisih*.

Stok lokasi asal berkurang saat **dikirim**; stok lokasi tujuan bertambah **sebesar yang diterima**. Selama di perjalanan barang tidak tercatat di stok mana pun. Selisih (kirim 10, terima 9) berarti 1 unit hilang dari catatan: periksa lalu koreksi lewat Stok (admin). Pembuat bisa membatalkan selama gudang belum memproses. Seluruh mutasi tercatat di Riwayat Mutasi dengan nomor `REQ-…`.

`PO dibuat → diajukan → disetujui → barang datang (terima ke Gudang Ruko / Gudang Toko) → transfer ke Display Toko → dijual di kasir / toko online`

## 4. Menyesuaikan toko

Menu **Pengaturan** (superadmin): nama toko, alamat, nomor WhatsApp (format `62812…`), info rekening dan catatan QRIS (tampil di toko online setelah pelanggan memesan), tulisan kaki struk, lebar kertas, izin jual saat stok 0, dan batas waktu pembatalan otomatis pesanan online.

Foto produk: tambah/edit barang → **📷 Ambil foto (kamera)** untuk memotret langsung dari HP (kamera HP terbuka langsung; tidak butuh HTTPS), atau **🖼 Pilih dari galeri / file** (di PC keduanya membuka pemilih file). Foto otomatis diperkecil sebelum diunggah; tombol *Hapus foto* tersedia. Hanya barang dengan opsi *tampil di toko online* yang muncul di toko online.

## 5. Akses staf: toko dan gudang (web saja)

Tidak ada aplikasi yang dipasang. Semua staf, termasuk di gudang, memakai **browser (Chrome)** di HP atau komputer.

1. **Sambungkan perangkat ke jaringan toko**: Wi-Fi (HP/tablet) atau kabel LAN (komputer). Di gedung gudang, pakai access point gudang yang sudah tersambung ke jaringan server (lihat bagian 6).
2. **Buka alamat server** di Chrome, misalnya `http://192.168.1.10:3000/admin/`. Alamat persisnya ada di **Pengaturan → Alamat akses untuk staf** (superadmin), lengkap dengan tombol *Salin* dan *Cetak kartu alamat* untuk ditempel di gudang. Alamat yang sama tertulis di jendela server saat dijalankan.
3. **Login dengan akun masing-masing** (dibuat superadmin di menu Pengguna & Role; untuk staf gudang pilih peran **Admin Gudang**).
4. **Pasang pintasan**: Chrome ⋮ → *Tambahkan ke layar utama*, supaya terbuka seperti aplikasi.

Agar alamat tidak berubah, atur **DHCP reservation** untuk komputer server di router (bagian 6).

### Scan barcode di gudang: apa yang bisa dan tidak

Browser hanya mengizinkan **kamera** di alamat `https://` atau `localhost`. Di alamat `http://192.168.x.x` biasa, tombol kamera **tidak bisa dipakai** (sudah saya uji: kamera tidak tersedia di alamat IP lewat HTTP, tersedia di `localhost`). Pilihan, dari yang paling mudah:

- **Scanner barcode USB/Bluetooth** (disarankan untuk gudang): bekerja seperti keyboard. Klik kolom cari/scan lalu tembak barcode. Tidak butuh HTTPS atau pengaturan apa pun.
- **Ketik nama atau SKU barang**: selalu bisa sebagai cadangan.
- **HTTPS dari Tailscale (disarankan bila toko memakai Tailscale):** kamera HP aktif tanpa peringatan; lihat bagian 6b.
- **HTTPS lokal** (`npm run cert`, lalu jalankan ulang server): kamera aktif, tetapi tiap HP menampilkan peringatan "koneksi tidak pribadi" yang harus dilewati sekali. *Belum saya uji di HP sungguhan.*
  - *Install ke desktop di PC server:* dengan sertifikat buatan sendiri Chrome tidak menawarkan Install. Isi `LOCAL_HTTP_PORT=3001` di `config.env`, jalankan ulang server, lalu di PC server buka `http://localhost:3001/admin/` dan Install dari situ (HP tetap memakai `https://IP:3000`). Alternatif tanpa Install: Chrome ⋮ → Simpan dan bagikan → Buat pintasan → *Buka sebagai jendela*.
- Scanner kamera cadangan tanpa internet: `npm install` lalu `npm run vendor` sekali (saat ada internet).

Cetak struk/invoice memakai dialog cetak browser (printer yang terpasang di komputer, atau simpan PDF).

## 5b. Diskon dan PPN di Kasir

- **Diskon**: di panel pembayaran Kasir ada dua kolom, *Diskon (Rp)* dan *Diskon (%)*. Keduanya boleh diisi bersamaan: persen dihitung dari subtotal, lalu ditambah diskon rupiah (total diskon tidak pernah melebihi subtotal).
- **PPN**: diatur oleh superadmin di **Pengaturan → Pajak penjualan kasir** (aktif/mati, nama pajak, tarif %, dan cara hitung). Kasir tidak bisa mengubah tarif. PPN dihitung dari nilai SETELAH diskon.
  - *Harga belum termasuk pajak*: PPN ditambahkan ke total.
  - *Harga sudah termasuk pajak*: total tidak berubah, PPN hanya dirinci di struk dan laporan.
- Tarif disimpan di setiap transaksi, jadi mengubah tarif di kemudian hari tidak mengubah transaksi lama.
- **Laporan**: PPN yang dipungut bukan omzet. *Omzet bersih* dan *laba kotor* dihitung tanpa PPN; PPN tampil di kartu tersendiri (dikurangi PPN dari retur secara proporsional) dan sebagai kolom di CSV penjualan.
- **Retur**: refund per unit dihitung proporsional terhadap total yang benar-benar dibayar pelanggan (sudah setelah diskon dan termasuk PPN).
- Rumus ada di satu file, `public/admin/calc.js`, yang dipakai server dan tampilan kasir sehingga angka di layar selalu sama dengan yang disimpan.
- Belum mencakup Sales Order (SO) dan pesanan online: keduanya tetap memakai diskon rupiah tanpa PPN.

## 6. Pemasangan jaringan offline: toko dan gudang beda gedung

> Bila kedua gedung sudah terhubung lewat Tailscale dan masing-masing punya internet, lewati bagian ini dan lihat **6b**.

**Prinsip:** satu server, satu jaringan, tanpa internet. Kedua gedung disambung menjadi **satu jaringan lokal** sehingga HP/komputer di gudang memakai server yang sama dengan kasir di toko. "Toko" dan "Gudang" hanyalah dua lokasi stok di database yang sama, jadi tidak ada proses sinkronisasi: begitu gudang menerima barang PO atau mentransfer ke toko, kasir langsung melihat stoknya. (Dua server terpisah yang disinkronkan sengaja dihindari: bila link putus, kedua stok bisa menyimpang dan sulit dirujukkan.)

```
 GEDUNG TOKO                                        GEDUNG GUDANG
 ┌──────────────────────────────┐   kabel UTP / fiber   ┌─────────────────────────────┐
 │ Komputer SERVER (kabel LAN)  │   atau sepasang radio │ PC gudang (kabel)           │
 │ Router (satu-satunya DHCP)   │◄─ bridge 5 GHz ─────►│ Switch                      │
 │ Switch ── PC kasir (kabel)   │                       │ Access Point ── HP/tablet   │
 │ Access Point ── HP/tablet    │                       │                staf (Wi-Fi) │
 └──────────────────────────────┘                       └─────────────────────────────┘
        semua perangkat satu jaringan yang sama, mis. 192.168.1.x
```

### Peralatan (contoh)

| Kebutuhan | Pilihan |
|---|---|
| Menyambung dua gedung | **Kabel UTP Cat6** (maks. 100 m per segmen; untuk jalur luar ruang pakai kabel outdoor dan pelindung petir), **kabel fiber** untuk jarak lebih jauh, atau **sepasang radio bridge 5 GHz** point-to-point (perlu saling "melihat" tanpa penghalang; contoh seri: TP-Link CPE, Ubiquiti NanoStation/LiteBeam) |
| Wi-Fi staf | Satu *access point* di tiap gedung, disambung kabel ke switch |
| Router | **Satu saja** (di gedung toko), yang membagikan alamat IP |
| Listrik | **UPS** untuk server, router, switch, dan radio bridge di kedua gedung |

### Pilihan menyambung ke gedung gudang

Dua cara yang Anda pertimbangkan sama-sama bisa. Bedanya ada pada kestabilan.

| | **A. Kabel LAN ke access point gudang** | **B. Wi-Fi extender ke access point gudang** |
|---|---|---|
| Kestabilan | Paling stabil dan cepat | Bergantung kuat sinyal; bisa lambat atau putus-putus |
| Kecepatan | Penuh | Sekitar separuh per lompatan (extender satu radio); makin jauh makin turun |
| Biaya & kerja | Beli dan pasang kabel (galian/pipa/tiang) | Murah, tinggal pasang |
| Risiko | Petir dan beda arde antar gedung bila kabel tembaga lewat luar | Terganggu dinding beton/logam, hujan, jarak, dan Wi-Fi lain |
| Cocok untuk | Pemakaian harian, HP/tablet scan gudang yang terus bekerja | Mencoba dulu, atau jarak pendek dengan sinyal sangat kuat |

**Opsi A, hal yang perlu diperhatikan**
- Kabel UTP Cat6 **maksimal 100 m** per segmen. Jalur luar ruang: kabel **outdoor** (tahan UV, berpelindung), lewat pipa, dengan **surge protector** di kedua ujung.
- Jika jaraknya lebih dari 100 m, atau kedua gedung beda arde/jaringan listrik, pakai **fiber + media converter**, atau sepasang **radio bridge** (secara fungsi seperti "extender" kelas profesional, pakai antena terarah, jauh lebih stabil antar gedung).
- Access point di gudang sebaiknya **PoE** (satu kabel untuk data dan listrik), dalam mode Access Point, tanpa DHCP.

**Opsi B, hal yang perlu diperhatikan**
- Letakkan extender di titik yang **masih menerima sinyal toko dengan kuat** (di HP minimal 3 dari 4 batang). Extender hanya memperkuat yang diterimanya; menaruhnya di titik yang sudah lemah hasilnya buruk.
- Pakai band **5 GHz** bila ada (lebih cepat, lebih sepi), dan jauhkan dari logam serta dinding tebal.
- Bila extender punya port LAN dan mode **Client/Bridge**, sambungkan ke access point gudang dengan kabel pendek, itu lebih stabil daripada staf gudang langsung memakai Wi-Fi hasil pantulan.
- Usahakan tetap **satu jaringan** (mode Repeater/Bridge), bukan mode Router. Subnet terpisah biasanya tetap bisa mengakses server karena HP-lah yang memulai sambungan, tetapi server melihat semua HP sebagai satu alamat dan perangkat lebih sulit saling menemukan.

**Uji kelayakan 15 menit sebelum dipasang permanen (khusus opsi B, dan juga berguna untuk A)**
1. Berdirilah di titik gudang tempat staf bekerja, sambungkan laptop atau HP ke Wi-Fi gudang.
2. Windows: `ping -n 200 192.168.1.10` · Mac/Linux: `ping -c 200 192.168.1.10` (ganti dengan IP server).
3. Lihat ringkasannya. Patokan yang wajar untuk aplikasi ini: **kehilangan paket 0 sampai 1%**, rata-rata **di bawah 50 ms**, dan tidak ada lonjakan di atas 300 ms. Ini patokan praktis dari saya, bukan hasil pengukuran di lokasi Anda.
4. Buka panel dan perhatikan lencana di pojok kanan atas: **hijau "terhubung · 26 ms"** = baik, **kuning** = lambat (di atas 400 ms), **merah dan banner "server tidak terjangkau"** = putus.
5. Lakukan di jam sibuk, juga saat banyak perangkat aktif. Jika hasilnya sering kuning atau merah, naikkan ke opsi A atau radio bridge.

**Saran:** mulai dari opsi B untuk mencoba bila anggaran terbatas; bila lolos uji dan stabil, boleh dipertahankan. Untuk pemakaian jangka panjang (apalagi tablet scan di gudang yang bekerja terus), opsi A atau radio bridge jauh lebih aman.

### Langkah pemasangan

1. **Satukan jaringan.** Sambungkan gedung gudang ke jaringan toko dengan salah satu cara di atas (opsi A, B, atau radio bridge). Perangkat penghubung (radio bridge, access point) harus diatur ke mode **Bridge / Access Point**, **bukan Router**.
2. **Satu pembagi IP saja.** Hanya router di toko yang menjalankan DHCP. Matikan DHCP di access point dan radio bridge. Semua perangkat akhirnya satu rentang, mis. `192.168.1.x`.
3. **Matikan "AP Isolation / Client Isolation"** di pengaturan Wi-Fi, agar HP bisa menjangkau server. (Jaringan "tamu" biasanya terisolasi; jangan dipakai.)
4. **Server di kabel LAN** (bukan Wi-Fi), disambung ke switch/router di toko. Di router buat **DHCP reservation / alamat tetap**, mis. `192.168.1.10`, supaya alamat server tidak berubah.
5. **Windows Firewall:** saat pertama menjalankan server, centang **Private networks** → *Allow access*. Jika terlewat: Windows Security → Firewall → *Allow an app* → Node.js.
6. **Jalankan server:** klik `start.bat` (atau `npm start`). Alamat yang dipakai staf tampil di terminal, mis. `http://192.168.1.10:3000/admin/`.
7. **Uji dari gudang:** HP di Wi-Fi gudang membuka alamat itu dan masuk. Jika gagal: periksa langkah 1 sampai 5 (penyebab terbanyak: DHCP ganda dan Client Isolation).
8. **Hidup otomatis:** tekan `Win+R`, ketik `shell:startup`, taruh *shortcut* `start.bat` di folder itu. Atur komputer agar tidak sleep.

> Jika Wi-Fi memakai router kedua dalam mode Router (NAT), server melihat semua HP sebagai satu alamat. Sistem sudah menghitung batas login per akun sehingga satu orang salah ketik tidak mengunci semua orang, tetapi tetap lebih rapi memakai mode Access Point.

### Server ditaruh di mana?

Taruh di **gedung toko**: transaksi kasir terjadi terus-menerus dan itu yang paling tidak boleh berhenti. Bila link ke gudang putus, toko tetap berjalan normal dan hanya pekerjaan gudang yang menunggu.

### Backup ke gedung lain (jangan dilewatkan)

Server adalah satu-satunya tempat data berada. Jika komputernya rusak atau toko kemalingan, semua data ikut hilang. Karena itu server bisa **membuat backup otomatis ke komputer di gedung gudang**.

1. Di PC gudang: buat folder `backup-toko`, klik kanan → *Properties* → *Sharing*, beri akses tulis untuk akun yang dipakai.
2. Di komputer server: salin `config.env.example` menjadi `config.env`, lalu isi `BACKUP_DIR=\\GUDANG-PC\backup-toko` (atau `E:\backup-toko` untuk flashdisk). Jalankan ulang server.
3. Backup dibuat saat server menyala lalu tiap 6 jam; 30 file terbaru disimpan. **Pengaturan → Cadangan data** menampilkan *Backup otomatis aktif* atau tanda merah **Backup GAGAL** beserta alasannya (mis. PC gudang mati).
4. **Pemulihan:** matikan server, buka folder `data/`, hapus `toko.db`, `toko.db-wal`, dan `toko.db-shm`, salin file backup pilihan ke sana dengan nama `toko.db`, lalu jalankan server.

Uji sekali setelah dipasang: lihat apakah file `.db` muncul di PC gudang. Backup yang belum pernah dites pemulihannya belum bisa dianggap aman.

### Jam dan listrik

Tanpa internet, jam komputer server tidak sinkron otomatis. **Semua waktu transaksi memakai jam server**, jadi cek tanggal dan jam server tiap bulan. Pakai UPS agar listrik padam tidak merusak database atau memutus link antar gedung.

### Bila link antar gedung atau Wi-Fi putus

- Di perangkat yang terputus, dalam ±8 detik muncul **banner merah "Sambungan ke server terputus"** dan lencana *server tidak terjangkau*; isian di layar tidak hilang. Setelah tersambung lagi banner hilang sendiri; tekan Bayar / Simpan lagi.
- Tidak ada transaksi setengah jalan yang tersimpan: tiap penyimpanan bersifat atomik.
- Kasir di gedung server tidak terpengaruh. Gudang berhenti sementara; catat di kertas dan input setelah tersambung.
- **Belum ada mode offline untuk perangkat yang kehilangan server.** Karena itu kualitas link antar gedung adalah hal terpenting dalam pemasangan ini.

### Akses dari HP tanpa internet

- *Pintasan Chrome* (⋮ → Tambahkan ke layar utama): paling sederhana, tetapi **kamera scan tidak aktif** di alamat `http://` biasa. Gunakan scanner barcode USB/Bluetooth atau ketik kode.
- *HTTPS lokal* (`npm run cert`): kamera aktif di browser, tetapi tiap HP memberi peringatan "tidak aman".
- Scanner kamera cadangan tanpa internet: jalankan `npm install` lalu `npm run vendor` sekali (saat ada internet).

### Jika kedua gedung tidak bisa disambung

Tanpa kabel/radio antar gedung, dua lokasi **tidak bisa saling terhubung secara real-time**. Fitur untuk kondisi itu (server kedua di gudang, transfer barang lewat berkas/flashdisk) **belum ada**; kabari saya bila ini yang terjadi.

### Toko online

Halaman pelanggan hanya terjangkau di jaringan lokal. Jika sistem hanya dipakai staf, matikan di **Pengaturan → Aktifkan halaman toko online**; alamat `/` lalu langsung diarahkan ke panel admin.

## 6b. Skenario toko ini: Tailscale, tiap gedung punya internet sendiri

Kondisi: PC toko dan PC gudang sudah terhubung lewat Tailscale, dan tiap gedung punya internetnya sendiri (tidak ada kabel/radio antar gedung). Maka **bagian 6 (kabel, extender, radio) tidak diperlukan**: Tailscale-lah penghubung kedua gedung. Aplikasi ini jalan di **satu PC server** (sebaiknya PC toko yang menyala sepanjang hari), dan semua perangkat lain membukanya dari browser.

```
 PC gudang ──┐                          ┌── HP staf toko (aplikasi Tailscale)
 HP staf gudang ─ (Tailscale) ─ PC SERVER (toko) ─ (Tailscale) ──┘
```

### Langkah pasang (sekali saja)
1. **Server:** pasang aplikasi ini di PC server (bagian 1), pastikan Tailscale di PC itu sudah login.
2. **Aktifkan HTTPS Tailscale** (supaya kamera HP bisa dipakai): di https://login.tailscale.com/admin/dns aktifkan **MagicDNS**, lalu **Enable HTTPS**.
3. **Jalankan `npm run tailscale`** di PC server. Perintah ini membaca status Tailscale dan mencetak persis apa yang perlu dijalankan: `tailscale serve --bg 3000` dan dua baris untuk `config.env` (`TRUST_PROXY=1`, `PUBLIC_HOST=…`). Jalankan ulang server setelahnya.
4. **PC gudang dan HP staf:** pasang Tailscale, login ke akun tailnet toko, lalu buka `https://NAMA-SERVER.nama-tailnet.ts.net/admin/`. Alamat persisnya juga tampil di **Pengaturan → Alamat akses untuk staf**; tombol *Cetak kartu alamat* membuat lembar petunjuk untuk staf.
5. Di HP: Chrome ⋮ → *Tambahkan ke layar utama*. Di PC: pintasan atau *Install* dari Chrome.

Dengan alamat `https://…ts.net` sertifikatnya sah, jadi **tidak ada peringatan dan kamera scan di HP bekerja**. Di PC, scanner USB/Bluetooth tetap cara tercepat.

**Scanner kamera di HP:** Chrome Android punya pembaca barcode bawaan. iPhone/Safari memakai pustaka cadangan: jalankan `npm install` lalu `npm run vendor` sekali di PC server agar pustaka ikut dilayani dari server (tanpa itu diambil dari internet).

### Yang perlu dipahami
- **Butuh internet di kedua sisi.** Tailscale menghubungkan lewat internet. Bila internet toko mati, gudang tidak bisa membuka aplikasi (kasir di PC server tetap jalan lewat `http://localhost:3000`). Bila internet gudang mati, hanya gudang yang terputus. Menurut [dokumentasi Tailscale](https://tailscale.com/docs/reference/coordination-server-down.md), bila hanya server koordinasi Tailscale yang tak terjangkau, koneksi yang sudah ada tetap jalan selama kunci perangkat belum kedaluwarsa.
- **Backup** tetap penting: isi `BACKUP_DIR` (bagian 6, "backup ke gedung lain") dengan folder bersama di PC gudang lewat alamat Tailscale, atau unduh manual dari Pengaturan.
- Sertifikat dari `tailscale serve` umumnya diperbarui otomatis oleh Tailscale (periksa saat mendekati 90 hari). Alternatif manual `tailscale cert` (isi `TLS_CERT`/`TLS_KEY` di `config.env`) berlaku 90 hari dan harus diperbarui sendiri.
- Sertifikat HTTPS Tailscale tercatat di log publik (Certificate Transparency) **beserta nama komputer**. Beri nama komputer yang netral.
- Jangan memakai *Tailscale Funnel* (membuka server ke internet umum). Atur ACL agar hanya perangkat toko yang bisa menjangkau server. Login aplikasi tetap wajib; ada pembatas percobaan login per perangkat.
- Jumlah perangkat/pengguna yang boleh di paket Tailscale Anda mengikuti ketentuan Tailscale; periksa di panel adminnya bila HP staf banyak.
- Port 3000 bisa diganti lewat `PORT=` di `config.env` bila bentrok dengan aplikasi lain di PC yang sama.
- **Belum diuji dengan Tailscale sungguhan.** Yang sudah diuji: sisi aplikasi (HTTPS dari file sertifikat, `HOST`, `TRUST_PROXY`, pembacaan status). Perintah `tailscale serve` dan format keluaran `tailscale status --json` mengikuti dokumentasi Tailscale dan perlu dicoba di PC toko. Bila `npm run tailscale` gagal membaca, jalankan `tailscale serve --bg 3000` sendiri dan isi `config.env` manual.

## 7. Lupa password / akun terkunci

Password disimpan di database (folder `data/`), bukan di kode. Server yang mulai dengan folder `data/` kosong membuat ulang akun awal (`superadmin/super123`, `admin/admin123`, `staf/staf123`, `gudang/gudang123`, `kasir/kasir123`, `timso/timso123`).

Lupa password atau akun terkunci: di komputer server, jalankan
```
node scripts/reset-password.js --list                    # lihat akun
node scripts/reset-password.js superadmin PasswordBaru1  # reset (min. 6 karakter)
```
Akun yang terkunci ("terlalu banyak percobaan") terbuka sendiri setelah 10 menit atau bila server dijalankan ulang.

**Lampiran: memasang di internet (tidak dipakai pada mode offline).** Aplikasi ini server Node.js dengan database di disk, jadi **tidak bisa** dipasang di Cloudflare Pages/Workers (hanya untuk situs statis; gejalanya login menampilkan "Terjadi kesalahan"). Jika suatu saat perlu, pakai Cloudflare Tunnel ke server Anda atau VPS dengan disk tetap, dan jalankan dengan `TRUST_PROXY=1` di `config.env`. Pasang HTTPS dan ganti semua password.

## 8. Keamanan dan pengujian

- Password disimpan ter-hash (scrypt), sesi berlaku 7 hari, login dibatasi 10 percobaan gagal per 10 menit untuk tiap kombinasi perangkat + akun.
- Pesanan online dibatasi 8 per 10 menit per perangkat (ubah dengan `ORDER_LIMIT`).
- **Pesanan online yang belum dibayar otomatis dibatalkan setelah 24 jam** dan stok dikembalikan (COD dan pesanan yang sudah diproses tidak disentuh; atur jamnya di Pengaturan, `0` untuk mematikan).
- Setiap aksi penting masuk **Log aktivitas** (siapa, apa, kapan).
- Pengujian otomatis: `npm test` (+31 pemeriksaan Kartu Stok, rincian lama: 53 API termasuk hak akses, stok, PO, pesanan, laporan; 24 untuk pengaman, backup otomatis, dan konfigurasi; 29 untuk peran Gudang dan migrasi database lama; 12 untuk konfigurasi Tailscale/HTTPS; 25 untuk Permintaan Barang; 28 untuk peran Kasir, Staf toko, dan dashboard). Alur tampilan (4 peran, semua halaman, kasir, siklus PO penuh, toko online, banner server terputus, Cek Stok sebagai staf di layar HP) juga sudah diuji di Chromium. `npm test` bagian API butuh `bash` (Windows: Git Bash atau WSL).
- **Belum diuji dengan perangkat nyata:** kamera untuk scan (termasuk HTTPS lokal di HP), printer, dan pemasangan jaringan dua gedung (radio bridge, access point, folder bersama di PC gudang) karena itu bergantung pada perangkat di lokasi Anda.

## 9. Rekomendasi

**Sebelum dipakai sungguhan**
1. Ganti ketiga password awal dan isi data toko (nama, WhatsApp, rekening) di Pengaturan.
2. Aktifkan **backup otomatis ke gedung lain** (bagian 6) dan uji pemulihannya sekali. Cadangan tambahan ke flashdisk mingguan juga baik.
3. Pasang **UPS** untuk server dan perangkat jaringan di kedua gedung.
4. Lakukan **stok opname awal** (menu Stok → koreksi, mode "set") sebelum mulai berjualan, lalu cetak label barcode untuk barang yang belum punya barcode.

**Pengembangan berikutnya (urut manfaat)**
- **Pembayaran otomatis** (Midtrans/Xendit) agar QRIS/transfer online lunas tanpa dicek manual. Saat ini pembayaran dicatat manual oleh staf.
- **Ongkos kirim** (RajaOngkir/Biteship) dan nomor resi.
- **Notifikasi WhatsApp** ke pelanggan saat status pesanan berubah.
- **Varian barang** (ukuran cincin, warna): saat ini tiap varian dibuat sebagai barang terpisah dengan SKU sendiri.
- **Retur/refund sebagian**, hutang ke supplier, dan promo/diskon per barang.
- **Data pelanggan & poin loyalitas**, terutama jika banyak pembeli langganan.
- **Mode offline kasir** bila listrik/Wi-Fi sering putus.
- Jika kelak ada lebih dari satu cabang: tambahkan lokasi stok per cabang (struktur stok sudah per-lokasi).

## 10. Struktur folder

```
hosana/
├─ server.js, db.js        server & database (SQLite bawaan Node)
├─ config.env.example      contoh pengaturan server (salin jadi config.env)
├─ public/index.html …     toko online pelanggan
├─ public/admin/           panel kasir & admin (PWA)
├─ tests/                  pengujian otomatis
├─ scripts/                sertifikat HTTPS, pustaka scanner, pembaca status Tailscale, reset password
└─ data/                   dibuat otomatis: database & foto (JANGAN dihapus)
```

Pengaturan server cukup ditulis di `config.env` (lihat `config.env.example`): `PORT` (default 3000), `DATA_DIR`, `BACKUP_DIR`, `BACKUP_EVERY_HOURS`, `BACKUP_KEEP`, `SEED_DEMO=0`, `HTTPS=0`, `ORDER_LIMIT`, `TRUST_PROXY=1`.
