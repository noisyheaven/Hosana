/* Retur Penjualan: form retur (dari detail transaksi / pencarian invoice) + riwayat retur */
(function () {
  const A = window.App, { $, $$, esc, num, rp, fmtDT, ymd, can, PAY } = A;
  const METHODS = ['tunai', 'transfer', 'qris', 'debit'];

  // ---------- form retur untuk satu transaksi ----------
  A.returForm = async function (saleId, onDone) {
    const info = await A.api(`/sales/${saleId}/returnable`);
    const s = info.sale;
    if (info.blocked) return A.modal(`Retur ${s.invoice_no}`, `<div class="notice bad">${esc(info.blocked)}</div>`, { footer: '<button class="btn" data-n>Tutup</button>' }).q('[data-n]').onclick = (e) => e.target.closest('.ov').remove();
    const rows = info.items.filter((i) => i.returnable_qty > 0);
    const m = A.modal(`Retur ${s.invoice_no}`, `
      <div class="muted small">${esc(s.customer_name || 'Pelanggan umum')} · dibeli ${esc(fmtDT(s.created_at))} · total ${rp(s.total)}${info.refunded ? ` · sudah direfund ${rp(info.refunded)}` : ''}</div>
      <div class="tablewrap gap-s"><table class="t"><thead><tr><th>Barang</th><th class="num">Sisa</th><th>Qty retur</th><th>Kondisi</th></tr></thead><tbody>${rows.map((i) => `<tr data-id="${i.id}">
        <td>${esc(i.name)}<div class="small muted">${rp(i.price)} / unit</div></td><td class="num">${i.returnable_qty}</td>
        <td><input class="inp" type="number" min="0" max="${i.returnable_qty}" value="0" data-qty style="width:76px"></td>
        <td><select class="inp" data-cond><option value="baik">Baik (masuk stok)</option><option value="rusak">Rusak (tidak masuk stok)</option></select></td></tr>`).join('')}</tbody></table></div>
      <div class="row gap-s"><div class="grow"><label class="f">Stok barang baik kembali ke</label><select class="inp" id="rl">${A.locOptions(Object.keys(A.LOC), info.default_location)}</select></div>
      <div class="grow"><label class="f">Refund lewat</label><select class="inp" id="rm">${METHODS.map((k) => `<option value="${k}"${k === info.default_refund_method ? ' selected' : ''}>${esc(PAY[k])}</option>`).join('')}</select></div></div>
      <label class="f gap-s">Alasan retur (wajib)</label><input class="inp" id="rr" placeholder="mis. salah ukuran, cacat, tidak cocok">
      <label class="f gap-s">Catatan (opsional)</label><input class="inp" id="rn">
      <div class="totalbox gap-s"><div class="row between"><span>Perkiraan refund</span><span class="big" id="est">${rp(0)}</span></div><div class="small muted" id="cashnote"></div></div>`,
      { footer: '<button class="btn" data-n>Batal</button><button class="btn primary" data-y>Proses retur</button>', size: 'wide' });
    const lines = () => $$('tr[data-id]', m.el || m.q('.mb')).map((tr) => ({ sale_item_id: +tr.dataset.id, qty: Math.max(0, parseInt($('[data-qty]', tr).value, 10) || 0), condition: $('[data-cond]', tr).value }));
    const estimate = () => {
      const picked = lines().filter((l) => l.qty > 0); const byId = new Map(info.items.map((i) => [i.id, i]));
      const base = picked.reduce((a, l) => a + byId.get(l.sale_item_id).price * l.qty, 0);
      const left = info.items.reduce((a, i) => a + i.returnable_qty, 0) - picked.reduce((a, l) => a + l.qty, 0);
      const max = s.total - info.refunded;
      const est = !picked.length ? 0 : left === 0 ? max : Math.min(max, Math.round(base * (s.subtotal > 0 ? s.total / s.subtotal : 1)));
      m.q('#est').textContent = rp(est);
      m.q('#cashnote').textContent = est && m.q('#rm').value === 'tunai' ? 'Uang refund diambil dari kas dan otomatis tercatat sebagai pengeluaran kas.' : '';
    };
    m.q('.mb').addEventListener('input', estimate); m.q('.mb').addEventListener('change', estimate);
    m.q('[data-n]').onclick = () => m.close();
    m.q('[data-y]').onclick = async () => {
      const items = lines().filter((l) => l.qty > 0);
      if (!items.length) return A.toast('Isi jumlah retur minimal satu barang', 'err');
      if (!m.q('#rr').value.trim()) return A.toast('Alasan retur wajib diisi', 'err');
      const ok = await A.confirm(`Refund ${m.q('#est').textContent} via ${PAY[m.q('#rm').value]}. Lanjutkan proses retur?`, { ok: 'Proses retur', title: 'Proses retur' });
      if (!ok) return;
      try {
        const r = await A.api(`/sales/${saleId}/return`, { method: 'POST', body: { items, reason: m.q('#rr').value.trim(), note: m.q('#rn').value.trim(), refund_method: m.q('#rm').value, restock_location: m.q('#rl').value } });
        A.toast(`Retur ${r.return_no} tersimpan`, 'ok'); m.close(); onDone && onDone(r); A.showReturn && A.showReturn(r.id);
      } catch (e) { A.fail(e); }
    };
  };

  // ---------- detail retur ----------
  A.showReturn = async function (id) {
    const r = await A.api('/returns/' + id);
    const m = A.modal(`Retur ${r.return_no}`, `
      <div class="row between"><span class="badge ok">REFUND ${esc((PAY[r.refund_method] || r.refund_method).toUpperCase())}</span><span class="muted small">${esc(fmtDT(r.created_at))}</span></div>
      <dl class="kv gap-s"><dt>Transaksi</dt><dd>${esc(r.invoice_no)}</dd><dt>Pelanggan</dt><dd>${esc(r.customer_name || '-')} ${esc(r.customer_phone || '')}</dd><dt>Diproses oleh</dt><dd>${esc(r.user_name || '-')}</dd><dt>Alasan</dt><dd>${esc(r.reason)}</dd>${r.note ? `<dt>Catatan</dt><dd>${esc(r.note)}</dd>` : ''}${r.cash ? `<dt>Kas keluar</dt><dd>${esc(r.cash.expense_no)}</dd>` : ''}</dl>
      <div class="tablewrap gap-s"><table class="t"><thead><tr><th>Barang</th><th class="num">Harga</th><th class="num">Qty</th><th>Kondisi</th><th>Stok kembali ke</th></tr></thead><tbody>${r.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${num(i.price)}</td><td class="num">${i.qty}</td><td>${i.condition === 'baik' ? 'Baik' : '<span class="badge bad">Rusak</span>'}</td><td>${i.restock_location ? esc(A.LOC[i.restock_location]) : '-'}</td></tr>`).join('')}</tbody></table></div>
      <div class="totalbox"><div class="row between"><span>Total refund</span><span class="big">${rp(r.refund_amount)}</span></div></div>`,
      { footer: '<button class="btn" data-n>Tutup</button>' });
    m.q('[data-n]').onclick = () => m.close();
  };

  // ---------- halaman Retur Penjualan ----------
  A.pages.retur = {
    title: 'Retur Penjualan',
    async render(v) {
      let from = can('penjualan.semua') ? ymd(new Date(Date.now() - 29 * 864e5)) : ymd(), to = ymd(), term = '';
      v.innerHTML = `<div class="card"><h2 style="margin-top:0">Retur baru</h2><label class="f">Cari transaksi (nomor invoice / nama / HP pelanggan, min. 3 huruf)</label><input class="inp" id="fq" placeholder="mis. INV-20261118-0001">
        <div id="fres" class="gap-s"></div></div>
        <div class="row gap"><div><label class="f">Dari</label><input class="inp" type="date" id="fr" value="${from}"></div><div><label class="f">Sampai</label><input class="inp" type="date" id="to" value="${to}"></div><div class="grow"><label class="f">Cari no. retur / invoice / pelanggan</label><input class="inp" id="q"></div></div>
        <div class="card flush gap"><div class="tablewrap" id="tb"></div></div>`;
      const load = async () => {
        const rows = await A.api(`/returns?from=${from}&to=${to}&q=${encodeURIComponent(term)}`);
        const sum = rows.reduce((a, r) => a + r.refund_amount, 0);
        $('#tb', v).innerHTML = rows.length ? `<table class="t"><thead><tr><th>No. Retur</th><th>Invoice</th><th>Pelanggan</th><th>Alasan</th><th>Refund</th><th class="num">Item</th><th class="num">Jumlah</th></tr></thead><tbody>${rows.map((r) => `<tr class="click" data-id="${r.id}"><td><b>${esc(r.return_no)}</b><div class="small muted">${esc(fmtDT(r.created_at))}</div></td><td>${esc(r.invoice_no)}</td><td>${esc(r.customer_name || '-')}</td><td>${esc(r.reason)}</td><td>${esc(PAY[r.refund_method] || r.refund_method)}</td><td class="num">${r.items}</td><td class="num">${rp(r.refund_amount)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="6" class="right"><b>Total refund</b></td><td class="num"><b>${rp(sum)}</b></td></tr></tfoot></table>` : '<div class="empty">Belum ada retur pada rentang ini</div>';
        $$('tr[data-id]', v).forEach((tr) => (tr.onclick = () => A.showReturn(+tr.dataset.id).catch(A.fail)));
      };
      const find = A.debounce(async (e) => {
        const t = e.target.value.trim(); const box = $('#fres', v);
        if (t.length < 3) { box.innerHTML = ''; return; }
        const rows = await A.api('/returns/find?q=' + encodeURIComponent(t));
        box.innerHTML = rows.length ? `<div class="tablewrap"><table class="t"><tbody>${rows.map((s) => `<tr><td><b>${esc(s.invoice_no)}</b><div class="small muted">${esc(fmtDT(s.created_at))}</div></td><td>${esc(s.customer_name || '-')}</td><td class="num">${rp(s.total)}</td><td>${s.status === 'void' ? '<span class="badge bad">void</span>' : s.returns ? `<span class="badge warn">${s.returns}x retur</span>` : ''}</td><td class="right">${s.status === 'paid' ? `<button class="btn sm primary" data-s="${s.id}">Retur</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="muted small">Transaksi tidak ditemukan</div>';
        $$('[data-s]', box).forEach((b) => (b.onclick = () => A.returForm(+b.dataset.s, () => { load().catch(A.fail); find(e); }).catch(A.fail)));
      });
      $('#fq', v).oninput = (e) => find(e);
      $('#fr', v).onchange = (e) => { from = e.target.value; load().catch(A.fail); }; $('#to', v).onchange = (e) => { to = e.target.value; load().catch(A.fail); };
      $('#q', v).oninput = A.debounce((e) => { term = e.target.value; load().catch(A.fail); });
      if (!can('penjualan.semua')) v.insertAdjacentHTML('beforeend', '<p class="muted small">Riwayat hanya menampilkan retur yang Anda proses sendiri dalam 3 hari terakhir.</p>');
      await load();
    },
  };
})();
