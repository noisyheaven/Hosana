/* Halaman: Dashboard, Kasir (POS), Pemesanan, Riwayat Penjualan */
(function () {
  const A = window.App, { $, $$, esc, num, rp, fmtDT, ymd, can, badge, PAY, ORDER_ST } = A;
  const compact = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.0', '') + 'jt' : n >= 1e3 ? Math.round(n / 1e3) + 'rb' : String(n));
  const waLink = (phone, text = '') => { let d = String(phone || '').replace(/\D/g, ''); if (d.startsWith('0')) d = '62' + d.slice(1); return `https://wa.me/${d}${text ? '?text=' + encodeURIComponent(text) : ''}`; };
  const chan = { pos: 'Kasir', online: 'Online', order: 'Pesanan' };

  // ---------- detail transaksi (dipakai banyak halaman) ----------
  A.showSale = async function (id, onChange) {
    const s = await A.api('/sales/' + id);
    const m = A.modal(`Transaksi ${s.invoice_no}`, `
      <div class="row between"><div>${s.status === 'void' ? '<span class="badge bad">DIBATALKAN</span>' : '<span class="badge ok">LUNAS</span>'} <span class="badge">${esc(chan[s.channel] || s.channel)}</span></div><div class="muted small">${esc(fmtDT(s.created_at))}</div></div>
      <dl class="kv gap-s"><dt>Kasir</dt><dd>${esc(s.cashier || '-')}</dd><dt>Pelanggan</dt><dd>${esc(s.customer_name || '-')} ${esc(s.customer_phone || '')}</dd><dt>Pembayaran</dt><dd>${esc(PAY[s.payment_method] || s.payment_method)}</dd>${s.void_reason ? `<dt>Alasan batal</dt><dd>${esc(s.void_reason)}</dd>` : ''}</dl>
      <div class="tablewrap gap-s"><table class="t"><thead><tr><th>Barang</th><th class="num">Harga</th><th class="num">Qty</th><th class="num">Jumlah</th></tr></thead><tbody>${s.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${num(i.price)}</td><td class="num">${i.qty}</td><td class="num">${num(i.price * i.qty)}</td></tr>`).join('')}</tbody></table></div>
      <div class="totalbox"><div class="row between"><span>Subtotal</span><b>${rp(s.subtotal)}</b></div>${s.discount ? `<div class="row between"><span>Diskon</span><b>-${rp(s.discount)}</b></div>` : ''}<div class="row between"><span>Total</span><span class="big">${rp(s.total)}</span></div><div class="row between small muted"><span>Dibayar ${rp(s.paid)}</span><span>Kembali ${rp(s.change_amount)}</span></div></div>`,
      { footer: `${can('admin') && s.status === 'paid' && !s.order_id ? '<button class="btn danger" data-void>Batalkan (void)</button>' : ''}<button class="btn" data-inv>🧾 Invoice A4</button><button class="btn primary" data-rc>🖨 Cetak struk</button>` });
    m.q('[data-rc]').onclick = () => A.print(A.receiptHtml(s));
    m.q('[data-inv]').onclick = () => A.print(A.invoiceHtml(s));
    const v = m.q('[data-void]');
    if (v) v.onclick = async () => {
      const reason = await A.prompt('Batalkan transaksi', 'Alasan pembatalan (wajib)', '', { ok: 'Batalkan transaksi' }); if (!reason) return;
      try { await A.api(`/sales/${id}/void`, { method: 'POST', body: { reason } }); A.toast('Transaksi dibatalkan, stok dikembalikan', 'ok'); m.close(); onChange && onChange(); } catch (e) { A.fail(e); }
    };
  };

  // ---------- Dashboard ----------
  A.pages.dashboard = {
    title: 'Dashboard',
    async render(v) {
      v.innerHTML = '<div class="empty">Memuat dashboard…</div>';
      const d = await A.api('/dashboard');
      const max = Math.max(1, ...d.series.map((x) => x.revenue));
      const stat = (l, val, s = '', cls = '') => `<div class="stat ${cls}"><div class="l">${l}</div><div class="v">${val}</div><div class="s">${s}</div></div>`;
      v.innerHTML = `
        <div class="stats">
          ${stat('Omzet hari ini', rp(d.today.revenue), `${d.today.trx} transaksi`, 'accent')}
          ${stat('Barang terjual hari ini', num(d.today.items), 'item')}
          ${stat('Omzet bulan ini', rp(d.month.revenue), `${d.month.trx} transaksi`)}
          ${stat('Pesanan aktif', d.orders.aktif, `<a href="#/pesanan">${d.orders.baru} baru · ${d.orders.belum_bayar} belum dibayar</a>`)}
          ${d.po_open !== undefined ? stat('PO berjalan', d.po_open, '<a href="#/po">lihat PO</a>') : ''}
          ${d.stock_value ? stat('Nilai stok (harga beli)', rp(d.stock_value.store + d.stock_value.warehouse), `Toko ${compact(d.stock_value.store)} · Gudang ${compact(d.stock_value.warehouse)}`) : ''}
        </div>
        <div class="cols gap">
          <div class="card"><div class="row between"><h2>Omzet 14 hari terakhir</h2></div>
            <div class="bars">${d.series.map((x, i) => `<div class="bar ${i === d.series.length - 1 ? 'today' : ''}" title="${esc(x.date)}: ${rp(x.revenue)} (${x.trx} trx)"><em>${x.revenue ? compact(x.revenue) : ''}</em><i style="height:${Math.max(1, Math.round((x.revenue / max) * 100))}%"></i><span>${x.date.slice(8)}</span></div>`).join('')}</div></div>
          <div class="card"><h2>Pembayaran hari ini</h2><div class="list">${d.by_method.length ? d.by_method.map((m) => `<div><span>${esc(PAY[m.method] || m.method)} <span class="muted small">(${m.trx})</span></span><b>${rp(m.revenue)}</b></div>`).join('') : '<div class="muted">Belum ada transaksi</div>'}</div></div>
        </div>
        <div class="cols gap">
          <div class="card flush"><div style="padding:16px 16px 0"><div class="row between"><h2>Transaksi terakhir</h2><a href="#/penjualan" class="small">Semua</a></div></div>
            <div class="tablewrap"><table class="t"><tbody>${d.recent.map((s) => `<tr class="click" data-sale="${s.id}"><td><b>${esc(s.invoice_no)}</b><div class="small muted">${esc(fmtDT(s.created_at))}</div></td><td>${esc(PAY[s.payment_method] || s.payment_method)}</td><td class="num">${rp(s.total)}</td><td>${s.status === 'void' ? '<span class="badge bad">void</span>' : ''}</td></tr>`).join('') || '<tr><td class="empty">Belum ada transaksi</td></tr>'}</tbody></table></div></div>
          <div class="grid">
            <div class="card"><h2>Terlaris (30 hari)</h2><div class="list">${d.top.length ? d.top.map((t, i) => `<div><span>${i + 1}. ${esc(t.name)}</span><b>${t.qty}×</b></div>`).join('') : '<div class="muted">Belum ada data</div>'}</div></div>
            <div class="card"><div class="row between"><h2>Stok toko menipis</h2><a href="#/stok" class="small">Kelola</a></div><div class="list">${d.low.length ? d.low.map((p) => `<div><span>${esc(p.name)}<div class="small muted">Gudang: ${p.wh_qty}</div></span><span class="badge ${p.store_qty <= 0 ? 'bad' : 'warn'}">${p.store_qty} / min ${p.min_stock}</span></div>`).join('') : '<div class="muted">Semua stok aman 👍</div>'}</div></div>
          </div>
        </div>`;
      $$('[data-sale]', v).forEach((tr) => (tr.onclick = () => A.showSale(+tr.dataset.sale, () => A.go('dashboard'))));
    },
  };

  // ---------- Kasir ----------
  A.pages.kasir = {
    title: 'Kasir',
    async render(v) {
      await Promise.all([A.loadProducts(), A.loadCats()]);
      const allowNeg = A.state.settings.allow_negative_stock === '1';
      let cart = []; let cat = ''; let method = 'tunai';
      const auto = () => localStorage.getItem('autoPrint') === '1';
      v.innerHTML = `<div class="pos">
        <div class="card"><div class="scanbar"><input class="inp" id="q" placeholder="Scan barcode / ketik nama atau SKU… (Enter)" autocomplete="off" autofocus><button class="btn" id="cam">📷 Scan</button></div>
          <div class="chips gap-s" id="cats"></div><div class="pgrid gap-s" id="grid"></div></div>
        <div class="card cart"><div class="row between"><h2>Keranjang</h2><button class="btn sm" id="clear">Kosongkan</button></div>
          <div id="lines"></div>
          <details class="gap-s"><summary class="small muted" style="cursor:pointer">Data pelanggan (opsional)</summary><div class="grid g2 gap-s"><input class="inp" id="cn" placeholder="Nama"><input class="inp" id="cp" placeholder="No. HP"></div></details>
          <div class="totalbox"><div class="row between"><span>Subtotal</span><b id="sub">0</b></div><div class="row between"><span>Diskon (Rp)</span><input class="inp" id="disc" type="number" min="0" value="0" style="width:130px;text-align:right"></div><div class="row between"><span><b>TOTAL</b></span><span class="big" id="tot">Rp 0</span></div></div>
          <div class="chips" id="meth">${['tunai', 'qris', 'transfer', 'debit'].map((m) => `<button class="chip ${m === method ? 'on' : ''}" data-m="${m}">${PAY[m]}</button>`).join('')}</div>
          <div id="cashbox" class="gap-s"><label class="f">Uang diterima</label><input class="inp" id="paid" type="number" min="0" inputmode="numeric"><div class="chips gap-s" id="quick"></div><div class="row between gap-s"><span class="muted">Kembalian</span><b id="chg" style="font-size:1.2rem">Rp 0</b></div></div>
          <label class="chk gap-s small"><input type="checkbox" id="auto" ${auto() ? 'checked' : ''}> Cetak struk otomatis setelah bayar</label>
          <button class="btn primary lg block gap-s" id="pay">Bayar</button></div></div>`;
      const q = $('#q', v);
      const total = () => Math.max(0, cart.reduce((a, l) => a + l.p.price * l.qty, 0) - Math.min(+$('#disc', v).value || 0, cart.reduce((a, l) => a + l.p.price * l.qty, 0)));
      const sub = () => cart.reduce((a, l) => a + l.p.price * l.qty, 0);
      const paintCats = () => { $('#cats', v).innerHTML = `<button class="chip ${cat === '' ? 'on' : ''}" data-c="">Semua</button>` + A.state.cats.map((c) => `<button class="chip ${String(cat) === String(c.id) ? 'on' : ''}" data-c="${c.id}">${esc(c.name)}</button>`).join(''); };
      const paintGrid = () => {
        const t = q.value.trim().toLowerCase();
        const list = A.state.products.filter((p) => (!cat || String(p.category_id) === String(cat)) && (!t || `${p.name} ${p.sku} ${p.barcode || ''}`.toLowerCase().includes(t))).slice(0, 150);
        $('#grid', v).innerHTML = list.map((p) => `<button class="pcard ${p.store_qty <= 0 && !allowNeg ? 'out' : ''}" data-id="${p.id}">${A.thumb(p)}<div class="nm">${esc(p.name)}</div><div class="pr">${rp(p.price)}</div><div class="st">Stok ${p.store_qty}${p.store_qty <= p.min_stock ? ' ⚠' : ''}</div></button>`).join('') || '<div class="empty" style="grid-column:1/-1">Barang tidak ditemukan</div>';
      };
      const paintCart = () => {
        $('#lines', v).innerHTML = cart.length ? cart.map((l, i) => `<div class="cartline"><div><b>${esc(l.p.name)}</b><div class="small muted">${rp(l.p.price)}</div></div><div class="right"><b>${num(l.p.price * l.qty)}</b></div>
          <div class="qtybox" data-i="${i}"><button data-d="-1">−</button><input type="number" min="1" value="${l.qty}" data-q><button data-d="1">+</button></div><div class="right"><button class="btn sm danger" data-rm="${i}">Hapus</button></div></div>`).join('') : '<div class="empty small">Scan atau pilih barang</div>';
        calc();
      };
      const calc = () => {
        $('#sub', v).textContent = num(sub()); $('#tot', v).textContent = rp(total());
        const paid = +$('#paid', v).value || 0; $('#chg', v).textContent = rp(Math.max(0, paid - total()));
        const t = total(); const q5 = [t, ...[20000, 50000, 100000, 200000].filter((x) => x > t)].slice(0, 4);
        $('#quick', v).innerHTML = t ? q5.map((x, i) => `<button class="chip" data-quick="${x}">${i === 0 ? 'Uang pas' : num(x)}</button>`).join('') : '';
      };
      const add = (p, n = 1) => {
        const ex = cart.find((l) => l.p.id === p.id); const have = ex ? ex.qty : 0;
        if (!allowNeg && have + n > p.store_qty) return A.toast(`Stok "${p.name}" hanya ${p.store_qty}`, 'err');
        if (ex) ex.qty += n; else cart.push({ p, qty: n });
        A.beep && 0; paintCart();
      };
      const byCode = (c) => A.state.products.find((p) => p.barcode === c || p.sku.toLowerCase() === c.toLowerCase());
      paintCats(); paintGrid(); paintCart();
      q.addEventListener('input', paintGrid);
      q.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return; e.preventDefault(); const t = q.value.trim(); if (!t) return;
        const ex = byCode(t); if (ex) { add(ex); q.value = ''; paintGrid(); return; }
        const list = A.state.products.filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(t.toLowerCase()));
        if (list.length === 1) { add(list[0]); q.value = ''; paintGrid(); } else if (!list.length) A.toast('Barang tidak ditemukan: ' + t, 'err');
      });
      $('#cam', v).onclick = () => A.scan((code) => { const p = byCode(code); p ? add(p) : A.toast('Barcode tidak dikenal: ' + code, 'err'); }, { continuous: true, title: 'Scan barang ke keranjang' });
      v.addEventListener('click', (e) => {
        const c = e.target.closest('[data-c]'); if (c) { cat = c.dataset.c; paintCats(); paintGrid(); }
        const g = e.target.closest('.pcard'); if (g) { add(A.state.products.find((p) => p.id === +g.dataset.id)); q.focus(); }
        const rm = e.target.closest('[data-rm]'); if (rm) { cart.splice(+rm.dataset.rm, 1); paintCart(); }
        const d = e.target.closest('[data-d]'); if (d) { const l = cart[+d.closest('[data-i]').dataset.i]; const n = l.qty + +d.dataset.d; if (n < 1) { cart.splice(cart.indexOf(l), 1); paintCart(); } else if (!allowNeg && n > l.p.store_qty) A.toast(`Stok hanya ${l.p.store_qty}`, 'err'); else { l.qty = n; paintCart(); } }
        const m = e.target.closest('[data-m]'); if (m) { method = m.dataset.m; $$('#meth .chip', v).forEach((x) => x.classList.toggle('on', x === m)); $('#cashbox', v).classList.toggle('hidden', method !== 'tunai'); }
        const k = e.target.closest('[data-quick]'); if (k) { $('#paid', v).value = k.dataset.quick; calc(); }
      });
      v.addEventListener('change', (e) => { if (e.target.matches('[data-q]')) { const l = cart[+e.target.closest('[data-i]').dataset.i]; const n = Math.max(1, parseInt(e.target.value, 10) || 1); if (!allowNeg && n > l.p.store_qty) { A.toast(`Stok hanya ${l.p.store_qty}`, 'err'); } else l.qty = n; paintCart(); } });
      $('#disc', v).addEventListener('input', calc); $('#paid', v).addEventListener('input', calc);
      $('#auto', v).onchange = (e) => localStorage.setItem('autoPrint', e.target.checked ? '1' : '0');
      $('#clear', v).onclick = () => { cart = []; paintCart(); };
      const doPay = async (btn) => {
        if (!cart.length) return A.toast('Keranjang masih kosong', 'err');
        const body = { items: cart.map((l) => ({ product_id: l.p.id, qty: l.qty })), discount: +$('#disc', v).value || 0, payment_method: method, paid: +$('#paid', v).value || 0, customer_name: $('#cn', v).value, customer_phone: $('#cp', v).value };
        if (method === 'tunai' && body.paid < total()) return A.toast('Uang yang diterima kurang', 'err');
        btn.disabled = true;
        try {
          const s = await A.api('/sales', { method: 'POST', body });
          s.items.forEach((it) => { const p = A.state.products.find((x) => x.id === it.product_id); if (p) p.store_qty -= it.qty; });
          cart = []; $('#disc', v).value = 0; $('#paid', v).value = ''; $('#cn', v).value = ''; $('#cp', v).value = ''; paintCart(); paintGrid();
          if (auto()) A.print(A.receiptHtml(s));
          const m = A.modal('Pembayaran berhasil ✔', `<div class="center"><div class="muted">${esc(s.invoice_no)}</div><div class="big" style="font-size:2rem;font-weight:800">${rp(s.total)}</div>${s.change_amount ? `<div class="gap-s">Kembalian</div><div style="font-size:1.8rem;font-weight:800;color:var(--ok)">${rp(s.change_amount)}</div>` : ''}</div>`,
            { footer: `<button class="btn" data-inv>🧾 Invoice A4</button><button class="btn" data-rc>🖨 Cetak struk</button><button class="btn primary" data-ok>Transaksi baru</button>`, onClose: () => q.focus() });
          m.q('[data-rc]').onclick = () => A.print(A.receiptHtml(s)); m.q('[data-inv]').onclick = () => A.print(A.invoiceHtml(s)); m.q('[data-ok]').onclick = () => m.close(); m.q('[data-ok]').focus();
        } catch (e) { A.fail(e); } finally { btn.disabled = false; }
      };
      $('#pay', v).onclick = (e) => doPay(e.currentTarget);
      $('#paid', v).addEventListener('keydown', (e) => { if (e.key === 'Enter') doPay($('#pay', v)); });
      q.focus();
    },
  };

  // ---------- Pemesanan ----------
  async function openOrder(id, refresh) {
    const o = await A.api('/orders/' + id);
    const closed = o.status === 'batal' || o.status === 'selesai';
    const nextBtns = closed ? '' : ['diproses', 'dikirim', 'selesai'].filter((s) => s !== o.status && !(o.status === 'dikirim' && s === 'diproses')).map((s) => `<button class="btn ${s === 'selesai' ? 'ok' : ''}" data-st="${s}">${{ diproses: 'Proses', dikirim: 'Tandai dikirim', selesai: 'Selesaikan' }[s]}</button>`).join('');
    const m = A.modal(`Pesanan ${o.order_no}`, `
      <div class="row">${badge(ORDER_ST, o.status)} ${o.payment_status === 'lunas' ? '<span class="badge ok">Lunas</span>' : '<span class="badge warn">Belum dibayar</span>'} <span class="badge">${esc(o.source)}</span><span class="muted small">${esc(fmtDT(o.created_at))}</span></div>
      <dl class="kv gap-s"><dt>Pelanggan</dt><dd>${esc(o.customer_name)}</dd><dt>HP / WA</dt><dd><a href="${waLink(o.phone, `Halo ${o.customer_name}, pesanan Anda ${o.order_no}…`)}" target="_blank" rel="noopener">${esc(o.phone)} (chat WA)</a></dd><dt>Alamat</dt><dd>${esc(o.address || '-')}</dd><dt>Catatan</dt><dd>${esc(o.notes || '-')}</dd><dt>Metode bayar</dt><dd>${esc(PAY[o.payment_method] || o.payment_method || '-')}</dd></dl>
      <div class="tablewrap gap-s"><table class="t"><thead><tr><th>Barang</th><th class="num">Harga</th><th class="num">Qty</th><th class="num">Jumlah</th></tr></thead><tbody>${o.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${num(i.price)}</td><td class="num">${i.qty}</td><td class="num">${num(i.price * i.qty)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="3" class="right"><b>Total</b></td><td class="num"><b>${rp(o.total)}</b></td></tr></tfoot></table></div>
      ${o.payment_status !== 'lunas' && o.status !== 'batal' ? `<div class="notice warn gap-s"><b>Catat pembayaran</b><div class="chips gap-s" id="pm">${['transfer', 'qris', 'tunai', 'debit'].map((x, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-m="${x}">${PAY[x]}</button>`).join('')}</div><button class="btn ok gap-s" id="dopay">Tandai LUNAS — ${rp(o.total)}</button></div>` : ''}
      ${o.sale ? `<div class="gap-s"><a href="#" data-sale="${o.sale.id}">Lihat invoice ${esc(o.sale.invoice_no)}</a></div>` : ''}`,
      { size: 'wide', footer: `${!closed ? '<button class="btn danger" data-cancel>Batalkan pesanan</button>' : ''}${nextBtns}` });
    let pm = 'transfer';
    m.qa('#pm .chip').forEach((c) => (c.onclick = () => { pm = c.dataset.m; m.qa('#pm .chip').forEach((x) => x.classList.toggle('on', x === c)); }));
    const run = async (fn, okMsg) => { try { await fn(); A.toast(okMsg, 'ok'); m.close(); refresh && refresh(); } catch (e) { A.fail(e); } };
    const dp = m.q('#dopay'); if (dp) dp.onclick = () => run(() => A.api(`/orders/${id}/pay`, { method: 'POST', body: { method: pm } }), 'Pembayaran dicatat');
    m.qa('[data-st]').forEach((b) => (b.onclick = () => run(() => A.api(`/orders/${id}/status`, { method: 'POST', body: { status: b.dataset.st } }), 'Status diperbarui')));
    const cn = m.q('[data-cancel]'); if (cn) cn.onclick = async () => { if (await A.confirm('Batalkan pesanan ini? Stok akan dikembalikan.', { danger: true, ok: 'Ya, batalkan' })) run(() => A.api(`/orders/${id}/status`, { method: 'POST', body: { status: 'batal' } }), 'Pesanan dibatalkan'); };
    const sl = m.q('[data-sale]'); if (sl) sl.onclick = (e) => { e.preventDefault(); A.showSale(+sl.dataset.sale); };
  }

  async function newOrder(refresh) {
    await A.loadProducts();
    const m = A.modal('Pesanan baru (telepon / WhatsApp / titip)', `<div class="grid g2"><div><label class="f">Nama pelanggan *</label><input class="inp" name="customer_name"></div><div><label class="f">No. HP / WA *</label><input class="inp" name="phone" inputmode="tel"></div></div>
      <div class="grid g2 gap-s"><div><label class="f">Alamat kirim</label><input class="inp" name="address"></div><div><label class="f">Sumber</label><select class="inp" name="source"><option value="wa">WhatsApp</option><option value="manual">Telepon / langsung</option></select></div></div>
      <div class="gap-s"><label class="f">Catatan</label><input class="inp" name="notes"></div><h3 class="gap">Barang</h3><div id="ed"></div>`,
      { size: 'xl', footer: '<button class="btn" data-n>Batal</button><button class="btn primary" data-y>Simpan pesanan</button>' });
    const ed = A.itemEditor(m.q('#ed'), { stock: 'store_qty' });
    m.q('[data-n]').onclick = () => m.close();
    m.q('[data-y]').onclick = async (e) => {
      const f = A.formData(m); const items = ed.get();
      try { await A.api('/orders', { method: 'POST', body: { ...f, items } }); A.toast('Pesanan dibuat, stok dipesan', 'ok'); m.close(); refresh(); } catch (er) { A.fail(er); }
    };
  }

  A.pages.pesanan = {
    title: 'Pemesanan',
    async render(v) {
      let st = 'aktif', term = ''; let timer;
      v.innerHTML = `<div class="row between"><div class="chips" id="f">${[['aktif', 'Aktif'], ['baru', 'Baru'], ['diproses', 'Diproses'], ['dikirim', 'Dikirim'], ['selesai', 'Selesai'], ['batal', 'Batal'], ['', 'Semua']].map(([k, l]) => `<button class="chip ${k === st ? 'on' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
        <div class="row"><input class="inp" id="q" placeholder="Cari no. / nama / HP" style="width:210px"><button class="btn primary" id="new">＋ Pesanan manual</button></div></div>
        <div class="card flush gap"><div class="tablewrap" id="tb"></div></div><p class="muted small">Pesanan dari toko online masuk otomatis (halaman ini menyegarkan diri tiap 30 detik). Stok toko langsung "dipesan" saat pesanan dibuat dan dikembalikan jika dibatalkan.</p>`;
      const load = async () => {
        const rows = await A.api(`/orders?status=${encodeURIComponent(st)}&q=${encodeURIComponent(term)}`);
        $('#tb', v).innerHTML = rows.length ? `<table class="t"><thead><tr><th>No. Pesanan</th><th>Pelanggan</th><th class="num">Item</th><th class="num">Total</th><th>Bayar</th><th>Status</th></tr></thead><tbody>${rows.map((o) => `<tr class="click" data-id="${o.id}"><td><b>${esc(o.order_no)}</b><div class="small muted">${esc(fmtDT(o.created_at))} · ${esc(o.source)}</div></td><td>${esc(o.customer_name)}<div class="small muted">${esc(o.phone)}</div></td><td class="num">${o.items}</td><td class="num">${rp(o.total)}</td><td>${o.payment_status === 'lunas' ? '<span class="badge ok">Lunas</span>' : '<span class="badge warn">Belum</span>'}</td><td>${badge(ORDER_ST, o.status)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Tidak ada pesanan</div>';
        $$('tr[data-id]', v).forEach((tr) => (tr.onclick = () => openOrder(+tr.dataset.id, load).catch(A.fail)));
      };
      $('#f', v).onclick = (e) => { const b = e.target.closest('[data-s]'); if (!b) return; st = b.dataset.s; $$('#f .chip', v).forEach((x) => x.classList.toggle('on', x === b)); load().catch(A.fail); };
      $('#q', v).oninput = A.debounce((e) => { term = e.target.value; load().catch(A.fail); });
      $('#new', v).onclick = () => newOrder(load).catch(A.fail);
      await load(); timer = setInterval(() => { if (!document.querySelector('.ov')) load().catch(() => {}); }, 30000);
      return () => clearInterval(timer);
    },
  };

  // ---------- Riwayat penjualan ----------
  A.pages.penjualan = {
    title: 'Riwayat Penjualan',
    async render(v) {
      let from = can('admin') ? ymd(new Date(Date.now() - 6 * 864e5)) : ymd(), to = ymd(), term = '';
      v.innerHTML = `<div class="row"><div><label class="f">Dari</label><input class="inp" type="date" id="fr" value="${from}"></div><div><label class="f">Sampai</label><input class="inp" type="date" id="to" value="${to}"></div><div class="grow"><label class="f">Cari invoice / pelanggan</label><input class="inp" id="q"></div></div>
        <div class="card flush gap"><div class="tablewrap" id="tb"></div></div>`;
      const load = async () => {
        const rows = await A.api(`/sales?from=${from}&to=${to}&q=${encodeURIComponent(term)}`);
        const sum = rows.filter((r) => r.status === 'paid').reduce((a, r) => a + r.total, 0);
        $('#tb', v).innerHTML = rows.length ? `<table class="t"><thead><tr><th>Invoice</th><th>Kanal</th><th>Pelanggan</th><th>Kasir</th><th>Metode</th><th class="num">Item</th><th class="num">Total</th><th></th></tr></thead><tbody>${rows.map((s) => `<tr class="click" data-id="${s.id}"><td><b>${esc(s.invoice_no)}</b><div class="small muted">${esc(fmtDT(s.created_at))}</div></td><td>${esc(chan[s.channel] || s.channel)}</td><td>${esc(s.customer_name || '-')}</td><td>${esc(s.cashier || '-')}</td><td>${esc(PAY[s.payment_method] || s.payment_method)}</td><td class="num">${s.items}</td><td class="num">${rp(s.total)}</td><td>${s.status === 'void' ? '<span class="badge bad">void</span>' : ''}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="6" class="right"><b>Total (tanpa void)</b></td><td class="num"><b>${rp(sum)}</b></td><td></td></tr></tfoot></table>` : '<div class="empty">Tidak ada transaksi</div>';
        $$('tr[data-id]', v).forEach((tr) => (tr.onclick = () => A.showSale(+tr.dataset.id, load).catch(A.fail)));
      };
      $('#fr', v).onchange = (e) => { from = e.target.value; load().catch(A.fail); }; $('#to', v).onchange = (e) => { to = e.target.value; load().catch(A.fail); };
      $('#q', v).oninput = A.debounce((e) => { term = e.target.value; load().catch(A.fail); });
      if (!can('admin')) v.insertAdjacentHTML('beforeend', '<p class="muted small">Sebagai staf, Anda hanya melihat transaksi 3 hari terakhir.</p>');
      await load();
    },
  };
})();
