// Tes Sales Invoice (SI): edit nota SO -> Finalkan -> SI terbit. Pembayaran bebas (sebelum/sesudah final, boleh sebagian).
// Jalankan: node tests/invoice.test.js
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..');
let ok = 0, fail = 0;
const chk = (n, c, x = '') => { c ? ok++ : fail++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${c ? '' : ' -> ' + String(x).slice(0, 300)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toko-si-'));
  const PORT = 3226, B = `http://127.0.0.1:${PORT}`;
  const start = () => spawn(process.execPath, [path.join(root, 'server.js')], { env: { ...process.env, DATA_DIR: dir, PORT, HTTPS: '0' }, stdio: 'ignore' });
  const wait = async () => { for (let i = 0; i < 40; i++) { try { await fetch(B + '/api/ping'); return; } catch { await sleep(200); } } };
  const k = async (m, p, body, token) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined || body === null ? undefined : JSON.stringify(body) }); let d = null; try { d = await r.json(); } catch (_) {} return { s: r.status, d }; };
  const login = async (u, p) => (await k('POST', '/api/login', { username: u, password: p })).d.token;
  let srv = start(); await wait();
  const S = await login('superadmin', 'super123'), SA = await login('salesadmin', 'sales123'), T = await login('timso', 'timso123'), K = await login('kasir', 'kasir123');
  const prods = (await k('GET', '/api/products?limit=50', null, S)).d.filter((p) => p.display_qty >= 10);
  const [p0, p1] = prods;
  const disp = async (p) => (await k('GET', '/api/products?limit=500', null, S)).d.find((x) => x.id === p.id).display_qty;
  const mk = async (items = [{ product_id: p0.id, qty: 2 }]) => (await k('POST', '/api/orders', { customer_name: 'Budi', phone: '081234567890', source: 'wa', items }, SA)).d;
  const get = async (id) => (await k('GET', '/api/orders/' + id, null, S)).d;

  console.log('# Draft nota & edit');
  const d0 = await disp(p0);
  const o = await mk();
  let g = await get(o.id);
  chk('SO baru = draft (belum final, belum ada SI)', g.finalized === false && !g.invoice && g.items.length === 1 && g.paid_amount === 0 && g.payment_status === 'belum', JSON.stringify(g).slice(0, 200));
  chk('invoice ditolak sebelum final', (await k('GET', `/api/orders/${o.id}/invoice`, null, SA)).s === 400);
  chk('stok sudah dipesan 2', (await disp(p0)) === d0 - 2);
  let e = await k('PUT', `/api/orders/${o.id}`, { items: [{ product_id: p0.id, qty: 5, price: 1000 }], discount: 500, address: 'Jl. Baru 1' }, SA);
  chk('edit nota: qty, harga, diskon', e.s === 200 && e.d.total === 4500 && e.d.subtotal === 5000 && e.d.discount === 500 && e.d.address === 'Jl. Baru 1', JSON.stringify(e.d).slice(0, 250));
  chk('edit qty naik -> stok dipesan bertambah', (await disp(p0)) === d0 - 5);
  e = await k('PUT', `/api/orders/${o.id}`, { items: [{ product_id: p0.id, qty: 1, price: 1000 }, { product_id: p1.id, qty: 3 }] }, T);
  chk('Tim SO edit: qty turun & barang baru (harga default = harga jual)', e.s === 200 && e.d.items.length === 2 && e.d.items.find((i) => i.product_id === p1.id).price === p1.price && e.d.total === 1000 + 3 * p1.price - 500, JSON.stringify(e.d).slice(0, 250));
  chk('stok ikut menyesuaikan (p0 kembali, p1 dipesan)', (await disp(p0)) === d0 - 1 && (await disp(p1)) === p1.display_qty - 3);
  chk('validasi edit: qty 0, diskon >= subtotal, kosong, barang tak ada', (await Promise.all([
    k('PUT', `/api/orders/${o.id}`, { items: [{ product_id: p0.id, qty: 0 }] }, SA), k('PUT', `/api/orders/${o.id}`, { discount: 99999999 }, SA),
    k('PUT', `/api/orders/${o.id}`, { items: [] }, SA), k('PUT', `/api/orders/${o.id}`, { items: [{ product_id: 999999, qty: 1 }] }, SA)])).every((r) => r.s === 400));
  chk('kasir tidak boleh edit / finalkan', (await k('PUT', `/api/orders/${o.id}`, { notes: 'x' }, K)).s === 403 && (await k('POST', `/api/orders/${o.id}/finalize`, {}, K)).s === 403);
  await k('POST', `/api/orders/${o.id}/status`, { status: 'batal' }, S);
  chk('stok kembali penuh setelah SO batal (draft)', (await disp(p0)) === d0 && (await disp(p1)) === p1.display_qty);
  chk('SO batal tidak bisa diedit / difinalkan', (await k('PUT', `/api/orders/${o.id}`, { notes: 'x' }, SA)).s === 400 && (await k('POST', `/api/orders/${o.id}/finalize`, {}, SA)).s === 400);

  console.log('# Final dulu, baru bayar');
  const a = await mk([{ product_id: p0.id, qty: 2 }]);
  await k('PUT', `/api/orders/${a.id}`, { items: [{ product_id: p0.id, qty: 2, price: 5000 }] }, SA);   // harga nota diubah lewat Edit nota
  const fa = await k('POST', `/api/orders/${a.id}/finalize`, {}, SA);
  const siA = fa.d.invoice && fa.d.invoice.si_no;
  chk('finalkan: SI terbit (SI-YYYYMMDD-0001), status baru -> diproses', fa.s === 200 && /^SI-\d{8}-0001$/.test(siA) && fa.d.finalized && fa.d.status === 'diproses', JSON.stringify(fa.d).slice(0, 200));
  chk('belum dibayar: belum ada transaksi penjualan', fa.d.sale === null);
  chk('nota terkunci setelah final (edit ditolak)', (await k('PUT', `/api/orders/${a.id}`, { notes: 'x' }, SA)).s === 400);
  chk('finalkan dua kali ditolak', (await k('POST', `/api/orders/${a.id}/finalize`, {}, SA)).s === 400);
  const inv = await k('GET', `/api/orders/${a.id}/invoice`, null, SA);
  chk('cetak SI (belum lunas): total, sisa, nomor', inv.s === 200 && inv.d.invoice_no === siA && inv.d.total === 10000 && inv.d.pay_status === 'belum' && inv.d.remaining === 10000 && inv.d.doc_title === 'SALES INVOICE', JSON.stringify(inv.d).slice(0, 250));
  chk('bayar melebihi sisa ditolak, jumlah 0 ditolak', (await k('POST', `/api/orders/${a.id}/pay`, { method: 'transfer', amount: 10001 }, T)).s === 400 && (await k('POST', `/api/orders/${a.id}/pay`, { method: 'transfer', amount: 0 }, T)).s === 400);
  let pp = await k('POST', `/api/orders/${a.id}/pay`, { method: 'transfer', amount: 4000 }, T);
  chk('bayar sebagian (DP): sebagian, sisa 6000, belum jadi penjualan', pp.s === 200 && pp.d.payment_status === 'sebagian' && pp.d.paid_amount === 4000 && pp.d.remaining === 6000 && pp.d.sale === null, JSON.stringify(pp.d).slice(0, 220));
  chk('SI (sebagian): sisa tagihan 6000', (await k('GET', `/api/orders/${a.id}/invoice`, null, SA)).d.remaining === 6000);
  chk('batal pembayaran-sebagian tanpa hak batal_lunas ditolak (403)', (await k('POST', `/api/orders/${a.id}/status`, { status: 'batal' }, SA)).s === 403);
  chk('selesai sebelum lunas ditolak', (await k('POST', `/api/orders/${a.id}/status`, { status: 'selesai' }, SA)).s === 400);
  chk('buka kembali ditolak saat belum lunas tapi alasan kosong', (await k('POST', `/api/orders/${a.id}/reopen`, {}, SA)).s === 400);
  pp = await k('POST', `/api/orders/${a.id}/pay`, { method: 'qris' }, T);
  chk('lunasi sisa (tanpa jumlah = sisa): lunas + transaksi penjualan tercatat bernomor SI', pp.s === 200 && pp.d.payment_status === 'lunas' && pp.d.sale && pp.d.sale.invoice_no === siA, JSON.stringify(pp.d.sale));
  const sale = (await k('GET', `/api/sales/${pp.d.sale.id}`, null, S)).d;
  chk('penjualan: channel order, total 10000, paid 10000, item sesuai nota', sale.channel === 'order' && sale.total === 10000 && sale.paid === 10000 && sale.items.length === 1 && sale.items[0].price === 5000, JSON.stringify(sale).slice(0, 200));
  chk('sudah lunas+tercatat: tidak bisa dibuka kembali', (await k('POST', `/api/orders/${a.id}/reopen`, { reason: 'salah' }, SA)).s === 400);
  chk('pelunasan ganda ditolak', (await k('POST', `/api/orders/${a.id}/pay`, { method: 'tunai' }, T)).s === 400);
  chk('selesaikan SO setelah lunas', (await k('POST', `/api/orders/${a.id}/status`, { status: 'selesai' }, SA)).d.status === 'selesai');

  console.log('# Bayar dulu, baru final');
  const b = await mk([{ product_id: p0.id, qty: 1 }, { product_id: p1.id, qty: 1 }]);
  const tot = p0.price + p1.price;
  let pb = await k('POST', `/api/orders/${b.id}/pay`, { method: 'tunai' }, T);
  chk('bayar penuh sebelum final: lunas, tapi belum jadi penjualan & belum ada SI', pb.s === 200 && pb.d.payment_status === 'lunas' && pb.d.paid_amount === tot && pb.d.sale === null && pb.d.finalized === false, JSON.stringify(pb.d).slice(0, 200));
  chk('invoice belum bisa dicetak walau lunas (belum final)', (await k('GET', `/api/orders/${b.id}/invoice`, null, SA)).s === 400);
  let eb = await k('PUT', `/api/orders/${b.id}`, { items: [{ product_id: p0.id, qty: 2 }, { product_id: p1.id, qty: 1 }] }, SA);
  chk('edit nota setelah dibayar: total naik -> status bayar jadi sebagian', eb.s === 200 && eb.d.total === 2 * p0.price + p1.price && eb.d.payment_status === 'sebagian' && eb.d.remaining === p0.price, JSON.stringify(eb.d).slice(0, 200));
  eb = await k('PUT', `/api/orders/${b.id}`, { items: [{ product_id: p0.id, qty: 1 }] }, SA);
  chk('edit nota: total turun di bawah yang sudah dibayar -> lunas (kelebihan tercatat)', eb.s === 200 && eb.d.payment_status === 'lunas' && eb.d.total === p0.price && eb.d.paid_amount === tot, JSON.stringify(eb.d).slice(0, 200));
  const fb = await k('POST', `/api/orders/${b.id}/finalize`, {}, SA);
  chk('finalkan SO yang sudah lunas: SI terbit (nomor ke-2) dan penjualan langsung tercatat', fb.s === 200 && /^SI-\d{8}-0002$/.test(fb.d.invoice.si_no) && fb.d.sale && fb.d.sale.invoice_no === fb.d.invoice.si_no, JSON.stringify(fb.d).slice(0, 200));
  const sb = (await k('GET', `/api/sales/${fb.d.sale.id}`, null, S)).d;
  chk('penjualan hasil final: total = nota, paid = yang dibayar, kembalian = kelebihan', sb.total === p0.price && sb.paid === tot && sb.change_amount === tot - p0.price, JSON.stringify(sb).slice(0, 200));

  console.log('# Buka kembali final & batalkan');
  const c = await mk([{ product_id: p0.id, qty: 1 }]);
  await k('PUT', `/api/orders/${c.id}`, { items: [{ product_id: p0.id, qty: 1, price: 2000 }] }, SA);
  const fc = await k('POST', `/api/orders/${c.id}/finalize`, {}, T);
  const siC = fc.d.invoice.si_no;
  chk('buka kembali butuh alasan', (await k('POST', `/api/orders/${c.id}/reopen`, { reason: '  ' }, T)).s === 400);
  const rc = await k('POST', `/api/orders/${c.id}/reopen`, { reason: 'harga salah' }, T);
  chk('buka kembali: SI lama void, nota bisa diedit lagi', rc.s === 200 && rc.d.finalized === false && rc.d.invoices.find((x) => x.si_no === siC).status === 'void' && rc.d.invoices[0].void_reason === 'harga salah', JSON.stringify(rc.d.invoices));
  chk('SI yang di-void tidak bisa dicetak', (await k('GET', `/api/orders/${c.id}/invoice`, null, SA)).s === 400);
  await k('PUT', `/api/orders/${c.id}`, { items: [{ product_id: p0.id, qty: 1, price: 2500 }] }, SA);
  const fc2 = await k('POST', `/api/orders/${c.id}/finalize`, {}, SA);
  chk('final ulang: nomor SI baru (tidak memakai ulang nomor void)', fc2.s === 200 && fc2.d.invoice.si_no !== siC && fc2.d.total === 2500, JSON.stringify(fc2.d.invoice));
  const invC = (await k('GET', `/api/orders/${c.id}/invoice`, null, SA)).d;
  chk('SI baru memuat harga hasil edit', invC.items[0].price === 2500 && invC.total === 2500);
  const dBefore = await disp(p0);
  const cc = await k('POST', `/api/orders/${c.id}/status`, { status: 'batal' }, SA);
  chk('batalkan SO final (belum dibayar): SI ikut void & stok kembali', cc.s === 200 && cc.d.invoices[0].status === 'void' && (await disp(p0)) === dBefore + 1, JSON.stringify(cc.d.invoices));
  chk('SO batal: SI tidak bisa dicetak', (await k('GET', `/api/orders/${c.id}/invoice`, null, SA)).s === 400);
  const pc = await mk(); await k('POST', `/api/orders/${pc.id}/pay`, { method: 'tunai', amount: 100 }, SA);
  chk('Super Admin boleh batalkan SO yang sudah dibayar sebagian', (await k('POST', `/api/orders/${pc.id}/status`, { status: 'batal' }, S)).s === 200);

  console.log('# Daftar SO & SI di laporan');
  const list = (await k('GET', '/api/orders?status=', null, SA)).d;
  chk('daftar SO memuat si_no (draft = null)', list.find((x) => x.id === a.id).si_no === siA && list.find((x) => x.id === pc.id).si_no === null);
  const rep = await k('GET', `/api/sales?q=${siA}`, null, S);
  chk('riwayat penjualan bisa dicari dengan nomor SI', rep.s === 200 && rep.d.length === 1 && rep.d[0].invoice_no === siA, JSON.stringify(rep.d).slice(0, 150));

  console.log('# Migrasi SO lama');
  srv.kill(); await sleep(600);
  {
    const d = new DatabaseSync(path.join(dir, 'toko.db'));
    const ins = (no, st, ps, sale) => Number(d.prepare(`INSERT INTO orders(order_no,source,customer_name,phone,status,payment_method,payment_status,total,sale_id) VALUES(?,?,?,?,?,?,?,?,?)`).run(no, 'wa', 'Lama', '081111111111', st, 'transfer', ps, 50000, sale).lastInsertRowid);
    const saleId = Number(d.prepare(`INSERT INTO sales(invoice_no,channel,customer_name,subtotal,discount,total,paid,payment_method,order_id) VALUES('INV-20250101-0007','order','Lama',50000,0,50000,50000,'transfer',1)`).run().lastInsertRowid);
    const o1 = ins('ORD-20250101-0001', 'diproses', 'lunas', saleId);
    d.prepare('INSERT INTO order_items(order_id,product_id,name,price,qty) VALUES(?,?,?,?,?)').run(o1, p0.id, 'Barang lama', 25000, 2);
    const o2 = ins('ORD-20250101-0002', 'baru', 'belum', null);
    d.prepare('INSERT INTO order_items(order_id,product_id,name,price,qty) VALUES(?,?,?,?,?)').run(o2, p0.id, 'Barang lama', 50000, 1);
    d.prepare('UPDATE orders SET paid_amount=0, si_id=NULL WHERE id IN (?,?)').run(o1, o2);
    d.close();
  }
  srv = start(); await wait();
  const S2 = await login('superadmin', 'super123');
  const all = (await k('GET', '/api/orders?status=', null, S2)).d;
  const l1 = all.find((x) => x.order_no === 'ORD-20250101-0001'), l2 = all.find((x) => x.order_no === 'ORD-20250101-0002');
  const gl1 = (await k('GET', '/api/orders/' + l1.id, null, S2)).d;
  chk('SO lama yang sudah lunas: dianggap final, nomor invoice lama jadi nomor SI', gl1.finalized && gl1.invoice.si_no === 'INV-20250101-0007' && gl1.paid_amount === 50000 && gl1.remaining === 0, JSON.stringify(gl1.invoice));
  chk('SO lama yang sudah lunas: nota terkunci dan SI bisa dicetak', (await k('PUT', '/api/orders/' + l1.id, { notes: 'x' }, S2)).s === 400 && (await k('GET', `/api/orders/${l1.id}/invoice`, null, S2)).d.items[0].qty === 2);
  const gl2 = (await k('GET', '/api/orders/' + l2.id, null, S2)).d;
  chk('SO lama yang belum dibayar: tetap draft & bisa diedit', !gl2.finalized && gl2.paid_amount === 0 && (await k('PUT', '/api/orders/' + l2.id, { notes: 'ok' }, S2)).s === 200);
  srv.kill(); await sleep(500);
  srv = start(); await wait();
  const S3 = await login('superadmin', 'super123');
  chk('restart kedua: migrasi tidak menggandakan SI', (await k('GET', '/api/orders/' + l1.id, null, S3)).d.invoices.length === 1);
  srv.kill();
  console.log(`\nHASIL SI: ${ok} lulus, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
