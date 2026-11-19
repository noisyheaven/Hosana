// Tes diskon (Rp + %) dan pajak/PPN di Kasir, termasuk retur & laporan. Jalankan: node tests/diskonpajak.test.js
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..');
const { calcSale, taxConfig } = require('../public/admin/calc.js');
let ok = 0, fail = 0;
const chk = (n, c, x = '') => { c ? ok++ : fail++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${c ? '' : ' -> ' + String(x).slice(0, 300)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const eq = (n, a, b) => chk(`${n} (${a} = ${b})`, a === b, `${a} != ${b}`);

(async () => {
  // ---------- 1. rumus murni ----------
  const off = taxConfig({});
  const ex = taxConfig({ tax_enabled: '1', tax_rate: '11', tax_mode: 'exclusive' });
  const inc = taxConfig({ tax_enabled: '1', tax_rate: '11', tax_mode: 'inclusive' });
  chk('pajak mati secara bawaan', off.enabled === false);
  let c = calcSale(100000, 0, 0, off);
  chk('tanpa diskon & pajak: total = subtotal', c.total === 100000 && c.tax_amount === 0 && c.tax_mode === 'none');
  c = calcSale(100000, 5000, 0, off); eq('diskon Rp 5.000 -> total', c.total, 95000);
  c = calcSale(100000, 0, 10, off); eq('diskon 10% -> total', c.total, 90000);
  c = calcSale(100000, 5000, 10, off); eq('diskon 10% + Rp 5.000 -> total', c.total, 85000);
  chk('rincian diskon persen / rupiah terpisah', c.discount_pct_amount === 10000 && c.discount_rp_amount === 5000);
  c = calcSale(100000, 150000, 0, off); eq('diskon Rp melebihi subtotal dibatasi -> total', c.total, 0);
  c = calcSale(100000, 0, 150, off); eq('diskon % > 100 dibatasi -> total', c.total, 0);
  c = calcSale(100000, 0, 0, ex); chk('PPN 11% ditambahkan', c.tax_amount === 11000 && c.total === 111000 && c.tax_mode === 'exclusive', JSON.stringify(c));
  c = calcSale(100000, 0, 10, ex); chk('PPN dihitung SETELAH diskon (90.000 -> 9.900)', c.tax_amount === 9900 && c.total === 99900, JSON.stringify(c));
  c = calcSale(111000, 0, 0, inc); chk('harga sudah termasuk PPN: total tetap, PPN dipisah (111.000 -> 11.000)', c.total === 111000 && c.tax_amount === 11000 && c.tax_mode === 'inclusive', JSON.stringify(c));
  c = calcSale(33333, 0, 0, ex); eq('pembulatan PPN (33.333 x 11%)', c.tax_amount, Math.round(3666.63));
  c = calcSale(0, 0, 0, ex); chk('keranjang kosong: semua 0', c.total === 0 && c.tax_amount === 0);
  c = calcSale(100000, 'abc', 'xyz', ex); chk('input aneh dianggap 0', c.discount === 0 && c.total === 111000);

  // ---------- 2. server ----------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hosana-dp-'));
  const srv = spawn(process.execPath, [path.join(root, 'server.js')], { env: { ...process.env, DATA_DIR: dir, PORT: 3187, HTTPS: '0' }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:3187';
  const k = async (m, p, body, token) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); let d = null; try { d = await r.json(); } catch {} return { s: r.status, d }; };
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/api/ping'); break; } catch { await sleep(200); } }
  try {
    const login = async (u, p) => (await k('POST', '/api/login', { username: u, password: p })).d.token;
    const S = await login('superadmin', 'super123'), K = await login('kasir', 'kasir123');
    const prods = (await k('GET', '/api/products?limit=100', null, K)).d;
    const p = prods.find((x) => x.display_qty >= 8 && x.price >= 1000) || prods.find((x) => x.display_qty >= 8);
    const price = p.price;
    await k('PUT', '/api/settings', { allow_negative_stock: '1' }, S); // tes membuat banyak transaksi; stok contoh terbatas
    const sell = (extra, qty = 2) => k('POST', '/api/sales', { items: [{ product_id: p.id, qty }], payment_method: 'qris', ...extra }, K);

    // pajak mati: perilaku lama tetap
    let r = await sell({ discount_rp: 500 });
    chk('pajak mati: tidak ada PPN', r.s === 200 && r.d.tax_amount === 0 && r.d.tax_mode === 'none', JSON.stringify(r.d));
    eq('diskon Rp tersimpan', r.d.discount_rp, 500); eq('total = subtotal - diskon', r.d.total, price * 2 - 500);
    r = await sell({ discount: 300 });
    chk('klien lama (field "discount") tetap dianggap diskon rupiah', r.s === 200 && r.d.discount === 300 && r.d.discount_rp === 300 && r.d.total === price * 2 - 300, JSON.stringify(r.d));
    r = await sell({ discount_pct: 10 });
    const pctAmt = Math.round(price * 2 * 10 / 100);
    chk('diskon 10% dihitung dari subtotal', r.s === 200 && r.d.discount === pctAmt && r.d.discount_pct === 10 && r.d.total === price * 2 - pctAmt, JSON.stringify(r.d));
    r = await sell({ discount_pct: 10, discount_rp: 700 });
    chk('diskon % + Rp digabung', r.s === 200 && r.d.discount === pctAmt + 700 && r.d.total === price * 2 - pctAmt - 700, JSON.stringify(r.d));
    r = await sell({ discount_pct: 101 }); chk('diskon > 100% ditolak', r.s === 400, r.s);
    r = await sell({ discount_pct: -5 }); chk('diskon % negatif ditolak', r.s === 400, r.s);
    r = await sell({ discount_rp: price * 100 }); chk('diskon Rp melebihi subtotal dibatasi (total 0)', r.s === 200 && r.d.total === 0 && r.d.discount === price * 2, JSON.stringify(r.d));

    // pengaturan pajak: hanya superadmin, divalidasi
    chk('kasir tidak boleh mengubah pengaturan pajak', (await k('PUT', '/api/settings', { tax_enabled: '1' }, K)).s === 403);
    chk('tarif pajak > 100 ditolak', (await k('PUT', '/api/settings', { tax_rate: '150' }, S)).s === 400);
    chk('mode pajak asal-asalan ditolak', (await k('PUT', '/api/settings', { tax_mode: 'ngawur' }, S)).s === 400);

    // PPN 11% ditambahkan (exclusive)
    r = await k('PUT', '/api/settings', { tax_enabled: '1', tax_rate: '11', tax_mode: 'exclusive', tax_name: 'PPN' }, S);
    chk('superadmin mengaktifkan PPN 11%', r.s === 200 && r.d.tax_enabled === '1' && r.d.tax_rate === '11', JSON.stringify(r.d));
    const sub = price * 2, base = sub - pctAmt, tax = Math.round(base * 0.11);
    r = await sell({ discount_pct: 10 });
    chk('PPN exclusive: total = setelah diskon + PPN', r.s === 200 && r.d.tax_amount === tax && r.d.total === base + tax && r.d.tax_mode === 'exclusive' && r.d.tax_rate === 11, JSON.stringify(r.d));
    const sale1 = r.d;
    r = await k('POST', '/api/sales', { items: [{ product_id: p.id, qty: 2 }], payment_method: 'tunai', discount_pct: 10, paid: sale1.total - 1 }, K);
    chk('tunai kurang dari total (termasuk PPN) ditolak', r.s === 400, r.s);
    r = await k('POST', '/api/sales', { items: [{ product_id: p.id, qty: 2 }], payment_method: 'tunai', discount_pct: 10, paid: sale1.total + 5000 }, K);
    chk('tunai: kembalian dihitung dari total + PPN', r.s === 200 && r.d.change_amount === 5000, JSON.stringify(r.d));
    const pay = (await k('GET', '/api/sales/' + sale1.id, null, K)).d;
    chk('detail transaksi memuat rincian diskon & PPN', pay.discount_pct === 10 && pay.tax_amount === tax && pay.store.tax_name === 'PPN');

    // retur: refund proporsional terhadap total yang dibayar (sudah termasuk PPN)
    const itemId = pay.items[0].id;
    const unit = Math.round(price * sale1.total / sale1.subtotal);
    r = await k('POST', `/api/sales/${sale1.id}/returns`, { reason: 'tes', items: [{ sale_item_id: itemId, qty: 1, restock: 0 }] }, S);
    chk('retur 1 unit: refund = harga x total/subtotal', r.s === 200 && r.d.refund_amount === unit, JSON.stringify(r.d).slice(0, 200));
    chk('refund 1 unit tidak lebih dari total', unit <= sale1.total);
    r = await k('POST', `/api/sales/${sale1.id}/returns`, { reason: 'tes', items: [{ sale_item_id: itemId, qty: 1, restock: 0 }] }, S);
    chk('retur sisa 1 unit berhasil (total refund tidak melebihi total transaksi)', r.s === 200, JSON.stringify(r.d).slice(0, 200));

    // PPN termasuk di harga (inclusive)
    r = await k('PUT', '/api/settings', { tax_mode: 'inclusive' }, S);
    r = await sell({});
    const itax = Math.round(sub * 11 / 111);
    chk('PPN inclusive: total tidak berubah, PPN dirinci', r.s === 200 && r.d.total === sub && r.d.tax_amount === itax && r.d.tax_mode === 'inclusive', JSON.stringify(r.d));

    // laporan: PPN bukan omzet
    const today = new Date(); const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const rep = (await k('GET', `/api/reports/sales?from=${ymd}&to=${ymd}`, null, S)).d;
    const T = rep.totals;
    chk('laporan: PPN dipungut > 0', T.tax_collected > 0, JSON.stringify(T));
    chk('laporan: omzet bersih = uang masuk - retur - PPN bersih', T.revenue === T.gross_revenue - T.return_amount - T.tax, JSON.stringify(T));
    chk('laporan: retur mengurangi PPN secara proporsional', T.tax_returned > 0 && T.tax === T.tax_collected - T.tax_returned, JSON.stringify(T));
    const csvRes = await fetch(B + `/api/reports/export?type=sales&from=${ymd}&to=${ymd}`, { headers: { Authorization: 'Bearer ' + S } });
    const csv = await csvRes.text();
    chk('CSV penjualan memuat kolom PPN & diskon %', csv.includes('Pajak (PPN)') && csv.includes('Diskon (%) diinput'), csv.slice(0, 200));

    // pajak dimatikan lagi: transaksi lama tidak berubah, transaksi baru tanpa PPN
    await k('PUT', '/api/settings', { tax_enabled: '0' }, S);
    r = await sell({});
    chk('PPN dimatikan: transaksi baru tanpa PPN', r.s === 200 && r.d.tax_amount === 0 && r.d.total === sub, JSON.stringify(r.d));
    const again = (await k('GET', '/api/sales/' + sale1.id, null, K)).d;
    chk('transaksi lama tetap membawa PPN-nya', again.tax_amount === tax && again.total === sale1.total);
  } finally { srv.kill(); }
  console.log(`\nHASIL diskon+pajak: ${ok} lulus, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
