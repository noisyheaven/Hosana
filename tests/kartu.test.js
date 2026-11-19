// Tes Kartu Stok (riwayat keluar-masuk per barang). Jalankan: node tests/kartu.test.js
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
let ok = 0, fail = 0;
const chk = (n, c, x = '') => { c ? ok++ : fail++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${c ? '' : ' -> ' + String(x).slice(0, 400)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toko-kartu-'));
const PORT = 3203, B = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, DATA_DIR: dir, PORT, HTTPS: '0' }, stdio: 'ignore' });
const k = async (m, p, body, token) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text(); let d = null; try { d = JSON.parse(txt); } catch { d = txt; }
  return { s: r.status, d, h: r.headers };
};
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };

(async () => {
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/api/ping'); break; } catch { await sleep(200); } }
  const tk = async (u, p) => (await k('POST', '/api/login', { username: u, password: p })).d.token;
  const S = await tk('superadmin', 'super123'), KS = await tk('kasir', 'kasir123'), F = await tk('staf', 'staf123'), SA = await tk('salesadmin', 'sales123'), G = await tk('admingudang', 'gudang123'), TS = await tk('timso', 'timso123');
  // role kustom: hanya Kartu Stok (+ cek stok), dan role kustom pemegang hak "stok" (lihat stok) saja
  const r1 = await k('POST', '/api/roles', { name: 'Pemeriksa Kartu', permissions: ['stok.kartu'] }, S);
  chk('buat role dengan hak Kartu Stok', r1.s === 200 && r1.d.permissions.includes('stok.kartu') && !r1.d.permissions.includes('stok'), JSON.stringify(r1.d));
  await k('POST', '/api/users', { username: 'kartu1', name: 'Pemeriksa', password: 'rahasia1', role: r1.d.key }, S);
  const r2 = await k('POST', '/api/roles', { name: 'Lihat Stok', permissions: ['stok'] }, S);
  await k('POST', '/api/users', { username: 'lihat1', name: 'Lihat', password: 'rahasia1', role: r2.d.key }, S);
  const T = await tk('kartu1', 'rahasia1'), V = await tk('lihat1', 'rahasia1');
  const prods = (await k('GET', '/api/products?limit=200', null, S)).d;
  const p = prods.find((x) => x.display_qty > 6 && x.gt_qty > 2);
  const get = (qs, t = S) => k('GET', '/api/stock/card?product_id=' + p.id + qs, null, t);
  const today = day(0);

  // ---- hak akses: butuh hak "stok" (Tim SO punya; kasir, staf, sales admin, admin gudang tidak)
  chk('pemegang hak Kartu Stok boleh, walau TANPA hak Stok per Lokasi', (await get('', T)).s === 200 && (await k('GET', '/api/stock/movements', null, T)).s === 403);
  chk('pemegang hak Stok (lihat) juga boleh membuka kartu stok', (await get('', V)).s === 200);
  chk('kasir, staf, sales admin, admin gudang, Tim SO (bawaan) DITOLAK', (await Promise.all([KS, F, SA, G, TS].map((t) => get('', t).then((r) => r.s)))).every((s) => s === 403));
  const cat = (await k('GET', '/api/roles', null, S)).d.catalog || (await k('GET', '/api/roles', null, S)).d.groups;
  chk('katalog hak menampilkan Kartu Stok', JSON.stringify(cat).includes('stok.kartu'));
  chk('tanpa login ditolak', (await get('', null)).s === 401);

  // ---- validasi
  chk('barang tidak ada -> 404', (await k('GET', '/api/stock/card?product_id=999999', null, S)).s === 404);
  chk('tanpa product_id -> rekap semua barang (bukan error)', (await k('GET', '/api/stock/card', null, S)).s === 200 && (await k('GET', '/api/stock/card', null, S)).d.mode === 'recap');
  chk('lokasi tidak valid -> 400', (await get('&location=store')).s === 400);
  chk('tanggal terbalik tidak error (otomatis ditukar)', (await get(`&from=${today}&to=${day(-3)}`)).s === 200);

  // ---- buat mutasi: koreksi +5 (display), jual 2, transfer Gudang Toko -> Display 1
  const adj = await k('POST', '/api/stock/adjust', { product_id: p.id, location: 'display', mode: 'add', qty: 5, note: 'tes kartu' }, S);
  chk('koreksi stok +5', adj.s === 200, JSON.stringify(adj.d));
  const sale = await k('POST', '/api/sales', { items: [{ product_id: p.id, qty: 2 }], payment_method: 'tunai', paid: 10000000 }, S);
  chk('penjualan 2 pcs', sale.s === 200 || sale.s === 201, JSON.stringify(sale.d).slice(0, 200));
  const tr = await k('POST', '/api/transfers', { from: 'gudang_toko', to: 'display', items: [{ product_id: p.id, qty: 1 }] }, S);
  chk('transfer Gudang Toko -> Display 1', tr.s === 200, JSON.stringify(tr.d));
  const now = (await k('GET', '/api/products?limit=200', null, S)).d.find((x) => x.id === p.id);

  // ---- kartu semua lokasi
  const all = (await get('&location=all')).d;
  chk('struktur kartu lengkap', all.product.id === p.id && Array.isArray(all.rows) && ['opening', 'total_in', 'total_out', 'closing', 'current'].every((f) => typeof all[f] === 'number') && all.location === 'all');
  chk('penjualan tercatat sebagai KELUAR 2', all.rows.some((r) => r.type === 'sale' && r.out === 2 && r.in === 0 && r.type_label === 'Penjualan' && r.ref === sale.d.invoice_no));
  chk('koreksi tercatat sebagai MASUK 5 dengan catatan', all.rows.some((r) => r.type === 'adjust' && r.in === 5 && r.note === 'tes kartu'));
  chk('transfer: keluar di Gudang Toko dan masuk di Display (semua lokasi)', all.rows.some((r) => r.type === 'transfer_out' && r.location === 'gudang_toko' && r.out === 1) && all.rows.some((r) => r.type === 'transfer_in' && r.location === 'display' && r.in === 1));
  let run = all.opening, runOk = true;
  for (const r of all.rows) { run += r.in - r.out; if (run !== r.balance) runOk = false; }
  chk('saldo berjalan konsisten di setiap baris', runOk && run === all.closing);
  chk('saldo awal + masuk - keluar = saldo akhir', all.opening + all.total_in - all.total_out === all.closing);
  chk('saldo akhir = stok tercatat sekarang (semua lokasi), tidak ada selisih', all.closing === now.total_qty && all.current === now.total_qty && all.mismatch === false, `${all.closing} vs ${now.total_qty}`);

  // ---- filter lokasi
  const dsp = (await get('&location=display')).d;
  chk('lokasi Display: hanya mutasi Display, saldo akhir = stok Display', dsp.rows.every((r) => r.location === 'display') && dsp.closing === now.display_qty && dsp.location_label === 'Display Toko', `${dsp.closing} vs ${now.display_qty}`);
  const gt = (await get('&location=gudang_toko')).d;
  chk('lokasi Gudang Toko: transfer keluar 1, saldo akhir = stok Gudang Toko', gt.rows.some((r) => r.type === 'transfer_out' && r.out === 1) && gt.closing === now.gt_qty);

  // ---- saldo awal: mutasi lama dipindah ke 10 hari lalu
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(dir, 'toko.db'));
  const adjId = db.prepare("SELECT id FROM stock_movements WHERE product_id=? AND type='adjust' ORDER BY id DESC LIMIT 1").get(p.id).id;
  db.prepare("UPDATE stock_movements SET created_at=datetime('now','localtime','-10 days') WHERE product_id=? AND id<=?").run(p.id, adjId);
  db.close();
  const old = (await get(`&location=display&from=${today}&to=${today}`)).d;
  chk('periode hari ini: saldo awal = stok Display sebelum penjualan & transfer hari ini', old.opening === now.display_qty + 2 - 1, `${old.opening} vs ${now.display_qty + 1}`);
  chk('periode hari ini: hanya mutasi hari ini (penjualan keluar 2, transfer masuk 1)', old.rows.length === 2 && old.total_out === 2 && old.total_in === 1 && old.closing === now.display_qty && !old.mismatch, JSON.stringify(old.rows.map((r) => r.type)));
  const future = (await get(`&location=all&from=${day(1)}&to=${day(2)}`)).d;
  chk('periode masa depan: tanpa mutasi, saldo awal = saldo akhir = stok sekarang', future.rows.length === 0 && future.opening === now.total_qty && future.closing === now.total_qty);
  const past = (await get(`&location=all&from=${day(-30)}&to=${day(-20)}`)).d;
  chk('periode sebelum barang punya mutasi: kosong, saldo 0, tanpa peringatan selisih', past.rows.length === 0 && past.opening === 0 && past.closing === 0 && past.mismatch === false);
  const mid = (await get(`&location=all&from=${day(-9)}&to=${day(-1)}`)).d;
  chk('periode 9..1 hari lalu: kosong, saldo awal = saldo akhir (mutasi lama di luar rentang)', mid.rows.length === 0 && mid.opening === mid.closing && mid.opening > 0, JSON.stringify([mid.opening, mid.closing]));

  // ---- rekap semua barang per lokasi (tanpa memilih satu barang)
  const allProducts = (await k('GET', '/api/products?limit=5000', null, S)).d;
  for (const loc of ['display', 'gudang_toko', 'gudang_ruko', 'all']) {
    const rc = (await k('GET', `/api/stock/card?location=${loc}&from=${day(-29)}&to=${today}`, null, S)).d;
    const qk = { display: 'display_qty', gudang_toko: 'gt_qty', gudang_ruko: 'gr_qty', all: 'total_qty' }[loc];
    const okRows = rc.rows.length >= allProducts.length && allProducts.every((a) => { const r = rc.rows.find((x) => x.product_id === a.id); return r && r.current === (a[qk] ?? a.display_qty + a.gt_qty + a.gr_qty); });
    chk(`rekap ${loc}: semua barang tampil langsung & stok sekarang cocok dengan Data Barang`, rc.mode === 'recap' && okRows && rc.mismatch_count === 0, JSON.stringify([rc.rows.length, allProducts.length, rc.mismatch_count]));
    chk(`rekap ${loc}: saldo akhir = awal + masuk - keluar, total dijumlah`, rc.rows.every((r) => r.closing === r.opening + r.in - r.out) && rc.totals.closing === rc.rows.reduce((a, r) => a + r.closing, 0));
  }
  const rcAll = (await k('GET', `/api/stock/card?location=display&from=${day(-29)}&to=${today}`, null, S)).d;
  const sample = rcAll.rows.filter((r) => r.in || r.out).slice(0, 3).concat(rcAll.rows.slice(0, 2));
  let same = sample.length > 0;
  for (const r of sample) { const c = (await k('GET', `/api/stock/card?product_id=${r.product_id}&location=display&from=${day(-29)}&to=${today}`, null, S)).d; same = same && c.opening === r.opening && c.total_in === r.in && c.total_out === r.out && c.closing === r.closing; }
  chk('rekap sama persis dengan kartu stok rinci per barang (saldo awal, masuk, keluar, akhir)', same, JSON.stringify(sample));
  const nm = allProducts[0].name.split(' ')[0];
  const rq = (await k('GET', `/api/stock/card?location=all&q=${encodeURIComponent(nm)}`, null, S)).d;
  chk('rekap: saring nama', rq.rows.length > 0 && rq.rows.every((r) => `${r.name} ${r.sku}`.toLowerCase().includes(nm.toLowerCase())) && rq.rows.length <= allProducts.length);
  const rh = (await k('GET', '/api/stock/card?location=gudang_toko&hide_empty=1', null, S)).d, rn = (await k('GET', '/api/stock/card?location=gudang_toko', null, S)).d;
  chk('rekap: sembunyikan barang tanpa stok & tanpa pergerakan', rh.rows.length <= rn.rows.length && rh.rows.every((r) => r.opening || r.in || r.out || r.current));
  chk('rekap: lokasi tidak valid ditolak', (await k('GET', '/api/stock/card?location=bulan', null, S)).s === 400);
  chk('rekap: kasir (tanpa hak stok) ditolak', (await k('GET', '/api/stock/card?location=display', null, KS)).s === 403);
  const rcsv = await fetch(`${B}/api/stock/card?location=display&format=csv`, { headers: { Authorization: 'Bearer ' + S } }); const rcsvTxt = await rcsv.text();
  chk('rekap: ekspor CSV memuat semua barang', rcsv.status === 200 && /text\/csv/.test(rcsv.headers.get('content-type')) && /rekap-kartu-stok-display/.test(rcsv.headers.get('content-disposition')) && allProducts.every((a) => rcsvTxt.includes(a.name)));

  // ---- CSV
  const csv = await fetch(`${B}/api/stock/card?product_id=${p.id}&location=all&format=csv`, { headers: { Authorization: 'Bearer ' + S } });
  const csvTxt = await csv.text();
  chk('ekspor CSV: unduhan .csv berisi saldo awal, penjualan, dan nama barang', csv.status === 200 && /text\/csv/.test(csv.headers.get('content-type')) && /attachment; filename="kartu-stok-.+\.csv"/.test(csv.headers.get('content-disposition')) && csvTxt.includes('Saldo awal') && csvTxt.includes('Penjualan') && csvTxt.includes(p.name));
  chk('ekspor CSV butuh hak juga (kasir ditolak)', (await fetch(`${B}/api/stock/card?product_id=${p.id}&format=csv`, { headers: { Authorization: 'Bearer ' + KS } })).status === 403);

  // ---- halaman & menu
  const html = await (await fetch(B + '/admin/')).text();
  chk('halaman admin memuat pages-kartu.js', html.includes('pages-kartu.js'));
  chk('berkas pages-kartu.js disajikan', (await fetch(B + '/admin/pages-kartu.js')).status === 200);

  console.log(`\nHASIL: ${ok} lulus, ${fail} gagal`); srv.kill(); process.exit(fail ? 1 : 0);
})().catch((e) => { srv.kill(); console.error(e); process.exit(1); });
