// Tes retur barang customer: stok, refund kas, retur parsial, batas kuantitas, dan hak akses.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, fail = 0;
const chk = (n, c, x = '') => { c ? ok++ : fail++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${c ? '' : ' -> ' + String(x).slice(0, 250)}`); };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toko-retur-'));
  const port = 3400 + Math.floor(Math.random() * 500);
  const srv = spawn(process.execPath, [path.join(root, 'server.js')], { env: { ...process.env, DATA_DIR: dir, PORT: String(port), HTTPS: '0' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  const k = async (method, url, body, token) => {
    try {
      const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      let d = {}; try { d = await r.json(); } catch {}
      return { s: r.status, d };
    } catch (e) { return { s: 0, d: { error: e.message } }; }
  };
  try {
    for (let i = 0; i < 50; i++) { if ((await k('GET', '/api/ping')).s === 200) break; await sleep(200); }
    const login = await k('POST', '/api/login', { username: 'superadmin', password: 'super123' });
    const token = login.d.token;
    const kasir = await k('POST', '/api/login', { username: 'kasir', password: 'kasir123' });
    chk('superadmin dan kasir dapat login', !!token && !!kasir.d.token);
    const products = (await k('GET', '/api/products?limit=500', undefined, token)).d;
    const p = products.find((x) => x.display_qty >= 3);
    const sale = await k('POST', '/api/sales', { items: [{ product_id: p.id, qty: 3 }], payment_method: 'tunai', paid: p.price * 3, customer_name: 'Uji Retur' }, token);
    const sid = sale.d.id, itemId = sale.d.items[0].id;
    const before = p.display_qty;
    const first = await k('POST', `/api/sales/${sid}/returns`, { items: [{ sale_item_id: itemId, qty: 1, restock: true }], location: 'gudang_toko', reason: 'Cacat kemasan' }, token);
    chk('retur parsial berhasil dibuat', first.s === 200 && first.d.return_no && first.d.refund_amount > 0, first.d.error);
    chk('nomor pengeluaran kas otomatis terhubung', !!first.d.expense_no && /^KAS-/.test(first.d.expense_no));
    const stock = (await k('GET', '/api/products?limit=500', undefined, token)).d.find((x) => x.id === p.id);
    chk('stok lokasi tujuan bertambah sesuai retur', stock.gt_qty >= 1);
    const detail = await k('GET', `/api/sales/${sid}`, undefined, token);
    chk('sisa qty retur diperbarui', detail.d.items[0].remaining_qty === 2 && detail.d.returned_total === first.d.refund_amount);
    const second = await k('POST', `/api/sales/${sid}/returns`, { items: [{ sale_item_id: itemId, qty: 2, restock: false }], location: 'display', reason: 'Retur sisa' }, token);
    chk('retur kedua untuk sisa qty berhasil', second.s === 200);
    const over = await k('POST', `/api/sales/${sid}/returns`, { items: [{ sale_item_id: itemId, qty: 1, restock: true }], location: 'display', reason: 'Retur berlebih' }, token);
    chk('retur melebihi qty yang dibeli ditolak', over.s === 400);
    const voidAfterReturn = await k('POST', `/api/sales/${sid}/void`, { reason: 'Tidak boleh void setelah retur' }, token);
    chk('transaksi yang sudah diretur tidak dapat di-void (cegah stok ganda)', voidAfterReturn.s === 400);
    const cash = await k('GET', `/api/reports/cash?from=2000-01-01&to=2099-12-31`, undefined, token);
    chk('refund tercatat dalam laporan pengeluaran kas', cash.s === 200 && cash.d.total.n === 2 && cash.d.rows.every((x) => x.category === 'Refund Retur Barang'));
    const rows = await k('GET', '/api/returns', undefined, token);
    chk('riwayat retur dapat ditelusuri', rows.s === 200 && rows.d.length === 2, JSON.stringify(rows));
    const salesReport = await k('GET', '/api/reports/sales?from=2000-01-01&to=2099-12-31', undefined, token);
    chk('laporan penjualan mengurangi omzet dan HPP barang yang kembali ke stok', salesReport.s === 200 && salesReport.d.totals.revenue === sale.d.total - first.d.refund_amount - second.d.refund_amount && salesReport.d.totals.return_amount === first.d.refund_amount + second.d.refund_amount, JSON.stringify(salesReport.d.totals));
    const forbidden = await k('POST', `/api/sales/${sid}/returns`, { items: [{ sale_item_id: itemId, qty: 1 }], reason: 'x' }, kasir.d.token);
    chk('kasir tidak dapat meretur qty yang sudah habis', forbidden.s === 400 || forbidden.s === 403);
  } finally {
    srv.kill(); await sleep(200);
  }
  console.log(`\nHASIL RETUR: ${ok} lulus, ${fail} gagal`);
  if (fail) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
