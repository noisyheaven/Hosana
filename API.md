# API ringkas
Semua endpoint selain `/api/login` dan `/api/health` memerlukan header `Authorization: Bearer <token>`.

- `POST /api/login` `{ "username": "...", "password": "..." }`
- `GET /api/dashboard`
- `GET /api/products?search=...`
- `POST /api/products` / `PUT /api/products/:id` / `DELETE /api/products/:id`
- Lokasi stok: `display` (Display Toko), `gudang_toko`, `gudang_ruko`. Produk membawa `display_qty`, `gt_qty`, `gr_qty`, `total_qty`.
- `POST /api/transfers` `{ "from": "gudang_ruko", "to": "display", "items": [{ "product_id": 1, "qty": 3 }], "note": "" }`
- `POST /api/stock/adjust` `{ "product_id": 1, "location": "gudang_toko", "mode": "set|add", "qty": 5 }`
- `POST /api/requests` `{ "from_location": "gudang_ruko", "to_location": "display", "items": [...] }` (asal: gudang_toko/gudang_ruko; tujuan: display/gudang_toko)
- `POST /api/po/:id/receive` `{ "location": "gudang_ruko|gudang_toko", "items": [{ "item_id": 1, "qty": 2 }] }`
- `POST /api/orders` menerima `source_location` (lokasi pengambilan barang SO, default `display`)
- `GET /api/stock/moves`
- Kartu Stok: `GET /api/stock/card?product_id=1&location=all|display|gudang_toko|gudang_ruko&from=2026-11-01&to=2026-11-18` (hak `stok.kartu` atau `stok`). Mengembalikan `opening` (saldo awal), `rows[]` (`in`, `out`, `balance`, `type_label`, `ref`, `note`, `user`), `total_in`, `total_out`, `closing`, `current` (stok tercatat sekarang), dan `mismatch` (true bila saldo akhir tidak sama dengan stok sekarang). Parameter tambahan: `period=all` (semua riwayat sejak mutasi pertama; tanpa `from`), `type=all|pembelian|penjualan|transfer|koreksi` (menyaring baris, saldo tetap saldo sebenarnya), `show_transfer=0|1` (0 menyembunyikan transfer hanya bila lokasi `all`; bila tidak dikirim, transfer tampil). Tiap baris juga memuat `group`, `party` (nama customer / supplier), `price` + `price_kind` (`jual` / `beli`; harga beli null bila tanpa hak `harga_beli`). Respons memuat `available` (stok tersedia), `hidden` (jumlah baris disembunyikan), `product.description`, `product.unit`. `total_in` / `total_out` dihitung dari baris yang tampil. Tambah `&format=csv` untuk unduhan CSV (kolom No, Tanggal, Jenis, ID, Keterangan, Masuk, Keluar, Saldo, Harga, Lokasi, Dicatat oleh)
- `POST /api/purchase-orders` `{ "supplier":"...", "notes":"", "items":[{"product_id":1,"qty":10,"unit_cost":12000}] }`
- `GET /api/purchase-orders`, `GET /api/purchase-orders/:id`
- `PUT /api/purchase-orders/:id`, `PUT /api/purchase-orders/:id/items`
- `POST /api/purchase-orders/:id/receive`
- `POST /api/sales` `{ "items":[{"product_id":1,"qty":2}], "payment_method":"tunai", "paid":40000, "discount_rp":0, "discount_pct":0 }`
  - `discount_rp` (rupiah) dan `discount_pct` (0–100, boleh desimal) boleh dipakai bersamaan; field lama `discount` tetap diterima dan dianggap `discount_rp`. Diskon persen dihitung dari subtotal, total diskon dibatasi sebesar subtotal.
  - Pajak mengikuti pengaturan toko (`tax_enabled`, `tax_rate`, `tax_mode` = `exclusive` | `inclusive`, `tax_name`), dihitung SETELAH diskon, dan tidak bisa diatur per transaksi oleh kasir. Respons memuat `discount`, `discount_rp`, `discount_pct`, `tax_rate`, `tax_mode`, `tax_amount`, `total`.
- `GET /api/sales?from=2026-01-01&to=2026-12-31`, `GET /api/sales/:id`
- Retur customer (hak `penjualan.retur`): `POST /api/sales/:id/returns` dengan `{ "items":[{"sale_item_id":1,"qty":1,"restock":true}], "location":"display|gudang_toko|gudang_ruko", "reason":"Barang cacat", "note":"" }`. Retur parsial didukung; stok hanya bertambah untuk item `restock:true`; refund otomatis dibuat sebagai pengeluaran kas kategori `Refund Retur Barang`.
- `GET /api/returns?from=&to=&q=`, `GET /api/returns/:id`, `GET /api/sales/:id/returns` (hak `penjualan.retur`). Transaksi yang sudah memiliki retur tidak bisa di-void.
- `GET /api/reports/sales?from=2026-01-01&to=2026-12-31`
- `POST /api/orders/:id/pack` (hak `pesanan.packing`) tandai SO selesai packing; body `{ "packed": false }` untuk membatalkan
- Sales Invoice (SI): `PUT /api/orders/:id` (hak `pesanan.edit`) edit nota `{ customer_name, phone, address, notes, discount, items:[{product_id, qty, price}] }`, hanya selama SO belum final; selisih qty menyesuaikan stok yang dipesan.
- `POST /api/orders/:id/finalize` (hak `pesanan.final`) kunci nota dan terbitkan SI (`SI-YYYYMMDD-0001`); tanpa syarat packing/pembayaran.
- `POST /api/orders/:id/reopen` `{ "reason": "..." }` (hak `pesanan.final`) void SI dan buka nota; ditolak bila SO sudah lunas dan tercatat sebagai penjualan.
- `POST /api/orders/:id/pay` `{ "method": "transfer", "amount": 4000 }` (hak `pesanan`) catat pembayaran kapan saja; `amount` kosong = sisa tagihan; status bayar `belum` / `sebagian` / `lunas`. Transaksi penjualan tercatat saat SO final dan lunas.
- `GET /api/orders/:id` memuat `finalized`, `invoice`, `invoices` (riwayat SI termasuk yang void), `subtotal`, `discount`, `paid_amount`, `remaining`.
- `GET /api/orders/:id/invoice` (hak `pesanan.invoice`) data Sales Invoice untuk dicetak (termasuk `pay_status`, `paid_amount`, `remaining`); ditolak (400) bila SO belum difinalkan atau sudah dibatalkan
- Kas: `GET /api/cash-categories`, `POST /api/cash-expenses` `{ "category": "...", "description": "...", "amount": 25000, "spent_at": "2026-11-18" }`, `GET /api/cash-expenses/mine` (hak `kas`)
- `GET /api/reports/cash?from=&to=` (hak `kas.laporan`), `GET /api/reports/export?type=cash`
- `GET /api/reports/sales` cukup hak `laporan.penjualan` (HPP/laba hanya bila punya `laporan`); `export?type=items|stock` butuh `laporan`
- `GET /api/users`, `POST /api/users` (superadmin only)

Hak akses: tiap endpoint memeriksa hak (permission) role pengguna, bukan nama role. Daftar hak ada di `permissions.js`; `GET /api/me` mengembalikan `role`, `role_name`, dan `perms` milik pengguna.

- `GET /api/roles` (katalog hak + daftar role), `POST /api/roles` `{ "name": "Kasir Onboarding", "description": "", "permissions": ["kasir"] }`
- `PUT /api/roles/:key` `{ "name", "description", "permissions": [...] }`, `POST /api/roles/:key/reset` (role bawaan), `DELETE /api/roles/:key` (role kustom tanpa pengguna)
- `POST /api/users` / `PUT /api/users/:id` menerima `role` berupa kunci role mana pun yang ada.

Semua endpoint role dan pengguna hanya untuk superadmin.
