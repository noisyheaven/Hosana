/* Inti aplikasi: API, util, modal, scanner kamera, cetak, editor item */
(function () {
  const App = (window.App = { state: { user: null, token: null, settings: {}, products: [], cats: [] }, pages: {} });
  const S = App.state;
  try { S.token = localStorage.getItem('token'); } catch (_) {}

  // ---------- util ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Number(n || 0).toLocaleString('id-ID');
  const rp = (n) => 'Rp ' + num(n);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const fmtDT = (s) => { if (!s) return '-'; const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s); if (!m) return s; return `${+m[3]} ${MON[+m[2] - 1]} ${m[1]}${m[4] ? ' ' + m[4] + ':' + m[5] : ''}`; };
  const fmtD = (s) => fmtDT(String(s || '').slice(0, 10));
  const ymd = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const RANK = { staf: 1, admin: 2, superadmin: 3 };
  const can = (role) => S.user && RANK[S.user.role] >= RANK[role];
  const initials = (n) => String(n || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const PAY = { tunai: 'Tunai', transfer: 'Transfer', qris: 'QRIS', debit: 'Debit/Kartu', cod: 'COD (bayar di tempat)' };
  const ORDER_ST = { baru: ['Baru', 'info'], diproses: ['Diproses', 'warn'], dikirim: ['Dikirim', 'info'], selesai: ['Selesai', 'ok'], batal: ['Batal', 'bad'] };
  const PO_ST = { draft: ['Draft', ''], submitted: ['Diajukan', 'info'], approved: ['Disetujui', 'warn'], partial: ['Diterima sebagian', 'warn'], received: ['Selesai diterima', 'ok'], cancelled: ['Dibatalkan', 'bad'] };
  const badge = (map, k) => { const m = map[k] || [k, '']; return `<span class="badge ${m[1]}">${esc(m[0])}</span>`; };
  Object.assign(App, { $, $$, esc, num, rp, fmtDT, fmtD, ymd, can, initials, debounce, PAY, ORDER_ST, PO_ST, badge });

  // ---------- API ----------
  App.apiBase = () => { try { return localStorage.getItem('apiBase') || window.API_BASE || ''; } catch (_) { return window.API_BASE || ''; } };
  App.api = async function (path, { method = 'GET', body, raw } = {}) {
    let r;
    try {
      r = await fetch(App.apiBase() + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) { throw new Error('Tidak dapat terhubung ke server. Periksa koneksi / alamat server.'); }
    if (raw) { if (!r.ok) { let d = {}; try { d = await r.json(); } catch (_) {} throw new Error(d.error || 'Gagal'); } return r; }
    let d = {}; try { d = await r.json(); } catch (_) {}
    if (r.status === 401 && S.token) { App.onLogout && App.onLogout(true); throw new Error(d.error || 'Sesi berakhir'); }
    if (!r.ok) throw new Error(d.error || 'Terjadi kesalahan');
    return d;
  };
  App.download = async function (path, fallbackName) {
    const r = await App.api(path, { raw: true });
    const cd = r.headers.get('Content-Disposition') || ''; const m = /filename="([^"]+)"/.exec(cd);
    const blob = await r.blob(); const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = m ? m[1] : fallbackName; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  // ---------- UI dasar ----------
  App.toast = (msg, kind = '') => {
    const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg; $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3000);
  };
  App.fail = (e) => { console.error(e); App.toast(e.message || String(e), 'err'); };
  App.modal = function (title, body, { footer = '', size = '', onClose } = {}) {
    const ov = document.createElement('div'); ov.className = 'ov';
    ov.innerHTML = `<div class="modal ${size}" role="dialog"><div class="mh"><h2>${esc(title)}</h2><button type="button" data-x aria-label="Tutup">&times;</button></div><div class="mb">${body}</div>${footer ? `<div class="mf">${footer}</div>` : ''}</div>`;
    document.body.appendChild(ov);
    ov.close = () => { if (ov.isConnected) { ov.remove(); onClose && onClose(); } };
    $('[data-x]', ov).onclick = ov.close;
    ov.q = (s) => $(s, ov); ov.qa = (s) => $$(s, ov);
    return ov;
  };
  App.confirm = (msg, { ok = 'Ya, lanjutkan', danger = false, title = 'Konfirmasi' } = {}) => new Promise((res) => {
    const m = App.modal(title, `<p style="margin:0">${esc(msg)}</p>`, { footer: `<button class="btn" data-n>Batal</button><button class="btn ${danger ? 'danger' : 'primary'}" data-y>${esc(ok)}</button>`, onClose: () => res(false) });
    m.q('[data-n]').onclick = () => m.close();
    m.q('[data-y]').onclick = () => { res(true); m.remove(); };
  });
  App.prompt = (title, label, def = '', { type = 'text', ok = 'Simpan', textarea = false } = {}) => new Promise((res) => {
    const m = App.modal(title, `<label class="f">${esc(label)}</label>${textarea ? `<textarea class="inp" id="pv">${esc(def)}</textarea>` : `<input class="inp" id="pv" type="${type}" value="${esc(def)}">`}`,
      { footer: `<button class="btn" data-n>Batal</button><button class="btn primary" data-y>${esc(ok)}</button>`, onClose: () => res(null) });
    const inp = m.q('#pv'); setTimeout(() => inp.focus(), 30);
    m.q('[data-n]').onclick = () => m.close();
    const go = () => { res(inp.value); m.remove(); };
    m.q('[data-y]').onclick = go; inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !textarea) go(); });
  });
  App.formData = (root) => {
    const o = {};
    $$('[name]', root).forEach((el) => { o[el.name] = el.type === 'checkbox' ? el.checked : el.value; });
    return o;
  };
  App.busy = async (btn, fn) => { btn.disabled = true; const t = btn.textContent; try { return await fn(); } finally { btn.disabled = false; btn.textContent = t; } };

  // ---------- data bersama ----------
  App.loadSettings = async () => { S.settings = await App.api('/settings'); return S.settings; };
  App.loadCats = async () => { S.cats = await App.api('/categories'); return S.cats; };
  App.loadProducts = async (extra = '') => { S.products = await App.api('/products?limit=5000' + extra); return S.products; };
  App.catOptions = (sel) => `<option value="">— Tanpa kategori —</option>` + S.cats.map((c) => `<option value="${c.id}" ${String(sel) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  App.thumb = (p, cls = '') => p.image ? `<img class="thumb ${cls}" src="${App.apiBase()}${esc(p.image)}" alt="" loading="lazy">` : `<div class="thumb ${cls}">${esc(initials(p.name))}</div>`;

  // ---------- scanner kamera ----------
  function beep() { try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(); o.frequency.value = 880; o.connect(a.destination); o.start(); setTimeout(() => { o.stop(); a.close(); }, 90); } catch (_) {} }
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Gagal memuat pustaka scanner (butuh internet)')); document.head.appendChild(s); }); }
  App.beep = beep;
  App.scan = function (onCode, { continuous = false, title = 'Scan Barcode' } = {}) {
    let stream = null, timer = null, h5 = null, closed = false, last = { c: '', t: 0 };
    const stop = () => { closed = true; clearInterval(timer); if (stream) stream.getTracks().forEach((t) => t.stop()); if (h5) h5.stop().catch(() => {}); };
    const m = App.modal(title, `<div class="scanbox" id="scbox"><video id="scvid" playsinline muted autoplay></video><div class="aim"></div></div>
      <div id="scmsg" class="muted small gap-s">Mengaktifkan kamera…</div>
      <div class="row gap-s"><input class="inp grow" id="scman" inputmode="text" placeholder="Atau ketik / scan dengan alat, lalu Enter"><button class="btn primary" id="scok">OK</button></div>`, { onClose: stop });
    const msg = (t) => { const e = m.q('#scmsg'); if (e) e.textContent = t; };
    const handle = (code) => {
      code = String(code || '').trim(); if (!code || closed) return;
      const now = Date.now(); if (code === last.c && now - last.t < 2000) return; last = { c: code, t: now };
      beep(); onCode(code); if (!continuous) m.close(); else msg('Terbaca: ' + code);
    };
    const man = m.q('#scman');
    const sendMan = () => { const v = man.value.trim(); man.value = ''; if (v) handle(v); man.focus(); };
    m.q('#scok').onclick = sendMan; man.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMan(); });
    (async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        m.q('#scbox').classList.add('hidden');
        msg('Kamera tidak dapat dipakai: halaman ini dibuka lewat HTTP biasa (kamera hanya jalan di HTTPS atau localhost). Gunakan input manual / scanner USB-Bluetooth, atau buka lewat HTTPS (lihat README).');
        man.focus(); return;
      }
      try {
        if ('BarcodeDetector' in window) {
          let formats = ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'qr_code'];
          try { const sup = await BarcodeDetector.getSupportedFormats(); formats = formats.filter((f) => sup.includes(f)); } catch (_) {}
          const det = new BarcodeDetector({ formats });
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
          const v = m.q('#scvid'); v.srcObject = stream; await v.play();
          msg('Arahkan kamera ke barcode');
          timer = setInterval(async () => { if (closed || v.readyState < 2) return; try { const r = await det.detect(v); if (r.length) handle(r[0].rawValue); } catch (_) {} }, 220);
        } else {
          // cadangan jika browser/WebView tidak punya BarcodeDetector: pustaka lokal (npm run vendor), lalu CDN
          if (!window.Html5Qrcode) await loadScript('vendor/html5-qrcode.min.js').catch(() => loadScript('https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'));
          m.q('#scbox').innerHTML = ''; h5 = new Html5Qrcode('scbox');
          await h5.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 140 } }, handle, () => {});
          msg('Arahkan kamera ke barcode');
        }
      } catch (e) { msg('Kamera gagal dibuka: ' + (e.message || e.name) + '. Pastikan izin kamera diberikan. Anda tetap bisa mengetik kode di bawah.'); }
      man.focus();
    })();
    return m;
  };

  // ---------- cetak ----------
  // Di aplikasi Android (Capacitor), WebView tidak punya window.print(); dipakai plugin native "NativePrint" (lihat android-app/).
  let nativePrint = null;
  const getNativePrint = () => {
    const C = window.Capacitor;
    if (!nativePrint && C && C.isNativePlatform && C.isNativePlatform() && C.registerPlugin) nativePrint = C.registerPlugin('NativePrint');
    return nativePrint;
  };
  App.printHtml = function (html, css = '') {
    const np = getNativePrint();
    if (np) {
      np.printHtml({ name: 'Dokumen toko', html: `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>` }).catch(App.fail);
      return;
    }
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    const d = f.contentWindow.document;
    d.open(); d.write(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`); d.close();
    setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { App.fail(e); } setTimeout(() => f.remove(), 60000); }, 350);
  };
  const lines = (s) => esc(s || '').replace(/\n/g, '<br>');
  App.receiptHtml = (sale) => {
    const st = sale.store || S.settings; const w = st.paper_width === '80' ? 76 : 54;
    const css = `@page{size:${w + 4}mm auto;margin:0}body{width:${w}mm;margin:0 2mm;padding:2mm 0;font:11px/1.4 "Courier New",monospace;color:#000}.c{text-align:center}.b{font-weight:bold}.r{display:flex;justify-content:space-between;gap:6px}hr{border:0;border-top:1px dashed #000;margin:5px 0}.big{font-size:13px}`;
    const items = sale.items.map((i) => `<div>${esc(i.name)}</div><div class="r"><span>${i.qty} x ${num(i.price)}</span><span>${num(i.qty * i.price)}</span></div>`).join('');
    const html = `<div class="c b big">${esc(st.store_name)}</div><div class="c">${lines(st.store_address)}</div><div class="c">Telp/WA: ${esc(st.store_phone)}</div><hr>
      ${sale.status === 'void' ? '<div class="c b big">*** DIBATALKAN ***</div>' : ''}
      <div>No   : ${esc(sale.invoice_no)}</div><div>Tgl  : ${esc(fmtDT(sale.created_at))}</div><div>Kasir: ${esc(sale.cashier || '-')}</div>${sale.customer_name ? `<div>Plgn : ${esc(sale.customer_name)}</div>` : ''}<hr>${items}<hr>
      <div class="r"><span>Subtotal</span><span>${num(sale.subtotal)}</span></div>${sale.discount ? `<div class="r"><span>Diskon</span><span>-${num(sale.discount)}</span></div>` : ''}
      <div class="r b big"><span>TOTAL</span><span>${num(sale.total)}</span></div>
      <div class="r"><span>Bayar (${esc(PAY[sale.payment_method] || sale.payment_method)})</span><span>${num(sale.paid)}</span></div>${sale.change_amount ? `<div class="r"><span>Kembali</span><span>${num(sale.change_amount)}</span></div>` : ''}<hr>
      <div class="c">${lines(st.receipt_footer)}</div>`;
    return { html, css };
  };
  App.invoiceHtml = (sale) => {
    const st = sale.store || S.settings;
    const css = `@page{size:A4;margin:16mm}body{font:13px/1.5 system-ui,Arial,sans-serif;color:#111}h1{margin:0;font-size:26px;letter-spacing:.05em}table{width:100%;border-collapse:collapse;margin-top:14px}th{background:#f1ede3;text-align:left;padding:8px;font-size:11px;text-transform:uppercase}td{padding:8px;border-bottom:1px solid #e5e0d3}.r{text-align:right}.top{display:flex;justify-content:space-between;gap:20px}.tot td{border:0;padding:3px 8px}.stamp{display:inline-block;border:3px solid #2e7d5b;color:#2e7d5b;padding:2px 14px;font-weight:800;transform:rotate(-6deg);border-radius:6px}.stamp.v{border-color:#b3372f;color:#b3372f}.muted{color:#666}`;
    const rows = sale.items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.name)}</td><td class="r">${num(i.price)}</td><td class="r">${i.qty}</td><td class="r">${num(i.price * i.qty)}</td></tr>`).join('');
    const html = `<div class="top"><div><b style="font-size:18px">${esc(st.store_name)}</b><div class="muted">${lines(st.store_address)}<br>Telp/WA: ${esc(st.store_phone)}</div></div><div class="r"><h1>INVOICE</h1><div><b>${esc(sale.invoice_no)}</b></div><div class="muted">${esc(fmtDT(sale.created_at))}</div></div></div>
      <div style="margin-top:16px" class="top"><div><div class="muted">Kepada</div><b>${esc(sale.customer_name || 'Pelanggan Umum')}</b>${sale.customer_phone ? `<div>${esc(sale.customer_phone)}</div>` : ''}</div><div class="r"><span class="stamp ${sale.status === 'void' ? 'v' : ''}">${sale.status === 'void' ? 'DIBATALKAN' : 'LUNAS'}</span><div class="muted" style="margin-top:6px">Metode: ${esc(PAY[sale.payment_method] || sale.payment_method)} · Kasir: ${esc(sale.cashier || '-')}</div></div></div>
      <table><thead><tr><th>#</th><th>Barang</th><th class="r">Harga</th><th class="r">Qty</th><th class="r">Jumlah</th></tr></thead><tbody>${rows}</tbody></table>
      <table class="tot" style="width:46%;margin-left:auto"><tr><td>Subtotal</td><td class="r">${rp(sale.subtotal)}</td></tr>${sale.discount ? `<tr><td>Diskon</td><td class="r">-${rp(sale.discount)}</td></tr>` : ''}<tr><td><b>TOTAL</b></td><td class="r"><b style="font-size:16px">${rp(sale.total)}</b></td></tr></table>
      <p class="muted" style="margin-top:30px">${lines(st.receipt_footer)}</p>`;
    return { html, css };
  };
  App.poHtml = (po) => {
    const st = po.store || S.settings;
    const css = `@page{size:A4;margin:16mm}body{font:13px/1.5 system-ui,Arial,sans-serif;color:#111}table{width:100%;border-collapse:collapse;margin-top:14px}th{background:#f1ede3;text-align:left;padding:8px;font-size:11px;text-transform:uppercase}td{padding:8px;border-bottom:1px solid #e5e0d3}.r{text-align:right}.top{display:flex;justify-content:space-between;gap:20px}.muted{color:#666}.sign{display:flex;justify-content:space-between;margin-top:60px}.sign div{width:30%;text-align:center;border-top:1px solid #333;padding-top:4px}`;
    const rows = po.items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.name)}<div class="muted">${esc(i.sku)}</div></td><td class="r">${i.qty} ${esc(i.unit || '')}</td><td class="r">${num(i.cost)}</td><td class="r">${num(i.qty * i.cost)}</td></tr>`).join('');
    const html = `<div class="top"><div><b style="font-size:18px">${esc(st.store_name)}</b><div class="muted">${lines(st.store_address)}</div></div><div class="r"><h1 style="margin:0">PURCHASE ORDER</h1><b>${esc(po.po_number)}</b>${po.revision ? ` · Revisi ${po.revision}` : ''}<div class="muted">${esc(fmtD(po.created_at))}</div></div></div>
      <div style="margin-top:14px"><div class="muted">Kepada supplier</div><b>${esc(po.supplier || '-')}</b>${po.supplier_phone ? `<div>${esc(po.supplier_phone)}</div>` : ''}${po.expected_date ? `<div class="muted">Estimasi tiba: ${esc(fmtD(po.expected_date))}</div>` : ''}</div>
      <table><thead><tr><th>#</th><th>Barang</th><th class="r">Qty</th><th class="r">Harga Beli</th><th class="r">Jumlah</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="r" style="margin-top:10px;font-size:16px"><b>Total: ${rp(po.total)}</b></div>${po.notes ? `<p><b>Catatan:</b> ${lines(po.notes)}</p>` : ''}
      <div class="sign"><div>Dibuat oleh<br>${esc(po.created_by_name || '')}</div><div>Disetujui<br>${esc(po.approved_by_name || '')}</div><div>Supplier</div></div>`;
    return { html, css };
  };
  // list: [{name, price, code, copies}]
  App.labelsHtml = (list) => {
    const css = `@page{size:A4;margin:8mm}body{margin:0;font:11px system-ui,Arial,sans-serif}.g{display:flex;flex-wrap:wrap;gap:2mm}.lab{width:48mm;height:27mm;border:1px dashed #bbb;padding:1.5mm;box-sizing:border-box;text-align:center;overflow:hidden;page-break-inside:avoid}.n{font-weight:700;font-size:10px;line-height:1.1;height:22px;overflow:hidden}.p{font-weight:800;font-size:12px}.lab svg{width:100%;height:12mm}`;
    let h = '';
    for (const it of list) for (let i = 0; i < it.copies; i++) h += `<div class="lab"><div class="n">${esc(it.name)}</div>${Barcode.svg(it.code, { height: 40, mw: 2, text: true })}<div class="p">${rp(it.price)}</div></div>`;
    return { html: `<div class="g">${h}</div>`, css };
  };
  App.print = (o) => App.printHtml(o.html, o.css);

  // ---------- editor daftar barang (dipakai Transfer, PO, Pesanan) ----------
  // opts: {items:[{product_id,qty,cost}], cost:bool, stock:'wh_qty'|'store_qty'|null, onChange, products}
  App.itemEditor = function (root, opts = {}) {
    let items = (opts.items || []).map((x) => ({ ...x }));
    const prods = () => opts.products || S.products;
    const byId = (id) => prods().find((p) => p.id === id);
    root.innerHTML = `<div class="rel"><div class="scanbar"><input class="inp grow" data-s placeholder="Ketik nama / SKU, atau scan barcode lalu Enter" autocomplete="off"><button type="button" class="btn" data-cam title="Scan kamera">📷 Scan</button></div><div class="suggest hidden" data-sg></div></div>
      <div class="tablewrap gap-s"><table class="t"><thead><tr><th>Barang</th>${opts.stock ? '<th class="num">Stok</th>' : ''}${opts.cost ? '<th class="num">Harga beli</th>' : ''}<th class="num" style="width:110px">Qty</th><th class="num">Jumlah</th><th></th></tr></thead><tbody data-rows></tbody><tfoot><tr><td colspan="${2 + (opts.stock ? 1 : 0) + (opts.cost ? 1 : 0)}" class="right"><b>Total</b></td><td class="num"><b data-tot>0</b></td><td></td></tr></tfoot></table></div>`;
    const inp = $('[data-s]', root), sg = $('[data-sg]', root), tb = $('[data-rows]', root);
    const total = () => items.reduce((a, i) => a + i.qty * (opts.cost ? i.cost : (byId(i.product_id)?.price || 0)), 0);
    const changed = () => { $('[data-tot]', root).textContent = num(total()); opts.onChange && opts.onChange(items); };
    const render = () => {
      tb.innerHTML = items.length ? items.map((it, idx) => { const p = byId(it.product_id) || { name: '#' + it.product_id, sku: '' }; const unit = opts.cost ? it.cost : p.price;
        return `<tr data-i="${idx}"><td><b>${esc(p.name)}</b><div class="small muted">${esc(p.sku)}</div></td>${opts.stock ? `<td class="num">${num(p[opts.stock])}</td>` : ''}${opts.cost ? `<td class="num"><input class="inp" style="width:110px;text-align:right" type="number" min="0" data-cost value="${it.cost}"></td>` : ''}<td class="num"><input class="inp" style="width:90px;text-align:right" type="number" min="1" data-qty value="${it.qty}"></td><td class="num" data-sub>${num(it.qty * unit)}</td><td><button type="button" class="btn sm danger" data-del>✕</button></td></tr>`; }).join('')
        : `<tr><td colspan="9" class="empty">Belum ada barang. Cari atau scan barang di atas.</td></tr>`;
      changed();
    };
    const add = (p, qty = 1) => {
      const ex = items.find((i) => i.product_id === p.id);
      if (ex) ex.qty += qty; else items.push({ product_id: p.id, qty, cost: p.cost || 0 });
      inp.value = ''; sg.classList.add('hidden'); render(); inp.focus();
    };
    const match = (t) => { t = t.toLowerCase(); return prods().filter((p) => `${p.name} ${p.sku} ${p.barcode || ''}`.toLowerCase().includes(t)).slice(0, 8); };
    const showSg = () => {
      const t = inp.value.trim(); if (!t) return sg.classList.add('hidden');
      const m = match(t); sg.innerHTML = m.length ? m.map((p) => `<button type="button" data-id="${p.id}"><span>${esc(p.name)} <span class="muted small">${esc(p.sku)}</span></span><span class="small muted">stok ${p.store_qty}/${p.wh_qty}</span></button>`).join('') : '<div class="empty small">Tidak ditemukan</div>';
      sg.classList.remove('hidden');
    };
    inp.addEventListener('input', showSg);
    inp.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return; e.preventDefault(); const t = inp.value.trim(); if (!t) return;
      const ex = prods().find((p) => p.barcode === t || p.sku.toLowerCase() === t.toLowerCase()); if (ex) return add(ex);
      const m = match(t); if (m.length === 1) add(m[0]); else if (m.length) add(m[0]); else App.toast('Barang tidak ditemukan: ' + t, 'err');
    });
    sg.addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) add(byId(+b.dataset.id)); });
    document.addEventListener('click', (e) => { if (!root.contains(e.target)) sg.classList.add('hidden'); });
    $('[data-cam]', root).onclick = () => App.scan((code) => { const p = prods().find((x) => x.barcode === code || x.sku === code); p ? add(p) : App.toast('Barcode tidak dikenal: ' + code, 'err'); }, { continuous: true, title: 'Scan barang' });
    tb.addEventListener('input', (e) => {
      const tr = e.target.closest('tr[data-i]'); if (!tr) return; const it = items[+tr.dataset.i];
      if (e.target.matches('[data-qty]')) it.qty = Math.max(0, parseInt(e.target.value, 10) || 0);
      if (e.target.matches('[data-cost]')) it.cost = Math.max(0, parseInt(e.target.value, 10) || 0);
      const p = byId(it.product_id); $('[data-sub]', tr).textContent = num(it.qty * (opts.cost ? it.cost : (p?.price || 0))); changed();
    });
    tb.addEventListener('click', (e) => { if (e.target.closest('[data-del]')) { items.splice(+e.target.closest('tr').dataset.i, 1); render(); } });
    render();
    return { get: () => items.filter((i) => i.qty > 0).map((i) => ({ product_id: i.product_id, qty: i.qty, cost: i.cost })), set: (x) => { items = x.map((i) => ({ ...i })); render(); }, focus: () => inp.focus() };
  };
})();
