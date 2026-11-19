/* Halaman: Dashboard, Kasir (POS), Sales Order (SO), Riwayat Penjualan */
(function () {
  const A = window.App, { $, $$, esc, num, rp, fmtDT, ymd, can, badge, PAY, ORDER_ST } = A;
  const compact = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.0', '') + 'jt' : n >= 1e3 ? Math.round(n / 1e3) + 'rb' : String(n));
  const waLink = (phone, text = '') => { let d = String(phone || '').replace(/\D/g, ''); if (d.startsWith('0')) d = '62' + d.slice(1); return `https://wa.me/${d}${text ? '?text=' + encodeURIComponent(text) : ''}`; };
  const chan = { pos: 'Kasir', online: 'Online', order: 'Pesanan' };

  // ---------- dialog retur customer ----------
  async function openSaleReturn(sale, onDone) {
    const eligible = sale.items.filter((it) => it.remaining_qty > 0);
    if (!eligible.length) return A.toast('Semua barang pada transaksi ini sudah diretur', 'err');
    const unitRefund = (it) => sale.subtotal > 0 ? Math.round(it.price * sale.total / sale.subtotal) : 0;
    const m = A.modal(`Retur barang · ${sale.invoice_no}`, `
      <div class="notice warn">Refund akan otomatis dicatat sebagai <b>Pengeluaran Kas</b>. Barang yang layak jual dapat dimasukkan kembali ke stok; barang rusak dapat ditandai tidak masuk stok.</div>
      <div class="grid g2 gap-s"><div><label class="f">Masukkan kembali ke lokasi stok</label><select class="inp" id="retloc">${A.locOptions(Object.keys(A.LOC), 'display')}</select></div><div><label class="f">Sisa nilai yang dapat direfund</label><div class="inp" style="font-weight:800">${rp(sale.remaining_refundable)}</div></div></div>
      <div class="tablewrap gap-s"><table class="t"><thead><tr><th>Barang</th><th class="num">Sisa</th><th class="num">Qty retur</th><th>Masuk stok?</th><th class="num">Refund</th></tr></thead><tbody>
      ${eligible.map((it) => `<tr data-ri="${it.id}" data-price="${unitRefund(it)}"><td><b>${esc(it.name)}</b><div class="small muted">${rp(it.price)} / unit</div></td><td class="num">${it.remaining_qty}</td><td class="num"><input class="inp" data-rqty type="number" min="0" max="${it.remaining_qty}" value="0" style="width:78px;text-align:right"></td><td><label class="chk small"><input type="checkbox" data-restock checked> Ya</label></td><td class="num" data-line-refund>Rp 0</td></tr>`).join('')}
      </tbody></table></div>
      <div class="totalbox"><div class="row between"><b>Total refund</b><span class="big" id="retTotal">${rp(0)}</span></div></div>
      <label class="f gap-s">Alasan retur *</label><input class="inp" id="retReason" placeholder="Contoh: barang cacat / salah barang / tidak sesuai">
      <label class="f gap-s">Catatan tambahan</label><textarea class="inp" id="retNote" rows="2" placeholder="Kondisi barang, bukti, atau keterangan lain"></textarea>`,
      { size: 'xl', footer: '<button class="btn" data-cancel>Batal</button><button class="btn primary" data-save>Simpan retur & proses refund</button>' });
    const calc = () => {
      let total = 0;
      m.qa('tbody tr[data-ri]').forEach((tr) => {
        const qty = Math.max(0, Math.min(+tr.querySelector('[data-rqty]').value || 0, +tr.querySelector('[data-rqty]').max));
        const value = qty * +tr.dataset.price; total += value;
        tr.querySelector('[data-line-refund]').textContent = rp(value);
      });
      m.q('#retTotal').textContent = rp(total);
      m.q('[data-save]').disabled = total <= 0 || total > sale.remaining_refundable;
      return total;
    };
    m.qa('[data-rqty]').forEach((x) => x.addEventListener('input', calc));
    m.q('[data-cancel]').onclick = () => m.close();
    m.q('[data-save]').onclick = async () => {
      const items = m.qa('tbody tr[data-ri]').map((tr) => ({
        sale_item_id: +tr.dataset.ri, qty: +tr.querySelector('[data-rqty]').value || 0,
        restock: tr.querySelector('[data-restock]').checked,
      })).filter((x) => x.qty > 0);
      try {
        const result = await A.api(`/sales/${sale.id}/returns`, { method: 'POST', body: {
          items, location: m.q('#retloc').value, reason: m.q('#retReason').value,
          note: m.q('#retNote').value,
        } });
        A.toast(`Retur ${result.return_no} tersimpan · Refund ${rp(result.refund_amount)} dicatat di kas`, 'ok');
        m.close(); onDone && onDone();
      } catch (e) { A.fail(e); }
    };
  }

  // ---------- detail transaksi (dipakai banyak halaman) ----------
  A.showSale = async function (id, onChange) {
    const s = await A.api('/sales/' + id);
    const m = A.modal(`Transaksi ${s.invoice_no}`, `
      <div class="row between"><div>${s.status === 'void' ? '<span class="badge bad">DIBATALKAN</span>' : '<span class="badge ok">LUNAS</span>'} <span class="badge">${esc(chan[s.channel] || s.channel)}</span></div><div class="muted small">${esc(fmtDT(s.created_at))}</div></div>
      <dl class="kv gap-s"><dt>Kasir</dt><dd>${esc(s.cashier || '-')}</dd><dt>Pelanggan</dt><dd>${esc(s.customer_name || '-')} ${esc(s.customer_phone || '')}</dd><dt>Pembayaran</dt><dd>${esc(PAY[s.payment_method] || s.payment_method)}</dd>${s.void_reason ? `<dt>Alasan batal</dt><dd>${esc(s.void_reason)}</dd>` : ''}</dl>
      <div class="tablewrap gap-s"><table class="t"><thead><tr><th>Barang</th><th class="num">Harga</th><th class="num">Qty</th><th class="num">Jumlah</th></tr></thead><tbody>${s.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${num(i.price)}</td><td class="num">${i.qty}</td><td class="num">${num(i.price * i.qty)}</td></tr>`).join('')}</tbody></table></div>
      <div class="totalbox"><div class="row between"><span>Subtotal</span><b>${rp(s.subtotal)}</b></div>${A.saleExtras(s).filter((x) => x.kind !== 'taxin').map((x) => `<div class="row between"><span>${esc(x.label)}</span><b>${x.amount < 0 ? '-' : ''}${rp(Math.abs(x.amount))}</b></div>`).join('')}<div class="row between"><span>Total</span><span class="big">${rp(s.total)}</span></div>${A.saleExtras(s).filter((x) => x.kind === 'taxin').map((x) => `<div class="row between small muted"><span>${esc(x.label)}</span><span>${rp(x.amount)}</span></div>`).join('')}<div class="row between small muted"><span>Dibayar ${rp(s.paid)}</span><span>Kembali ${rp(s.change_amount)}</span></div></div>
      ${s.returns && s.returns.length ? `<div class="card gap-s"><h3>Riwayat retur</h3>${s.returns.map((r) => `<div class="row between"><div><b>${esc(r.return_no)}</b><div class="small muted">${esc(fmtDT(r.created_at))} · ${esc(r.reason)}</div><div class="small muted">Pengeluaran kas: ${esc(r.expense_no || '-')}</div></div><b>${rp(r.refund_amount)}</b></div>`).join('')}</div>` : ''}
      ${s.returned_total ? `<div class="row between"><span>Total sudah direfund</span><b>${rp(s.returned_total)}</b></div>` : ''}`,
      { size: 'wide', footer: `${can('penjualan.retur') && s.status === 'paid' && s.remaining_refundable > 0 ? '<button class="btn ok" data-return>↩ Retur barang</button>' : ''}${can('penjualan.void') && s.status === 'paid' && !s.order_id && !s.returned_total ? '<button class="btn danger" data-void>Batalkan (void)</button>' : ''}<button class="btn" data-inv>🧾 Invoice A4</button><button class="btn primary" data-rc>🖨 Cetak struk</button>` });
    m.q('[data-rc]').onclick = () => A.print(A.receiptHtml(s));
    m.q('[data-inv]').onclick = () => A.print(A.invoiceHtml(s));
    const ret = m.q('[data-return]');
    if (ret) ret.onclick = () => openSaleReturn(s, () => { m.close(); onChange && onChange(); });
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
          ${d.stock_value ? stat('Nilai stok (harga beli)', rp(d.stock_value.display + d.stock_value.gudang_toko + d.stock_value.gudang_ruko), `Display ${compact(d.stock_value.display)} · G.Toko ${compact(d.stock_value.gudang_toko)} · G.Ruko ${compact(d.stock_value.gudang_ruko)}`) : ''}
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
            <div class="card"><div class="row between"><h2>Display Toko menipis</h2><a href="#/stok" class="small">Kelola</a></div><div class="list">${d.low.length ? d.low.map((p) => `<div><span>${esc(p.name)}<div class="small muted">Gdg Toko: ${p.gt_qty} · Gdg Ruko: ${p.gr_qty}</div></span><span class="badge ${p.display_qty <= 0 ? 'bad' : 'warn'}">${p.display_qty} / min ${p.min_stock}</span></div>`).join('') : '<div class="muted">Semua stok aman 👍</div>'}</div></div>
          </div>
        </div>`;
      $$('[data-sale]', v).forEach((tr) => (tr.onclick = () => A.showSale(+tr.dataset.sale, () => A.go('dashboard'))));
    },
  };

  // ---------- Kasir ----------
  // Tampilan "cari dulu": katalog tidak ditampilkan penuh. Kasir scan / ketik di kolom pencarian, hasil muncul sebagai daftar singkat,
  // keranjang menjadi pusat layar, dan pembayaran ada di panel samping (di HP: bilah bayar di bawah).
  A.pages.kasir = {
    title: 'Kasir',
    async render(v) {
      await Promise.all([A.loadProducts(), A.loadCats(), A.loadSettings()]);
      let customers = []; try { customers = await A.api('/customers'); } catch (_) {}
      const allowNeg = A.state.settings.allow_negative_stock === '1';
      const tax = window.HosanaCalc.taxConfig(A.state.settings);
      let cart = []; let method = 'tunai'; let results = []; let hl = 0; let flashId = null;
      const auto = () => localStorage.getItem('autoPrint') === '1';
      const getRecent = () => { try { return JSON.parse(localStorage.getItem('posRecent') || '[]'); } catch (_) { return []; } };
      const pushRecent = (id) => { try { localStorage.setItem('posRecent', JSON.stringify([id, ...getRecent().filter((x) => x !== id)].slice(0, 8))); } catch (_) {} };
      const byId = (id) => A.state.products.find((p) => p.id === +id);
      const byCode = (c) => A.state.products.find((p) => p.barcode === c || p.sku.toLowerCase() === c.toLowerCase());

      v.innerHTML = `<div class="pos2">
        <section class="pos2-main">
          <div class="cmd">
            <div class="cmd-bar"><span class="cmd-ic">🔍</span><input class="cmd-inp" id="q" placeholder="Scan / cari nama atau SKU…" autocomplete="off" autofocus><span class="kbd" title="Pintasan keyboard">F2</span><button class="btn" id="cam" title="Scan barcode dengan kamera">📷<span class="bt"> Scan</span></button><button class="btn" id="browse" title="Lihat barang per kategori">☰<span class="bt"> Jelajah</span></button></div>
            <div class="cmd-res hidden" id="res" role="listbox"></div>
          </div>
          <div class="recent hidden" id="recent"></div>
          <div class="card cartcard"><div class="row between"><h2>Keranjang <span class="badge" id="cnt">0</span></h2><button class="btn sm" id="clear">Kosongkan</button></div><div id="lines"></div></div>
        </section>
        <aside class="pos2-side" id="side"><div class="card payc">
          <div class="paytotal"><div class="muted">Total bayar</div><div class="big" id="tot">Rp 0</div><div class="muted" id="subline">Keranjang kosong</div></div>
          <div class="gap-s"><label class="f">Subtotal</label><div class="inp ro" id="sub">0</div></div>
          <div class="grid g2 gap-s"><div><label class="f">Diskon (Rp)</label><input class="inp" id="disc" type="number" min="0" value="0" inputmode="numeric"></div><div><label class="f">Diskon (%)</label><input class="inp" id="discp" type="number" min="0" max="100" step="0.01" value="0" inputmode="decimal"></div></div>
          <div class="brk gap-s hidden" id="brk"></div>
          <label class="f gap-s">Metode pembayaran</label>
          <div class="seg" id="meth">${['tunai', 'qris', 'transfer', 'debit'].map((m) => `<button type="button" class="${m === method ? 'on' : ''}" data-m="${m}">${PAY[m]}</button>`).join('')}</div>
          <div id="cashbox" class="gap-s"><label class="f">Uang diterima</label><input class="inp" id="paid" type="number" min="0" inputmode="numeric" style="font-size:1.15rem;font-weight:700"><div class="chips gap-s" id="quick"></div><div class="chgbox"><span>Kembalian</span><b id="chg">Rp 0</b></div></div>
          <details class="gap-s" open><summary class="small muted" style="cursor:pointer">Data pelanggan (opsional)</summary><label class="f">Pilih pelanggan terdaftar</label><select class="inp" id="csel"><option value="">— Input manual / tanpa pelanggan —</option>${customers.map((c) => `<option value="${c.id}">${esc(c.name)}${c.phone ? ` · ${esc(c.phone)}` : ""}</option>`).join("")}</select><div class="grid g2 gap-s"><input class="inp" id="cn" placeholder="Nama pelanggan"><input class="inp" id="cp" placeholder="No. HP / WA" inputmode="tel"></div><div class="small muted">Pelanggan baru dapat ditambahkan melalui menu Data Pelanggan.</div></details>
          <label class="chk gap-s small"><input type="checkbox" id="auto" ${auto() ? 'checked' : ''}> Cetak struk otomatis setelah bayar</label>
          <button class="btn primary lg block gap-s" id="pay" disabled>Bayar <span class="kbd">F9</span></button>
        </div></aside>
      </div>
      <div class="paybar"><div><div class="small muted" id="pbn">Keranjang kosong</div><b id="pbt">Rp 0</b></div><button class="btn primary lg" id="pbgo">Bayar</button></div>`;
      const q = $('#q', v), res = $('#res', v);
      $('#csel', v).onchange = () => {
        const c = customers.find((x) => x.id === +$('#csel', v).value);
        $('#cn', v).value = c?.name || ''; $('#cp', v).value = c?.phone || '';
      };

      // ---- hitung
      const sub = () => cart.reduce((a, l) => a + l.p.price * l.qty, 0);
      const cs = () => window.HosanaCalc.calcSale(sub(), +$('#disc', v).value || 0, parseFloat($('#discp', v).value) || 0, tax);
      const total = () => cs().total;
      const calc = () => {
        const c = cs(), t = c.total, n = cart.reduce((a, l) => a + l.qty, 0);
        $('#sub', v).textContent = num(sub());
        // rincian diskon & pajak (hanya tampil bila ada)
        const rows = [];
        if (c.discount > 0) rows.push(`<div class="row between"><span>Diskon${c.discount_pct > 0 ? ` (${String(c.discount_pct).replace('.', ',')}%${c.discount_rp_amount > 0 ? ' + Rp' : ''})` : ''}</span><b>-${rp(c.discount)}</b></div>`);
        if (tax.enabled && c.base > 0) rows.push(c.tax_mode === 'inclusive'
          ? `<div class="row between muted"><span>Sudah termasuk ${esc(tax.name)} ${String(tax.rate).replace('.', ',')}%</span><span>${rp(c.tax_amount)}</span></div>`
          : `<div class="row between"><span>${esc(tax.name)} ${String(tax.rate).replace('.', ',')}%</span><b>+${rp(c.tax_amount)}</b></div>`);
        const brk = $('#brk', v); brk.innerHTML = rows.join(''); brk.classList.toggle('hidden', !rows.length); $('#tot', v).textContent = rp(t); $('#pbt', v).textContent = rp(t);
        const info = n ? `${cart.length} jenis · ${n} item` : 'Keranjang kosong';
        $('#subline', v).textContent = info; $('#pbn', v).textContent = info; $('#cnt', v).textContent = n;
        const paid = +$('#paid', v).value || 0; $('#chg', v).textContent = rp(Math.max(0, paid - t));
        const q5 = [t, ...[20000, 50000, 100000, 200000].filter((x) => x > t)].slice(0, 4);
        $('#quick', v).innerHTML = t ? q5.map((x, i) => `<button type="button" class="chip" data-quick="${x}">${i === 0 ? 'Uang pas' : num(x)}</button>`).join('') : '';
        $('#pay', v).disabled = !cart.length; $('#pbgo', v).disabled = !cart.length;
      };

      // ---- keranjang
      const paintCart = () => {
        $('#lines', v).innerHTML = cart.length ? cart.map((l, i) => {
          const atMax = !allowNeg && l.qty >= l.p.display_qty;
          return `<div class="cl ${l.p.id === flashId ? 'flash' : ''}" data-i="${i}">${A.thumb(l.p, 'sm')}
            <div class="cl-n"><b>${esc(l.p.name)}</b><div class="small muted">${rp(l.p.price)}${atMax ? ' · <span style="color:var(--warn)">sudah maksimal stok display</span>' : ''}</div></div>
            <div class="qtybox"><button type="button" data-d="-1" aria-label="Kurangi">−</button><input type="number" min="1" value="${l.qty}" data-q inputmode="numeric"><button type="button" data-d="1" aria-label="Tambah">+</button></div>
            <div class="cl-t">${rp(l.p.price * l.qty)}</div><button type="button" class="cl-x" data-rm="${i}" aria-label="Hapus ${esc(l.p.name)}">✕</button></div>`;
        }).join('') : `<div class="cart-empty"><div class="ico">🧺</div><div><b>Keranjang masih kosong</b></div><div class="small gap-s">Scan barcode atau ketik nama barang di kolom pencarian di atas.<br><span class="kbd">F2</span> cari &nbsp; <span class="kbd">Enter</span> tambah &nbsp; <span class="kbd">F9</span> bayar</div></div>`;
        flashId = null; calc();
      };
      const paintRecent = () => {
        const list = getRecent().map(byId).filter(Boolean);
        const el = $('#recent', v); el.classList.toggle('hidden', !list.length);
        el.innerHTML = list.length ? `<span>Terakhir dijual:</span>` + list.map((p) => `<button type="button" class="rchip ${p.display_qty <= 0 && !allowNeg ? 'out' : ''}" data-rid="${p.id}" title="${esc(p.name)} · ${rp(p.price)}">${esc(p.name)}</button>`).join('') : '';
      };
      const add = (p, n = 1) => {
        const ex = cart.find((l) => l.p.id === p.id); const have = ex ? ex.qty : 0;
        if (!allowNeg && have + n > p.display_qty) return A.toast(`Stok Display Toko "${p.name}" hanya ${p.display_qty}`, 'err');
        if (ex) ex.qty += n; else cart.unshift({ p, qty: n });
        flashId = p.id; pushRecent(p.id); paintCart(); paintRecent();
      };

      // ---- pencarian
      const rank = (p, t) => { if (p.barcode === t || p.sku.toLowerCase() === t) return 0; const n = p.name.toLowerCase(); if (n.startsWith(t)) return 1; if (n.split(/\s+/).some((w) => w.startsWith(t))) return 2; return 3; };
      const search = (t) => {
        const full = t.toLowerCase(), toks = full.split(/\s+/).filter(Boolean); if (!toks.length) return [];
        return A.state.products.filter((p) => { const h = `${p.name} ${p.sku} ${p.barcode || ''}`.toLowerCase(); return toks.every((k) => h.includes(k)); })
          .sort((a, b) => rank(a, full) - rank(b, full) || a.name.localeCompare(b.name)).slice(0, 8);
      };
      const paintRes = () => {
        const t = q.value.trim(); if (!t) { res.classList.add('hidden'); results = []; return; }
        results = search(t); hl = Math.min(hl, Math.max(0, results.length - 1));
        res.innerHTML = results.length
          ? results.map((p, i) => `<button type="button" class="rrow ${i === hl ? 'act' : ''} ${p.display_qty <= 0 && !allowNeg ? 'out' : ''}" data-id="${p.id}" role="option">${A.thumb(p, 'sm')}<span class="rmain"><b>${esc(p.name)}</b><span class="small muted mono">${esc(p.sku)}${p.barcode ? ' · ' + esc(p.barcode) : ''}</span></span><span class="badge ${p.display_qty <= 0 ? 'bad' : p.display_qty <= p.min_stock ? 'warn' : 'ok'}">Stok ${p.display_qty}</span><span class="rpr">${rp(p.price)}</span></button>`).join('') + '<div class="rhint">↑ ↓ pilih · Enter tambah ke keranjang · Esc tutup</div>'
          : `<div class="rnone">Tidak ada barang untuk “<b>${esc(t)}</b>”.<div class="small">Coba kata lain, atau gunakan tombol Jelajah.</div></div>`;
        res.classList.remove('hidden');
      };
      const closeRes = () => { q.value = ''; hl = 0; paintRes(); };
      const pickAdd = (p) => { if (p) { add(p); closeRes(); q.focus(); } };
      q.addEventListener('input', () => { hl = 0; paintRes(); });
      q.addEventListener('focus', paintRes);
      q.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          if (!results.length) return; e.preventDefault();
          hl = (hl + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length; paintRes();
          const a = $('.rrow.act', res); if (a) a.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
          e.preventDefault(); const t = q.value.trim(); if (!t) return;
          const ex = byCode(t); if (ex) return pickAdd(ex); // scanner barcode / SKU persis: langsung masuk
          if (results.length) pickAdd(results[hl]); else A.toast('Barang tidak ditemukan: ' + t, 'err');
        } else if (e.key === 'Escape') closeRes();
      });
      res.addEventListener('mousedown', (e) => e.preventDefault()); // jaga fokus tetap di kolom pencarian
      res.addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) pickAdd(byId(b.dataset.id)); });
      const onDoc = (e) => { if (!e.target.closest('.cmd')) res.classList.add('hidden'); };
      document.addEventListener('click', onDoc);
      $('#cam', v).onclick = () => A.scan((code) => { const p = byCode(code); p ? add(p) : A.toast('Barcode tidak dikenal: ' + code, 'err'); }, { continuous: true, title: 'Scan barang ke keranjang' });

      // ---- jelajah per kategori (opsional, tidak tampil kecuali dibuka)
      $('#browse', v).onclick = () => {
        let cat = '', term = '';
        const m = A.modal('Jelajah barang', `<input class="inp" id="bq" placeholder="Filter nama / SKU (opsional)"><div class="chips gap-s" id="bc"></div><div class="pgrid gap-s" id="bg"></div>`, { size: 'xl' });
        const paint = () => {
          m.q('#bc').innerHTML = `<button class="chip ${cat === '' ? 'on' : ''}" data-c="">Semua</button>` + A.state.cats.map((c) => `<button class="chip ${String(cat) === String(c.id) ? 'on' : ''}" data-c="${c.id}">${esc(c.name)}</button>`).join('');
          const t = term.toLowerCase();
          const list = A.state.products.filter((p) => (!cat || String(p.category_id) === String(cat)) && (!t || `${p.name} ${p.sku} ${p.barcode || ''}`.toLowerCase().includes(t))).slice(0, 120);
          m.q('#bg').innerHTML = list.length ? list.map((p) => `<button class="pcard ${p.display_qty <= 0 && !allowNeg ? 'out' : ''}" data-id="${p.id}">${A.thumb(p)}<div class="nm">${esc(p.name)}</div><div class="pr">${rp(p.price)}</div><div class="st">Stok ${p.display_qty}</div></button>`).join('') : '<div class="empty">Tidak ada barang</div>';
        };
        m.q('#bq').oninput = A.debounce((e) => { term = e.target.value; paint(); }, 150);
        m.addEventListener('click', (e) => {
          const c = e.target.closest('[data-c]'); if (c) { cat = c.dataset.c; paint(); }
          const g = e.target.closest('.pcard'); if (g) { const p = byId(g.dataset.id); add(p); A.toast('Ditambahkan: ' + p.name, 'ok'); }
        });
        paint(); setTimeout(() => m.q('#bq').focus(), 30);
      };

      // ---- aksi keranjang & pembayaran
      const rc = $('#recent', v); rc.addEventListener('click', (e) => { const b = e.target.closest('[data-rid]'); if (b) { add(byId(b.dataset.rid)); q.focus(); } });
      $('#lines', v).addEventListener('click', (e) => {
        const rm = e.target.closest('[data-rm]'); if (rm) { cart.splice(+rm.dataset.rm, 1); paintCart(); return; }
        const d = e.target.closest('[data-d]'); if (!d) return;
        const l = cart[+d.closest('[data-i]').dataset.i]; const n = l.qty + +d.dataset.d;
        if (n < 1) { cart.splice(cart.indexOf(l), 1); paintCart(); } else if (!allowNeg && n > l.p.display_qty) A.toast(`Stok hanya ${l.p.display_qty}`, 'err'); else { l.qty = n; paintCart(); }
      });
      $('#lines', v).addEventListener('change', (e) => {
        if (!e.target.matches('[data-q]')) return;
        const l = cart[+e.target.closest('[data-i]').dataset.i]; const n = Math.max(1, parseInt(e.target.value, 10) || 1);
        if (!allowNeg && n > l.p.display_qty) A.toast(`Stok hanya ${l.p.display_qty}`, 'err'); else l.qty = n; paintCart();
      });
      $('#lines', v).addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-q]')) { e.target.blur(); q.focus(); } });
      $('#meth', v).addEventListener('click', (e) => {
        const m = e.target.closest('[data-m]'); if (!m) return; method = m.dataset.m;
        $$('#meth button', v).forEach((x) => x.classList.toggle('on', x === m)); $('#cashbox', v).classList.toggle('hidden', method !== 'tunai');
      });
      $('#quick', v).addEventListener('click', (e) => { const k = e.target.closest('[data-quick]'); if (k) { $('#paid', v).value = k.dataset.quick; calc(); } });
      $('#disc', v).addEventListener('input', calc); $('#discp', v).addEventListener('input', calc); $('#paid', v).addEventListener('input', calc);
      $('#auto', v).onchange = (e) => localStorage.setItem('autoPrint', e.target.checked ? '1' : '0');
      $('#clear', v).onclick = async () => { if (!cart.length) return; if (await A.confirm('Kosongkan keranjang?', { danger: true, ok: 'Kosongkan' })) { cart = []; paintCart(); q.focus(); } };
      $('#pbgo', v).onclick = () => { $('#side', v).scrollIntoView({ behavior: 'smooth', block: 'start' }); if (method === 'tunai') setTimeout(() => $('#paid', v).focus({ preventScroll: true }), 350); };

      const doPay = async (btn) => {
        if (!cart.length) return A.toast('Keranjang masih kosong', 'err');
        const body = { items: cart.map((l) => ({ product_id: l.p.id, qty: l.qty })), discount_rp: +$('#disc', v).value || 0, discount_pct: parseFloat($('#discp', v).value) || 0, payment_method: method, paid: +$('#paid', v).value || 0, customer_name: $('#cn', v).value, customer_phone: $('#cp', v).value };
        if (method === 'tunai' && body.paid < total()) return A.toast('Uang yang diterima kurang', 'err');
        btn.disabled = true;
        try {
          const s = await A.api('/sales', { method: 'POST', body });
          s.items.forEach((it) => { const p = byId(it.product_id); if (p) p.display_qty -= it.qty; });
          cart = []; $('#disc', v).value = 0; $('#discp', v).value = 0; $('#paid', v).value = ''; $('#cn', v).value = ''; $('#cp', v).value = ''; $('#csel', v).value = ''; paintCart(); paintRecent();
          if (auto()) A.print(A.receiptHtml(s));
          const m = A.modal('Pembayaran berhasil ✔', `<div class="center"><div class="muted">${esc(s.invoice_no)}</div><div class="big" style="font-size:2rem;font-weight:800">${rp(s.total)}</div>${s.change_amount ? `<div class="gap-s">Kembalian</div><div style="font-size:1.8rem;font-weight:800;color:var(--ok)">${rp(s.change_amount)}</div>` : ''}</div>`,
            { footer: `<button class="btn" data-inv>🧾 Invoice A4</button><button class="btn" data-rc>🖨 Cetak struk</button><button class="btn primary" data-ok>Transaksi baru</button>`, onClose: () => q.focus() });
          m.q('[data-rc]').onclick = () => A.print(A.receiptHtml(s)); m.q('[data-inv]').onclick = () => A.print(A.invoiceHtml(s)); m.q('[data-ok]').onclick = () => m.close(); m.q('[data-ok]').focus();
        } catch (e) { A.fail(e); } finally { btn.disabled = !cart.length; }
      };
      $('#pay', v).onclick = (e) => doPay(e.currentTarget);
      $('#paid', v).addEventListener('keydown', (e) => { if (e.key === 'Enter') doPay($('#pay', v)); });

      // pintasan keyboard: F2 = cari, F9 = bayar (diabaikan saat ada dialog terbuka)
      const onKey = (e) => {
        if (document.querySelector('.ov')) return;
        if (e.key === 'F2') { e.preventDefault(); q.focus(); q.select(); } else if (e.key === 'F9') { e.preventDefault(); doPay($('#pay', v)); }
      };
      document.addEventListener('keydown', onKey);

      paintCart(); paintRecent(); q.focus();
      return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('click', onDoc); };
    },
  };

  // ---------- Sales Order (SO) ----------
  const PAYST = { lunas: ['Lunas', 'ok'], sebagian: ['Dibayar sebagian', 'warn'], belum: ['Belum dibayar', 'warn'] };
  const siBadge = (o) => o.finalized ? `<span class="badge ok" title="Nota terkunci">🧾 ${esc(o.invoice.si_no)}</span>`
    : o.invoice && o.status === 'batal' ? `<span class="badge" title="Sales Invoice dibatalkan">${esc(o.invoice.si_no)} (void)</span>`
    : o.status === 'batal' ? '' : '<span class="badge warn" title="Nota masih bisa diedit">Draft nota</span>';

  async function openOrder(id, refresh) {
    const o = await A.api('/orders/' + id);
    const closed = o.status === 'batal' || o.status === 'selesai';
    const fin = o.finalized;
    const nextBtns = closed ? '' : ['diproses', 'dikirim', 'selesai'].filter((s) => s !== o.status && !(o.status === 'dikirim' && s === 'diproses')).map((s) => `<button class="btn ${s === 'selesai' ? 'ok' : ''}" data-st="${s}">${{ diproses: 'Proses', dikirim: 'Tandai dikirim', selesai: 'Selesaikan' }[s]}</button>`).join('');
    const packBtn = can('pesanan.packing') && o.status !== 'batal' ? (o.packed_at ? '<button class="btn" data-pack="undo">Batalkan status packing</button>' : '<button class="btn ok" data-pack="do">📦 Selesai packing</button>') : '';
    const editBtn = can('pesanan.edit') && !fin && !closed ? '<button class="btn" data-edit>✏ Edit nota</button>' : '';
    const finalBtn = can('pesanan.final') && !fin && o.status !== 'batal' ? '<button class="btn ok" data-final>✔ Finalkan & terbitkan SI</button>' : '';
    const reopenBtn = can('pesanan.final') && fin && !o.sale && !closed ? '<button class="btn" data-reopen>Buka kembali final</button>' : '';
    const invBtn = can('pesanan.invoice') && o.status !== 'batal' ? `<button class="btn primary" data-sinv ${fin ? '' : 'disabled title="Finalkan SO dulu"'}>🧾 Cetak Sales Invoice</button>` : '';
    const ps = PAYST[o.payment_status] || PAYST.belum;
    const m = A.modal(`Sales Order ${o.order_no}`, `
      <div class="row">${badge(ORDER_ST, o.status)} <span class="badge ${ps[1]}">${ps[0]}</span> ${siBadge(o)} <span class="badge">${esc(o.source)}</span>${o.packed_at ? '<span class="badge ok">📦 Sudah dipacking</span>' : '<span class="badge warn">Belum dipacking</span>'}<span class="muted small">${esc(fmtDT(o.created_at))}</span></div>
      <dl class="kv gap-s"><dt>Pelanggan</dt><dd>${esc(o.customer_name)}</dd><dt>HP / WA</dt><dd><a href="${waLink(o.phone, `Halo ${o.customer_name}, pesanan Anda ${o.order_no}…`)}" target="_blank" rel="noopener">${esc(o.phone)} (chat WA)</a></dd><dt>Alamat</dt><dd>${esc(o.address || '-')}</dd><dt>Catatan</dt><dd>${esc(o.notes || '-')}</dd><dt>Metode bayar</dt><dd>${esc(PAY[o.payment_method] || o.payment_method || '-')}</dd>${o.finalized ? `<dt>Sales Invoice</dt><dd><b>${esc(o.invoice.si_no)}</b> · terbit ${esc(fmtDT(o.invoice.issued_at))}${o.final_by_name ? ' oleh ' + esc(o.final_by_name) : ''}</dd>` : ''}</dl>
      <div class="tablewrap gap-s"><table class="t"><thead><tr><th>Barang</th><th class="num">Harga</th><th class="num">Qty</th><th class="num">Jumlah</th></tr></thead><tbody>${o.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${num(i.price)}</td><td class="num">${i.qty}</td><td class="num">${num(i.price * i.qty)}</td></tr>`).join('')}</tbody><tfoot>${o.discount ? `<tr><td colspan="3" class="right">Subtotal</td><td class="num">${rp(o.subtotal)}</td></tr><tr><td colspan="3" class="right">Diskon</td><td class="num">-${rp(o.discount)}</td></tr>` : ''}<tr><td colspan="3" class="right"><b>Total</b></td><td class="num"><b>${rp(o.total)}</b></td></tr>${o.paid_amount > 0 && o.payment_status !== 'lunas' ? `<tr><td colspan="3" class="right">Sudah dibayar</td><td class="num">${rp(o.paid_amount)}</td></tr><tr><td colspan="3" class="right"><b>Sisa tagihan</b></td><td class="num"><b>${rp(o.remaining)}</b></td></tr>` : ''}</tfoot></table></div>
      ${o.payment_status !== 'lunas' && o.status !== 'batal' ? `<div class="notice warn gap-s"><b>Catat pembayaran</b> <span class="small">(boleh kapan saja, sebelum atau sesudah SO difinalkan)</span><div class="chips gap-s" id="pm">${['transfer', 'qris', 'tunai', 'debit'].map((x, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-m="${x}">${PAY[x]}</button>`).join('')}</div><div class="row gap-s"><div><label class="f">Jumlah (Rp)</label><input class="inp" id="payamt" type="number" min="1" max="${o.remaining}" value="${o.remaining}" style="width:170px"></div><button class="btn ok" id="dopay">Catat pembayaran</button></div><div class="small muted gap-s">Sisa tagihan ${rp(o.remaining)}. Kurangi jumlahnya untuk pembayaran sebagian (DP / cicilan).</div></div>` : ''}
      ${o.packed_at ? `<div class="muted small gap-s">Selesai packing ${esc(fmtDT(o.packed_at))}${o.packed_by_name ? ' oleh ' + esc(o.packed_by_name) : ''}</div>` : ''}
      ${!fin && o.status !== 'batal' && (can('pesanan.final') || can('pesanan.invoice')) ? `<div class="notice gap-s">Nota masih <b>draft</b>${can('pesanan.edit') ? ' dan bisa diedit' : ''}. Setelah <b>Finalkan</b>, nota terkunci dan Sales Invoice terbit${o.payment_status === 'lunas' ? ' (SO sudah lunas, jadi transaksi penjualan langsung tercatat)' : ''}.</div>` : ''}
      ${fin && !o.sale && o.payment_status !== 'lunas' ? '<div class="notice gap-s">Transaksi penjualan (masuk laporan) tercatat otomatis begitu SO ini <b>lunas</b>.</div>' : ''}
      ${o.invoices.filter((x) => x.status === 'void').length ? `<div class="muted small gap-s">Sales Invoice dibatalkan: ${o.invoices.filter((x) => x.status === 'void').map((x) => `${esc(x.si_no)}${x.void_reason ? ' (' + esc(x.void_reason) + ')' : ''}`).join(', ')}</div>` : ''}
      ${o.sale && can('penjualan') ? `<div class="gap-s"><a href="#" data-sale="${o.sale.id}">Lihat transaksi ${esc(o.sale.invoice_no)}</a></div>` : ''}`,
      { size: 'wide', footer: `${!closed ? '<button class="btn danger" data-cancel>Batalkan SO</button>' : ''}${packBtn}${nextBtns}${editBtn}${reopenBtn}${finalBtn}${invBtn}` });
    let pm = 'transfer';
    m.qa('#pm .chip').forEach((c) => (c.onclick = () => { pm = c.dataset.m; m.qa('#pm .chip').forEach((x) => x.classList.toggle('on', x === c)); }));
    const run = async (fn, okMsg, after) => { try { await fn(); A.toast(okMsg, 'ok'); m.close(); refresh && refresh(); after && after(); } catch (e) { A.fail(e); } };
    const dp = m.q('#dopay'); if (dp) dp.onclick = () => run(() => A.api(`/orders/${id}/pay`, { method: 'POST', body: { method: pm, amount: +m.q('#payamt').value || 0 } }), 'Pembayaran dicatat');
    m.qa('[data-st]').forEach((b) => (b.onclick = () => run(() => A.api(`/orders/${id}/status`, { method: 'POST', body: { status: b.dataset.st } }), 'Status diperbarui')));
    const cn = m.q('[data-cancel]'); if (cn) cn.onclick = async () => { if (await A.confirm(`Batalkan Sales Order ini? Stok akan dikembalikan${fin ? ' dan Sales Invoice ' + o.invoice.si_no + ' ikut dibatalkan' : ''}.`, { danger: true, ok: 'Ya, batalkan' })) run(() => A.api(`/orders/${id}/status`, { method: 'POST', body: { status: 'batal' } }), 'Sales Order dibatalkan'); };
    const pk = m.q('[data-pack]'); if (pk) pk.onclick = () => run(() => A.api(`/orders/${id}/pack`, { method: 'POST', body: { packed: pk.dataset.pack !== 'undo' } }), pk.dataset.pack === 'undo' ? 'Status packing dibatalkan' : 'Pesanan ditandai selesai packing');
    const ed = m.q('[data-edit]'); if (ed) ed.onclick = () => { m.close(); editOrder(o, refresh).catch(A.fail); };
    const fn = m.q('[data-final]'); if (fn) fn.onclick = async () => { if (await A.confirm(`Finalkan ${o.order_no}? Nota (${rp(o.total)}) akan terkunci dan Sales Invoice terbit.`, { ok: 'Ya, finalkan' })) run(() => A.api(`/orders/${id}/finalize`, { method: 'POST', body: {} }), 'Sales Invoice terbit', () => openOrder(id, refresh).catch(A.fail)); };
    const ro = m.q('[data-reopen]'); if (ro) ro.onclick = async () => { const reason = await A.prompt('Buka kembali final', `Alasan (Sales Invoice ${o.invoice.si_no} akan dibatalkan, nomor baru terbit saat difinalkan lagi)`, '', { ok: 'Buka kembali', textarea: true }); if (reason && reason.trim()) run(() => A.api(`/orders/${id}/reopen`, { method: 'POST', body: { reason } }), 'Final dibuka, nota bisa diedit', () => openOrder(id, refresh).catch(A.fail)); };
    const si = m.q('[data-sinv]'); if (si && fin) si.onclick = async () => { try { A.print(A.invoiceHtml(await A.api(`/orders/${id}/invoice`))); } catch (e) { A.fail(e); } };
    const sl = m.q('[data-sale]'); if (sl) sl.onclick = (e) => { e.preventDefault(); A.showSale(+sl.dataset.sale); };
  }

  // Edit nota: hanya untuk SO yang belum difinalkan.
  async function editOrder(o, refresh) {
    await A.loadProducts(); let customers = []; try { customers = await A.api('/customers'); } catch (_) {}
    const m = A.modal(`Edit nota ${o.order_no}`, `<div class="notice gap-s">Perubahan qty langsung menyesuaikan stok yang dipesan dari <b>${esc(A.LOC[o.source_location] || o.source_location)}</b>. Setelah SO difinalkan, nota terkunci.</div>
      <div class="grid g2 gap-s"><div><label class="f">Nama pelanggan *</label><input class="inp" name="customer_name" list="customerList" value="${esc(o.customer_name)}"><datalist id="customerList">${customers.map((c) => `<option value="${esc(c.name)}"></option>`).join("")}</datalist></div><div><label class="f">No. HP / WA *</label><input class="inp" name="phone" inputmode="tel" value="${esc(o.phone)}"></div></div>
      <div class="grid g2 gap-s"><div><label class="f">Alamat kirim</label><input class="inp" name="address" value="${esc(o.address || '')}"></div><div><label class="f">Catatan</label><input class="inp" name="notes" value="${esc(o.notes || '')}"></div></div>
      <h3 class="gap">Barang</h3><div id="ed"></div>
      <div class="row gap-s" style="justify-content:flex-end;align-items:flex-end"><div><label class="f">Diskon nota (Rp)</label><input class="inp" name="discount" type="number" min="0" value="${o.discount || 0}" style="width:170px"></div><div class="right" style="min-width:210px"><div class="muted small" id="calcSub"></div><div><b id="calcTot"></b></div></div></div>`,
      { size: 'xl', footer: '<button class="btn" data-n>Batal</button><button class="btn primary" data-y>Simpan nota</button>' });
    const customerName = m.q('[name=customer_name]');
    customerName.onchange = () => { const c = customers.find((x) => x.name.toLowerCase() === customerName.value.trim().toLowerCase()); if (c) { m.q('[name=phone]').value = c.phone || ''; m.q('[name=address]').value = c.address || ''; } };
    const disc = m.q('[name=discount]');
    let cur = o.items.map((i) => ({ product_id: i.product_id, qty: i.qty, cost: i.price }));
    const recalc = () => { const sub = cur.reduce((t, i) => t + i.qty * i.cost, 0), d = Math.max(0, parseInt(disc.value, 10) || 0); m.q('#calcSub').textContent = `Subtotal ${rp(sub)}`; m.q('#calcTot').textContent = `Total ${rp(sub - d)}`; };
    const ed = A.itemEditor(m.q('#ed'), { cost: true, costLabel: 'Harga satuan', costOf: (p) => p.price, stock: 'all', items: cur, onChange: (it) => { cur = it; recalc(); } });
    disc.oninput = recalc; recalc();
    m.q('[data-n]').onclick = () => { m.close(); openOrder(o.id, refresh).catch(A.fail); };
    m.q('[data-y]').onclick = async () => {
      const f = A.formData(m);
      try { await A.api('/orders/' + o.id, { method: 'PUT', body: { customer_name: f.customer_name, phone: f.phone, address: f.address, notes: f.notes, discount: f.discount, items: ed.get().map((i) => ({ product_id: i.product_id, qty: i.qty, price: i.cost })) } }); A.toast('Nota disimpan', 'ok'); m.close(); refresh && refresh(); openOrder(o.id, refresh).catch(A.fail); } catch (er) { A.fail(er); }
    };
  }

  async function newOrder(refresh) {
    await A.loadProducts(); let customers = []; try { customers = await A.api('/customers'); } catch (_) {}
    const m = A.modal('Sales Order baru (telepon / WhatsApp / titip)', `<div class="grid g2"><div><label class="f">Nama pelanggan *</label><input class="inp" name="customer_name" list="customerList"><datalist id="customerList">${customers.map((c) => `<option value="${esc(c.name)}"></option>`).join("")}</datalist></div><div><label class="f">No. HP / WA *</label><input class="inp" name="phone" inputmode="tel"></div></div>
      <div class="grid g2 gap-s"><div><label class="f">Alamat kirim</label><input class="inp" name="address"></div><div><label class="f">Sumber</label><select class="inp" name="source"><option value="wa">WhatsApp</option><option value="manual">Telepon / langsung</option></select></div></div>
      <div class="grid g2 gap-s"><div><label class="f">Catatan</label><input class="inp" name="notes"></div><div><label class="f">Barang diambil dari</label><select class="inp" name="source_location">${A.locOptions(Object.keys(A.LOC), 'display')}</select></div></div><h3 class="gap">Barang</h3><div id="ed"></div>`,
      { size: 'xl', footer: '<button class="btn" data-n>Batal</button><button class="btn primary" data-y>Simpan SO</button>' });
    const customerName = m.q('[name=customer_name]');
    customerName.onchange = () => { const c = customers.find((x) => x.name.toLowerCase() === customerName.value.trim().toLowerCase()); if (c) { m.q('[name=phone]').value = c.phone || ''; m.q('[name=address]').value = c.address || ''; } };
    const ed = A.itemEditor(m.q('#ed'), { stock: 'all' });
    m.q('[data-n]').onclick = () => m.close();
    m.q('[data-y]').onclick = async (e) => {
      const f = A.formData(m); const items = ed.get();
      try { await A.api('/orders', { method: 'POST', body: { ...f, items } }); A.toast('Sales Order dibuat, stok dipesan', 'ok'); m.close(); refresh(); } catch (er) { A.fail(er); }
    };
  }

  A.pages.pesanan = {
    title: 'Sales Order (SO)',
    async render(v) {
      let st = 'aktif', term = ''; let timer;
      v.innerHTML = `<div class="row between"><div class="chips" id="f">${[['aktif', 'Aktif'], ['baru', 'Baru'], ['diproses', 'Diproses'], ['dikirim', 'Dikirim'], ['selesai', 'Selesai'], ['batal', 'Batal'], ['', 'Semua']].map(([k, l]) => `<button class="chip ${k === st ? 'on' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
        <div class="row"><input class="inp" id="q" placeholder="Cari no. SO / nama / HP" style="width:210px"><button class="btn primary" id="new">＋ SO manual</button></div></div>
        <div class="card flush gap"><div class="tablewrap" id="tb"></div></div><p class="muted small">Sales Order dari toko online masuk otomatis (halaman ini menyegarkan diri tiap 30 detik). Stok langsung "dipesan" (dipotong dari lokasi pengambilan, default Display Toko) saat pesanan dibuat dan dikembalikan jika SO dibatalkan.</p>`;
      const load = async () => {
        const rows = await A.api(`/orders?status=${encodeURIComponent(st)}&q=${encodeURIComponent(term)}`);
        $('#tb', v).innerHTML = rows.length ? `<table class="t"><thead><tr><th>No. SO</th><th>Pelanggan</th><th class="num">Item</th><th class="num">Diskon</th><th class="num">Total</th><th>Bayar</th><th>Sales Invoice</th><th>Status</th></tr></thead><tbody>${rows.map((o) => `<tr class="click" data-id="${o.id}"><td><b>${esc(o.order_no)}</b><div class="small muted">${esc(fmtDT(o.created_at))} · ${esc(o.source)}</div></td><td>${esc(o.customer_name)}<div class="small muted">${esc(o.phone)}</div></td><td class="num">${o.items}</td><td class="num">${rp(o.total)}</td><td>${o.payment_status === 'lunas' ? '<span class="badge ok">Lunas</span>' : o.payment_status === 'sebagian' ? '<span class="badge warn">Sebagian</span>' : '<span class="badge warn">Belum</span>'}</td><td>${o.si_no ? `<span class="badge ok">${esc(o.si_no)}</span>` : o.status === 'batal' ? '' : '<span class="badge">Draft</span>'}</td><td>${badge(ORDER_ST, o.status)}${o.packed_at && o.status !== 'batal' ? ' <span class="badge ok" title="Sudah dipacking">📦</span>' : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Tidak ada Sales Order</div>';
        $$('tr[data-id]', v).forEach((tr) => (tr.onclick = () => openOrder(+tr.dataset.id, load).catch(A.fail)));
      };
      $('#f', v).onclick = (e) => { const b = e.target.closest('[data-s]'); if (!b) return; st = b.dataset.s; $$('#f .chip', v).forEach((x) => x.classList.toggle('on', x === b)); load().catch(A.fail); };
      $('#q', v).oninput = A.debounce((e) => { term = e.target.value; load().catch(A.fail); });
      $('#new', v).onclick = () => newOrder(load).catch(A.fail);
      await load(); timer = setInterval(() => { if (!document.querySelector('.ov')) load().catch(() => {}); }, 30000);
      return () => clearInterval(timer);
    },
  };

  // ---------- Pengeluaran Kas ----------
  A.pages.kas = {
    title: 'Pengeluaran Kas',
    async render(v) {
      const cats = await A.api('/cash-categories');
      v.innerHTML = `<div class="cols"><div class="card"><h2>Catat pengeluaran kas</h2>
        <label class="f gap-s">Tanggal</label><input class="inp" type="date" id="kd" value="${ymd()}">
        <label class="f gap-s">Kategori *</label><select class="inp" id="kc">${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
        <label class="f gap-s">Keterangan *</label><input class="inp" id="kn" placeholder="Mis. beli plastik packing, ongkir paket">
        <label class="f gap-s">Jumlah (Rp) *</label><input class="inp" id="ka" inputmode="numeric" placeholder="0">
        <button class="btn primary gap" id="ks">Simpan pengeluaran</button>
        <p class="muted small">Pengeluaran yang sudah disimpan tidak bisa diubah atau dihapus oleh kasir. Bila salah input, tambahkan catatan di keterangan pengeluaran berikutnya dan beri tahu pemilik.</p></div>
        <div class="card flush"><div style="padding:16px 16px 0"><h2>Catatan saya hari ini</h2></div><div class="tablewrap" id="kl"></div></div></div>`;
      const load = async () => {
        const rows = await A.api('/cash-expenses/mine');
        const tot = rows.reduce((a, r) => a + r.amount, 0);
        $('#kl', v).innerHTML = rows.length ? `<table class="t"><thead><tr><th>Keterangan</th><th class="num">Jumlah</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.description)}<div class="small muted">${esc(r.category)} · ${esc(r.expense_no)} · ${esc(fmtDT(r.created_at))}</div></td><td class="num">${rp(r.amount)}</td></tr>`).join('')}</tbody><tfoot><tr><td class="right"><b>Total hari ini</b></td><td class="num"><b>${rp(tot)}</b></td></tr></tfoot></table>` : '<div class="empty">Belum ada pengeluaran yang Anda catat hari ini</div>';
      };
      const save = async () => {
        const amount = +String($('#ka', v).value).replace(/\D/g, '');
        const btn = $('#ks', v); btn.disabled = true;
        try {
          await A.api('/cash-expenses', { method: 'POST', body: { spent_at: $('#kd', v).value, category: $('#kc', v).value, description: $('#kn', v).value, amount } });
          A.toast('Pengeluaran kas dicatat', 'ok'); $('#kn', v).value = ''; $('#ka', v).value = ''; await load(); $('#kn', v).focus();
        } catch (e) { A.fail(e); } finally { btn.disabled = false; }
      };
      $('#ks', v).onclick = save;
      $('#ka', v).addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
      await load();
    },
  };

  // ---------- Laporan Pengeluaran Kas ----------
  A.pages.kas_laporan = {
    title: 'Laporan Pengeluaran Kas',
    async render(v) {
      const now = new Date(); let from = ymd(now), to = ymd(now);
      const presets = { 'Hari ini': () => [ymd(), ymd()], '7 hari': () => [ymd(new Date(Date.now() - 6 * 864e5)), ymd()], 'Bulan ini': () => [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd()], 'Bulan lalu': () => [ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), ymd(new Date(now.getFullYear(), now.getMonth(), 0))] };
      v.innerHTML = `<div class="row noprint" id="ctl"><div><label class="f">Dari</label><input class="inp" type="date" id="fr" value="${from}"></div><div><label class="f">Sampai</label><input class="inp" type="date" id="to" value="${to}"></div><div class="chips" style="align-self:end">${Object.keys(presets).map((k) => `<button class="chip" data-p="${k}">${k}</button>`).join('')}</div><span class="grow"></span><div class="row" style="align-self:end"><button class="btn" id="csv">⬇ CSV</button><button class="btn primary" id="prt">🖨 Cetak</button></div></div><div id="out" class="gap"></div>`;
      const load = async () => {
        const r = await A.api(`/reports/cash?from=${from}&to=${to}`);
        const tbl = (rows, cols) => rows.length ? `<table class="t"><thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}">${c.h}</th>`).join('')}</tr></thead><tbody>${rows.map((x) => `<tr>${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.f(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<div class="empty">Tidak ada data</div>';
        $('#out', v).innerHTML = `<h2 style="margin-bottom:10px">Pengeluaran kas ${esc(A.fmtD(from))} – ${esc(A.fmtD(to))}</h2>
          <div class="stats"><div class="stat accent"><div class="l">Total pengeluaran</div><div class="v">${rp(r.total.total)}</div><div class="s">${r.total.n} catatan</div></div></div>
          <div class="cols gap"><div class="card flush"><div style="padding:16px 16px 0"><h2>Per kategori</h2></div>${tbl(r.by_category, [{ h: 'Kategori', f: (x) => esc(x.category) }, { h: 'Jml', num: 1, f: (x) => x.n }, { h: 'Total', num: 1, f: (x) => num(x.total) }])}</div>
          <div class="card flush"><div style="padding:16px 16px 0"><h2>Rekap harian</h2></div>${tbl(r.daily, [{ h: 'Tanggal', f: (x) => esc(A.fmtD(x.date)) }, { h: 'Jml', num: 1, f: (x) => x.n }, { h: 'Total', num: 1, f: (x) => num(x.total) }])}</div></div>
          <div class="card flush gap"><div style="padding:16px 16px 0"><h2>Rincian</h2></div><div class="tablewrap">${tbl(r.rows, [{ h: 'Tanggal', f: (x) => esc(A.fmtD(x.spent_at)) }, { h: 'No.', f: (x) => esc(x.expense_no) }, { h: 'Kategori', f: (x) => esc(x.category) }, { h: 'Keterangan', f: (x) => esc(x.description || '') }, { h: 'Dicatat oleh', f: (x) => esc(x.user_name || '-') }, { h: 'Jumlah', num: 1, f: (x) => num(x.amount) }])}</div></div>`;
      };
      const reload = () => load().catch(A.fail);
      $('#fr', v).onchange = (e) => { from = e.target.value; reload(); }; $('#to', v).onchange = (e) => { to = e.target.value; reload(); };
      $('#ctl', v).addEventListener('click', (e) => { const p = e.target.closest('[data-p]'); if (!p) return; [from, to] = presets[p.dataset.p](); $('#fr', v).value = from; $('#to', v).value = to; reload(); });
      $('#csv', v).onclick = () => A.download(`/reports/export?type=cash&from=${from}&to=${to}`, `pengeluaran-kas-${from}_${to}.csv`).catch(A.fail);
      $('#prt', v).onclick = () => window.print();
      reload();
    },
  };

  // ---------- Riwayat penjualan ----------
  A.pages.penjualan = {
    title: 'Riwayat Penjualan',
    async render(v) {
      let from = can('penjualan.semua') ? ymd(new Date(Date.now() - 6 * 864e5)) : ymd(), to = ymd(), term = '';
      v.innerHTML = `<div class="row"><div><label class="f">Dari</label><input class="inp" type="date" id="fr" value="${from}"></div><div><label class="f">Sampai</label><input class="inp" type="date" id="to" value="${to}"></div><div class="grow"><label class="f">Cari invoice / pelanggan</label><input class="inp" id="q"></div></div>
        <div class="card flush gap"><div class="tablewrap" id="tb"></div></div>`;
      const load = async () => {
        const rows = await A.api(`/sales?from=${from}&to=${to}&q=${encodeURIComponent(term)}`);
        const sum = rows.filter((r) => r.status === 'paid').reduce((a, r) => a + r.total, 0);
        $('#tb', v).innerHTML = rows.length ? `<table class="t"><thead><tr><th>Invoice</th><th>Kanal</th><th>Pelanggan</th><th>Kasir</th><th>Metode</th><th class="num">Item</th><th class="num">Diskon</th><th class="num">Total</th><th></th></tr></thead><tbody>${rows.map((s) => `<tr class="click" data-id="${s.id}"><td><b>${esc(s.invoice_no)}</b><div class="small muted">${esc(fmtDT(s.created_at))}</div></td><td>${esc(chan[s.channel] || s.channel)}</td><td>${esc(s.customer_name || '-')}</td><td>${esc(s.cashier || '-')}</td><td>${esc(PAY[s.payment_method] || s.payment_method)}</td><td class="num">${s.items}</td><td class="num">${s.discount > 0 ? `<span class="badge warn">-${rp(s.discount)}</span>` : '-'}</td><td class="num">${rp(s.total)}</td><td>${s.status === 'void' ? '<span class="badge bad">void</span>' : ''}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="7" class="right"><b>Total (tanpa void)</b></td><td class="num"><b>${rp(sum)}</b></td><td></td></tr></tfoot></table>` : '<div class="empty">Tidak ada transaksi</div>';
        $$('tr[data-id]', v).forEach((tr) => (tr.onclick = () => A.showSale(+tr.dataset.id, load).catch(A.fail)));
      };
      $('#fr', v).onchange = (e) => { from = e.target.value; load().catch(A.fail); }; $('#to', v).onchange = (e) => { to = e.target.value; load().catch(A.fail); };
      $('#q', v).oninput = A.debounce((e) => { term = e.target.value; load().catch(A.fail); });
      if (!can('penjualan.semua')) v.insertAdjacentHTML('beforeend', '<p class="muted small">Anda hanya melihat transaksi Anda sendiri dalam 3 hari terakhir.</p>');
      await load();
    },
  };

  // ---------- Riwayat retur customer ----------
  A.pages.retur = {
    title: 'Retur Barang Customer',
    async render(v) {
      let from = ymd(new Date(Date.now() - 29 * 864e5)), to = ymd(), term = '';
      v.innerHTML = `<div class="row"><div><label class="f">Dari</label><input class="inp" type="date" id="retFrom" value="${from}"></div><div><label class="f">Sampai</label><input class="inp" type="date" id="retTo" value="${to}"></div><div class="grow"><label class="f">Cari retur / invoice / pelanggan</label><input class="inp" id="retQ"></div></div>
        <div class="card flush gap"><div class="tablewrap" id="retTable"></div></div>`;
      const load = async () => {
        const rows = await A.api(`/returns?from=${from}&to=${to}&q=${encodeURIComponent(term)}`);
        $('#retTable', v).innerHTML = rows.length ? `<table class="t"><thead><tr><th>No. Retur</th><th>Invoice asal</th><th>Pelanggan</th><th>Alasan</th><th>Dicatat oleh</th><th>Pengeluaran kas</th><th class="num">Refund</th><th>Waktu</th></tr></thead><tbody>${rows.map((r) => `<tr class="click" data-ret="${r.id}"><td><b>${esc(r.return_no)}</b></td><td>${esc(r.invoice_no)}</td><td>${esc(r.customer_name || '-')}</td><td>${esc(r.reason)}</td><td>${esc(r.user_name || '-')}</td><td>${esc(r.expense_no || '-')}</td><td class="num"><b>${rp(r.refund_amount)}</b></td><td>${esc(fmtDT(r.created_at))}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="6" class="right"><b>Total refund</b></td><td class="num"><b>${rp(rows.reduce((a, r) => a + r.refund_amount, 0))}</b></td><td></td></tr></tfoot></table>` : '<div class="empty">Belum ada retur pada periode ini</div>';
        $$('[data-ret]', v).forEach((tr) => tr.onclick = async () => {
          try {
            const r = await A.api('/returns/' + tr.dataset.ret);
            const m = A.modal(`Detail retur ${r.return_no}`, `<dl class="kv"><dt>Invoice</dt><dd>${esc(r.invoice_no)}</dd><dt>Pelanggan</dt><dd>${esc(r.customer_name || '-')}</dd><dt>Alasan</dt><dd>${esc(r.reason)}</dd><dt>Lokasi stok</dt><dd>${esc(A.LOC[r.location] || r.location)}</dd><dt>Pengeluaran kas</dt><dd>${esc(r.expense_no || '-')}</dd><dt>Dicatat oleh</dt><dd>${esc(r.user_name || '-')}</dd><dt>Waktu</dt><dd>${esc(fmtDT(r.created_at))}</dd></dl>
              <table class="t"><thead><tr><th>Barang</th><th class="num">Qty retur</th><th class="num">Masuk stok</th><th class="num">Refund</th></tr></thead><tbody>${r.items.map((it) => `<tr><td>${esc(it.name)}</td><td class="num">${it.qty}</td><td class="num">${it.restock_qty}</td><td class="num">${rp(it.qty * it.unit_refund)}</td></tr>`).join('')}</tbody></table><div class="totalbox"><div class="row between"><b>Total refund</b><span class="big">${rp(r.refund_amount)}</span></div></div>${r.note ? `<p>${esc(r.note)}</p>` : ''}`, { size: 'wide', footer: '<button class="btn primary" data-close> Tutup </button>' });
            m.q('[data-close]').onclick = () => m.close();
          } catch (e) { A.fail(e); }
        });
      };
      $('#retFrom', v).onchange = (e) => { from = e.target.value; load().catch(A.fail); };
      $('#retTo', v).onchange = (e) => { to = e.target.value; load().catch(A.fail); };
      $('#retQ', v).oninput = A.debounce((e) => { term = e.target.value; load().catch(A.fail); });
      await load();
    },
  };
})();