// Tes detail role terbaru: pengeluaran kas (Kasir), alur packing -> Sales Invoice (Tim SO -> Sales Admin), migrasi role lama.
// Jalankan: node tests/detailrole.test.js
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const root = path.join(__dirname, '..');
let ok = 0, fail = 0;
const chk = (n, c, x = '') => { c ? ok++ : fail++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${c ? '' : ' -> ' + String(x).slice(0, 300)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function boot(dir, port) {
  const srv = spawn(process.execPath, [path.join(root, 'server.js')], { env: { ...process.env, DATA_DIR: dir, PORT: port, HTTPS: '0' }, stdio: 'ignore' });
  const B = `http://127.0.0.1:${port}`;
  const k = async (m, p, body, token) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined || body === null ? undefined : JSON.stringify(body) }); let d = null; const ct = r.headers.get('content-type') || ''; try { d = ct.includes('json') ? await r.json() : await r.text(); } catch (_) {} return { s: r.status, d }; };
  for (let i = 0; i < 50; i++) { try { await fetch(B + '/api/ping'); break; } catch { await sleep(200); } }
  const login = async (u, p) => (await k('POST', '/api/login', { username: u, password: p })).d.token;
  return { srv, k, login };
}
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toko-detail-'));
  let { srv, k, login } = await boot(dir, 3211);
  const K = await login('kasir', 'kasir123'), F = await login('staf', 'staf123'), SA = await login('salesadmin', 'sales123'), T = await login('timso', 'timso123'), G = await login('admingudang', 'gudang123'), S = await login('superadmin', 'super123');
  const st = async (m, p, t, b) => (await k(m, p, b, t)).s;

  console.log('# Pengeluaran kas');
  chk('kasir: input pengeluaran kas berhasil', (await st('POST', '/api/cash-expenses', K, { category: 'Perlengkapan (plastik, kertas, dll)', description: 'Beli plastik packing', amount: 25000 })) === 200);
  chk('kasir: jumlah 0 / keterangan kosong / kategori kosong ditolak', (await st('POST', '/api/cash-expenses', K, { category: 'Operasional', description: 'x', amount: 0 })) === 400 && (await st('POST', '/api/cash-expenses', K, { category: 'Operasional', description: '', amount: 1000 })) === 400 && (await st('POST', '/api/cash-expenses', K, { category: '', description: 'x', amount: 1000 })) === 400);
  await k('POST', '/api/cash-expenses', { category: 'Ongkir / transport', description: 'Ongkir paket', amount: 15000 }, K);
  const mine = (await k('GET', '/api/cash-expenses/mine', null, K)).d;
  chk('kasir: melihat catatan miliknya hari ini (2 baris)', Array.isArray(mine) && mine.length === 2, JSON.stringify(mine));
  const rep = (await k('GET', '/api/reports/cash', null, K)).d;
  chk('kasir: laporan pengeluaran kas total 40.000 dan per kategori', rep.total.total === 40000 && rep.total.n === 2 && rep.by_category.length === 2 && rep.rows.length === 2, JSON.stringify(rep.total));
  const csv = await k('GET', '/api/reports/export?type=cash', null, K);
  chk('kasir: ekspor CSV pengeluaran kas boleh', csv.s === 200 && String(csv.d).includes('Beli plastik packing'));
  chk('kasir DITOLAK: CSV per item (HPP) dan CSV stok', (await st('GET', '/api/reports/export?type=items', K)) === 403 && (await st('GET', '/api/reports/export?type=stock', K)) === 403);
  chk('kasir BOLEH: CSV transaksi penjualan', (await st('GET', '/api/reports/export?type=sales', K)) === 200);
  chk('role tanpa hak kas (staf, sales admin, tim SO, admin gudang) ditolak', (await Promise.all([F, SA, T, G].map((t) => st('POST', '/api/cash-expenses', t, { category: 'Operasional', description: 'x', amount: 1000 })))).every((x) => x === 403));
  chk('hanya pemegang kas.laporan yang melihat laporan kas', (await Promise.all([F, SA, T, G].map((t) => st('GET', '/api/reports/cash', t)))).every((x) => x === 403) && (await st('GET', '/api/reports/cash', S)) === 200);

  console.log('# Finalkan SO -> Sales Invoice');
  const prods = (await k('GET', '/api/products?limit=20', null, SA)).d;
  const p0 = prods.find((p) => p.display_qty >= 3);
  const mk = async () => (await k('POST', '/api/orders', { customer_name: 'Budi', phone: '081234567890', source: 'wa', items: [{ product_id: p0.id, qty: 1 }] }, SA)).d;
  const o = await mk();
  chk('sales admin: input SO berhasil', !!o.id, JSON.stringify(o));
  chk('invoice SO ditolak sebelum SO difinalkan', (await st('GET', `/api/orders/${o.id}/invoice`, SA)) === 400);
  chk('sales admin tidak boleh menandai packing (hak tim SO)', (await st('POST', `/api/orders/${o.id}/pack`, SA, {})) === 403);
  chk('tim SO: tandai selesai packing berhasil', (await k('POST', `/api/orders/${o.id}/pack`, {}, T)).d.packed_at != null);
  chk('tim SO: packing ganda ditolak', (await st('POST', `/api/orders/${o.id}/pack`, T, {})) === 400);
  chk('tim SO: invoice SO masih ditolak bila belum difinalkan (walau sudah packing)', (await st('GET', `/api/orders/${o.id}/invoice`, T)) === 400);
  chk('staf, kasir, admin gudang tidak boleh mencetak invoice SO', (await Promise.all([F, K, G].map((t) => st('GET', `/api/orders/${o.id}/invoice`, t)))).every((x) => x === 403));
  chk('staf, kasir, admin gudang tidak boleh finalkan / edit nota SO', (await Promise.all([F, K, G].flatMap((t) => [st('POST', `/api/orders/${o.id}/finalize`, t, {}), st('PUT', `/api/orders/${o.id}`, t, { notes: 'x' })]))).every((x) => x === 403));
  const fin = await k('POST', `/api/orders/${o.id}/finalize`, {}, T);
  chk('tim SO: finalkan SO menerbitkan SI-', fin.s === 200 && /^SI-\d{8}-\d{4}$/.test(fin.d.invoice.si_no) && fin.d.finalized === true, JSON.stringify(fin.d).slice(0, 200));
  const invT = await k('GET', `/api/orders/${o.id}/invoice`, null, T);
  chk('tim SO: cetak Sales Invoice setelah final (belum dibayar pun boleh)', invT.s === 200 && invT.d.invoice_no === fin.d.invoice.si_no && invT.d.pay_status === 'belum' && invT.d.remaining > 0, JSON.stringify(invT.d).slice(0, 200));
  const inv = await k('GET', `/api/orders/${o.id}/invoice`, null, SA);
  chk('sales admin: invoice SO bisa dicetak setelah final', inv.s === 200 && /^SI-/.test(inv.d.invoice_no) && inv.d.items.length === 1 && inv.d.order_no === fin.d.order_no, JSON.stringify(inv.d).slice(0, 200));
  chk('hanya packing: detail SO memuat siapa & kapan', (await k('GET', `/api/orders/${o.id}`, null, SA)).d.packed_by_name === 'Tim SO');
  const o2 = await mk();
  await k('POST', `/api/orders/${o2.id}/pay`, { method: 'transfer' }, SA);
  await k('POST', `/api/orders/${o2.id}/pack`, {}, T);
  chk('tim SO: batalkan status packing berhasil; invoice tetap tertutup selama SO belum difinalkan', (await k('POST', `/api/orders/${o2.id}/pack`, { packed: false }, T)).d.packed_at === null && (await st('GET', `/api/orders/${o2.id}/invoice`, SA)) === 400);
  const o3 = await mk();
  await k('POST', `/api/orders/${o3.id}/status`, { status: 'batal' }, SA);
  chk('SO batal: tidak bisa dipacking', (await st('POST', `/api/orders/${o3.id}/pack`, T, {})) === 400);

  console.log('# Migrasi role lama');
  srv.kill(); await sleep(600);
  const db = new DatabaseSync(path.join(dir, 'toko.db'));
  const oldSales = ['cek', 'produk', 'stok', 'pesanan', 'pesanan.batal_lunas', 'penjualan', 'penjualan.semua', 'penjualan.void'];
  db.prepare("UPDATE roles SET permissions=? WHERE key='sales_admin'").run(JSON.stringify(oldSales));          // masih bawaan lama -> harus dimigrasi
  db.prepare("UPDATE roles SET permissions=? WHERE key='staf'").run(JSON.stringify(['cek', 'pesanan', 'produk', 'stok', 'permintaan', 'permintaan.buat'])); // bawaan lama -> dimigrasi
  db.prepare("UPDATE roles SET permissions=? WHERE key='tim_so'").run(JSON.stringify(['pesanan', 'pesanan.packing', 'cek', 'produk', 'stok']));        // bawaan lama -> dimigrasi
  db.prepare("UPDATE roles SET permissions=? WHERE key='kasir'").run(JSON.stringify(['kasir', 'penjualan', 'laporan.penjualan'])); // sudah dikustomisasi -> jangan ditimpa
  db.close();
  ({ srv, k, login } = await boot(dir, 3212));
  const S2 = await login('superadmin', 'super123');
  const roles = (await k('GET', '/api/roles', null, S2)).d.roles || (await k('GET', '/api/roles', null, S2)).d;
  const rl = (key) => (Array.isArray(roles) ? roles : []).find((r) => r.key === key);
  chk('role bawaan lama yang belum diubah dipindah ke detail baru (sales admin)', JSON.stringify([...rl('sales_admin').permissions].sort()) === JSON.stringify(['pesanan', 'pesanan.edit', 'pesanan.final', 'pesanan.invoice', 'customer', 'cek'].sort()), JSON.stringify(rl('sales_admin') && rl('sales_admin').permissions));
  chk('role yang sudah dikustomisasi superadmin tidak ditimpa (kasir)', JSON.stringify(rl('kasir').permissions) === JSON.stringify(['kasir', 'penjualan', 'laporan.penjualan']), JSON.stringify(rl('kasir') && rl('kasir').permissions));

  chk('staf lama (SO + data barang + stok) dipindah ke hak baru', JSON.stringify(rl('staf').permissions) === JSON.stringify(['cek', 'permintaan', 'permintaan.buat']), JSON.stringify(rl('staf').permissions));
  chk('tim SO lama dipindah ke hak baru (+ edit nota, finalkan, cetak SI, tanpa data barang/stok)', JSON.stringify(rl('tim_so').permissions) === JSON.stringify(['pesanan', 'pesanan.packing', 'pesanan.edit', 'pesanan.final', 'pesanan.invoice', 'cek']), JSON.stringify(rl('tim_so').permissions));
  srv.kill(); await sleep(600);
  const db2 = new DatabaseSync(path.join(dir, 'toko.db'));
  db2.prepare("UPDATE roles SET permissions=? WHERE key='staf'").run(JSON.stringify(['cek', 'permintaan', 'permintaan.buat', 'produk'])); // diubah superadmin -> jangan ditimpa
  db2.prepare("UPDATE roles SET permissions=? WHERE key='tim_so'").run(JSON.stringify(['pesanan', 'cek', 'produk', 'stok']));                  // generasi pertama
  db2.close();
  ({ srv, k, login } = await boot(dir, 3213));
  const S3 = await login('superadmin', 'super123');
  const roles3 = (await k('GET', '/api/roles', null, S3)).d.roles || (await k('GET', '/api/roles', null, S3)).d;
  const rl3 = (key) => roles3.find((r) => r.key === key);
  chk('staf yang sudah dikustomisasi tidak ditimpa', JSON.stringify(rl3('staf').permissions) === JSON.stringify(['produk', 'cek', 'permintaan', 'permintaan.buat'].sort((a, b) => ['cek', 'produk', 'permintaan', 'permintaan.buat'].indexOf(a) - ['cek', 'produk', 'permintaan', 'permintaan.buat'].indexOf(b))), JSON.stringify(rl3('staf').permissions));
  chk('tim SO generasi pertama juga dimigrasi', JSON.stringify(rl3('tim_so').permissions) === JSON.stringify(['pesanan', 'pesanan.packing', 'pesanan.edit', 'pesanan.final', 'pesanan.invoice', 'cek']), JSON.stringify(rl3('tim_so').permissions));

  srv.kill();
  console.log(`\nHASIL: ${ok} lulus, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
