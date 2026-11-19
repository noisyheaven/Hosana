// Tes 3 lokasi stok (Display Toko, Gudang Toko, Gudang Ruko) + role Sales Admin / Admin Gudang. Jalankan: node tests/lokasi.test.js
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
let ok = 0, fail = 0;
const chk = (n, c, x = '') => { c ? ok++ : fail++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${c ? '' : ' -> ' + String(x).slice(0, 300)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toko-loc-'));
const PORT = 3199, B = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, DATA_DIR: dir, PORT, HTTPS: '0' }, stdio: 'ignore' });
const k = async (m, p, body, token) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); let d = null; try { d = await r.json(); } catch {} return { s: r.status, d }; };
(async () => {
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/api/ping'); break; } catch { await sleep(200); } }
  const tk = async (u, p) => (await k('POST', '/api/login', { username: u, password: p })).d.token;
  const S = await tk('superadmin', 'super123'), SA = await tk('salesadmin', 'sales123'), G = await tk('admingudang', 'gudang123'), F = await tk('staf', 'staf123');
  const prod = async (id) => (await k('GET', '/api/products?limit=100', null, S)).d.find((p) => p.id === id);
  const p = (await k('GET', '/api/products?limit=100', null, S)).d.find((x) => x.gt_qty > 2 && x.gr_qty > 2 && x.display_qty > 2);
  chk('produk punya 3 stok + total', p && ['display_qty', 'gt_qty', 'gr_qty', 'total_qty'].every((f) => typeof p[f] === 'number') && p.total_qty === p.display_qty + p.gt_qty + p.gr_qty);

  // role
  const roles = (await k('GET', '/api/roles', null, S)).d.roles.map((r) => r.key);
  chk('role sales_admin & admin_gudang ada, admin/gudang lama tidak', roles.includes('sales_admin') && roles.includes('admin_gudang') && !roles.includes('admin') && !roles.includes('gudang'), roles);
  const nu = await k('POST', '/api/users', { username: 'sa2', name: 'SA2', password: 'rahasia1', role: 'sales_admin' }, S);
  chk('buat pengguna Sales Admin', nu.s === 200 || nu.s === 201, JSON.stringify(nu.d));

  // koreksi stok: izin per lokasi
  chk('admin gudang TIDAK boleh koreksi Gudang Toko / Gudang Ruko (detail role baru)', (await k('POST', '/api/stock/adjust', { product_id: p.id, location: 'gudang_toko', mode: 'add', qty: 4 }, G)).s === 403 && (await k('POST', '/api/stock/adjust', { product_id: p.id, location: 'gudang_ruko', mode: 'add', qty: 1 }, G)).s === 403);
  chk('pemegang hak koreksi gudang (superadmin) boleh koreksi Gudang Toko', (await k('POST', '/api/stock/adjust', { product_id: p.id, location: 'gudang_toko', mode: 'add', qty: 4 }, S)).s === 200);
  chk('pemegang hak koreksi gudang (superadmin) boleh koreksi Gudang Ruko', (await k('POST', '/api/stock/adjust', { product_id: p.id, location: 'gudang_ruko', mode: 'add', qty: 1 }, S)).s === 200);
  chk('admin gudang TIDAK boleh koreksi Display Toko', (await k('POST', '/api/stock/adjust', { product_id: p.id, location: 'display', mode: 'add', qty: 1 }, G)).s === 403);
  chk('sales admin TIDAK boleh koreksi stok gudang', (await k('POST', '/api/stock/adjust', { product_id: p.id, location: 'gudang_toko', mode: 'add', qty: 1 }, SA)).s === 403);
  chk('lokasi lama "store" ditolak', (await k('POST', '/api/stock/adjust', { product_id: p.id, location: 'store', mode: 'add', qty: 1 }, S)).s === 400);

  // transfer antar lokasi
  let b = await prod(p.id);
  const t1 = await k('POST', '/api/transfers', { from: 'gudang_toko', to: 'display', items: [{ product_id: p.id, qty: 2 }] }, S);
  let a = await prod(p.id);
  chk('transfer Gudang Toko -> Display', t1.s === 200 && a.gt_qty === b.gt_qty - 2 && a.display_qty === b.display_qty + 2 && a.gr_qty === b.gr_qty, JSON.stringify(t1.d));
  b = a;
  const t2 = await k('POST', '/api/transfers', { from: 'gudang_ruko', to: 'gudang_toko', items: [{ product_id: p.id, qty: 1 }] }, S);
  a = await prod(p.id);
  chk('transfer Gudang Ruko -> Gudang Toko', t2.s === 200 && a.gr_qty === b.gr_qty - 1 && a.gt_qty === b.gt_qty + 1, JSON.stringify(t2.d));
  chk('transfer asal = tujuan ditolak', (await k('POST', '/api/transfers', { from: 'display', to: 'display', items: [{ product_id: p.id, qty: 1 }] }, S)).s === 400);
  chk('transfer melebihi stok asal ditolak', (await k('POST', '/api/transfers', { from: 'display', to: 'gudang_toko', items: [{ product_id: p.id, qty: 99999 }] }, S)).s === 400);
  chk('transfer: riwayat memuat lokasi', (await k('GET', '/api/transfers', null, S)).d[0].from_location === 'gudang_ruko');
  chk('admin gudang tak boleh transfer / melihat riwayat transfer', (await k('GET', '/api/transfers', null, G)).s === 403);
  chk('sales admin tak boleh transfer', (await k('POST', '/api/transfers', { items: [{ product_id: p.id, qty: 1 }] }, SA)).s === 403);

  // permintaan Gudang Toko -> Display
  b = await prod(p.id);
  const rq = await k('POST', '/api/requests', { from_location: 'gudang_toko', to_location: 'display', items: [{ product_id: p.id, qty: 3 }] }, F);
  chk('staf membuat permintaan dari Gudang Toko', rq.s === 200 && rq.d.from_location === 'gudang_toko' && rq.d.items[0].src_qty === b.gt_qty, JSON.stringify(rq.d));
  chk('permintaan tujuan Gudang Ruko ditolak', (await k('POST', '/api/requests', { from_location: 'gudang_toko', to_location: 'gudang_ruko', items: [{ product_id: p.id, qty: 1 }] }, F)).s === 400);
  chk('permintaan asal Display ditolak', (await k('POST', '/api/requests', { from_location: 'display', to_location: 'gudang_toko', items: [{ product_id: p.id, qty: 1 }] }, F)).s === 400);
  const sh = await k('POST', `/api/requests/${rq.d.id}/ship`, { items: [{ item_id: rq.d.items[0].id, qty: 3 }] }, G);
  a = await prod(p.id);
  chk('kirim memotong Gudang Toko, Display belum berubah', sh.s === 200 && a.gt_qty === b.gt_qty - 3 && a.display_qty === b.display_qty, JSON.stringify(sh.d));
  const rc = await k('POST', `/api/requests/${rq.d.id}/receive`, { items: [{ item_id: rq.d.items[0].id, qty: 3 }] }, F);
  a = await prod(p.id);
  chk('terima menambah Display Toko', rc.s === 200 && a.display_qty === b.display_qty + 3, JSON.stringify(rc.d));

  // PO -> Gudang Toko
  const po = (await k('POST', '/api/po', { supplier_id: null, items: [{ product_id: p.id, qty: 5, cost: 1000 }] }, S)).d;
  await k('POST', `/api/po/${po.id}/status`, { status: 'submitted' }, S); await k('POST', `/api/po/${po.id}/status`, { status: 'approved' }, S);
  b = await prod(p.id);
  const rv = await k('POST', `/api/po/${po.id}/receive`, { location: 'gudang_toko', items: [{ item_id: po.items[0].id, qty: 5 }] }, G);
  a = await prod(p.id);
  chk('terima PO ke Gudang Toko', rv.s === 200 && a.gt_qty === b.gt_qty + 5 && a.gr_qty === b.gr_qty, JSON.stringify(rv.d));

  // SO: ambil dari Gudang Ruko lalu batal -> kembali ke Gudang Ruko
  b = await prod(p.id);
  const so = await k('POST', '/api/orders', { customer_name: 'Budi', phone: '081200000009', source: 'wa', source_location: 'gudang_ruko', items: [{ product_id: p.id, qty: 2 }] }, SA);
  a = await prod(p.id);
  chk('SO dari Gudang Ruko memotong Gudang Ruko', so.s === 200 && a.gr_qty === b.gr_qty - 2 && a.display_qty === b.display_qty, JSON.stringify(so.d));
  const cn = await k('POST', `/api/orders/${so.d.id}/status`, { status: 'batal' }, SA);
  a = await prod(p.id);
  chk('batal SO mengembalikan ke Gudang Ruko', cn.s === 200 && a.gr_qty === b.gr_qty && a.display_qty === b.display_qty, JSON.stringify(cn.d));
  chk('SO lokasi tidak valid ditolak', (await k('POST', '/api/orders', { customer_name: 'X', phone: '081200000009', source_location: 'store', items: [{ product_id: p.id, qty: 1 }] }, SA)).s === 400);

  // barang baru dengan stok awal 3 lokasi, laporan stok
  const np = await k('POST', '/api/products', { name: 'Tes 3 Lokasi', price: 1000, cost: 500, display_qty: 1, gt_qty: 2, gr_qty: 3 }, S);
  const npp = await prod(np.d.id);
  chk('stok awal 3 lokasi', npp && npp.display_qty === 1 && npp.gt_qty === 2 && npp.gr_qty === 3);
  const rep = (await k('GET', '/api/reports/stock', null, S)).d;
  chk('laporan stok 3 lokasi', rep.totals.gt_qty >= 2 && 'gr_value' in rep.totals && 'display_value' in rep.rows[0]);
  const dash = (await k('GET', '/api/dashboard', null, S)).d;
  chk('dashboard: nilai stok 3 lokasi', ['display', 'gudang_toko', 'gudang_ruko'].every((x) => x in dash.stock_value) && dash.low.every((x) => 'display_qty' in x));
  console.log(`\nHASIL: ${ok} lulus, ${fail} gagal`); srv.kill(); process.exit(fail ? 1 : 0);
})().catch((e) => { srv.kill(); console.error(e); process.exit(1); });
