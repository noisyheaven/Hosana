// Tes Kartu Stok sesuai acuan aplikasi lama: No/ID/Keterangan/Harga, filter Jenis, Show Transfer, semua riwayat, Total In/Out/Available.
// Jalankan: node tests/kartu_lama.test.js
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
let ok = 0, fail = 0;
const chk = (n, c, x = '') => { c ? ok++ : fail++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${c ? '' : ' -> ' + String(x).slice(0, 400)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toko-kartulama-'));
const PORT = 3221, B = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, DATA_DIR: dir, PORT, HTTPS: '0' }, stdio: 'ignore' });
const k = async (m, p, body, token) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined || body === null ? undefined : JSON.stringify(body) });
  const txt = await r.text(); let d = null; try { d = JSON.parse(txt); } catch { d = txt; }
  return { s: r.status, d };
};
(async () => {
  for (let i = 0; i < 50; i++) { try { await fetch(B + '/api/ping'); break; } catch { await sleep(200); } }
  const tk = async (u, p) => (await k('POST', '/api/login', { username: u, password: p })).d.token;
  const S = await tk('superadmin', 'super123');
  // role kustom pemegang Kartu Stok TANPA harga beli
  const r1 = await k('POST', '/api/roles', { name: 'Pemeriksa Kartu', permissions: ['stok.kartu'] }, S);
  await k('POST', '/api/users', { username: 'kartu1', name: 'Pemeriksa', password: 'rahasia1', role: r1.d.key }, S);
  const T = await tk('kartu1', 'rahasia1');
  const p = (await k('GET', '/api/products?limit=200', null, S)).d.find((x) => x.display_qty > 6 && x.gt_qty > 2 && x.gr_qty > 2);
  const card = (qs, t = S) => k('GET', `/api/stock/card?product_id=${p.id}` + qs, null, t);

  // --- dokumen asal: PO (supplier + harga beli), penjualan kasir (customer), SO (customer), transfer
  const sup = (await k('POST', '/api/suppliers', { name: 'CV Sumber Tes' }, S)).d;
  const po = (await k('POST', '/api/po', { supplier_id: sup.id, submit: true, items: [{ product_id: p.id, qty: 5, cost: 742589 }] }, S)).d;
  await k('POST', `/api/po/${po.id}/status`, { status: 'approved' }, S);
  const det = (await k('GET', `/api/receiving/po/${po.id}`, null, S)).d;
  const rc = await k('POST', `/api/po/${po.id}/receive`, { items: [{ item_id: det.items[0].id, qty: 5 }], location: 'gudang_ruko' }, S);
  chk('terima PO 5 pcs', rc.s === 200, JSON.stringify(rc.d).slice(0, 200));
  const sale = (await k('POST', '/api/sales', { items: [{ product_id: p.id, qty: 1 }], payment_method: 'tunai', paid: 100000000, customer_name: 'Toko TIARA' }, S)).d;
  const sale2 = (await k('POST', '/api/sales', { items: [{ product_id: p.id, qty: 1 }], payment_method: 'tunai', paid: 100000000 }, S)).d;
  const so = await k('POST', '/api/orders', { customer_name: 'Hosanna OLShop (WA)', phone: '081234567890', source: 'wa', items: [{ product_id: p.id, qty: 1 }] }, S);
  const tr = await k('POST', '/api/transfers', { from: 'gudang_toko', to: 'display', items: [{ product_id: p.id, qty: 1 }] }, S);
  chk('dokumen asal berhasil dibuat', !!sale.invoice_no && !!sale2.invoice_no && so.s === 200 && tr.s === 200, JSON.stringify([sale, so.d, tr.d]).slice(0, 300));

  // --- default lama (tanpa parameter baru) tetap seperti sebelumnya
  const base = (await card('&location=all')).d;
  chk('kompatibel: tanpa parameter baru, transfer tetap tampil', base.rows.some((r) => r.type === 'transfer_in') && base.show_transfer === true);

  // --- Keterangan (customer / supplier) + ID dokumen + Harga
  const all = (await card('&location=all&period=all')).d;
  const rPO = all.rows.find((r) => r.type === 'po_in'), rS1 = all.rows.find((r) => r.ref === sale.invoice_no), rS2 = all.rows.find((r) => r.ref === sale2.invoice_no), rSO = all.rows.find((r) => r.ref === so.d.order_no);
  chk('Pembelian: ID = no. PO, Keterangan = supplier, Harga = harga beli', rPO && rPO.ref === po.po_number && rPO.party === 'CV Sumber Tes' && rPO.price === 742589 && rPO.price_kind === 'beli' && rPO.in === 5, JSON.stringify(rPO));
  chk('Penjualan: Keterangan = nama customer, Harga = harga jual', rS1 && rS1.party === 'Toko TIARA' && rS1.price === p.price && rS1.price_kind === 'jual' && rS1.out === 1, JSON.stringify(rS1));
  chk('Penjualan tanpa nama customer -> "Pelanggan umum"', rS2 && rS2.party === 'Pelanggan umum', JSON.stringify(rS2));
  chk('Sales Order: Keterangan = customer SO, Harga jual', rSO && rSO.party === 'Hosanna OLShop (WA)' && rSO.price === p.price, JSON.stringify(rSO));
  chk('baris punya kelompok jenis', rPO.group === 'Pembelian' && rS1.group === 'Penjualan' && all.rows.find((r) => r.type === 'transfer_in').group === 'Transfer');
  chk('harga beli disembunyikan dari role tanpa hak harga_beli, harga jual tetap tampil', (await card('&period=all', T)).d.rows.find((r) => r.type === 'po_in').price === null && (await card('&period=all', T)).d.rows.find((r) => r.ref === sale.invoice_no).price === p.price);

  // --- Semua riwayat (Bulan tidak dicentang): saldo awal 0, mulai dari mutasi pertama
  chk('period=all: saldo awal 0 dan memuat stok awal', all.period === 'all' && all.opening === 0 && all.rows.some((r) => r.type === 'initial'), `${all.opening} ${all.period}`);
  chk('period=all: saldo akhir = stok sekarang, tanpa peringatan selisih', all.closing === all.current && all.mismatch === false, JSON.stringify([all.closing, all.current, all.mismatch]));
  chk('Total masuk - Total keluar = Tersedia (semua riwayat, semua jenis, semua transfer)', all.total_in - all.total_out === all.available, JSON.stringify([all.total_in, all.total_out, all.available]));

  // --- Show Transfer
  const hide = (await card('&location=all&period=all&show_transfer=0')).d;
  chk('show_transfer=0 (lokasi semua): baris transfer disembunyikan, jumlahnya dilaporkan', !hide.rows.some((r) => r.group === 'Transfer') && hide.hidden === 2 && hide.show_transfer === false, JSON.stringify([hide.hidden, hide.show_transfer]));
  chk('menyembunyikan transfer tidak mengubah saldo akhir & saldo baris lain', hide.closing === all.closing && hide.rows.every((r) => all.rows.find((x) => x.id === r.id).balance === r.balance));
  chk('masuk-keluar tanpa transfer tetap = tersedia (transfer saling meniadakan)', hide.total_in - hide.total_out === hide.available, JSON.stringify([hide.total_in, hide.total_out, hide.available]));
  const dis = (await card('&location=display&period=all&show_transfer=0')).d;
  chk('lokasi tertentu: transfer SELALU tampil (agar saldo lokasi bisa ditelusuri)', dis.rows.some((r) => r.type === 'transfer_in') && dis.show_transfer === true);
  chk('lokasi tertentu: masuk - keluar = tersedia', dis.total_in - dis.total_out === dis.available, JSON.stringify([dis.total_in, dis.total_out, dis.available]));

  // --- Filter Jenis
  const bel = (await card('&location=all&period=all&type=pembelian')).d;
  chk('filter Jenis = Pembelian: hanya terima PO, totals ikut baris tampil', bel.rows.length === 1 && bel.rows[0].type === 'po_in' && bel.total_in === 5 && bel.total_out === 0 && bel.available === all.available, JSON.stringify([bel.rows.length, bel.total_in, bel.total_out]));
  chk('filter Jenis tidak mengubah saldo berjalan baris', bel.rows[0].balance === all.rows.find((r) => r.id === bel.rows[0].id).balance);
  const jual = (await card('&location=all&period=all&type=penjualan')).d;
  chk('filter Jenis = Penjualan: penjualan + SO', jual.rows.length >= 3 && jual.rows.every((r) => r.group === 'Penjualan') && jual.total_out === 3, JSON.stringify([jual.rows.length, jual.total_out]));
  const trn = (await card('&location=all&period=all&type=transfer&show_transfer=0')).d;
  chk('filter Jenis = Transfer menampilkan transfer walau show_transfer=0', trn.rows.length === 2 && trn.rows.every((r) => r.group === 'Transfer'), JSON.stringify(trn.rows.length));
  const kor = (await card('&location=all&period=all&type=koreksi')).d;
  chk('filter Jenis = Koreksi: stok awal/opname/koreksi', kor.rows.length >= 1 && kor.rows.every((r) => r.group === 'Koreksi'));

  // --- barang: deskripsi & satuan, rekap semua riwayat, CSV
  chk('respons memuat deskripsi & satuan barang', base.product.unit !== undefined && 'description' in base.product);
  const recap = (await k('GET', '/api/stock/card?period=all&location=all', null, S)).d;
  const rr = recap.rows.find((x) => x.product_id === p.id);
  chk('rekap semua barang mendukung period=all (saldo awal 0, saldo akhir = stok)', recap.mode === 'recap' && rr.opening === 0 && rr.closing === rr.current, JSON.stringify(rr));
  const csv = (await k('GET', `/api/stock/card?product_id=${p.id}&period=all&location=all&format=csv`, null, S)).d;
  chk('CSV: kolom No, Tanggal, Jenis, ID, Keterangan, Masuk, Keluar, Saldo, Harga, Lokasi', String(csv).includes('No;Tanggal;Jenis;ID;Keterangan;Masuk;Keluar;Saldo;Harga;Lokasi') && String(csv).includes('Toko TIARA') && String(csv).includes('742589'), String(csv).slice(0, 300));
  const csvT = (await k('GET', `/api/stock/card?product_id=${p.id}&period=all&format=csv`, null, T)).d;
  chk('CSV role tanpa harga beli tidak membocorkan harga beli', !String(csvT).includes('742589'));

  srv.kill();
  console.log(`\nHASIL: ${ok} lulus, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
