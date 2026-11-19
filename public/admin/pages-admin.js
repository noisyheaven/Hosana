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
    const ed = A.itemEditor(m.q('#ed'), { cost: true, stock: 'all', items: po ? po.items.map((i) => ({ product_id: i.product_id, qty: i.qty, cost: i.cost })) : [] });
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
    const m = A.modal(`Terima barang — ${po.po_number}`, `<p class="muted small" style="margin-top:0">Pilih lokasi tujuan lalu isi jumlah yang benar-benar datang (boleh sebagian).</p>
      <label class="f">Simpan ke lokasi</label><select class="inp" id="loc">${A.locOptions(['gudang_ruko', 'gudang_toko'], 'gudang_ruko')}</select>
      <table class="t"><thead><tr><th>Barang</th><th class="num">Sisa</th><th class="num" style="width:120px">Diterima</th></tr></thead><tbody>${rem.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${i.qty - i.received_qty}</td><td><input class="inp" type="number" min="0" max="${i.qty - i.received_qty}" value="${i.qty - i.received_qty}" data-item="${i.id}" style="text-align:right"></td></tr>`).join('')}</tbody></table>
      <label class="f gap-s">Catatan penerimaan (no. surat jalan, dll.)</label><input class="inp" id="note">`, { footer: '<button class="btn" data-n>Batal</button><button class="btn ok" data-y>Terima barang</button>' });
    m.q('[data-n]').onclick = () => m.close();
    m.q('[data-y]').onclick = async () => {
      const items = m.qa('[data-item]').map((x) => ({ item_id: +x.dataset.item, qty: +x.value || 0 })).filter((x) => x.qty > 0);
      try { await A.api(`/po/${po.id}/receive`, { method: 'POST', body: { items, location: m.q('#loc').value, note: m.q('#note').value } }); A.toast(`Barang diterima, stok ${A.LOC[m.q('#loc').value]} bertambah`, 'ok'); m.close(); refresh(); } catch (e) { A.fail(e); }
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
    if (st === 'approved') acts.push(btn('edit', 'Revisi'), ...(A.can('terima') ? [btn('receive', 'Terima barang', 'ok')] : []));
    if (st === 'partial' && A.can('terima')) acts.push(btn('receive', 'Terima barang', 'ok'));
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
        <div class="notice gap"><b>Alur PO:</b> Draft → Diajukan → Disetujui → Barang diterima (masuk Gudang Ruko / Gudang Toko) → pindahkan ke Display Toko lewat menu <a href="#/transfer">Transfer</a>. PO bisa direvisi (tambah / ubah / hapus barang) selama belum ada barang yang diterima; setiap revisi tercatat.</div>`;
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
        $('#tb', v).innerHTML = rows.length ? `<table class="t"><thead><tr><th>Nama</th><th>Telepon</th><th>Alamat</th><th></th></tr></thead><tbody>${rows.map((s) => `<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.phone || '-')}</td><td>${esc(s.address || '-')}</td><td class="nowrap"><button class="btn sm primary" data-h="${s.id}">Riwayat pembelian</button> <button class="btn sm" data-e="${s.id}">Edit</button> <button class="btn sm danger" data-d="${s.id}">Hapus</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Belum ada supplier</div>';
      };
      v.addEventListener('click', async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.e) form(rows.find((s) => s.id === +b.dataset.e));
        if (b.dataset.h) {
          try {
            const h = await A.api('/suppliers/' + b.dataset.h + '/purchases');
            const fmtDate = (value) => value ? fmtDT(value) : '-';
            const body = h.orders.length ? `<div class="row between gap-s"><b>${esc(h.supplier.name)}</b><span>Total PO: <b>${rp(h.total)}</b></span></div><div class="tablewrap gap-s"><table class="t"><thead><tr><th>Tanggal</th><th>Nomor PO</th><th>Barang</th><th class="num">Total</th></tr></thead><tbody>${h.orders.map((po) => `<tr><td>${esc(fmtDate(po.created_at))}<div class="small muted">${badge(PO_ST, po.status)}</div></td><td><b>${esc(po.po_number)}</b></td><td>${po.items.map((i) => `${esc(i.name)} × ${i.qty}${i.unit ? ' ' + esc(i.unit) : ''}`).join('<br>')}</td><td class="num">${rp(po.total)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="3" class="right"><b>Total keseluruhan</b></td><td class="num"><b>${rp(h.total)}</b></td></tr></tfoot></table></div>` : `<div class="empty">Belum ada riwayat PO untuk supplier ini.</div>`;
            const hm = A.modal('Riwayat pembelian supplier', body, { size: 'xl', footer: '<button class="btn" data-n>Tutup</button>' }); hm.q('[data-n]').onclick = () => hm.close();
          } catch (err) { A.fail(err); }
        }
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
      const full = A.can('laporan'); // tanpa hak "Laporan lengkap": tidak ada laba/HPP, nilai stok, dan CSV per item/stok
      const now = new Date(); let from = ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to = ymd(now), tab = 'sales';
      const presets = { 'Hari ini': () => [ymd(), ymd()], '7 hari': () => [ymd(new Date(Date.now() - 6 * 864e5)), ymd()], 'Bulan ini': () => [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd()], 'Bulan lalu': () => [ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), ymd(new Date(now.getFullYear(), now.getMonth(), 0))], 'Tahun ini': () => [ymd(new Date(now.getFullYear(), 0, 1)), ymd()] };
      v.innerHTML = `<div class="tabs noprint" id="tabs"><button class="tab on" data-t="sales">Penjualan</button>${full ? '<button class="tab" data-t="stock">Nilai Stok</button>' : ''}</div>
        <div class="row noprint" id="ctl"><div><label class="f">Dari</label><input class="inp" type="date" id="fr" value="${from}"></div><div><label class="f">Sampai</label><input class="inp" type="date" id="to" value="${to}"></div><div class="chips" style="align-self:end">${Object.keys(presets).map((k) => `<button class="chip" data-p="${k}">${k}</button>`).join('')}</div><span class="grow"></span>
        <div class="row" style="align-self:end"><button class="btn" id="csv1">⬇ CSV transaksi</button>${full ? '<button class="btn" id="csv2">⬇ CSV per item</button><button class="btn" id="csv3">⬇ CSV stok</button>' : ''}<button class="btn primary" id="prt">🖨 Cetak</button></div></div>
        <div id="out" class="gap"></div>`;
      const load = async () => {
        const out = $('#out', v); out.innerHTML = '<div class="empty">Memuat…</div>';
        if (tab === 'stock') {
          const r = await A.api('/reports/stock');
          out.innerHTML = `<div class="stats"><div class="stat accent"><div class="l">Nilai Display Toko</div><div class="v">${rp(r.totals.display_value)}</div><div class="s">${num(r.totals.display_qty)} unit (harga beli)</div></div><div class="stat"><div class="l">Nilai Gudang Toko</div><div class="v">${rp(r.totals.gt_value)}</div><div class="s">${num(r.totals.gt_qty)} unit</div></div><div class="stat"><div class="l">Nilai Gudang Ruko</div><div class="v">${rp(r.totals.gr_value)}</div><div class="s">${num(r.totals.gr_qty)} unit</div></div><div class="stat"><div class="l">Total aset persediaan</div><div class="v">${rp(r.totals.display_value + r.totals.gt_value + r.totals.gr_value)}</div></div></div>
            <div class="card flush gap"><div class="tablewrap"><table class="t"><thead><tr><th>Barang</th><th class="num">Display</th><th class="num">Gdg Toko</th><th class="num">Gdg Ruko</th><th class="num">Harga beli</th><th class="num">Nilai stok</th></tr></thead><tbody>${r.rows.map((p) => `<tr><td>${esc(p.name)}<div class="small muted">${esc(p.sku)}</div></td><td class="num">${p.display_qty}</td><td class="num">${p.gt_qty}</td><td class="num">${p.gr_qty}</td><td class="num">${num(p.cost)}</td><td class="num">${num(p.display_value + p.gt_value + p.gr_value)}</td></tr>`).join('')}</tbody></table></div></div>`;
          return;
        }
        const r = await A.api(`/reports/sales?from=${from}&to=${to}`); const t = r.totals;
        const tbl = (rows, cols) => rows.length ? `<table class="t"><thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}">${c.h}</th>`).join('')}</tr></thead><tbody>${rows.map((x) => `<tr>${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.f(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<div class="empty">Tidak ada data</div>';
        out.innerHTML = `<h2 style="margin-bottom:10px">Laporan penjualan ${esc(fmtD(from))} – ${esc(fmtD(to))}</h2>
          <div class="stats"><div class="stat accent"><div class="l">Omzet bersih</div><div class="v">${rp(t.revenue)}</div><div class="s">${t.trx} transaksi · sebelum retur ${rp(t.gross_revenue)}</div></div>${full ? `<div class="stat"><div class="l">Laba kotor</div><div class="v">${rp(t.profit)}</div><div class="s">Omzet bersih − HPP bersih (${rp(t.cogs)})</div></div>` : ''}${r.returns && r.returns.n ? `<div class="stat"><div class="l">Refund retur</div><div class="v">${rp(r.returns.total)}</div><div class="s">${r.returns.n} retur · ${r.returns.qty} unit · sudah masuk Pengeluaran Kas</div></div>` : ''}<div class="stat"><div class="l">Barang terjual</div><div class="v">${num(t.items)}</div></div><div class="stat"><div class="l">Rata-rata / transaksi</div><div class="v">${rp(t.avg)}</div></div><div class="stat"><div class="l">Diskon</div><div class="v">${rp(t.discount)}</div></div>${t.tax_collected ? `<div class="stat"><div class="l">Pajak (PPN) dipungut</div><div class="v">${rp(t.tax)}</div><div class="s">Bukan omzet · sudah dipisah dari omzet &amp; laba${t.tax_returned ? ` · dikurangi retur ${rp(t.tax_returned)}` : ''}</div></div>` : ''}${r.voided.n ? `<div class="stat"><div class="l">Dibatalkan (void)</div><div class="v">${r.voided.n}</div><div class="s">${rp(r.voided.total)}</div></div>` : ''}</div>
          ${r.daily.length > 1 && r.daily.length <= 45 ? `<div class="card gap"><h2>Omzet per hari</h2>${barChart(r.daily, 'revenue', (x) => x.date.slice(8))}</div>` : ''}
          <div class="cols gap"><div class="card flush"><div style="padding:16px 16px 0"><h2>Produk terjual</h2></div><div class="tablewrap">${tbl(r.by_product, [{ h: 'Produk', f: (x) => esc(x.name) }, { h: 'Qty', num: 1, f: (x) => x.qty }, { h: 'Omzet', num: 1, f: (x) => num(x.revenue) }, ...(full ? [{ h: 'Laba', num: 1, f: (x) => num(x.profit) }] : [])])}</div></div>
          <div class="grid"><div class="card flush"><div style="padding:16px 16px 0"><h2>Per metode bayar</h2></div>${tbl(r.by_method, [{ h: 'Metode', f: (x) => esc(PAY[x.method] || x.method) }, { h: 'Trx', num: 1, f: (x) => x.trx }, { h: 'Uang masuk', num: 1, f: (x) => num(x.revenue) }])}</div>
          <div class="card flush"><div style="padding:16px 16px 0"><h2>Per kanal</h2></div>${tbl(r.by_channel, [{ h: 'Kanal', f: (x) => ({ pos: 'Kasir toko', online: 'Online', order: 'Sales Order' }[x.channel] || x.channel) }, { h: 'Trx', num: 1, f: (x) => x.trx }, { h: 'Omzet', num: 1, f: (x) => num(x.revenue) }])}</div>
          <div class="card flush"><div style="padding:16px 16px 0"><h2>Per kasir</h2></div>${tbl(r.by_cashier, [{ h: 'Kasir', f: (x) => esc(x.cashier) }, { h: 'Trx', num: 1, f: (x) => x.trx }, { h: 'Omzet', num: 1, f: (x) => num(x.revenue) }])}</div></div></div>
          <div class="card flush gap"><div style="padding:16px 16px 0"><h2>Rekap harian</h2></div><div class="tablewrap">${tbl(r.daily, [{ h: 'Tanggal', f: (x) => esc(fmtD(x.date)) }, { h: 'Trx', num: 1, f: (x) => x.trx }, { h: 'Diskon', num: 1, f: (x) => num(x.discount) }, ...(t.tax_collected ? [{ h: 'PPN', num: 1, f: (x) => num(x.tax) }] : []), { h: 'Omzet', num: 1, f: (x) => num(x.revenue) }])}</div></div>`;
      };
      const reload = () => load().catch(A.fail);
      $('#tabs', v).onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; tab = b.dataset.t; $$('#tabs .tab', v).forEach((x) => x.classList.toggle('on', x === b)); $('#ctl .row:first-child', v); reload(); };
      $('#fr', v).onchange = (e) => { from = e.target.value; reload(); }; $('#to', v).onchange = (e) => { to = e.target.value; reload(); };
      $('#ctl', v).addEventListener('click', (e) => { const p = e.target.closest('[data-p]'); if (!p) return; [from, to] = presets[p.dataset.p](); $('#fr', v).value = from; $('#to', v).value = to; reload(); });
      const dl = (type) => A.download(`/reports/export?type=${type}&from=${from}&to=${to}`, `laporan-${type}.csv`).catch(A.fail);
      $('#csv1', v).onclick = () => dl('sales'); if (full) { $('#csv2', v).onclick = () => dl('items'); $('#csv3', v).onclick = () => dl('stock'); }
      $('#prt', v).onclick = () => window.print();
      reload();
    },
  };

  // ======================= PENGGUNA & ROLE =======================
  // Super Admin mengatur siapa memakai role apa, dan hak akses tiap role (centang per fitur).
  // Menu di panel dan akses di server mengikuti hak yang dicentang di sini.
  const permEditor = (catalog, selected, locked) => {
    const sel = new Set(selected);
    return `<div class="row between small"><span class="muted">Centang fitur yang boleh dipakai role ini. Menu yang tidak dicentang tidak akan tampil.</span><b><span id="pcount">0</span> hak dipilih</b></div><div class="gap-s">`
      + catalog.map((g) => `<fieldset class="pgroup"><legend>${esc(g.title)}</legend>${locked ? '' : `<button type="button" class="btn sm" style="float:right" data-grp="${esc(g.title)}">Pilih semua / kosongkan</button>`}`
        + g.items.map((it) => `<label class="chk perm ${it.requires ? 'sub' : ''}" data-grp-of="${esc(g.title)}"><input type="checkbox" data-k="${esc(it.key)}" ${sel.has(it.key) ? 'checked' : ''} ${locked ? 'disabled' : ''}><span><b>${esc(it.label)}</b>${it.desc ? `<span class="small muted"> · ${esc(it.desc)}</span>` : ''}</span></label>`).join('')
        + '</fieldset>').join('') + '</div>';
  };
  const wirePerms = (root, catalog) => {
    const req = {}; catalog.forEach((g) => g.items.forEach((i) => { if (i.requires) req[i.key] = i.requires; }));
    const box = (k) => root.querySelector(`[data-k="${k}"]`);
    const count = () => { const e = root.querySelector('#pcount'); if (e) e.textContent = root.querySelectorAll('[data-k]:checked').length; };
    const off = (p) => Object.keys(req).filter((c) => req[c] === p).forEach((c) => { box(c).checked = false; off(c); });
    root.addEventListener('change', (e) => {
      const k = e.target.dataset && e.target.dataset.k; if (!k) return;
      if (e.target.checked) { let r = req[k]; while (r) { box(r).checked = true; r = req[r]; } } else off(k);
      count();
    });
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-grp]'); if (!b) return;
      const boxes = [...root.querySelectorAll('[data-grp-of]')].filter((l) => l.dataset.grpOf === b.dataset.grp).map((l) => l.querySelector('input'));
      const all = boxes.every((x) => x.checked); boxes.forEach((x) => { x.checked = !all; }); count();
    });
    count();
    return { set: (list) => { root.querySelectorAll('[data-k]').forEach((x) => { x.checked = list.includes(x.dataset.k); }); count(); }, get: () => [...root.querySelectorAll('[data-k]:checked')].map((x) => x.dataset.k) };
  };

  A.pages.pengguna = {
    title: 'Pengguna & Role',
    async render(v) {
      let tab = 'users', users = [], roles = [], catalog = [];
      v.innerHTML = `<div class="row between"><div class="chips" id="tabs"><button class="chip on" data-t="users">Pengguna</button><button class="chip" data-t="roles">Role &amp; Hak Akses</button></div><button class="btn primary" id="new">＋ Pengguna</button></div><div id="body" class="gap"></div>`;
      const roleName = (k) => (roles.find((r) => r.key === k) || {}).name || k;
      const loadRoles = async () => { const d = await A.api('/roles'); roles = d.roles; catalog = d.catalog; };
      const loadUsers = async () => { users = await A.api('/users'); };

      const userForm = (u) => {
        const m = A.modal(u ? 'Edit pengguna' : 'Pengguna baru', `<div class="grid g2"><div><label class="f">Username</label><input class="inp" name="username" value="${esc(u?.username || '')}" ${u ? 'disabled' : ''}></div><div><label class="f">Nama lengkap</label><input class="inp" name="name" value="${esc(u?.name || '')}"></div>
          <div><label class="f">Role</label><select class="inp" name="role">${roles.map((r) => `<option value="${esc(r.key)}" ${(u ? u.role : 'kasir') === r.key ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select><div class="small muted gap-s" id="rdesc"></div></div><div><label class="f">${u ? 'Password baru (kosongkan jika tidak diubah)' : 'Password (min. 6)'}</label><input class="inp" name="password" type="text" autocomplete="off"></div></div>
          ${u ? `<label class="chk gap-s"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Akun aktif</label>` : ''}`, { footer: '<button class="btn" data-n>Batal</button><button class="btn primary" data-y>Simpan</button>' });
        const sel = m.q('[name=role]'); const paint = () => { const r = roles.find((x) => x.key === sel.value); m.q('#rdesc').textContent = r ? `${r.description || ''} (${r.permissions.length} hak akses)` : ''; };
        sel.onchange = paint; paint();
        m.q('[data-n]').onclick = () => m.close();
        m.q('[data-y]').onclick = async () => { const f = A.formData(m); if (u) { f.active = f.active ? 1 : 0; delete f.username; if (!f.password) delete f.password; } try { await A.api(u ? '/users/' + u.id : '/users', { method: u ? 'PUT' : 'POST', body: f }); A.toast('Tersimpan', 'ok'); m.close(); await loadUsers(); await loadRoles(); paint2(); } catch (e) { A.fail(e); } };
      };

      const roleForm = (r) => {
        const locked = !!(r && r.locked);
        const m = A.modal(r ? (locked ? `Hak akses: ${r.name}` : `Edit role: ${r.name}`) : 'Role baru',
          `${locked ? '<div class="notice">Super Admin selalu memiliki semua hak akses dan tidak bisa diubah.</div>' : ''}
          <div class="grid g2"><div><label class="f">Nama role</label><input class="inp" name="name" value="${esc(r?.name || '')}" placeholder="mis. Kasir Magang" ${locked ? 'disabled' : ''}></div>
          <div><label class="f">Deskripsi singkat (opsional)</label><input class="inp" name="description" value="${esc(r?.description || '')}" ${locked ? 'disabled' : ''}></div></div>
          ${!r ? `<div class="gap-s"><label class="f">Mulai dari hak akses role</label><select class="inp" id="copy"><option value="">— Kosong (centang sendiri) —</option>${roles.filter((x) => !x.locked).map((x) => `<option value="${esc(x.key)}">${esc(x.name)}</option>`).join('')}</select></div>` : ''}
          <div class="gap">${permEditor(catalog, r ? r.permissions : [], locked)}</div>`,
          { size: 'wide', footer: `<button class="btn" data-n>${locked ? 'Tutup' : 'Batal'}</button>${r && r.builtin && !locked ? '<button class="btn danger" data-reset>Kembalikan ke awal</button>' : ''}${locked ? '' : '<button class="btn primary" data-y>Simpan</button>'}` });
        const pe = wirePerms(m, catalog);
        const cp = m.q('#copy'); if (cp) cp.onchange = () => { const src = roles.find((x) => x.key === cp.value); pe.set(src ? src.permissions : []); };
        m.q('[data-n]').onclick = () => m.close();
        const rs = m.q('[data-reset]');
        if (rs) rs.onclick = async () => { if (!(await A.confirm(`Kembalikan hak akses role "${r.name}" ke pengaturan awal?`, { danger: true, ok: 'Ya, kembalikan' }))) return; try { await A.api(`/roles/${r.key}/reset`, { method: 'POST' }); A.toast('Dikembalikan ke awal', 'ok'); m.close(); await loadRoles(); paint2(); } catch (e) { A.fail(e); } };
        const ok = m.q('[data-y]');
        if (ok) ok.onclick = async () => {
          const body = { name: m.q('[name=name]').value, description: m.q('[name=description]').value, permissions: pe.get() };
          if (!body.permissions.length && !(await A.confirm('Role ini tidak punya hak akses sama sekali, penggunanya tidak bisa membuka menu apa pun. Tetap simpan?', { ok: 'Ya, simpan' }))) return;
          try { await A.api(r ? '/roles/' + r.key : '/roles', { method: r ? 'PUT' : 'POST', body }); A.toast('Role tersimpan. Berlaku langsung untuk pengguna role ini.', 'ok'); m.close(); await loadRoles(); await loadUsers(); paint2(); } catch (e) { A.fail(e); }
        };
      };

      const paint2 = () => {
        const body = $('#body', v); const nb = $('#new', v);
        $$('#tabs .chip', v).forEach((c) => c.classList.toggle('on', c.dataset.t === tab));
        if (tab === 'users') {
          nb.textContent = '＋ Pengguna';
          body.innerHTML = `<div class="card flush"><div class="tablewrap"><table class="t"><thead><tr><th>Username</th><th>Nama</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>${users.map((u) => `<tr><td><b>${esc(u.username)}</b></td><td>${esc(u.name)}</td><td><span class="badge info">${esc(roleName(u.role))}</span></td><td>${u.active ? '<span class="badge ok">Aktif</span>' : '<span class="badge">Nonaktif</span>'}</td><td><button class="btn sm" data-e="${u.id}">Edit</button></td></tr>`).join('')}</tbody></table></div></div>`;
        } else {
          nb.textContent = '＋ Role baru';
          body.innerHTML = `<div class="notice">Role menentukan menu dan fitur yang bisa dipakai. Buat role sendiri sesuai kebutuhan (mis. kasir yang sedang onboarding hanya diberi hak <b>Kasir</b>, lalu ditambah bertahap). Perubahan berlaku langsung tanpa pengguna perlu login ulang.</div>
            <div class="card flush gap"><div class="tablewrap"><table class="t"><thead><tr><th>Role</th><th>Deskripsi</th><th class="num">Hak akses</th><th class="num">Pengguna</th><th></th></tr></thead><tbody>${roles.map((r) => `<tr><td><b>${esc(r.name)}</b> <span class="badge ${r.builtin ? '' : 'info'}">${r.locked ? 'tetap' : r.builtin ? 'bawaan' : 'kustom'}</span></td><td class="small muted">${esc(r.description)}</td><td class="num">${r.permissions.length}</td><td class="num">${r.users}</td><td class="nowrap"><button class="btn sm" data-r="${esc(r.key)}">${r.locked ? 'Lihat' : 'Atur hak akses'}</button>${r.builtin ? '' : ` <button class="btn sm danger" data-rdel="${esc(r.key)}">Hapus</button>`}</td></tr>`).join('')}</tbody></table></div></div>`;
        }
      };
      v.addEventListener('click', async (e) => {
        const t = e.target.closest('[data-t]'); if (t) { tab = t.dataset.t; paint2(); return; }
        const eu = e.target.closest('[data-e]'); if (eu) return userForm(users.find((u) => u.id === +eu.dataset.e));
        const er = e.target.closest('[data-r]'); if (er) return roleForm(roles.find((r) => r.key === er.dataset.r));
        const dr = e.target.closest('[data-rdel]');
        if (dr) { const r = roles.find((x) => x.key === dr.dataset.rdel); if (!(await A.confirm(`Hapus role "${r.name}"?`, { danger: true, ok: 'Hapus' }))) return; try { await A.api('/roles/' + r.key, { method: 'DELETE' }); A.toast('Role dihapus', 'ok'); await loadRoles(); paint2(); } catch (er2) { A.fail(er2); } }
      });
      $('#new', v).onclick = () => (tab === 'users' ? userForm(null) : roleForm(null));
      await Promise.all([loadRoles(), loadUsers()]);
      paint2();
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
        <label class="chk" style="align-self:end"><input type="checkbox" name="allow_negative_stock" ${s.allow_negative_stock === '1' ? 'checked' : ''}> Izinkan penjualan saat stok 0 / minus</label>
        <div style="grid-column:1/-1;border-top:1px solid var(--line);padding-top:10px"><b>Pajak penjualan kasir</b><div class="muted small">Berlaku untuk transaksi baru di Kasir. Transaksi yang sudah tercatat tidak berubah.</div></div>
        <label class="chk"><input type="checkbox" name="tax_enabled" ${s.tax_enabled === '1' ? 'checked' : ''}> Aktifkan pajak (PPN) di Kasir</label>
        <div><label class="f">Nama pajak di struk</label><input class="inp" name="tax_name" value="${esc(s.tax_name || 'PPN')}" maxlength="12"></div>
        <div><label class="f">Tarif (%)</label><input class="inp" type="number" min="0" max="100" step="0.01" name="tax_rate" value="${esc(s.tax_rate || '11')}" inputmode="decimal"></div>
        <div><label class="f">Cara hitung</label><select class="inp" name="tax_mode"><option value="exclusive" ${s.tax_mode !== 'inclusive' ? 'selected' : ''}>Harga BELUM termasuk pajak (pajak ditambahkan di total)</option><option value="inclusive" ${s.tax_mode === 'inclusive' ? 'selected' : ''}>Harga SUDAH termasuk pajak (hanya dirinci di struk)</option></select></div>
        <label class="chk" style="grid-column:1/-1"><input type="checkbox" name="store_online_enabled" ${s.store_online_enabled !== '0' ? 'checked' : ''}> Aktifkan halaman toko online untuk pelanggan (matikan bila sistem hanya dipakai internal oleh staf)</label></div>
        <button class="btn primary gap" id="save">Simpan pengaturan</button></div>
        <div class="card gap" id="accesscard"><h2>Alamat akses untuk staf (toko &amp; gudang)</h2><div class="muted small" id="acc">Memuat…</div></div>
        <div class="grid"><div class="card"><h2>Cadangan data</h2><p class="muted small" style="margin-top:0">Unduh salinan seluruh database (produk, stok, transaksi). Simpan rutin di tempat aman — flashdisk / Google Drive.</p><button class="btn" id="bk">⬇ Unduh backup database</button><div class="small gap-s" id="bkstat"></div></div>
        <div class="card"><h2>Log aktivitas</h2><div id="audit" class="small" style="max-height:340px;overflow:auto"></div></div></div></div>`;
      $('#save', v).onclick = async () => { const f = A.formData(v); f.allow_negative_stock = f.allow_negative_stock ? '1' : '0'; f.tax_enabled = f.tax_enabled ? '1' : '0'; f.store_online_enabled = f.store_online_enabled ? '1' : '0'; try { A.state.settings = await A.api('/settings', { method: 'PUT', body: f }); A.toast('Pengaturan disimpan', 'ok'); } catch (e) { A.fail(e); } };
      A.api('/server-info').then((i) => {
        const el = $('#acc', v); if (!el) return;
        const mk = (ip) => `${i.protocol}://${ip}${i.port === 80 || i.port === 443 ? '' : ':' + i.port}/admin/`;
        const rows = [];
        if (i.public_host) rows.push({ url: `https://${i.public_host}/admin/`, label: 'Nama Tailscale (HTTPS, kamera aktif)' });
        for (const d of i.details || []) rows.push({ url: mk(d.ip), label: d.kind === 'tailscale' ? 'Lewat Tailscale' : 'Jaringan lokal (Wi-Fi/LAN)' });
        if (!rows.length) { el.innerHTML = '<span class="bad">Komputer server belum tersambung ke jaringan (kabel LAN).</span>'; return; }
        const urls = rows.map((r) => r.url);
        el.innerHTML = `<p style="margin-top:0">Staf cukup membuka salah satu alamat ini di Chrome, lalu login dengan akunnya sendiri.</p>`
          + rows.map((r) => `<div class="gap-s"><div class="small muted">${esc(r.label)}</div><div class="row"><code class="grow" style="font-size:15px;word-break:break-all">${esc(r.url)}</code><button class="btn sm" data-copy="${esc(r.url)}">Salin</button></div></div>`).join('')
          + (rows.length > 1 ? '<p class="small muted">Pakai alamat yang cocok dengan jaringan HP staf: "Jaringan lokal" bila HP satu Wi-Fi dengan server, "Tailscale" bila HP memakai aplikasi Tailscale.</p>' : '')
          + (i.secure || i.public_host ? '' : '<p class="small muted">Catatan: lewat alamat <b>http://</b> kamera HP tidak bisa dipakai untuk scan. Pakai scanner USB/Bluetooth, ketik nama barang, atau aktifkan HTTPS (lihat README).</p>')
          + '<button class="btn sm gap-s" id="accprint">Cetak kartu alamat</button>';
        el.querySelectorAll('[data-copy]').forEach((b) => { b.onclick = () => { const t = b.dataset.copy; (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => A.toast('Alamat disalin', 'ok')).catch(() => { prompt('Salin alamat ini:', t); }); }; });
        $('#accprint', v).onclick = () => A.printHtml(`<h2 style="font-family:sans-serif">${esc(A.state.settings.store_name || 'Toko')} — Alamat aplikasi</h2><p style="font-family:sans-serif">1. Sambungkan HP ke Wi-Fi toko/gudang (atau aktifkan Tailscale).<br>2. Buka Chrome, ketik alamat ini:</p>${rows.map((r) => `<p style="font:bold 22px monospace;margin-bottom:0">${esc(r.url)}</p><p style="font-family:sans-serif;margin-top:0">${esc(r.label)}</p>`).join('')}<p style="font-family:sans-serif">3. Login dengan akun Anda. Menu ⋮ → "Tambahkan ke layar utama" agar mudah dibuka.</p>`);
      }).catch(() => { const el = $('#acc', v); if (el) el.textContent = ''; });
      $('#bk', v).onclick = () => A.download('/backup', 'backup-toko.db').catch(A.fail);
      A.api('/backup/status').then((b) => {
        const el = $('#bkstat', v); if (!el) return;
        if (!b.enabled) { el.innerHTML = '<span class="muted">Backup otomatis belum diaktifkan. Isi <b>BACKUP_DIR</b> di config.env (mis. folder bersama di komputer gedung lain).</span>'; return; }
        const l = b.last; el.innerHTML = !l ? '<span class="muted">Menunggu backup pertama…</span>' : l.ok ? `<span class="badge ok">Backup otomatis aktif</span> <span class="muted">terakhir ${esc(fmtDT(l.at))} → ${esc(b.dir)}</span>` : `<span class="badge bad">Backup GAGAL</span> <span>${esc(l.error)}</span><div class="muted">Periksa folder tujuan (${esc(b.dir)}) / komputer gedung lain menyala dan bisa diakses.</div>`;
      }).catch(() => {});
      try { const log = await A.api('/audit?limit=100'); $('#audit', v).innerHTML = `<table class="t"><tbody>${log.map((l) => `<tr><td class="nowrap muted">${esc(fmtDT(l.created_at))}</td><td><b>${esc(l.username || '-')}</b> ${esc(l.action)}<div class="muted">${esc(l.detail || '')}</div></td></tr>`).join('')}</tbody></table>`; } catch (_) {}
    },
  };

  // ---------- Data pelanggan ----------
  A.pages.pelanggan = {
    title: 'Data Pelanggan',
    async render(v) {
      let rows = [];
      v.innerHTML = `<div class="row between"><p class="muted small">Simpan nama, nomor HP/WA, dan alamat pelanggan agar dapat dipilih kembali saat transaksi.</p><button class="btn primary" id="new">＋ Pelanggan</button></div><div class="card flush gap"><div class="tablewrap" id="tb"></div></div>`;
      const form = (c) => {
        const m = A.modal(c ? 'Edit pelanggan' : 'Pelanggan baru', `<label class="f">Nama *</label><input class="inp" name="name" value="${esc(c?.name || '')}"><label class="f gap-s">Telepon / WA</label><input class="inp" name="phone" inputmode="tel" value="${esc(c?.phone || '')}"><label class="f gap-s">Alamat</label><textarea class="inp" name="address">${esc(c?.address || '')}</textarea><label class="f gap-s">Catatan</label><input class="inp" name="notes" value="${esc(c?.notes || '')}">`, { footer: '<button class="btn" data-n>Batal</button><button class="btn primary" data-y>Simpan</button>' });
        m.q('[data-n]').onclick = () => m.close();
        m.q('[data-y]').onclick = async () => {
          const body = A.formData(m);
          if (!body.name.trim()) return A.toast('Nama pelanggan wajib diisi', 'err');
          try { await A.api(c ? '/customers/' + c.id : '/customers', { method: c ? 'PUT' : 'POST', body }); m.close(); load(); }
          catch (e) { A.fail(e); }
        };
      };
      const load = async () => {
        rows = await A.api('/customers');
        $('#tb', v).innerHTML = rows.length ? `<table class="t"><thead><tr><th>Nama pelanggan</th><th>Telepon / WA</th><th>Alamat</th><th>Catatan</th><th></th></tr></thead><tbody>${rows.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.phone || '-')}</td><td>${esc(c.address || '-')}</td><td>${esc(c.notes || '-')}</td><td class="nowrap"><button class="btn sm" data-e="${c.id}">Edit</button> <button class="btn sm danger" data-d="${c.id}">Arsip</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Belum ada pelanggan. Tambahkan pelanggan pertama.</div>';
      };
      $('#new', v).onclick = () => form(null);
      v.addEventListener('click', async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.e) form(rows.find((c) => c.id === +b.dataset.e));
        if (b.dataset.d && confirm('Arsipkan pelanggan ini?')) {
          try { await A.api('/customers/' + b.dataset.d, { method: 'DELETE' }); load(); } catch (er) { A.fail(er); }
        }
      });
      await load();
    },
  };
})();
