// Katalog hak akses (permission) + bawaan tiap role.
// Dipakai server (cek akses tiap endpoint) dan dikirim ke panel admin (menu & halaman Role).
// Menambah fitur baru: tambahkan satu baris di GROUPS, lalu pakai kuncinya di route server & menu panel.
//
// Hak akses bertingkat: "requires" = hak induk. Memberi hak anak otomatis memberi hak induknya.
// Hak yang TIDAK bisa didelegasikan (hanya Super Admin): Pengguna & Role, Pengaturan, Log aktivitas, Backup.

const GROUPS = [
  { title: 'Penjualan', items: [
    { key: 'kasir', label: 'Kasir', desc: 'Menu Kasir: menjual barang, menerima pembayaran, cetak struk' },
    { key: 'penjualan', label: 'Riwayat Penjualan', desc: 'Melihat riwayat transaksi miliknya sendiri (3 hari terakhir)' },
    { key: 'penjualan.semua', label: 'Lihat semua transaksi', desc: 'Transaksi semua kasir dan semua tanggal', requires: 'penjualan' },
    { key: 'penjualan.void', label: 'Batalkan (void) transaksi', desc: 'Membatalkan transaksi penjualan, stok kembali', requires: 'penjualan' },
    { key: 'penjualan.retur', label: 'Retur barang customer', desc: 'Mencatat retur, mengembalikan stok, dan mencatat refund sebagai pengeluaran kas', requires: 'penjualan' },
    { key: 'pesanan', label: 'Sales Order (SO)', desc: 'Sales Order (SO) online / telepon / WA: buat, ubah status, catat pembayaran' },
    { key: 'pesanan.batal_lunas', label: 'Batalkan SO yang sudah dibayar', desc: 'Tanpa hak ini, SO lunas hanya bisa dibatalkan orang lain yang berhak', requires: 'pesanan' },
    { key: 'pesanan.packing', label: 'Tandai SO selesai packing', desc: 'Tim SO menandai pesanan sudah selesai dikemas', requires: 'pesanan' },
    { key: 'pesanan.edit', label: 'Edit nota SO', desc: 'Mengubah barang, qty, harga, diskon, dan data pelanggan pada SO yang belum difinalkan', requires: 'pesanan' },
    { key: 'pesanan.final', label: 'Finalkan SO & terbitkan Sales Invoice', desc: 'Mengunci nota SO dan menerbitkan Sales Invoice (SI); juga boleh membuka kembali final selama belum lunas', requires: 'pesanan' },
    { key: 'pesanan.invoice', label: 'Cetak Sales Invoice SO', desc: 'Mencetak Sales Invoice, setelah SO difinalkan (SI sudah terbit)', requires: 'pesanan' },
    { key: 'kas', label: 'Pengeluaran Kas', desc: 'Mencatat uang kas yang keluar (beli plastik, ongkir, dll) dan melihat catatan miliknya hari ini' },
  ] },
  { title: 'Barang & Stok', items: [
    { key: 'cek', label: 'Cek Stok', desc: 'Mencari barang dan melihat stok di 3 lokasi: Display Toko, Gudang Toko, Gudang Ruko' },
    { key: 'produk', label: 'Data Barang (lihat)', desc: 'Melihat daftar barang dan cetak label barcode' },
    { key: 'produk.kelola', label: 'Kelola barang & kategori', desc: 'Tambah, ubah, arsip/hapus barang, kategori, unggah foto', requires: 'produk' },
    { key: 'harga_beli', label: 'Lihat harga beli (modal)', desc: 'Harga beli / HPP muncul di Data Barang, PO, dan nilai stok' },
    { key: 'stok', label: 'Stok per Lokasi (lihat)', desc: 'Melihat stok Display Toko, Gudang Toko, Gudang Ruko dan riwayat mutasi stok' },
    { key: 'stok.kartu', label: 'Kartu Stok', desc: 'Melihat riwayat keluar-masuk stok per barang (saldo awal, masuk, keluar, saldo akhir), mencetak, dan ekspor CSV' },
    { key: 'stok.koreksi_toko', label: 'Koreksi / opname stok Display Toko', desc: '', requires: 'stok' },
    { key: 'stok.koreksi_gudang', label: 'Koreksi / opname stok Gudang Toko & Gudang Ruko', desc: '', requires: 'stok' },
    { key: 'permintaan', label: 'Permintaan Barang (lihat)', desc: 'Melihat daftar permintaan barang dari toko ke gudang' },
    { key: 'permintaan.buat', label: 'Buat permintaan & konfirmasi terima (toko)', desc: 'Membuat, membatalkan miliknya sendiri, dan mengonfirmasi barang diterima', requires: 'permintaan' },
    { key: 'permintaan.batal_semua', label: 'Batalkan permintaan milik orang lain', desc: '', requires: 'permintaan.buat' },
    { key: 'permintaan.proses', label: 'Proses permintaan (gudang)', desc: 'Menyiapkan, menolak, dan mengirim barang', requires: 'permintaan' },
    { key: 'terima', label: 'Terima Barang dari Supplier (PO)', desc: 'Mencatat barang PO yang datang; masuk ke Gudang Ruko atau Gudang Toko' },
    { key: 'transfer', label: 'Transfer Stok Antar Lokasi', desc: 'Memindahkan stok langsung antar Display Toko, Gudang Toko, dan Gudang Ruko' },
  ] },
  { title: 'Pembelian', items: [
    { key: 'po', label: 'Purchase Order ke Supplier', desc: 'Membuat, merevisi, mengajukan, menyetujui, menghapus PO' },
    { key: 'supplier', label: 'Supplier', desc: 'Kelola data supplier' },
  ] },
  { title: 'Manajemen', items: [
    { key: 'customer', label: 'Data Pelanggan (kelola)', desc: 'Menambah, mengubah, dan menghapus daftar pelanggan (nama, HP/WA, alamat). Memilih pelanggan di Kasir / SO tidak butuh hak ini' },
    { key: 'kas.laporan', label: 'Laporan Kas', desc: 'Laporan pengeluaran kas semua kasir per tanggal, per kategori, dan ekspor CSV. Tidak perlu hak input kas' },
    { key: 'laporan.penjualan', label: 'Laporan Penjualan', desc: 'Laporan penjualan per hari, metode bayar, kanal, kasir, dan produk. Tanpa HPP / laba' },
    { key: 'laporan', label: 'Laporan lengkap', desc: 'Menambah laba kotor, HPP, laporan nilai stok, dan ekspor CSV per item / stok', requires: 'laporan.penjualan' },
    { key: 'dashboard', label: 'Dashboard', desc: 'Omzet, grafik, barang terlaris, stok menipis' },
  ] },
];

const ITEMS = GROUPS.flatMap((g) => g.items);
const ALL_KEYS = ITEMS.map((i) => i.key);
const BY_KEY = Object.fromEntries(ITEMS.map((i) => [i.key, i]));

// Peran bawaan. superadmin selalu memegang semua hak dan tidak bisa diubah.
const BUILTIN = {
  superadmin: { name: 'Super Admin', description: 'Semua hak akses, termasuk Pengguna & Role, Pengaturan, Backup. Tidak bisa diubah.', permissions: ALL_KEYS },
  // Admin (lama) dipecah dua: sisi penjualan = Sales Admin, sisi gudang = Admin Gudang.
  sales_admin: { name: 'Sales Admin', description: 'Input Sales Order (SO), edit nota, finalkan SO (menerbitkan Sales Invoice), cetak Sales Invoice, dan cek stok.',
    permissions: ['cek', 'pesanan', 'pesanan.edit', 'pesanan.final', 'pesanan.invoice', 'customer'] },
  admin_gudang: { name: 'Admin Gudang', description: 'Cek stok, terima dan proses permintaan barang dari toko, terima barang masuk dari supplier.',
    permissions: ['cek', 'permintaan', 'permintaan.proses', 'terima'] },
  staf: { name: 'Staf', description: 'Cek stok, mengajukan permintaan barang ke gudang, dan mengonfirmasi barang yang diterima.',
    permissions: ['cek', 'permintaan', 'permintaan.buat'] },
  kasir: { name: 'Kasir', description: 'Input penjualan, cetak struk / invoice customer, input pengeluaran kas, laporan pengeluaran kas, laporan penjualan, dan cek stok.',
    permissions: ['kasir', 'penjualan', 'penjualan.retur', 'cek', 'kas', 'kas.laporan', 'laporan.penjualan'] },
  tim_so: { name: 'Tim SO', description: 'Cek stok, mengerjakan Sales Order (SO) dari Sales Admin (edit nota, ubah status, catat pembayaran, tandai selesai packing), finalkan SO, dan mencetak Sales Invoice untuk customer. Tanpa harga beli.',
    permissions: ['cek', 'pesanan', 'pesanan.packing', 'pesanan.edit', 'pesanan.final', 'pesanan.invoice'] },
};

// buang kunci tak dikenal, tambahkan hak induk yang wajib, urutkan sesuai katalog
function normalize(list) {
  const set = new Set((Array.isArray(list) ? list : []).filter((k) => BY_KEY[k]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const k of [...set]) { const r = BY_KEY[k].requires; if (r && !set.has(r)) { set.add(r); changed = true; } }
  }
  return ALL_KEYS.filter((k) => set.has(k));
}
function parse(json) { try { return normalize(JSON.parse(json || '[]')); } catch (_) { return []; } }

// Hak bawaan versi sebelumnya. Dipakai migrasi: role yang hak-nya masih persis sama dengan ini (belum diubah superadmin)
// otomatis dipindah ke bawaan terbaru; role yang sudah dikustomisasi tidak disentuh.
// Satu role boleh punya beberapa generasi bawaan lama (daftar berisi daftar hak).
const PREVIOUS_DEFAULTS = {
  sales_admin: [['cek', 'produk', 'stok', 'pesanan', 'pesanan.batal_lunas', 'penjualan', 'penjualan.semua', 'penjualan.void'], ['cek', 'pesanan', 'pesanan.invoice'], ['cek', 'pesanan', 'pesanan.edit', 'pesanan.final', 'pesanan.invoice']],
  admin_gudang: [['cek', 'produk', 'stok', 'stok.koreksi_gudang', 'permintaan', 'permintaan.proses', 'terima', 'transfer']],
  kasir: [['kasir', 'penjualan']],
  staf: [['cek', 'pesanan', 'produk', 'stok', 'permintaan', 'permintaan.buat']],
  tim_so: [['pesanan', 'cek', 'produk', 'stok'], ['pesanan', 'pesanan.packing', 'cek', 'produk', 'stok'], ['cek', 'pesanan', 'pesanan.packing', 'pesanan.invoice']],
};

module.exports = { GROUPS, ALL_KEYS, BUILTIN, PREVIOUS_DEFAULTS, normalize, parse };
