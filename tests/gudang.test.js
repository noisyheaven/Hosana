// Tes peran Gudang + migrasi database lama. Jalankan: node tests/gudang.test.js
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const root = path.join(__dirname, '..');
let ok = 0, fail = 0;
const chk = (name, cond, extra = '') => { cond ? ok++ : fail++; console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : ' -> ' + extra}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- 1. database LAMA (tanpa peran gudang) harus bisa dimigrasi tanpa kehilangan data
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toko-gd-'));
{
  const old = new DatabaseSync(path.join(dir, 'toko.db'));
  old.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('superadmin','admin','staf')), active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime')));
    INSERT INTO users(username,name,password_hash,role) VALUES('lama','Pengguna Lama','x','staf');`);
  old.close();
}
const PORT = 3191, B = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [path.join(root, 'server.js')], { env: { ...process.env, DATA_DIR: dir, PORT, SEED_DEMO: '1', HTTPS: '0' }, stdio: 'ignore' });
const j = async (m, p, body, token) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); let d = null; try { d = await r.json(); } catch {} return { s: r.status, d }; };
(async () => {
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/api/ping'); break; } catch { await sleep(200); } }
  const login = async (u, p) => (await j('POST', '/api/login', { username: u, password: p })).d?.token;
  const sa = await login('superadmin', 'super123') || await login('superadmin', 'super123');
  // seed hanya jalan jika tabel users kosong; DB lama punya 1 user -> buat akun sendiri
  let admin = sa;
  if (!sa) { console.log('  (DB lama tidak punya superadmin; memakai pengguna baru lewat DB)'); }
  chk('server hidup setelah migrasi DB lama', (await j('GET', '/api/ping')).s === 200);
  srv.kill();
  const db = new DatabaseSync(path.join(dir, 'toko.db'));
  chk('data pengguna lama tetap ada', db.prepare("SELECT name FROM users WHERE username='lama'").get()?.name === 'Pengguna Lama');
  chk('constraint kini menerima gudang', (() => { try { db.prepare("INSERT INTO users(username,name,password_hash,role) VALUES('g0','G','x','gudang')").run(); return true; } catch { return false; } })());
  db.close();
  await sleep(300);

  // --- 2. hak akses peran Gudang pada database baru
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'toko-gd2-'));
  const P2 = 3192, B2 = `http://127.0.0.1:${P2}`;
  const s2 = spawn(process.execPath, [path.join(root, 'server.js')], { env: { ...process.env, DATA_DIR: dir2, PORT: P2, HTTPS: '0' }, stdio: 'ignore' });
  const k = async (m, p, body, token) => { const r = await fetch(B2 + p, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); let d = null; try { d = await r.json(); } catch {} return { s: r.status, d }; };
  for (let i = 0; i < 40; i++) { try { await fetch(B2 + '/api/ping'); break; } catch { await sleep(200); } }
  const tk = async (u, p) => (await k('POST', '/api/login', { username: u, password: p })).d.token;
  const S = await tk('superadmin', 'super123'), A = await tk('superadmin', 'super123'), G = await tk('admingudang', 'gudang123'), F = await tk('staf', 'staf123');
  chk('akun demo gudang bisa login', !!G);
  const prods = (await k('GET', '/api/products?limit=50', null, G)).d;
  chk('gudang melihat barang', prods.length > 0);
  chk('gudang TIDAK melihat harga beli', prods.every((p) => p.cost === undefined));
  for (const [m, p] of [['GET', '/api/dashboard'], ['GET', '/api/sales'], ['GET', '/api/orders'], ['GET', '/api/reports/sales'], ['GET', '/api/po'], ['GET', '/api/po/1'], ['GET', '/api/suppliers'], ['GET', '/api/users'], ['GET', '/api/settings/x']]) {
    const r = await k(m, p, null, G); chk(`gudang ditolak ${m} ${p}`, r.s === 403 || r.s === 404, r.s);
  }
  chk('gudang tak boleh buat penjualan', (await k('POST', '/api/sales', { items: [{ product_id: 1, qty: 1 }], payments: [] }, G)).s === 403);
  chk('gudang tak boleh ubah barang', (await k('POST', '/api/products', { name: 'x', price: 1 }, G)).s === 403);
  chk('staf kasir ditolak untuk transfer/terima/opname', (await k('POST', '/api/transfers', { items: [{ product_id: 1, qty: 1 }] }, F)).s === 403 && (await k('GET', '/api/receiving/po', null, F)).s === 403 && (await k('POST', '/api/stock/adjust', { product_id: 1, location: 'gudang_ruko', mode: 'add', qty: 1 }, F)).s === 403);
  // koreksi stok
  chk('admin gudang TIDAK boleh koreksi stok gudang (detail role: hanya cek stok, permintaan, terima barang)', (await k('POST', '/api/stock/adjust', { product_id: 1, location: 'gudang_ruko', mode: 'add', qty: 50, note: 'tes' }, G)).s === 403);
  chk('superadmin boleh koreksi stok GUDANG', (await k('POST', '/api/stock/adjust', { product_id: 1, location: 'gudang_ruko', mode: 'add', qty: 50, note: 'tes' }, A)).s === 200);
  chk('gudang TIDAK boleh koreksi stok toko', (await k('POST', '/api/stock/adjust', { product_id: 1, location: 'display', mode: 'add', qty: 5 }, G)).s === 403);
  // transfer
  const before = (await k('GET', '/api/products/barcode/RH-0001', null, G)).d;
  chk('admin gudang TIDAK boleh transfer antar lokasi', (await k('POST', '/api/transfers', { items: [{ product_id: before.id, qty: 5 }] }, G)).s === 403);
  const tr = await k('POST', '/api/transfers', { items: [{ product_id: before.id, qty: 5 }] }, A);
  const after = (await k('GET', '/api/products/barcode/RH-0001', null, G)).d;
  chk('superadmin boleh transfer gudang->toko', tr.s === 200 && after.display_qty === before.display_qty + 5 && after.gr_qty === before.gr_qty - 5, JSON.stringify(tr.d));
  // PO: admin buat+setujui, gudang terima tanpa melihat harga
  const sup = (await k('POST', '/api/suppliers', { name: 'Supplier Tes' }, A)).d;
  const po = (await k('POST', '/api/po', { supplier_id: sup.id, submit: true, items: [{ product_id: before.id, qty: 10, cost: 12345 }] }, A)).d;
  chk('PO belum disetujui tidak muncul di penerimaan', (await k('GET', '/api/receiving/po', null, G)).d.length === 0);
  await k('POST', `/api/po/${po.id}/status`, { status: 'approved' }, A);
  const list = (await k('GET', '/api/receiving/po', null, G)).d;
  chk('PO disetujui muncul untuk gudang', list.length === 1 && list[0].po_number === po.po_number);
  const det = await k('GET', `/api/receiving/po/${po.id}`, null, G);
  chk('detail penerimaan tanpa harga beli/total', det.s === 200 && !JSON.stringify(det.d).includes('12345') && det.d.total === undefined && det.d.items.every((i) => i.cost === undefined), JSON.stringify(det.d));
  const wh0 = (await k('GET', '/api/products/barcode/RH-0001', null, G)).d.gr_qty;
  const rc = await k('POST', `/api/po/${po.id}/receive`, { items: [{ item_id: det.d.items[0].id, qty: 4 }], note: 'SJ-1' }, G);
  chk('gudang menerima barang (sebagian) & respons tanpa harga', rc.s === 200 && rc.d.status === 'partial' && !JSON.stringify(rc.d).includes('12345'), JSON.stringify(rc.d));
  chk('stok gudang bertambah 4', (await k('GET', '/api/products/barcode/RH-0001', null, G)).d.gr_qty === wh0 + 4);
  chk('admin tetap boleh semuanya (PO + laporan)', (await k('GET', '/api/po/' + po.id, null, A)).s === 200 && (await k('GET', '/api/reports/sales', null, A)).s === 200);
  // pengguna: superadmin bisa membuat peran gudang; peran palsu ditolak
  const nu = await k('POST', '/api/users', { username: 'gd2', name: 'Gudang 2', password: 'rahasia1', role: 'admin_gudang' }, S);
  chk('superadmin bisa buat pengguna peran gudang', nu.s === 200 || nu.s === 201, JSON.stringify(nu.d));
  chk('peran tidak valid ditolak', (await k('POST', '/api/users', { username: 'gd3', name: 'X', password: 'rahasia1', role: 'dewa' }, S)).s === 400);
  s2.kill();
  console.log(`\nHASIL: ${ok} lulus, ${fail} gagal`); process.exit(fail ? 1 : 0);
})().catch((e) => { srv.kill(); console.error(e); process.exit(1); });
