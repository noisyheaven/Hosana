// Tes role kustom & hak akses. Jalankan: node tests/roles.test.js
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..');
let ok = 0, fail = 0;
const chk = (n, c, x = '') => { c ? ok++ : fail++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${c ? '' : ' -> ' + String(x).slice(0, 300)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toko-roles-'));
  const PORT = 3197;
  const srv = spawn(process.execPath, [path.join(root, 'server.js')], { env: { ...process.env, DATA_DIR: dir, PORT, HTTPS: '0' }, stdio: 'ignore' });
  const B = `http://127.0.0.1:${PORT}`;
  const k = async (m, p, body, token) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined || body === null ? undefined : JSON.stringify(body) }); let d = null; try { d = await r.json(); } catch (_) {} return { s: r.status, d }; };
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/api/ping'); break; } catch { await sleep(200); } }
  const login = async (u, p) => (await k('POST', '/api/login', { username: u, password: p })).d.token;
  const S = await login('superadmin', 'super123'), A = await login('superadmin', 'super123'), F = await login('staf', 'staf123'), G = await login('admingudang', 'gudang123'), K = await login('kasir', 'kasir123'), SA = await login('salesadmin', 'sales123'), T = await login('timso', 'timso123');
  const st = async (m, p, t, b) => (await k(m, p, b, t)).s;

  // ---- bawaan: hak tiap role mengikuti perilaku lama
  const me = async (t) => (await k('GET', '/api/me', null, t)).d;
  chk('/api/me memuat role_name dan perms', (await me(K)).role_name === 'Kasir' && (await me(K)).perms.includes('kasir'));
  chk('kasir: kasir, penjualan, kas, laporan kas, cek stok, laporan penjualan', JSON.stringify([...(await me(K)).perms].sort()) === JSON.stringify(['kasir', 'penjualan', 'penjualan.retur', 'kas', 'kas.laporan', 'cek', 'laporan.penjualan'].sort()), JSON.stringify((await me(K)).perms));
  chk('kasir DITOLAK: stok, permintaan, po, laporan stok, pesanan, transfer, dashboard', (await Promise.all([['GET', '/api/stock/movements'], ['GET', '/api/requests'], ['GET', '/api/po'], ['GET', '/api/reports/stock'], ['GET', '/api/orders'], ['GET', '/api/transfers'], ['GET', '/api/dashboard']].map(([m, p]) => st(m, p, K)))).every((s) => s === 403));
  chk('kasir BOLEH: laporan penjualan (tanpa laba/HPP), cek stok', (await st('GET', '/api/reports/sales', K)) === 200 && (await k('GET', '/api/reports/sales', null, K)).d.totals.profit === undefined && (await k('GET', '/api/reports/sales', null, K)).d.totals.cogs === undefined && (await st('GET', '/api/products?limit=3', K)) === 200);
  chk('staf: hak = cek stok + permintaan barang + konfirmasi terima', JSON.stringify([...(await me(F)).perms].sort()) === JSON.stringify(['cek', 'permintaan', 'permintaan.buat'].sort()), JSON.stringify((await me(F)).perms));
  chk('staf: permintaan boleh; SO/po/laporan/transfer/stok/penjualan ditolak', (await Promise.all([['GET', '/api/orders'], ['GET', '/api/stock/movements'], ['GET', '/api/sales']].map(([m, p]) => st(m, p, F)))).every((x) => x === 403) && (await st('GET', '/api/requests', F)) === 200 && (await st('GET', '/api/po', F)) === 403 && (await st('GET', '/api/reports/sales', F)) === 403 && (await st('POST', '/api/transfers', F, { items: [] })) === 403);
  chk('gudang: terima barang & permintaan boleh, kasir/pesanan/po ditolak', (await st('GET', '/api/receiving/po', G)) === 200 && (await st('GET', '/api/requests', G)) === 200 && (await st('GET', '/api/orders', G)) === 403 && (await st('GET', '/api/po', G)) === 403 && (await st('POST', '/api/sales', G, { items: [] })) === 403);
  chk('gudang tidak melihat harga beli, admin melihat', (await k('GET', '/api/products?limit=3', null, G)).d.every((p) => p.cost === undefined) && (await k('GET', '/api/products?limit=3', null, A)).d.every((p) => p.cost !== undefined));
  // manajemen: Data Pelanggan & Laporan Kas
  const KA = await st('GET', '/api/customers', K), KP = await st('POST', '/api/customers', K, { name: 'Coba Kasir' }), SAP = await st('POST', '/api/customers', SA, { name: 'Pelanggan Tes Role', phone: '0899000111' });
  chk('kasir boleh memilih (GET) pelanggan, tidak boleh mengelola', KA === 200 && KP === 403);
  chk('sales admin (hak customer) boleh menambah pelanggan', SAP === 200);
  chk('kasir tidak boleh mengubah / menghapus pelanggan', (await st('PUT', '/api/customers/1', K, { name: 'x' })) === 403 && (await st('DELETE', '/api/customers/1', K)) === 403);
  {
    const mk = await k('POST', '/api/roles', { name: 'Manajer Kas', permissions: ['kas.laporan'] }, S);
    chk('hak Laporan Kas berdiri sendiri (tidak menarik hak kas input)', mk.s === 200 && JSON.stringify(mk.d.permissions) === '["kas.laporan"]', JSON.stringify(mk.d));
    await k('POST', '/api/users', { username: 'manajerkas', name: 'Manajer Kas', password: 'rahasia1', role: mk.d.key }, S);
    const MK = await login('manajerkas', 'rahasia1');
    chk('laporan kas boleh; input kas, pelanggan, barang, penjualan ditolak', (await st('GET', '/api/reports/cash', MK)) === 200 && (await st('POST', '/api/cash-expenses', MK, { amount: 1000, category: 'lain', description: 'x' })) === 403 && (await st('GET', '/api/customers', MK)) === 403 && (await st('GET', '/api/products', MK)) === 403 && (await st('GET', '/api/sales', MK)) === 403);
  }
  chk('menu manajemen memuat Data Pelanggan & Laporan Kas di katalog hak', (() => { const g = require('../permissions.js').GROUPS.find((x) => x.title === 'Manajemen'); const ks = g.items.map((i) => i.key); return ks.includes('customer') && ks.includes('kas.laporan'); })());
  chk('sales admin: hak = SO + edit nota + finalkan + cetak SI + data pelanggan + cek stok', JSON.stringify([...(await me(SA)).perms].sort()) === JSON.stringify(['pesanan', 'pesanan.edit', 'pesanan.final', 'pesanan.invoice', 'customer', 'cek'].sort()), JSON.stringify((await me(SA)).perms));
  chk('sales admin: SO boleh; penjualan/stok/po/laporan/dashboard/transfer/terima ditolak', (await st('GET', '/api/orders', SA)) === 200 && (await Promise.all([['GET', '/api/sales'], ['GET', '/api/stock/movements'], ['GET', '/api/po'], ['GET', '/api/reports/sales'], ['GET', '/api/dashboard'], ['GET', '/api/transfers'], ['GET', '/api/receiving/po'], ['POST', '/api/orders/1/pack']].map(([m, u]) => st(m, u, SA)))).every((x) => x === 403));
  chk('sales admin tidak melihat harga beli', (await k('GET', '/api/products?limit=3', null, SA)).d.every((p) => p.cost === undefined));
  chk('admin gudang: hak = cek stok + permintaan (proses) + terima barang', JSON.stringify([...(await me(G)).perms].sort()) === JSON.stringify(['cek', 'permintaan', 'permintaan.proses', 'terima'].sort()), JSON.stringify((await me(G)).perms));
  chk('admin gudang: transfer, stok, SO, penjualan ditolak', (await Promise.all([['GET', '/api/transfers'], ['GET', '/api/stock/movements'], ['GET', '/api/orders'], ['GET', '/api/sales']].map(([m, u]) => st(m, u, G)))).every((x) => x === 403));
  const p0 = (await k('GET', '/api/products?limit=50', null, A)).d.find((x) => x.display_qty > 3 && x.gr_qty > 3);
  chk('admin gudang tidak boleh koreksi stok (display maupun gudang)', (await st('POST', '/api/stock/adjust', G, { product_id: p0.id, location: 'display', mode: 'set', qty: 9 })) === 403 && (await st('POST', '/api/stock/adjust', G, { product_id: p0.id, location: 'gudang_ruko', mode: 'set', qty: p0.gr_qty })) === 403);

  chk('tim_so: role_name "Tim SO", hak = cek + pesanan + packing + edit nota + finalkan + cetak SI', (await me(T)).role === 'tim_so' && (await me(T)).role_name === 'Tim SO' && JSON.stringify([...(await me(T)).perms].sort()) === JSON.stringify(['pesanan', 'pesanan.packing', 'pesanan.edit', 'pesanan.final', 'pesanan.invoice', 'cek'].sort()), JSON.stringify(await me(T)));
  chk('tim_so: Sales Order (orders) & cek stok boleh', (await st('GET', '/api/orders', T)) === 200 && (await st('GET', '/api/products?limit=3', T)) === 200);
  chk('tim_so DITOLAK: kasir, po, laporan, permintaan, transfer, pengguna, role', (await Promise.all([['POST', '/api/sales'], ['GET', '/api/po'], ['GET', '/api/reports/sales'], ['GET', '/api/requests'], ['GET', '/api/transfers'], ['GET', '/api/users'], ['GET', '/api/roles']].map(([m, p]) => st(m, p, T, m === 'POST' ? { items: [] } : undefined)))).every((s) => s === 403));
  chk('tim_so tidak melihat harga beli', (await k('GET', '/api/products?limit=3', null, T)).d.every((p) => p.cost === undefined));

  // ---- hanya superadmin yang mengelola role
  chk('hanya superadmin boleh /api/roles', (await Promise.all([SA, F, G, K].map((t) => st('GET', '/api/roles', t)))).every((s) => s === 403) && (await st('GET', '/api/roles', S)) === 200);
  const list = (await k('GET', '/api/roles', null, S)).d;
  chk('daftar role: 6 bawaan (termasuk Tim SO) + katalog hak', list.roles.filter((r) => r.builtin).length === 6 && list.catalog.length >= 4 && list.roles[0].key === 'superadmin' && list.roles[0].locked);
  chk('role superadmin tidak bisa diubah / dihapus', (await st('PUT', '/api/roles/superadmin', S, { permissions: ['kasir'] })) === 400 && (await st('DELETE', '/api/roles/superadmin', S)) === 400);
  chk('role bawaan tidak bisa dihapus', (await st('DELETE', '/api/roles/kasir', S)) === 400);

  // ---- role kustom: kasir yang sedang onboarding
  const c = await k('POST', '/api/roles', { name: 'Kasir Onboarding', description: 'Karyawan baru', permissions: ['kasir', 'tidak_ada'] }, S);
  chk('buat role kustom (kunci tak dikenal dibuang)', c.s === 200 && c.d.key === 'kasir_onboarding' && JSON.stringify(c.d.permissions) === '["kasir"]' && !c.d.builtin, JSON.stringify(c.d));
  chk('nama "superadmin" dicadangkan (409)', (await st('POST', '/api/roles', S, { name: 'superadmin' })) === 409);
  chk('nama role kembar ditolak (409)', (await st('POST', '/api/roles', S, { name: 'Kasir Onboarding' })) === 409);
  const nu = await k('POST', '/api/users', { username: 'magang1', name: 'Magang Satu', password: 'rahasia1', role: 'kasir_onboarding' }, S);
  chk('buat pengguna dengan role kustom', nu.s === 200, JSON.stringify(nu.d));
  chk('role yang tidak ada ditolak', (await st('POST', '/api/users', S, { username: 'x1x', name: 'X', password: 'rahasia1', role: 'dewa' })) === 400);
  const M = await login('magang1', 'rahasia1');
  const mm = await me(M);
  chk('pengguna role kustom: perms hanya kasir', mm.role === 'kasir_onboarding' && mm.role_name === 'Kasir Onboarding' && JSON.stringify(mm.perms) === '["kasir"]', JSON.stringify(mm));
  const prods = (await k('GET', '/api/products?limit=50', null, M)).d;
  chk('role kustom bisa melihat barang untuk berjualan tanpa harga beli', prods.length > 0 && prods.every((p) => p.cost === undefined));
  const pr = prods.find((x) => x.display_qty > 2);
  chk('role kustom bisa menjual', (await st('POST', '/api/sales', M, { items: [{ product_id: pr.id, qty: 1 }], payment_method: 'tunai', paid: pr.price })) === 200);
  chk('role kustom TIDAK bisa riwayat penjualan, stok, po, pengguna, role', (await Promise.all([['GET', '/api/sales'], ['GET', '/api/stock/movements'], ['GET', '/api/po'], ['GET', '/api/users'], ['GET', '/api/roles'], ['GET', '/api/orders'], ['GET', '/api/reports/sales']].map(([m, p]) => st(m, p, M)))).every((s) => s === 403));

  // ---- perubahan hak langsung berlaku (token sama)
  const up = await k('PUT', '/api/roles/kasir_onboarding', { permissions: ['penjualan.void'] }, S);
  chk('hak anak otomatis menambah hak induk', JSON.stringify(up.d.permissions) === '["penjualan","penjualan.void"]', JSON.stringify(up.d));
  const up2 = await k('PUT', '/api/roles/kasir_onboarding', { permissions: ['kasir', 'penjualan'] }, S);
  chk('ubah hak role disimpan', up2.s === 200 && up2.d.permissions.length === 2);
  chk('hak baru langsung berlaku tanpa login ulang', (await st('GET', '/api/sales', M)) === 200 && (await st('POST', '/api/sales/1/void', M, { reason: 'x' })) === 403);
  const rows = (await k('GET', '/api/sales', null, M)).d;
  chk('tanpa hak "lihat semua": hanya transaksi sendiri', rows.length >= 1 && rows.every((r) => r.cashier === 'Magang Satu'));
  chk('perubahan hak ikut tercatat di /api/me', JSON.stringify((await me(M)).perms) === '["kasir","penjualan"]');

  // ---- hapus role
  chk('role yang masih dipakai tidak bisa dihapus (409)', (await st('DELETE', '/api/roles/kasir_onboarding', S)) === 409);
  const uid = (await k('GET', '/api/users', null, S)).d.find((u) => u.username === 'magang1').id;
  chk('pindahkan pengguna ke role lain', (await st('PUT', '/api/users/' + uid, S, { role: 'kasir' })) === 200);
  chk('role kosong bisa dihapus', (await st('DELETE', '/api/roles/kasir_onboarding', S)) === 200);
  const M2 = await login('magang1', 'rahasia1');
  chk('pengguna pindah role: hak ikut role baru', (await me(M2)).role === 'kasir');

  // ---- role tanpa hak sama sekali
  const z = await k('POST', '/api/roles', { name: 'Kosong' }, S);
  chk('role tanpa hak boleh dibuat', z.s === 200 && z.d.permissions.length === 0);
  await k('POST', '/api/users', { username: 'kosong1', name: 'Kosong', password: 'rahasia1', role: 'kosong' }, S);
  const Z = await login('kosong1', 'rahasia1');
  chk('role kosong: login bisa, semua menu/data sensitif ditolak', (await me(Z)).perms.length === 0 && (await st('GET', '/api/orders', Z)) === 403 && (await st('POST', '/api/sales', Z, { items: [] })) === 403 && (await st('GET', '/api/requests', Z)) === 403);

  // ---- ubah & reset role bawaan
  await k('PUT', '/api/roles/staf', { permissions: ['cek'] }, S);
  chk('hak role bawaan bisa dikurangi (staf tak lagi boleh permintaan)', (await st('GET', '/api/requests', F)) === 403 && (await st('GET', '/api/products', F)) === 200);
  const rs = await k('POST', '/api/roles/staf/reset', null, S);
  chk('reset role bawaan ke awal', rs.s === 200 && rs.d.permissions.includes('permintaan.buat') && (await st('GET', '/api/requests', F)) === 200);
  chk('role kustom tak bisa di-reset', (await st('POST', '/api/roles/kosong/reset', S)) === 400);

  // ---- restart server: perubahan hak tidak ditimpa seed
  await k('PUT', '/api/roles/admin_gudang', { permissions: ['cek', 'terima'] }, S);
  srv.kill(); await sleep(500);
  const srv2 = spawn(process.execPath, [path.join(root, 'server.js')], { env: { ...process.env, DATA_DIR: dir, PORT, HTTPS: '0' }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/api/ping'); break; } catch { await sleep(200); } }
  const S2 = await login('superadmin', 'super123');
  const g = (await k('GET', '/api/roles', null, S2)).d.roles.find((r) => r.key === 'admin_gudang');
  chk('setelah restart hak role tidak kembali ke bawaan', JSON.stringify(g.permissions) === '["cek","terima"]', JSON.stringify(g.permissions));
  srv2.kill();
  console.log(`\nHASIL: ${ok} lulus, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
