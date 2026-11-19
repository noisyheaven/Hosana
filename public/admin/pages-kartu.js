/* Kartu Stok: riwayat keluar-masuk satu barang (saldo awal, masuk, keluar, saldo berjalan) + cetak & ekspor CSV */
(function () {
  const A = window.App, { $, $$, esc, num, fmtDT, fmtD, ymd } = A;
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
  const RANGES = {
    semua: ['Semua', () => ['', '']],
    '7': ['7 hari', () => [addDays(-6), ymd()]],
    '30': ['30 hari', () => [addDays(-29), ymd()]],
    bulan: ['Bulan ini', () => { const d = new Date(); return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), ymd()]; }],
    tahun: ['Tahun ini', () => [new Date().getFullYear() + '-01-01', ymd()]],
  };

  // Dipanggil dari halaman lain (mis. Stok per Lokasi): buka Kartu Stok untuk satu barang
  A.openStockCard = (productId, location) => { A.kartuPreset = { product_id: productId, location: location || 'all' }; A.go('kartu'); };

  const d8 = (t) => (t && t.length >= 10 ? `${t.slice(8, 10)}/${t.slice(5, 7)}/${t.slice(2, 4)}` : '');   // 18/11/26, seperti kartu stok aplikasi lama
  const monthBounds = (m) => { const [y, mo] = m.split('-').map(Number); return [`${m}-01`, ymd(new Date(y, mo, 0))]; };
  const TYPES = [['all', 'Semua'], ['pembelian', 'Pembelian'], ['penjualan', 'Penjualan'], ['transfer', 'Transfer'], ['koreksi', 'Koreksi / opname']];

  A.pages.kartu = {
    title: 'Kartu Stok',
    async render(v) {
      await A.loadProducts('&active=all');
      const preset = A.kartuPreset; A.kartuPreset = null;
      const [f0, t0] = RANGES['30'][1]();
      // mode periode: all = semua riwayat (bawaan, seperti aplikasi lama), month = satu bulan, range = rentang tanggal
      const st = { product: null, loc: (preset && preset.location) || 'all', mode: 'all', month: ymd().slice(0, 7), from: f0, to: t0, type: 'all', showTransfer: false, data: null };
      if (preset) st.product = A.state.products.find((p) => p.id === +preset.product_id) || null;

      v.innerHTML = `<div class="card kc-ctl">
          <div class="rel"><label class="f">Barang</label>
            <div class="scanbar"><input class="inp grow" id="kp" placeholder="Ketik nama / SKU / scan barcode lalu Enter" autocomplete="off"><button class="btn" id="kcam" title="Scan barcode">📷</button></div>
            <div class="suggest hidden" id="ksg"></div></div>
          <div class="kc-item gap-s" id="kitem"></div>
          <div class="kc-filters gap-s">
            <div><label class="f">Jenis</label><select class="inp" id="kty">${TYPES.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
            <div><label class="f">Lokasi</label><select class="inp" id="kl"><option value="all">Semua lokasi</option>${A.locOptions(Object.keys(A.LOC), st.loc)}</select></div>
            <div><label class="chk f"><input type="checkbox" id="kbul"> Bulan</label><input class="inp" id="kmon" type="month" value="${st.month}" disabled></div>
            <div><label class="f">Dari tanggal</label><input class="inp" id="kf" type="date" value=""></div>
            <div><label class="f">Sampai tanggal</label><input class="inp" id="kt" type="date" value=""></div>
            <div class="kc-tr"><label class="chk"><input type="checkbox" id="kst"> Tampilkan transfer</label></div>
          </div>
          <div class="kc-quick gap-s"><div class="chips" id="kr">${Object.entries(RANGES).map(([k, r]) => `<button class="chip${k === 'semua' ? ' on' : ''}" data-r="${k}">${r[0]}</button>`).join('')}</div></div>
        </div>
        <div id="kout" class="gap"></div>`;
      $('#kl', v).value = st.loc;
      const inp = $('#kp', v), sg = $('#ksg', v), out = $('#kout', v);

      const periodQS = () => st.mode === 'all' ? '&period=all' : st.mode === 'month' ? (([f, t]) => `&from=${f}&to=${t}`)(monthBounds(st.month)) : `&from=${st.from}&to=${st.to}`;
      const query = (extra = '') => `/stock/card?product_id=${st.product.id}&location=${st.loc}${periodQS()}&type=${st.type}&show_transfer=${st.showTransfer || st.loc !== 'all' || st.type === 'transfer' ? 1 : 0}${extra}`;
      const signed = (n, cls) => n ? `<span class="${cls}">${cls === 'kc-in' ? '+' : '−'}${num(n)}</span>` : '<span class="muted">·</span>';

      const syncCtl = () => {
        const has = !!st.product, trShown = st.loc !== 'all' || st.type === 'transfer';
        $('#kty', v).disabled = !has; $('#kst', v).disabled = !has || trShown; $('#kst', v).checked = trShown || st.showTransfer;
        $('#kbul', v).checked = st.mode === 'month'; $('#kmon', v).disabled = st.mode !== 'month';
        $('#kf', v).value = st.mode === 'range' ? st.from : ''; $('#kt', v).value = st.mode === 'range' ? st.to : '';
        const it = $('#kitem', v);
        const pr = has ? { ...st.product, ...((st.data && st.data.product) || {}) } : null;   // deskripsi & satuan dari server
        it.innerHTML = has ? `<div class="kc-itembox"><b>${esc(pr.name)}</b><div class="small muted"><span class="mono">${esc(pr.sku)}</span>${pr.barcode ? ' · ' + esc(pr.barcode) : ''}${pr.description ? ' · ' + esc(pr.description) : ''} · Satuan: ${esc(String(pr.unit || 'pcs').toUpperCase())}</div></div>` : '';
      };
      const paint = () => {
        const d = st.data;
        syncCtl();
        if (!st.product) { out.innerHTML = '<div class="card empty">Pilih barang dulu: ketik nama / SKU, atau scan barcode, lalu tekan Enter.</div>'; return; }
        if (!d) { out.innerHTML = '<div class="empty">Memuat kartu stok…</div>'; return; }
        const rangeTxt = d.period === 'all' ? 'Semua riwayat' : `${fmtD(d.from)} s/d ${fmtD(d.to)}`;
        const open = d.period !== 'all' || d.opening !== 0;
        out.innerHTML = `<div class="row between"><div class="small muted">${esc(d.location_label)} · ${esc(rangeTxt)} · ${d.rows.length} baris</div>
            <div class="row"><button class="btn" id="kprint">🖨 Cetak</button><button class="btn" id="kcsv">⬇ Ekspor CSV</button></div></div>
          ${d.mismatch ? `<div class="notice warn gap-s">Saldo akhir kartu (<b>${num(d.closing)}</b>) berbeda dengan stok tercatat sekarang (<b>${num(d.current)}</b>). Ada perubahan stok yang tidak tercatat di buku mutasi. Lakukan stok opname untuk menyelaraskannya.</div>` : ''}
          ${d.truncated ? '<div class="notice warn gap-s">Riwayat terlalu panjang, hanya 5.000 mutasi pertama dalam periode yang ditampilkan. Persempit rentang tanggal.</div>' : ''}
          ${!d.show_transfer && d.hidden ? `<div class="small muted gap-s">${d.hidden} baris transfer antar lokasi disembunyikan (tidak mengubah total stok). Centang <b>Tampilkan transfer</b> untuk melihatnya.</div>` : ''}
          <div class="card flush gap-s"><div class="tablewrap kc-scroll" id="kscroll"><table class="t kc-t kc-card"><thead><tr><th class="num">No</th><th>Tanggal</th><th>Jenis</th><th>ID</th><th>Keterangan</th><th class="num">Masuk</th><th class="num">Keluar</th><th class="num">Saldo</th><th class="num">Harga</th><th>Lokasi</th></tr></thead><tbody>
            ${open ? `<tr class="kc-open"><td></td><td>${esc(d8(d.from))}</td><td colspan="6"><b>Saldo awal</b></td><td class="num"><b>${num(d.opening)}</b></td><td colspan="2"></td></tr>` : ''}
            ${d.rows.length ? d.rows.map((r, i) => `<tr class="kc-row${i === d.rows.length - 1 ? ' kc-sel' : ''}" title="${esc(fmtDT(r.created_at))} · dicatat oleh ${esc(r.user || '-')}"><td class="num muted">${i + 1}</td><td class="nowrap">${esc(d8(r.created_at))}</td><td>${esc(r.type_label)}</td><td class="mono small">${esc(r.ref || '')}</td><td>${esc(r.party || r.note || '')}${r.party && r.note ? `<div class="small muted">${esc(r.note)}</div>` : ''}</td><td class="num">${r.in ? `<span class="kc-in">${num(r.in)}</span>` : ''}</td><td class="num">${r.out ? `<span class="kc-out">${num(r.out)}</span>` : ''}</td><td class="num"><b>${num(r.balance)}</b></td><td class="num ${r.price_kind === 'beli' ? 'muted' : ''}" title="${r.price_kind === 'beli' ? 'Harga beli' : r.price_kind === 'jual' ? 'Harga jual' : ''}">${r.price == null ? '' : num(r.price)}</td><td class="small">${esc(A.LOC_SHORT[r.location] || r.location_label)}</td></tr>`).join('') : `<tr><td colspan="10" class="empty">Tidak ada pergerakan stok untuk pilihan ini.</td></tr>`}
          </tbody></table></div></div>
          <div class="kc-foot gap-s"><div><span>Total masuk</span><b class="kc-in">${num(d.total_in)}</b></div><div><span>Total keluar</span><b class="kc-out">${num(d.total_out)}</b></div><div class="kc-avail"><span>Tersedia</span><b>${num(d.available)}</b></div></div>`;
        const sc = $('#kscroll', out); if (sc) sc.scrollTop = sc.scrollHeight;      // langsung ke mutasi terbaru
        $$('.kc-row', out).forEach((tr) => (tr.onclick = () => { $$('.kc-row', out).forEach((x) => x.classList.toggle('kc-sel', x === tr)); }));
        $('#kcsv', out).onclick = () => A.download(query('&format=csv'), 'kartu-stok.csv').catch(A.fail);
        $('#kprint', out).onclick = () => printCard(d);
      };

      const load = async () => {
        if (!st.product) { st.data = null; paint(); return; }
        st.data = null; paint();
        try { st.data = await A.api(query()); paint(); } catch (e) { out.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; }
      };

      const printCard = (d) => {
        const S = A.state.settings;
        const css = '@page{size:A4 landscape;margin:12mm}body{font:11px/1.4 system-ui,Arial,sans-serif;color:#111}h1{font-size:18px;margin:0}table{width:100%;border-collapse:collapse;margin-top:10px}th{background:#f1ede3;text-align:left;padding:5px 7px;font-size:10px}td{padding:4px 7px;border-bottom:1px solid #ddd;vertical-align:top}.r{text-align:right}.m{color:#666;font-size:10px}tfoot td{font-weight:bold;border-top:2px solid #333}';
        const html = `<div class="m">${esc(S.store_name || '')}</div><h1>KARTU STOK</h1><div style="margin-top:4px"><b>${esc(d.product.name)}</b> <span class="m">(${esc(d.product.sku)})${d.product.description ? ' · ' + esc(d.product.description) : ''}</span></div><div class="m">${esc(d.location_label)} · ${d.period === 'all' ? 'Semua riwayat' : 'Periode ' + esc(fmtD(d.from)) + ' s/d ' + esc(fmtD(d.to))}</div>
          <table><thead><tr><th class="r">No</th><th>Tanggal</th><th>Jenis</th><th>ID</th><th>Keterangan</th><th class="r">Masuk</th><th class="r">Keluar</th><th class="r">Saldo</th><th class="r">Harga</th><th>Lokasi</th></tr></thead><tbody>
          ${d.period !== 'all' || d.opening ? `<tr><td></td><td>${esc(d8(d.from))}</td><td colspan="6"><b>Saldo awal</b></td><td class="r"><b>${num(d.opening)}</b></td><td colspan="2"></td></tr>` : ''}
          ${d.rows.map((r, i) => `<tr><td class="r">${i + 1}</td><td>${esc(d8(r.created_at))}</td><td>${esc(r.type_label)}</td><td>${esc(r.ref || '')}</td><td>${esc([r.party, r.note].filter(Boolean).join(' - '))}</td><td class="r">${r.in ? num(r.in) : ''}</td><td class="r">${r.out ? num(r.out) : ''}</td><td class="r">${num(r.balance)}</td><td class="r">${r.price == null ? '' : num(r.price)}</td><td>${esc(A.LOC_SHORT[r.location] || r.location_label)}</td></tr>`).join('')}
          </tbody><tfoot><tr><td colspan="5">Total masuk / keluar</td><td class="r">${num(d.total_in)}</td><td class="r">${num(d.total_out)}</td><td class="r" colspan="3">Tersedia: ${num(d.available)}</td></tr></tfoot></table>
          <div class="m" style="margin-top:8px">Dicetak ${esc(fmtDT(ymd() + ' ' + new Date().toTimeString().slice(0, 5)))} oleh ${esc(A.state.user.name)}</div>`;
        A.printHtml(html, css);
      };

      // ---- pemilih barang
      const label = (p) => `${p.name} · ${p.sku}`;
      const pick = (p) => { st.product = p; inp.value = label(p); sg.classList.add('hidden'); load(); };
      const match = (t) => { const toks = t.toLowerCase().split(/\s+/).filter(Boolean); return A.state.products.filter((p) => { const h = `${p.name} ${p.sku} ${p.barcode || ''}`.toLowerCase(); return toks.every((k) => h.includes(k)); }).slice(0, 8); };
      const showSg = () => {
        const t = inp.value.trim(); if (!t || (st.product && t === label(st.product))) return sg.classList.add('hidden');
        const m = match(t);
        sg.innerHTML = m.length ? m.map((p) => `<button type="button" data-id="${p.id}"><span>${esc(p.name)} <span class="muted small">${esc(p.sku)}</span>${p.active === 0 ? ' <span class="badge">arsip</span>' : ''}</span><span class="small muted">total stok ${num(p.total_qty ?? (p.display_qty + p.gt_qty + p.gr_qty))}</span></button>`).join('') : '<div class="empty small">Barang tidak ditemukan</div>';
        sg.classList.remove('hidden');
      };
      inp.addEventListener('input', () => { if (!inp.value.trim() && st.product) { st.product = null; load(); } showSg(); });
      inp.addEventListener('focus', () => { if (st.product) inp.select(); });
      inp.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return; e.preventDefault(); const t = inp.value.trim(); if (!t) return;
        const ex = A.state.products.find((p) => p.barcode === t || p.sku.toLowerCase() === t.toLowerCase());
        const m = ex ? [ex] : match(t); m.length ? pick(m[0]) : A.toast('Barang tidak ditemukan: ' + t, 'err');
      });
      sg.addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) pick(A.state.products.find((p) => p.id === +b.dataset.id)); });
      const outside = (e) => { if (!$('.rel', v)?.contains(e.target)) sg.classList.add('hidden'); };
      document.addEventListener('click', outside);
      $('#kcam', v).onclick = () => A.scan((code) => { const p = A.state.products.find((x) => x.barcode === code || x.sku === code); p ? pick(p) : A.toast('Barcode tidak dikenal: ' + code, 'err'); });

      // ---- filter
      $('#kl', v).onchange = (e) => { st.loc = e.target.value; load(); };
      $('#kty', v).onchange = (e) => { st.type = e.target.value; load(); };
      $('#kst', v).onchange = (e) => { st.showTransfer = e.target.checked; load(); };
      const chip = (k) => $$('#kr .chip', v).forEach((c) => c.classList.toggle('on', c.dataset.r === k));
      $('#kbul', v).onchange = (e) => { st.mode = e.target.checked ? 'month' : 'all'; chip(st.mode === 'all' ? 'semua' : null); load(); };
      $('#kmon', v).onchange = (e) => { if (e.target.value) { st.month = e.target.value; load(); } };
      const dates = () => { const f = $('#kf', v).value, t = $('#kt', v).value; if (!f && !t) return; st.mode = 'range'; st.from = f || t; st.to = t || f; chip(null); load(); };
      $('#kf', v).onchange = dates; $('#kt', v).onchange = dates;
      $('#kr', v).onclick = (e) => {
        const b = e.target.closest('[data-r]'); if (!b) return;
        if (b.dataset.r === 'semua') { st.mode = 'all'; } else { st.mode = 'range'; [st.from, st.to] = RANGES[b.dataset.r][1](); }
        chip(b.dataset.r); load();
      };

      if (st.product) inp.value = label(st.product);
      await load();
      return () => document.removeEventListener('click', outside);
    },
  };
})();
