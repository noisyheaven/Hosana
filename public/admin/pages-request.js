/* Permintaan Barang: toko meminta barang ke gudang -> gudang menyiapkan & mengirim -> toko konfirmasi terima.
   (Bukan PO: PO hanya untuk pembelian ke supplier.) */
(function () {
  const A = window.App, { $, $$, esc, num, fmtDT, can } = A;
  const ST = { requested: ['Diminta', 'info'], preparing: ['Disiapkan', 'warn'], shipped: ['Dikirim, menunggu konfirmasi toko', 'warn'], received: ['Selesai', 'ok'], rejected: ['Ditolak', 'bad'], cancelled: ['Dibatalkan', ''] };
  const badge = (s) => `<span class="badge ${ST[s][1]}">${ST[s][0]}</span>`;
  const isGudang = () => !can('permintaan.buat') && can('permintaan.proses'); // peran yang hanya memproses (gudang)
  const canMinta = () => can('permintaan.buat');
  const canProses = () => can('permintaan.proses');

  async function newForm(refresh, prefill) {
    await A.loadProducts();
    const m = A.modal('Permintaan barang', `<p class="muted small" style="margin-top:0">Pilih dari gudang mana barang diminta dan ke mana dikirim. Stok ketiga lokasi ditampilkan di tabel.</p>
      <div class="grid g2"><div><label class="f">Diminta dari</label><select class="inp" id="from">${A.locOptions(['gudang_ruko', 'gudang_toko'], 'gudang_ruko')}</select></div><div><label class="f">Dikirim ke</label><select class="inp" id="to">${A.locOptions(['display', 'gudang_toko'], 'display')}</select></div></div><div id="ed" class="gap-s"></div>
      <div class="grid g2 gap"><div><label class="f">Catatan untuk gudang</label><input class="inp" id="note" placeholder="mis. etalase depan hampir kosong"></div>
      <label class="chk" style="align-self:end"><input type="checkbox" id="urgent"> Mendesak (pelanggan menunggu / etalase kosong)</label></div>`,
      { size: 'wide', footer: '<button class="btn" data-n>Batal</button><button class="btn primary" data-y>Kirim permintaan</button>' });
    const ed = A.itemEditor(m.q('#ed'), { stock: 'all', noTotal: true });
    if (prefill && prefill.length) ed.set(prefill);
    m.q('[data-n]').onclick = () => m.close();
    m.q('[data-y]').onclick = async (e) => {
      const items = ed.get(); if (!items.length) return A.toast('Pilih barang yang diminta', 'err');
      const from_location = m.q('#from').value, to_location = m.q('#to').value;
      if (from_location === to_location) return A.toast('Asal dan tujuan tidak boleh sama', 'err');
      e.currentTarget.disabled = true;
      try { const r = await A.api('/requests', { method: 'POST', body: { items, from_location, to_location, note: m.q('#note').value, urgent: m.q('#urgent').checked } }); A.toast(`Permintaan ${r.number} terkirim ke ${A.LOC[from_location]}`, 'ok'); m.close(); refresh(); }
      catch (er) { A.fail(er); e.currentTarget.disabled = false; }
    };
  }

  function shipForm(r, refresh) {
    const m = A.modal(`Kirim barang · ${r.number}`, `<p class="muted small" style="margin-top:0">Isi jumlah yang benar-benar dikirim. Stok ${esc(A.LOC[r.from_location])} berkurang saat Anda menekan Kirim. Bila kurang dari permintaan, isi catatan alasannya.</p>
      <table class="t"><thead><tr><th>Barang</th><th class="num">Diminta</th><th class="num">Stok ${esc(A.LOC_SHORT[r.from_location])}</th><th class="num" style="width:110px">Dikirim</th></tr></thead><tbody>${r.items.map((i) => `<tr><td>${esc(i.name)}<div class="muted small">${esc(i.sku)}</div></td><td class="num">${i.qty}</td><td class="num ${i.src_qty < i.qty ? 'bad' : ''}">${i.src_qty}</td><td><input class="inp" type="number" min="0" max="${Math.min(i.qty, i.src_qty)}" value="${Math.min(i.qty, i.src_qty)}" data-item="${i.id}"></td></tr>`).join('')}</tbody></table>
      <label class="f gap-s">Catatan (wajib bila ada yang kurang)</label><input class="inp" id="note" placeholder="mis. stok gudang tinggal 3, sisanya menunggu PO">`,
      { footer: '<button class="btn" data-n>Batal</button><button class="btn primary" data-y>Kirim ke toko</button>' });
    m.q('[data-n]').onclick = () => m.close();
    m.q('[data-y]').onclick = async () => {
      const items = m.qa('[data-item]').map((x) => ({ item_id: +x.dataset.item, qty: +x.value || 0 }));
      try { await A.api(`/requests/${r.id}/ship`, { method: 'POST', body: { items, note: m.q('#note').value } }); A.toast('Barang dikirim. Menunggu konfirmasi toko', 'ok'); m.close(); refresh(); } catch (e) { A.fail(e); }
    };
  }
  function receiveForm(r, refresh) {
    const m = A.modal(`Terima barang · ${r.number}`, `<p class="muted small" style="margin-top:0">Hitung barang yang sampai. Stok ${esc(A.LOC[r.to_location])} bertambah sesuai jumlah yang Anda isi. Bila ada selisih, isi catatannya.</p>
      <table class="t"><thead><tr><th>Barang</th><th class="num">Dikirim gudang</th><th class="num" style="width:110px">Diterima</th></tr></thead><tbody>${r.items.filter((i) => i.sent_qty > 0).map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${i.sent_qty}</td><td><input class="inp" type="number" min="0" max="${i.sent_qty}" value="${i.sent_qty}" data-item="${i.id}"></td></tr>`).join('')}</tbody></table>
      <label class="f gap-s">Catatan (wajib bila ada selisih)</label><input class="inp" id="note" placeholder="mis. 1 patung pecah di perjalanan">`,
      { footer: '<button class="btn" data-n>Batal</button><button class="btn primary" data-y>Konfirmasi diterima</button>' });
    m.q('[data-n]').onclick = () => m.close();
    m.q('[data-y]').onclick = async () => {
      const items = m.qa('[data-item]').map((x) => ({ item_id: +x.dataset.item, qty: +x.value || 0 }));
      try { await A.api(`/requests/${r.id}/receive`, { method: 'POST', body: { items, note: m.q('#note').value } }); A.toast(`Barang diterima, stok ${A.LOC[r.to_location]} bertambah`, 'ok'); m.close(); refresh(); } catch (e) { A.fail(e); }
    };
  }

  async function detail(id, refresh) {
    const r = await A.api('/requests/' + id);
    const acts = [];
    if (r.status === 'requested' && canProses()) acts.push(['prepare', 'Mulai siapkan', '']);
    if (['requested', 'preparing'].includes(r.status) && canProses()) acts.push(['ship', 'Kirim', 'primary'], ['reject', 'Tolak', 'danger']);
    if (r.status === 'requested' && canMinta() && (r.created_by === A.state.user.id || can('permintaan.batal_semua'))) acts.push(['cancel', 'Batalkan permintaan', 'danger']);
    if (r.status === 'shipped' && canMinta()) acts.push(['receive', 'Terima barang', 'ok']);
    const done = r.status === 'received' || r.status === 'shipped';
    const m = A.modal(`${r.number} ${r.urgent ? '· MENDESAK' : ''}`, `<div class="row between"><div>${badge(r.status)} ${r.discrepancy ? '<span class="badge bad">Ada selisih</span>' : ''}</div><div class="muted small">${esc(fmtDT(r.created_at))} · ${esc(r.created_by_name || '-')}</div></div>
      <p class="gap-s"><b>${esc(A.LOC[r.from_location] || '-')}</b> → <b>${esc(A.LOC[r.to_location] || '-')}</b></p>
      ${r.note ? `<p><b>Catatan toko:</b> ${esc(r.note)}</p>` : ''}
      ${r.has_short ? '<div class="notice warn gap-s">Stok di lokasi asal kurang untuk sebagian barang. Mungkin perlu membuat PO ke supplier.</div>' : ''}
      ${r.reject_reason ? `<div class="notice bad gap-s"><b>Ditolak gudang:</b> ${esc(r.reject_reason)}</div>` : ''}
      <div class="tablewrap gap-s"><table class="t"><thead><tr><th>Barang</th><th class="num">Diminta</th>${done ? '<th class="num">Dikirim</th>' : '<th class="num">Stok ${esc(A.LOC_SHORT[r.from_location])}</th>'}${r.status === 'received' ? '<th class="num">Diterima</th>' : ''}</tr></thead><tbody>${r.items.map((i) => `<tr><td>${esc(i.name)}<div class="muted small">${esc(i.sku)}</div></td><td class="num">${i.qty}</td>${done ? `<td class="num">${i.sent_qty}</td>` : `<td class="num ${i.short ? 'bad' : ''}">${i.src_qty}${i.short ? ' (kurang)' : ''}</td>`}${r.status === 'received' ? `<td class="num ${i.received_qty < i.sent_qty ? 'bad' : ''}">${i.received_qty}</td>` : ''}</tr>`).join('')}</tbody></table></div>
      <div class="small muted gap-s">${r.prepared_by_name ? `Disiapkan: ${esc(r.prepared_by_name)} · ` : ''}${r.shipped_at ? `Dikirim: ${esc(fmtDT(r.shipped_at))} oleh ${esc(r.shipped_by_name || '-')}${r.ship_note ? ' (' + esc(r.ship_note) + ')' : ''} · ` : ''}${r.received_at ? `Diterima: ${esc(fmtDT(r.received_at))} oleh ${esc(r.received_by_name || '-')}${r.receive_note ? ' (' + esc(r.receive_note) + ')' : ''}` : ''}</div>`,
      { size: 'wide', footer: acts.map(([a, l, c]) => `<button class="btn ${c}" data-a="${a}">${l}</button>`).join('') + '<button class="btn" data-x2>Tutup</button>' });
    m.q('[data-x2]').onclick = () => m.close();
    m.qa('[data-a]').forEach((b) => (b.onclick = async () => {
      const a = b.dataset.a;
      try {
        if (a === 'ship') { m.close(); return shipForm(r, refresh); }
        if (a === 'receive') { m.close(); return receiveForm(r, refresh); }
        if (a === 'reject') { const why = prompt('Alasan menolak permintaan ini?'); if (!why) return; await A.api(`/requests/${r.id}/reject`, { method: 'POST', body: { reason: why } }); }
        else if (a === 'cancel') { if (!(await A.confirm('Batalkan permintaan ini?', { danger: true, ok: 'Batalkan' }))) return; await A.api(`/requests/${r.id}/cancel`, { method: 'POST', body: {} }); }
        else await A.api(`/requests/${r.id}/prepare`, { method: 'POST', body: {} });
        A.toast('Tersimpan', 'ok'); m.close(); refresh();
      } catch (e) { A.fail(e); }
    }));
  }

  A.pages.permintaan = {
    title: 'Permintaan Barang',
    async render(v) {
      let st = 'open';
      v.innerHTML = `<div class="row between"><div class="chips" id="f">${[['open', 'Berjalan'], ['closed', 'Selesai / batal'], ['', 'Semua']].map(([k, l]) => `<button class="chip ${k === st ? 'on' : ''}" data-s="${k}">${l}</button>`).join('')}</div>${canMinta() ? '<button class="btn primary" id="new">＋ Minta barang ke gudang</button>' : ''}</div>
        <div class="card flush gap"><div class="tablewrap" id="tb"></div></div>
        <div class="notice gap">${isGudang() ? '<b>Tugas gudang:</b> buka permintaan → <b>Kirim</b> dengan jumlah yang benar-benar dikirim. Setelah peminta mengonfirmasi, stok lokasi tujuan bertambah.' : '<b>Alur:</b> toko meminta → gudang menyiapkan &amp; mengirim → toko menekan <b>Terima barang</b>. Stok lokasi asal berkurang saat dikirim; stok lokasi tujuan bertambah saat Anda konfirmasi. Untuk membeli dari supplier, pakai <b>Purchase Order</b>.'}</div>`;
      const load = async () => {
        const rows = await A.api('/requests?status=' + st);
        $('#tb', v).innerHTML = rows.length ? `<table class="t"><thead><tr><th>No.</th><th>Waktu</th><th>Peminta</th><th>Dari → Ke</th><th>Barang</th><th>Status</th></tr></thead><tbody>${rows.map((r) => `<tr class="click" data-id="${r.id}"><td><b>${esc(r.number)}</b>${r.urgent ? ' <span class="badge bad">Mendesak</span>' : ''}</td><td class="nowrap">${esc(fmtDT(r.created_at))}</td><td>${esc(r.created_by_name || '-')}</td><td class="small nowrap">${esc(A.LOC_SHORT[r.from_location] || '-')} → ${esc(A.LOC_SHORT[r.to_location] || '-')}</td><td>${r.items.slice(0, 3).map((i) => `${esc(i.name)} <b>×${i.qty}</b>`).join(', ')}${r.items.length > 3 ? ` +${r.items.length - 3} lagi` : ''}</td><td>${badge(r.status)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Belum ada permintaan.</div>';
        $$('tr[data-id]', v).forEach((tr) => (tr.onclick = () => detail(+tr.dataset.id, load).catch(A.fail)));
      };
      $('#f', v).onclick = (e) => { const b = e.target.closest('[data-s]'); if (!b) return; st = b.dataset.s; $$('#f .chip', v).forEach((x) => x.classList.toggle('on', x === b)); load().catch(A.fail); };
      if (canMinta()) $('#new', v).onclick = () => newForm(load).catch(A.fail);
      await load();
      // dibuka dari Cek Stok: #/permintaan?add=ID
      const add = new URLSearchParams((location.hash.split('?')[1] || '')).get('add');
      if (add && canMinta()) { history.replaceState(null, '', '#/permintaan'); newForm(load, [{ product_id: +add, qty: 1, cost: 0 }]).catch(A.fail); }
      const t = setInterval(() => { if (!document.querySelector('.ov')) load().catch(() => {}); }, 20000); // gudang melihat permintaan baru tanpa refresh
      return () => clearInterval(t);
    },
  };
})();
