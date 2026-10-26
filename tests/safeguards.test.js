// Tes pengaman: batal otomatis pesanan online belum dibayar + pembatas pesanan. Jalankan: node tests/safeguards.test.js
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toko-test-'));
const PORT = 3190, B = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, DATA_DIR: dir, PORT, EXPIRE_CHECK_SEC: '1', ORDER_LIMIT: '4' }, stdio: 'ignore' });
let ok = 0, fail = 0;
const chk = (name, cond, extra = '') => { cond ? ok++ : fail++; console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : ' -> ' + extra}`); };
const j = async (m, p, body, token) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, d: await r.json().catch(() => ({})) }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 30; i++) { try { await fetch(B + '/api/public/info'); break; } catch { await sleep(200); } }
  const t = (await j('POST', '/api/login', { username: 'superadmin', password: 'super123' })).d.token;
  const stock = async () => (await j('GET', '/api/products/barcode/RH-0003', null, t)).d.store_qty;
  const before = await stock();
  const o1 = await j('POST', '/api/public/orders', { customer_name: 'A', phone: '081200000001', payment_method: 'transfer', items: [{ product_id: 3, qty: 2 }] });
  const o2 = await j('POST', '/api/public/orders', { customer_name: 'B', phone: '081200000002', payment_method: 'cod', items: [{ product_id: 3, qty: 1 }] });
  chk('stok berkurang saat dipesan', (await stock()) === before - 3, await stock());
  await sleep(2500);
  chk('default 24 jam: belum dibatalkan', (await j('GET', '/api/public/orders/' + o1.d.order_no + '?phone=081200000001')).d.status === 'baru');
  await j('PUT', '/api/settings', { online_hold_hours: '0.0001' }, t);
  await sleep(3000);
  const s1 = (await j('GET', '/api/public/orders/' + o1.d.order_no + '?phone=081200000001')).d.status;
  const s2 = (await j('GET', '/api/public/orders/' + o2.d.order_no + '?phone=081200000002')).d.status;
  chk('transfer belum bayar -> batal otomatis', s1 === 'batal', s1);
  chk('COD tidak dibatalkan otomatis', s2 === 'baru', s2);
  chk('stok dikembalikan (hanya pesanan batal)', (await stock()) === before - 1, await stock());
  await j('PUT', '/api/settings', { online_hold_hours: '0' }, t);
  const o3 = await j('POST', '/api/public/orders', { customer_name: 'C', phone: '081200000003', payment_method: 'transfer', items: [{ product_id: 3, qty: 1 }] });
  await sleep(2500);
  chk('0 = fitur mati', (await j('GET', '/api/public/orders/' + o3.d.order_no + '?phone=081200000003')).d.status === 'baru');
  const o4 = await j('POST', '/api/public/orders', { customer_name: 'D', phone: '081200000004', items: [{ product_id: 3, qty: 1 }] });
  chk('pesanan ke-4 masih diterima', o4.s === 200, o4.s);
  const o5 = await j('POST', '/api/public/orders', { customer_name: 'E', phone: '081200000005', items: [{ product_id: 3, qty: 1 }] });
  chk('pesanan ke-5 dalam 10 menit ditolak (429)', o5.s === 429, o5.s);
  console.log(`\nHASIL: ${ok} lulus, ${fail} gagal`);
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
