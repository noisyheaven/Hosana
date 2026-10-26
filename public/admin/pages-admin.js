/* Halaman: Purchase Order, Supplier, Laporan, Pengguna, Pengaturan */
(function () {
  const A = window.App, { $, $$, esc, num, rp, fmtDT, fmtD, ymd, badge, PAY, PO_ST } = A;
  const compact = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + 'jt' : n >= 1e3 ? Math.round(n / 1e3) + 'rb' : String(n));

  // ======================= PURCHASE ORDER =======================
  function diffItems(oldI, newI) {
    const out = []; const o = new Map(oldI.map((i) => [i.product_id, i])); const n = new Map(newI.map((i) => [i.product_id, i]));
    for (const [id, i] of n) { const p = o.get(id); if (!p) out.push(`＋ ${i.name} ×${i.qty} @${num(i.cost)}`); else { const c = []; if (p.qty !== i.qty) c.push(`qty ${p.qty}→${i.qty}`); if (p.cost !== i.cost) c.push(`harga ${num(p.cost)}→${num(i.cost)}`); if (c.length) out.push(`✎ ${i.name}: ${c.join(', ')}`); } }
    for (const [id, i] of o) if (!n.has(id)) out.push(`− ${i.name} dihapus`);
    return out;
  }

  async function poForm(po, refresh) {
    const [sups] = await Promise.all([A.api('/suppliers'), A.loadProducts()]);
    const edit = !!po; const revising = edit && po.status !== 'draft';
    const m = A.modal(edit ? `Revisi ${po.po_number}` : 'Buat Purchase Order', `
      ${revising && po.status === 'approved' ? '<div class="notice warn" style="margin-bottom:12px">PO ini sudah disetujui. Setelah direvisi, statusnya kembali ke <b>Diajukan</b> dan perlu disetujui ulang.</div>' : ''}
      <div class="grid g3"><div><label class="f">Supplier</label><div class="scanbar"><select class="inp" id="sup"><option value="">— pilih —</option>${sups.map((s) => `<option value="${s.id}" ${po && po.supplier_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select><button class="btn" id="addsup" type="button" title="Supplier baru">＋</button></div></div>
      <div><label class="f">Estimasi tiba</label><input class="inp" type="date" id="eta" value="${esc(po?.expected_date || '')}"></div>
      <div><label class="f">Catatan untuk supplier</label><input class="inp" id="notes" value="${esc(po?.notes || '')}"></div></div>
      ${revising ? '<div class="gap-s"><label class="f">Alasan revisi *</label><input class="inp" id="rnote" placeholder="mis. supplier kehabisan stok, harga naik, tambah barang"></div>' : ''}
      <div class="row between gap"><h3>Daftar barang</h3><button class="btn sm" id="newp" type="button">＋ Barang baru (belum terdaftar)</button></div><div id="ed"></div>`,
      { size: 'xl', footer: `<button class="btn" data-n>Batal</button>${edit ? '<button class="btn primary" data-save>Simpan revisi</button>' : '<button class="btn" data-draft>Simpan draft</button><button class="btn primary" data-sub>Simpan &amp; ajukan</button>'}` });
    const ed = A.itemEditor(m.q('#ed'), { cost: true, stock: 'wh_qty', items: po ? po.items.map((i) => ({ product_id: i.product_id, qty: i.qty, cost: i.cost })) : [] });
    m.q('#addsup').onclick = async () => { const n = await A.prompt('Supplier baru', 'Nama supplier'); if (!n) return; try { const r = await A.api('/suppliers', { method: 'POST', body: { name: n } }); m.q('#sup').insertAdjacentHTML('beforeend', `<option value="${r.id}" selected>${esc(n)}</option>`); m.q('#sup').value = r.id; } catch (e) { A.fail(e); } };
    m.q('#newp').onclick = () => A.productForm(null, async () => { await A.loadProducts(); A.toast('Barang tersimpan — cari namanya di kolom pencarian', 'ok'); }).catch(A.fail);
    m.q('[data-n]').onclick = () => m.close();
    const save = async (submit, btn) => {
      const items = ed.get(); if (!items.length) return A.toast('Tambahkan minimal satu barang', 'err');
      const body = { supplier_id: m.q('#sup').value || null, expected_date: m.q('#eta').value, notes: m.q('#notes').value, items, submit };
      if (revising) { body.revision_note = m.q('#rnote').value.trim(); if (!body.revision_note) return A.toast('Isi alasan revisi', 'err'); }
      btn.disabled = true;
      try { edit ? await A.api('/po/' + po.id, { method: 'PUT', body }) : await A.api('/po', { method: 'POST', body }); A.toast(edit ? 'Revisi tersimpan' : 'PO dibuat', 'ok'); m.close(); refresh(); } catch (e) { A.fail(e); btn.disabled = false; }
    };
    const d = m.q('[data-draft]'), s = m.q('[data-sub]'), sv = m.q('[data-save]');
    if (d) d.onclick = () => save(false, d); if (s) s.onclick = () => save(true, s); if (sv) sv.onclick = () => save(false, sv);
  }

  async function receiveForm(po, refresh) {
    const rem = po.items.filter((i) => i.qty > i.received_qty);
    const m = A.modal(`Terima barang — ${po.po_number}`, `<p class="muted small" style="margin-top:0">Barang yang diterima masuk ke <b>stok gudang</b>. Isi jumlah yang benar-benar datang (boleh sebagian).</p>
      <table class="t"><thead><tr><th>Barang</th><th class="num">Sisa</th><th class="num" style="width:120px">Diterima</th></tr></thead><tbody>${rem.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${i.qty - i.received_qty}</td><td><input class="inp" type="number" min="0" max="${i.qty - i.received_qty}" value="${i.qty - i.received_qty}" data-item="${i.id}" style="text-align:right"></td></tr>`).join('')}</tbody></table>
      <label class="f gap-s">Catatan penerimaan (no. surat jalan, dll.)</label><input class="inp" id="note">`, { footer: '<button class="btn" data-n>Batal</button><button class="btn ok" data-y>Terima ke gudang</button>' });
    m.q('[data-n]').onclick = () => m.close();
    m.q('[data-y]').onclick = async () => {
      const items = m.qa('[data-item]').map((x) => ({ item_id: +x.dataset.item, qty: +x.value || 0 })).filter((x) => x.qty > 0);
      try { await A.api(`/po/${po.id}/receive`, { method: 'POST', body: { items, note: m.q('#note').value } }); A.toast('Barang diterima, stok gudang bertambah', 'ok'); m.close(); refresh(); } catch (e) { A.fail(e); }
    };
  }

  async function poDetail(id, refresh) {
    const po = await A.api('/po/' + id);
    const st = po.status;
    const hist = po.revisions.map((r, i) => {
      const newer = i === 0 ? po.items.map((x) => ({ product_id: x.product_id, name: x.name, qty: x.qty, cost: x.cost })) : po.revisions[i - 1].snapshot.items;
      const d = diffItems(r.snapshot.items, newer);
      return `<div><b>Revisi ${r.revision + 1}</b> <span class="muted small">· ${esc(r.user || '')} · ${esc(fmtDT(r.created_at))}</span>${r.note ? `<div>“${esc(r.note)}”</div>` : ''}<div class="small muted">${d.length ? d.map(esc).join('<br>') : 'Tidak ada perubahan barang'}</div></div>`;
    }).join('');
    const btn = (k, label, cls = '') => `<button class="btn ${cls}" data-a="${k}">${label}</button>`;
    const acts = [];
    if (st === 'draft') acts.push(btn('edit', 'Edit'), btn('submit', 'Ajukan', 'primary'));
    if (st === 'submitted') acts.push(btn('edit', 'Revisi'), btn('draft', 'Kembalikan ke draft'), btn('approve', 'Setujui', 'ok'));
    if (st === 'approved') acts.push(btn('edit', 'Revisi'), btn('receive', 'Terima barang', 'ok'));
    if (st === 'partial') acts.push(btn('receive', 'Terima barang', 'ok'));
    if (['draft', 'submitted', 'approved', 'partial'].includes(st)) acts.push(btn('cancel', st === 'partial' ? 'Batalkan sisa' : 'Batalkan PO', 'danger'));
    if (['draft', 'cancelled'].includes(st)) acts.push(btn('delete', 'Hapus', 'danger'));
    acts.push(btn('print', '🖨 Cetak PO'));
    const m = A.modal(`${po.po_number}${po.revision ? ' · Revisi ' + po.revision : ''}`, `
      <div class="row">${badge(PO_ST, st)} <span class="muted small">Dibuat ${esc(fmtDT(po.created_at))} oleh ${esc(po.created_by_name || '-')}</span></div>
      <dl class="kv gap-s"><dt>Supplier</dt><dd>${esc(po.supplier || '-')} ${esc(po.supplier_phone || '')}</dd><dt>Estimasi tiba</dt><dd>${esc(po.expected_date ? fmtD(po.expected_date) : '-')}</dd><dt>Catatan</dt><dd>${esc(po.notes || '-')}</dd>${po.approved_by_name ? `<dt>Disetujui oleh</dt><dd>${esc(po.approved_by_name)}</dd>` : ''}</dl>
      <div class="tablewrap gap-s"><table class="t"><thead><tr><th>Barang</th><th class="num">Harga beli</th><th class="num">Dipesan</th><th class="num">Diterima</th><th class="num">Jumlah</th></tr></thead><tbody>${po.items.map((i) => `<tr><td><b>${esc(i.name)}</b><div class="small muted">${esc(i.sku)}</div></td><td class="num">${num(i.cost)}</td><td class="num">${i.qty}</td><td class="num"><span class="badge ${i.received_qty >= i.qty ? 'ok' : i.received_qty ? 'warn' : ''}">${i.received_qty}</span></td><td class="num">${num(i.qty * i.cost)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="4" class="right"><b>Total</b></td><td class="num"><b>${rp(po.total)}</b></td></tr></tfoot></table></div>
      ${po.revisions.length ? `<h3 class="gap">Riwayat revisi</h3><div class="timeline gap-s">${hist}</div>` : ''}`, { size: 'wide', footer: acts.join('') });
    const status = async (to, msg) => { try { await A.api(`/po/${id}/status`, { method: 'POST', body: { status: to } }); A.toast(msg, 'ok'); m.close(); refresh(); } catch (e) { A.fail(e); } };
    m.qa('[data-a]').forEach((b) => (b.onclick = async () => {
      const a = b.dataset.a;
      if (a === 'edit') { m.close(); poForm(po, refresh).catch(A.fail); }
      if (a === 'submit') status('submitted', 'PO diajukan');
      if (a === 'draft') status('draft', 'PO dikembalikan ke draft');
      if (a === 'approve') status('approved', 'PO disetujui');
      if (a === 'cancel' && (await A.confirm('Batalkan PO ini?', { danger: true, ok: 'Batalkan PO' }))) status('cancelled', 'PO dibatalkan');
      if (a === 'delete' && (await A.confirm('Hapus PO ini permanen?', { danger: true, ok: 'Hapus' }))) { try { await A.api('/po/' + id, { method: 'DELETE' }); m.close(); refresh(); } catch (e) { A.fail(e); } }
      if (a === 'receive') { m.close(); receiveForm(po, refresh).catch(A.fail); }
      if (a === 'print') A.print(A.poHtml(po));
    }));
  }

  A.pages.po = {
    title: 'Purchase Order',
    async render(v) {
      let st = 'open';
      v.innerHTML = `<div class="row between"><div class="chips" id="f">${[['open', 'Berjalan'], ['draft', 'Draft'], ['submitted', 'Diajukan'], ['approved', 'Disetujui'], ['partial', 'Sebagian'], ['received', 'Selesai'], ['cancelled', 'Batal'], ['', 'Semua']].map(([k, l]) => `<button class="chip ${k === st ? 'on' : ''}" data-s="${k}">${l}</button>`).join('')}</div><button class="btn primary" id="new">＋ Buat PO</button></div>
        <div class="card flush gap"><div class="tablewrap" id="tb"></div></div>
        <div class="notice gap"><b>Alur PO:</b> Draft → Diajukan → Disetujui → Barang diterima (masuk <b>stok gudang</b>) → pindahkan ke toko lewat menu <a href="#/transfer">Transfer</a>. PO bisa direvisi (tambah / ubah / hapus barang) selama belum ada barang yang diterima; setiap revisi tercatat.</div>`;
      const load = async () => {
        const rows = await A.api('/po?status=' + st);
        $('#tb', v).innerHTML = rows.length ? `<table class="t"><thead><tr><th>No. PO</th><th>Supplier</th><th>Estimasi</th><th class="num">Baris</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>${rows.map((p) => `<tr class="click" data-id="${p.id}"><td><b>${esc(p.po_number)}</b>${p.revision ? ` <span class="badge info">rev ${p.revision}</span>` : ''}<div class="small muted">${esc(fmtDT(p.created_at))}</div></td><td>${esc(p.supplier || '-')}</td><td>${p.expected_date ? esc(fmtD(p.expected_date)) : '-'}</td><td class="num">${p.lines}</td><td class="num">${rp(p.total)}</td><td>${badge(PO_ST, p.status)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Belum ada PO</div>';
        $$('tr[data-id]', v).forEach((tr) => (tr.onclick = () => poDetail(+tr.dataset.id, load).catch(A.fail)));
      };
      $('#f', v).onclick = (e) => { const b = e.target.closest('[data-s]'); if (!b) return; st = b.dataset.s; $$('#f .chip', v).forEach((x) => x.classList.toggle('on', x === b)); load().catch(A.fail); };
      $('#new', v).onclick = () => poForm(null, load).catch(A.fail);
      await load();
    },
  };

  // ======================= SUPPLIER =======================
  A.pages.supplier = {
    title: 'Supplier',
    async render(v) {
      v.innerHTML = `<div class="row between"><span></span><button class="btn primary" id="new">＋ Supplier</button></div><div class="card flush gap"><div class="tablewrap" id="tb"></div></div>`;
      const form = (s) => {
        const m = A.modal(s ? 'Edit supplier' : 'Supplier baru', `<label class="f">Nama *</label><input class="inp" name="name" value="${esc(s?.name || '')}"><label class="f gap-s">Telepon / WA</label><input class="inp" name="phone" value="${esc(s?.phone || '')}"><label class="f gap-s">Alamat</label><textarea class="inp" name="address">${esc(s?.address || '')}</textarea>`, { footer: '<button class="btn" data-n>Batal</button><button class="btn primary" data-y>Simpan</button>' });
        m.q('[data-n]').onclick = () => m.close();
        m.q('[data-y]').onclick = async () => { try { await A.api(s ? '/suppliers/' + s.id : '/suppliers', { method: s ? 'PUT' : 'POST', body: A.formData(m) }); m.close(); load(); } catch (e) { A.fail(e); } };
      };
      let rows = [];
      const load = async () => {
        rows = await A.api('/suppliers');
        $('#tb', v).innerHTML = rows.length ? `<table class="t"><thead><tr><th>Nama</th><th>Telepon</th><th>Alamat</th><th></th></tr></thead><tbody>${rows.map((s) => `<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.phone || '-')}</td><td>${esc(s.address || '-')}</td><td class="nowrap"><button class="btn sm" data-e="${s.id}">Edit</button> <button class="btn sm danger" data-d="${s.id}">Hapus</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Belum ada supplier</div>';
      };
      v.addEventListener('click', async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.e) form(rows.find((s) => s.id === +b.dataset.e));
        if (b.dataset.d && (await A.confirm('Hapus supplier ini?', { danger: true, ok: 'Hapus' }))) { await A.api('/suppliers/' + b.dataset.d, { method: 'DELETE' }); load(); }
      });
      $('#new', v).onclick = () => form(null);
      await load();
    },
  };

  // ======================= LAPORAN =======================
  const barChart = (series, valKey, labelFn) => { const max = Math.max(1, ...series.map((x) => x[valKey])); return `<div class="bars">${series.map((x) => `<div class="bar" title="${esc(labelFn(x))}: ${rp(x[valKey])}"><em>${x[valKey] ? compact(x[valKey]) : ''}</em><i style="height:${Math.max(1, Math.round((x[valKey] / max) * 100))}%"></i><span>${esc(labelFn(x))}</span></div>`).join('')}</div>`; };
  A.pages.laporan = {
    title: 'Laporan',
    async render(v) {
      const now = new Date(); let from = ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to = ymd(now), tab = 'sales';
      const presets = { 'Hari ini': () => [ymd(), ymd()], '7 hari': () => [ymd(new Date(Date.now() - 6 * 864e5)), ymd()], 'Bulan ini': () => [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd()], 'Bulan lalu': () => [ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), ymd(new Date(now.getFullYear(), now.getMonth(), 0))], 'Tahun ini': () => [ymd(new Date(now.getFullYear(), 0, 1)), ymd()] };
      v.innerHTML = `<div class="tabs noprint" id="tabs"><button class="tab on" data-t="sales">Penjualan</button><button class="tab" data-t="stock">Nilai Stok</button></div>
        <div class="row noprint" id="ctl"><div><label class="f">Dari</label><input class="inp" type="date" id="fr" value="${from}"></div><div><label class="f">Sampai</label><input class="inp" type="date" id="to" value="${to}"></div><div class="chips" style="align-self:end">${Object.keys(presets).map((k) => `<button class="chip" data-p="${k}">${k}</button>`).join('')}</div><span class="grow"></span>
        <div class="row" style="align-self:end"><button class="btn" id="csv1">⬇ CSV transaksi</button><button class="btn" id="csv2">⬇ CSV per item</button><button class="btn" id="csv3">⬇ CSV stok</button><button class="btn primary" id="prt">🖨 Cetak</button></div></div>
        <div id="out" class="gap"></div>`;
      const load = async () => {
        const out = $('#out', v); out.innerHTML = '<div class="empty">Memuat…</div>';
        if (tab === 'stock') {
          const r = await A.api('/reports/stock');
          out.innerHTML = `<div class="stats"><div class="stat accent"><div class="l">Nilai stok toko</div><div class="v">${rp(r.totals.store_value)}</div><div class="s">${num(r.totals.store_qty)} unit (harga beli)</div></div><div class="stat"><div class="l">Nilai stok gudang</div><div class="v">${rp(r.totals.wh_value)}</div><div class="s">${num(r.totals.wh_qty)} unit</div></div><div class="stat"><div class="l">Total aset persediaan</div><div class="v">${rp(r.totals.store_value + r.totals.wh_value)}</div></div></div>
            <div class="card flush gap"><div class="tablewrap"><table class="t"><thead><tr><th>Barang</th><th class="num">Toko</th><th class="num">Gudang</th><th class="num">Harga beli</th><th class="num">Nilai stok</th></tr></thead><tbody>${r.rows.map((p) => `<tr><td>${esc(p.name)}<div class="small muted">${esc(p.sku)}</div></td><td class="num">${p.store_qty}</td><td class="num">${p.wh_qty}</td><td class="num">${num(p.cost)}</td><td class="num">${num(p.store_value + p.wh_value)}</td></tr>`).join('')}</tbody></table></div></div>`;
          return;
        }
        const r = await A.api(`/reports/sales?from=${from}&to=${to}`); const t = r.totals;
        const tbl = (rows, cols) => rows.length ? `<table class="t"><thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}">${c.h}</th>`).join('')}</tr></thead><tbody>${rows.map((x) => `<tr>${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.f(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<div class="empty">Tidak ada data</div>';
        out.innerHTML = `<h2 style="margin-bottom:10px">Laporan penjualan ${esc(fmtD(from))} – ${esc(fmtD(to))}</h2>
          <div class="stats"><div class="stat accent"><div class="l">Omzet</div><div class="v">${rp(t.revenue)}</div><div class="s">${t.trx} transaksi</div></div><div class="stat"><div class="l">Laba kotor</div><div class="v">${rp(t.profit)}</div><div class="s">Omzet − HPP (${rp(t.cogs)})</div></div><div class="stat"><div class="l">Barang terjual</div><div class="v">${num(t.items)}</div></div><div class="stat"><div class="l">Rata-rata / transaksi</div><div class="v">${rp(t.avg)}</div></div><div class="stat"><div class="l">Diskon</div><div class="v">${rp(t.discount)}</div></div>${r.voided.n ? `<div class="stat"><div class="l">Dibatalkan (void)</div><div class="v">${r.voided.n}</div><div class="s">${rp(r.voided.total)}</div></div>` : ''}</div>
          ${r.daily.length > 1 && r.daily.length <= 45 ? `<div class="card gap"><h2>Omzet per hari</h2>${barChart(r.daily, 'revenue', (x) => x.date.slice(8))}</div>` : ''}
          <div class="cols gap"><div class="card flush"><div style="padding:16px 16px 0"><h2>Produk terjual</h2></div><div class="tablewrap">${tbl(r.by_product, [{ h: 'Produk', f: (x) => esc(x.name) }, { h: 'Qty', num: 1, f: (x) => x.qty }, { h: 'Omzet', num: 1, f: (x) => num(x.revenue) }, { h: 'Laba', num: 1, f: (x) => num(x.profit) }])}</div></div>
          <div class="grid"><div class="card flush"><div style="padding:16px 16px 0"><h2>Per metode bayar</h2></div>${tbl(r.by_method, [{ h: 'Metode', f: (x) => esc(PAY[x.method] || x.method) }, { h: 'Trx', num: 1, f: (x) => x.trx }, { h: 'Omzet', num: 1, f: (x) => num(x.revenue) }])}</div>
          <div class="card flush"><div style="padding:16px 16px 0"><h2>Per kanal</h2></div>${tbl(r.by_channel, [{ h: 'Kanal', f: (x) => ({ pos: 'Kasir toko', online: 'Online', order: 'Pesanan' }[x.channel] || x.channel) }, { h: 'Trx', num: 1, f: (x) => x.trx }, { h: 'Omzet', num: 1, f: (x) => num(x.revenue) }])}</div>
          <div class="card flush"><div style="padding:16px 16px 0"><h2>Per kasir</h2></div>${tbl(r.by_cashier, [{ h: 'Kasir', f: (x) => esc(x.cashier) }, { h: 'Trx', num: 1, f: (x) => x.trx }, { h: 'Omzet', num: 1, f: (x) => num(x.revenue) }])}</div></div></div>
          <div class="card flush gap"><div style="padding:16px 16px 0"><h2>Rekap harian</h2></div><div class="tablewrap">${tbl(r.daily, [{ h: 'Tanggal', f: (x) => esc(fmtD(x.date)) }, { h: 'Trx', num: 1, f: (x) => x.trx }, { h: 'Diskon', num: 1, f: (x) => num(x.discount) }, { h: 'Omzet', num: 1, f: (x) => num(x.revenue) }])}</div></div>`;
      };
      const reload = () => load().catch(A.fail);
      $('#tabs', v).onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; tab = b.dataset.t; $$('#tabs .tab', v).forEach((x) => x.classList.toggle('on', x === b)); $('#ctl .row:first-child', v); reload(); };
      $('#fr', v).onchange = (e) => { from = e.target.value; reload(); }; $('#to', v).onchange = (e) => { to = e.target.value; reload(); };
      $('#ctl', v).addEventListener('click', (e) => { const p = e.target.closest('[data-p]'); if (!p) return; [from, to] = presets[p.dataset.p](); $('#fr', v).value = from; $('#to', v).value = to; reload(); });
      const dl = (type) => A.download(`/reports/export?type=${type}&from=${from}&to=${to}`, `laporan-${type}.csv`).catch(A.fail);
      $('#csv1', v).onclick = () => dl('sales'); $('#csv2', v).onclick = () => dl('items'); $('#csv3', v).onclick = () => dl('stock');
      $('#prt', v).onclick = () => window.print();
      reload();
    },
  };

  // ======================= PENGGUNA =======================
  const ROLE = { superadmin: 'Super Admin', admin: 'Admin', staf: 'Staf' };
  A.pages.pengguna = {
    title: 'Pengguna & Hak Akses',
    async render(v) {
      v.innerHTML = `<div class="row between"><span class="muted">Super Admin: semua fitur · Admin: barang, stok, PO, laporan · Staf: kasir, pesanan, lihat stok</span><button class="btn primary" id="new">＋ Pengguna</button></div><div class="card flush gap"><div class="tablewrap" id="tb"></div></div>`;
      let rows = [];
      const form = (u) => {
        const m = A.modal(u ? 'Edit pengguna' : 'Pengguna baru', `<div class="grid g2"><div><label class="f">Username</label><input class="inp" name="username" value="${esc(u?.username || '')}" ${u ? 'disabled' : ''}></div><div><label class="f">Nama lengkap</label><input class="inp" name="name" value="${esc(u?.name || '')}"></div>
          <div><label class="f">Role</label><select class="inp" name="role">${Object.entries(ROLE).map(([k, l]) => `<option value="${k}" ${u?.role === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div><label class="f">${u ? 'Password baru (kosongkan jika tidak diubah)' : 'Password (min. 6)'}</label><input class="inp" name="password" type="text" autocomplete="off"></div></div>
          ${u ? `<label class="chk gap-s"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Akun aktif</label>` : ''}`, { footer: '<button class="btn" data-n>Batal</button><button class="btn primary" data-y>Simpan</button>' });
        m.q('[data-n]').onclick = () => m.close();
        m.q('[data-y]').onclick = async () => { const f = A.formData(m); if (u) { f.active = f.active ? 1 : 0; delete f.username; if (!f.password) delete f.password; } try { await A.api(u ? '/users/' + u.id : '/users', { method: u ? 'PUT' : 'POST', body: f }); A.toast('Tersimpan', 'ok'); m.close(); load(); } catch (e) { A.fail(e); } };
      };
      const load = async () => {
        rows = await A.api('/users');
        $('#tb', v).innerHTML = `<table class="t"><thead><tr><th>Username</th><th>Nama</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((u) => `<tr><td><b>${esc(u.username)}</b></td><td>${esc(u.name)}</td><td><span class="badge info">${ROLE[u.role]}</span></td><td>${u.active ? '<span class="badge ok">Aktif</span>' : '<span class="badge">Nonaktif</span>'}</td><td><button class="btn sm" data-e="${u.id}">Edit</button></td></tr>`).join('')}</tbody></table>`;
      };
      v.addEventListener('click', (e) => { const b = e.target.closest('[data-e]'); if (b) form(rows.find((u) => u.id === +b.dataset.e)); });
      $('#new', v).onclick = () => form(null);
      await load();
    },
  };

  // ======================= PENGATURAN =======================
  A.pages.pengaturan = {
    title: 'Pengaturan Toko',
    async render(v) {
      const s = await A.loadSettings();
      v.innerHTML = `<div class="cols"><div class="card"><h2>Identitas toko &amp; struk</h2><div class="grid g2"><div><label class="f">Nama toko</label><input class="inp" name="store_name" value="${esc(s.store_name)}"></div><div><label class="f">Telepon / WhatsApp (format 62…)</label><input class="inp" name="store_phone" value="${esc(s.store_phone)}"></div>
        <div style="grid-column:1/-1"><label class="f">Alamat</label><textarea class="inp" name="store_address">${esc(s.store_address)}</textarea></div>
        <div style="grid-column:1/-1"><label class="f">Info rekening (tampil di toko online)</label><textarea class="inp" name="bank_info">${esc(s.bank_info)}</textarea></div>
        <div style="grid-column:1/-1"><label class="f">Catatan QRIS</label><input class="inp" name="qris_note" value="${esc(s.qris_note)}"></div>
        <div style="grid-column:1/-1"><label class="f">Pesan kaki struk / invoice</label><textarea class="inp" name="receipt_footer">${esc(s.receipt_footer)}</textarea></div>
        <div><label class="f">Batalkan otomatis pesanan online yang belum dibayar (jam, 0 = mati)</label><input class="inp" type="number" min="0" step="1" name="online_hold_hours" value="${esc(s.online_hold_hours ?? '24')}"></div>
        <div><label class="f">Lebar kertas struk</label><select class="inp" name="paper_width"><option value="58" ${s.paper_width !== '80' ? 'selected' : ''}>58 mm</option><option value="80" ${s.paper_width === '80' ? 'selected' : ''}>80 mm</option></select></div>
        <label class="chk" style="align-self:end"><input type="checkbox" name="allow_negative_stock" ${s.allow_negative_stock === '1' ? 'checked' : ''}> Izinkan penjualan saat stok 0 / minus</label></div>
        <button class="btn primary gap" id="save">Simpan pengaturan</button></div>
        <div class="grid"><div class="card"><h2>Cadangan data</h2><p class="muted small" style="margin-top:0">Unduh salinan seluruh database (produk, stok, transaksi). Simpan rutin di tempat aman — flashdisk / Google Drive.</p><button class="btn" id="bk">⬇ Unduh backup database</button></div>
        <div class="card"><h2>Log aktivitas</h2><div id="audit" class="small" style="max-height:340px;overflow:auto"></div></div></div></div>`;
      $('#save', v).onclick = async () => { const f = A.formData(v); f.allow_negative_stock = f.allow_negative_stock ? '1' : '0'; try { A.state.settings = await A.api('/settings', { method: 'PUT', body: f }); A.toast('Pengaturan disimpan', 'ok'); } catch (e) { A.fail(e); } };
      $('#bk', v).onclick = () => A.download('/backup', 'backup-toko.db').catch(A.fail);
      try { const log = await A.api('/audit?limit=100'); $('#audit', v).innerHTML = `<table class="t"><tbody>${log.map((l) => `<tr><td class="nowrap muted">${esc(fmtDT(l.created_at))}</td><td><b>${esc(l.username || '-')}</b> ${esc(l.action)}<div class="muted">${esc(l.detail || '')}</div></td></tr>`).join('')}</tbody></table>`; } catch (_) {}
    },
  };
})();
