// Tes peran Kasir (hanya jual-beli) + dashboard khusus superadmin + migrasi. Jalankan: node tests/kasir.test.js
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
  const k = async (m, p, body, token) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); let d = null; try { d = await r.json(); } catch {} return { s: r.status, d }; };
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/api/ping'); break; } catch { await sleep(200); } }
  return { srv, k };
}
(async () => {
  // 1. database lama yang hanya mengenal 3 peran (atau 4 dengan gudang) bisa menerima peran kasir setelah migrasi
  const old = fs.mkdtempSync(path.join(os.tmpdir(), 'toko-ks-'));
  { const d = new DatabaseSync(path.join(old, 'toko.db'));
    d.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('superadmin','admin','gudang','staf')), active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime'))); INSERT INTO users(username,name,password_hash,role) VALUES('lama','Lama','x','gudang');`); d.close(); }
  const o = await boot(old, 3195); await sleep(300); o.srv.kill(); await sleep(300);
  { const d = new DatabaseSync(path.join(old, 'toko.db'));
    chk('migrasi: pengguna lama (peran gudang) tetap ada', d.prepare("SELECT role FROM users WHERE username='lama'").get()?.role === 'gudang');
    chk('migrasi: peran kasir kini diterima database', (() => { try { d.prepare("INSERT INTO users(username,name,password_hash,role) VALUES('k0','K','x','kasir')").run(); return true; } catch { return false; } })()); d.close(); }

  // 2. hak akses
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toko-ks2-'));
  const { srv, k } = await boot(dir, 3199);
  const tk = async (u, p) => (await k('POST', '/api/login', { username: u, password: p })).d.token;
  const S = await tk('superadmin', 'super123'), A = await tk('superadmin', 'super123'), F = await tk('staf', 'staf123'), G = await tk('admingudang', 'gudang123'), K = await tk('kasir', 'kasir123'), SA = await tk('salesadmin', 'sales123');
  chk('akun demo kasir bisa login', !!K);
  chk('dashboard: superadmin boleh', (await k('GET', '/api/dashboard', null, S)).s === 200);
  chk('dashboard: sales admin, staf, kasir, admin gudang DITOLAK', (await Promise.all([SA, F, K, G].map((t) => k('GET', '/api/dashboard', null, t)))).every((r) => r.s === 403));
  const prods = (await k('GET', '/api/products?limit=50', null, K)).d;
  chk('kasir melihat barang (untuk berjualan) tanpa harga beli', prods.length > 0 && prods.every((p) => p.cost === undefined));
  const p = prods.find((x) => x.display_qty > 2);
  const sale = await k('POST', '/api/sales', { items: [{ product_id: p.id, qty: 1 }], payment_method: 'tunai', paid: p.price }, K);
  chk('kasir bisa membuat penjualan', sale.s === 200 && (sale.d.invoice_no || sale.d.id), JSON.stringify(sale.d));
  const sid = sale.d.id;
  const other = await k('POST', '/api/sales', { items: [{ product_id: p.id, qty: 1 }], payment_method: 'tunai', paid: p.price }, A);
  const mine = (await k('GET', '/api/sales', null, K)).d;
  chk('kasir hanya melihat transaksinya sendiri', mine.length === 1 && mine[0].id === sid, JSON.stringify(mine.map((m) => m.id)));
  chk('kasir bisa membuka struk miliknya', (await k('GET', '/api/sales/' + sid, null, K)).s === 200);
  chk('kasir DITOLAK membuka transaksi orang lain', (await k('GET', '/api/sales/' + other.d.id, null, K)).s === 403);
  chk('kasir tak bisa filter tanggal lama (tetap 3 hari)', (await k('GET', '/api/sales?from=2000-01-01', null, K)).d.length === 1);
  chk('admin melihat semua transaksi', (await k('GET', '/api/sales', null, A)).d.length === 2);
  chk('staf toko DITOLAK berjualan & melihat riwayat penjualan', (await k('POST', '/api/sales', { items: [{ product_id: p.id, qty: 1 }], payment_method: 'tunai', paid: p.price }, F)).s === 403 && (await k('GET', '/api/sales', null, F)).s === 403);
  chk('staf toko tetap bisa cek stok & detail barang', (await k('GET', '/api/products?limit=5', null, F)).d.length > 0 && (await k('GET', '/api/products/barcode/RH-0001', null, F)).d.name);
  for (const [m, u, b] of [['GET', '/api/orders'], ['POST', '/api/orders', { items: [] }], ['POST', `/api/sales/${sid}/void`, {}], ['GET', '/api/po'], ['GET', '/api/suppliers'], ['GET', '/api/reports/stock'], ['GET', '/api/users'], ['POST', '/api/transfers', { items: [{ product_id: p.id, qty: 1 }] }], ['POST', '/api/stock/adjust', { product_id: p.id, location: 'display', mode: 'add', qty: 1 }], ['POST', '/api/requests', { items: [{ product_id: p.id, qty: 1 }] }], ['GET', '/api/receiving/po'], ['POST', '/api/products', { name: 'x', price: 1 }]]) {
    const r = await k(m, u, b, K); chk(`kasir ditolak ${m} ${u}`, r.s === 403, r.s);
  }
  chk('gudang masih tidak bisa berjualan', (await k('POST', '/api/sales', { items: [{ product_id: p.id, qty: 1 }], payment_method: 'tunai', paid: p.price }, G)).s === 403);
  chk('superadmin bisa membuat pengguna peran kasir', (await k('POST', '/api/users', { username: 'kasir2', name: 'Kasir 2', password: 'rahasia1', role: 'kasir' }, S)).s === 200);
  srv.kill();
  console.log(`\nHASIL: ${ok} lulus, ${fail} gagal`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
