/* Halaman: Produk, Stok, Transfer gudang -> toko */
(function () {
  const A = window.App, { $, $$, esc, num, rp, fmtDT, can } = A;
  const MOV = { initial: 'Stok awal', sale: 'Penjualan', sale_return: 'Retur customer', void: 'Void penjualan', order: 'Sales Order (dipesan)', order_cancel: 'Sales Order batal', transfer_out: 'Kirim ke toko', transfer_in: 'Masuk ke toko', po_in: 'Terima PO', opname: 'Opname', adjust: 'Koreksi' };

  // ---------- label barcode ----------
  function labelDialog(products) {
    const m = A.modal('Cetak label barcode', `<p class="muted small" style="margin-top:0">Atur jumlah label per barang. Cetak di kertas A4 biasa (atau kertas label stiker). Barcode EAN-13 / Code128 bisa dibaca scanner mana pun.</p>
      <table class="t"><tbody>${products.map((p) => `<tr><td><b>${esc(p.name)}</b><div class="small mono muted">${esc(p.barcode || p.sku)}</div></td><td class="num" style="width:110px"><input class="inp" type="number" min="0" value="1" data-id="${p.id}" style="text-align:right"></td></tr>`).join('')}</tbody></table>`,
      { footer: '<button class="btn" data-n>Batal</button><button class="btn primary" data-y>🖨 Cetak</button>' });
    m.q('[data-n]').onclick = () => m.close();
    m.q('[data-y]').onclick = () => {
      const list = products.map((p) => ({ name: p.name, price: p.price, code: p.barcode || p.sku, copies: Math.max(0, parseInt(m.q(`[data-id="${p.id}"]`).value, 10) || 0) })).filter((x) => x.copies);
      if (!list.length) return A.toast('Isi jumlah label', 'err');
      try { A.print(A.labelsHtml(list)); } catch (e) { A.fail(e); }
    };
  }

  // ---------- resize gambar ----------
  function resizeImage(file, max = 800) {
    return new Promise((res, rej) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => { const r = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.82)); };
      img.onerror = () => rej(new Error('Gambar tidak dapat dibaca')); img.src = url;
    });
  }

  // ---------- form produk ----------
  async function productForm(p, refresh) {
    const edit = !!p; p = p || { price: 0, cost: 0, min_stock: 5, unit: 'pcs', show_online: 1 };
    await A.loadCats();
    const m = A.modal(edit ? 'Edit barang' : 'Tambah barang', `
      <div class="grid g2"><div style="grid-column:1/-1"><label class="f">Nama barang *</label><input class="inp" name="name" value="${esc(p.name || '')}"></div>
      <div><label class="f">SKU (kosong = otomatis)</label><input class="inp" name="sku" value="${esc(p.sku || '')}"></div>
      <div><label class="f">Barcode (kosong = dibuat otomatis)</label><div class="scanbar"><input class="inp" name="barcode" value="${esc(p.barcode || '')}" inputmode="numeric"><button class="btn" type="button" id="scanbc" title="Scan dari kemasan">📷</button></div></div>
      <div><label class="f">Kategori</label><select class="inp" name="category_id">${A.catOptions(p.category_id)}</select></div>
      <div><label class="f">Satuan</label><input class="inp" name="unit" value="${esc(p.unit || 'pcs')}"></div>
      <div><label class="f">Harga jual (Rp) *</label><input class="inp" name="price" type="number" min="0" value="${p.price}"></div>
      <div><label class="f">Harga beli / modal (Rp)</label><input class="inp" name="cost" type="number" min="0" value="${p.cost}"></div>
      <div><label class="f">Stok minimum (peringatan)</label><input class="inp" name="min_stock" type="number" min="0" value="${p.min_stock}"></div>
      ${edit ? '' : `<div></div><div><label class="f">Stok awal — Display Toko</label><input class="inp" name="display_qty" type="number" min="0" value="0"></div><div><label class="f">Stok awal — Gudang Toko</label><input class="inp" name="gt_qty" type="number" min="0" value="0"></div><div><label class="f">Stok awal — Gudang Ruko</label><input class="inp" name="gr_qty" type="number" min="0" value="0"></div>`}
      <div style="grid-column:1/-1"><label class="f">Deskripsi (tampil di toko online)</label><textarea class="inp" name="description">${esc(p.description || '')}</textarea></div>
      <div style="grid-column:1/-1" class="row"><div id="imgprev">${p.image ? `<img class="thumb" style="width:72px;height:72px" src="${A.apiBase()}${esc(p.image)}">` : '<div class="thumb" style="width:72px;height:72px">Foto</div>'}</div><div class="grow"><label class="f">Foto barang</label><div class="row" style="flex-wrap:wrap;gap:8px"><button type="button" class="btn" id="imgcam">📷 Ambil foto (kamera)</button><button type="button" class="btn" id="imgpick">🖼 Pilih dari galeri / file</button><button type="button" class="btn" id="imgdel" ${p.image ? '' : 'hidden'}>Hapus foto</button></div><div class="small muted gap-s" id="imgst"></div><input type="file" accept="image/*" capture="environment" id="imgf-cam" hidden><input type="file" accept="image/*" id="imgf" hidden><input type="hidden" name="image" value="${esc(p.image || '')}"></div></div>
      <label class="chk" style="grid-column:1/-1"><input type="checkbox" name="show_online" ${p.show_online ? 'checked' : ''}> Tampilkan di toko online</label></div>`,
      { size: 'wide', footer: '<button class="btn" data-n>Batal</button><button class="btn primary" data-y>Simpan</button>' });
    m.q('#scanbc').onclick = () => A.scan((c) => { m.q('[name=barcode]').value = c; }, { title: 'Scan barcode kemasan' });
    // Foto: "Ambil foto" membuka kamera HP langsung (atribut capture; tidak butuh HTTPS). Di PC keduanya membuka pemilih file.
    const onPhoto = async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      const st = m.q('#imgst'); st.textContent = 'Memproses & mengunggah foto…';
      try {
        const data = await resizeImage(f); const r = await A.api('/upload', { method: 'POST', body: { data } });
        m.q('[name=image]').value = r.url; m.q('#imgprev').innerHTML = `<img class="thumb" style="width:72px;height:72px" src="${A.apiBase()}${r.url}">`; m.q('#imgdel').hidden = false; st.textContent = 'Foto siap. Klik Simpan untuk menyimpan barang.';
      } catch (er) { st.textContent = ''; A.fail(er); }
    };
    m.q('#imgf-cam').onchange = onPhoto; m.q('#imgf').onchange = onPhoto;
    m.q('#imgcam').onclick = () => m.q('#imgf-cam').click(); m.q('#imgpick').onclick = () => m.q('#imgf').click();
    m.q('#imgdel').onclick = () => { m.q('[name=image]').value = ''; m.q('#imgprev').innerHTML = '<div class="thumb" style="width:72px;height:72px">Foto</div>'; m.q('#imgdel').hidden = true; m.q('#imgst').textContent = 'Foto dihapus. Klik Simpan untuk menyimpan.'; };
    m.q('[data-n]').onclick = () => m.close();
    m.q('[data-y]').onclick = async (e) => {
      const f = A.formData(m); f.show_online = f.show_online ? 1 : 0;
      for (const k of ['price', 'cost', 'min_stock', 'display_qty', 'gt_qty', 'gr_qty']) if (f[k] !== undefined) f[k] = +f[k] || 0;
      e.currentTarget.disabled = true;
      try { const r = await A.api(edit ? '/products/' + p.id : '/products', { method: edit ? 'PUT' : 'POST', body: f }); A.toast(edit ? 'Barang diperbarui' : `Barang ditambahkan (SKU ${r.sku})`, 'ok'); m.close(); refresh(); } catch (er) { A.fail(er); e.currentTarget.disabled = false; }
    };
  }

  A.productForm = productForm;
  async function categoryManager(refresh) {
    await A.loadCats();
    const m = A.modal('Kelola kategori', '<div id="cl"></div><div class="row gap"><input class="inp grow" id="nc" placeholder="Nama kategori baru"><button class="btn primary" id="ac">Tambah</button></div>');
    const paint = () => { m.q('#cl').innerHTML = A.state.cats.map((c) => `<div class="row between" style="padding:6px 0;border-bottom:1px solid #f0ece1"><span>${esc(c.name)} <span class="muted small">(${c.products} barang)</span></span><span><button class="btn sm" data-ren="${c.id}">Ubah</button> <button class="btn sm danger" data-del="${c.id}">Hapus</button></span></div>`).join('') || '<div class="muted">Belum ada kategori</div>'; };
    paint();
    m.q('#ac').onclick = async () => { const n = m.q('#nc').value.trim(); if (!n) return; try { await A.api('/categories', { method: 'POST', body: { name: n } }); m.q('#nc').value = ''; await A.loadCats(); paint(); refresh(); } catch (e) { A.fail(e); } };
    m.q('#cl').onclick = async (e) => {
      const r = e.target.closest('[data-ren]'), d = e.target.closest('[data-del]');
      try {
        if (r) { const c = A.state.cats.find((x) => x.id === +r.dataset.ren); const n = await A.prompt('Ubah kategori', 'Nama', c.name); if (n) { await A.api('/categories/' + c.id, { method: 'PUT', body: { name: n } }); await A.loadCats(); paint(); refresh(); } }
        if (d && (await A.confirm('Hapus kategori ini? Barang di dalamnya jadi tanpa kategori.', { danger: true, ok: 'Hapus' }))) { await A.api('/categories/' + d.dataset.del, { method: 'DELETE' }); await A.loadCats(); paint(); refresh(); }
      } catch (er) { A.fail(er); }
    };
  }

  // ---------- Produk ----------
  A.pages.produk = {
    title: 'Data Barang',
    async render(v) {
      const manage = can('produk.kelola'), seeCost = can('harga_beli'); let term = '', cat = '', low = false, archived = false; const sel = new Set();
      await A.loadCats();
      v.innerHTML = `<div class="row between"><div class="row grow"><input class="inp" id="q" placeholder="Cari nama / SKU / barcode" style="max-width:300px"><select class="inp" id="cat" style="max-width:200px"><option value="">Semua kategori</option>${A.state.cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
        <label class="chk small"><input type="checkbox" id="low"> Stok menipis</label>${manage ? '<label class="chk small"><input type="checkbox" id="arch"> Tampilkan arsip</label>' : ''}</div>
        <div class="row"><button class="btn" id="cam">📷 Cari lewat scan</button><button class="btn" id="lab">🏷 Label terpilih</button>${manage ? '<button class="btn" id="cats">Kategori</button><button class="btn primary" id="add">＋ Tambah barang</button>' : ''}</div></div>
        <div class="card flush gap"><div class="tablewrap" id="tb"></div></div>`;
      let rows = [];
      const load = async () => {
        const qs = `?q=${encodeURIComponent(term)}&category_id=${cat}${low ? '&low=1' : ''}&active=${archived ? 'all' : '1'}`;
        rows = await A.api('/products' + qs);
        $('#tb', v).innerHTML = rows.length ? `<table class="t"><thead><tr><th><input type="checkbox" id="all"></th><th>Barang</th><th>Kategori</th><th class="num">Harga jual</th>${seeCost ? '<th class="num">Harga beli</th>' : ''}<th class="num">Display</th><th class="num">Gdg Toko</th><th class="num">Gdg Ruko</th><th></th></tr></thead><tbody>${rows.map((p) => `<tr data-id="${p.id}" style="${p.active ? '' : 'opacity:.5'}"><td><input type="checkbox" data-sel="${p.id}" ${sel.has(p.id) ? 'checked' : ''}></td><td><div class="row" style="flex-wrap:nowrap">${A.thumb(p)}<div><b>${esc(p.name)}</b>${p.active ? '' : ' <span class="badge">arsip</span>'}<div class="small muted mono">${esc(p.sku)} · ${esc(p.barcode || '-')}</div></div></div></td><td>${esc(p.category || '-')}</td><td class="num">${rp(p.price)}</td>${seeCost ? `<td class="num">${rp(p.cost)}</td>` : ''}<td class="num"><span class="badge ${p.display_qty <= 0 ? 'bad' : p.display_qty <= p.min_stock ? 'warn' : 'ok'}">${p.display_qty}</span></td><td class="num">${p.gt_qty}</td><td class="num">${p.gr_qty}</td><td class="nowrap"><button class="btn sm" data-lab="${p.id}" title="Cetak label">🏷</button>${can(['stok', 'stok.kartu']) ? ` <button class="btn sm" data-card="${p.id}" title="Kartu stok">📒</button>` : ''}${manage ? ` <button class="btn sm" data-edit="${p.id}">Edit</button> <button class="btn sm danger" data-del="${p.id}">Hapus</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Belum ada barang</div>';
      };
      const byId = (id) => rows.find((p) => p.id === +id);
      v.addEventListener('click', async (e) => {
        const t = e.target;
        if (t.matches('#all')) { rows.forEach((p) => (t.checked ? sel.add(p.id) : sel.delete(p.id))); $$('[data-sel]', v).forEach((c) => (c.checked = t.checked)); }
        if (t.matches('[data-sel]')) { t.checked ? sel.add(+t.dataset.sel) : sel.delete(+t.dataset.sel); }
        const b = t.closest('button'); if (!b) return;
        if (b.dataset.lab) labelDialog([byId(b.dataset.lab)]);
        if (b.dataset.card) A.openStockCard(+b.dataset.card);
        if (b.dataset.edit) productForm(byId(b.dataset.edit), load).catch(A.fail);
        if (b.dataset.del) {
          const p = byId(b.dataset.del);
          if (await A.confirm(`Hapus "${p.name}"? Jika sudah punya riwayat transaksi, barang hanya diarsipkan.`, { danger: true, ok: 'Hapus' })) { try { const r = await A.api('/products/' + p.id, { method: 'DELETE' }); A.toast(r.message, 'ok'); load(); } catch (er) { A.fail(er); } }
        }
      });
      $('#q', v).oninput = A.debounce((e) => { term = e.target.value; load().catch(A.fail); });
      $('#cat', v).onchange = (e) => { cat = e.target.value; load().catch(A.fail); };
      $('#low', v).onchange = (e) => { low = e.target.checked; load().catch(A.fail); };
      const ar = $('#arch', v); if (ar) ar.onchange = (e) => { archived = e.target.checked; load().catch(A.fail); };
      $('#cam', v).onclick = () => A.scan((c) => { $('#q', v).value = c; term = c; load().catch(A.fail); }, { title: 'Cari barang lewat barcode' });
      $('#lab', v).onclick = () => { const l = rows.filter((p) => sel.has(p.id)); l.length ? labelDialog(l) : A.toast('Centang barang dulu', 'err'); };
      if (manage) { $('#add', v).onclick = () => productForm(null, load).catch(A.fail); $('#cats', v).onclick = () => categoryManager(() => A.go('produk')).catch(A.fail); }
      await load();
    },
  };

  // ---------- Stok ----------
  async function adjustForm(p, loc, refresh) {
    const cur = p[A.QTYKEY[loc]];
    const m = A.modal(`Koreksi stok ${A.LOC[loc]}`, `<p style="margin-top:0"><b>${esc(p.name)}</b><br><span class="muted">Stok tercatat saat ini: <b>${cur}</b></span></p>
      <label class="f">Jenis koreksi</label><select class="inp" id="mode"><option value="set">Stok opname — isi jumlah hasil hitung fisik</option><option value="add">Tambah / kurangi (isi minus untuk mengurangi)</option></select>
      <label class="f gap-s" id="ql">Jumlah stok sebenarnya</label><input class="inp" id="qty" type="number" value="${cur}"><label class="f gap-s">Alasan / catatan</label><input class="inp" id="note" placeholder="mis. barang rusak, hasil hitung ulang">`,
      { footer: '<button class="btn" data-n>Batal</button><button class="btn primary" data-y>Simpan</button>' });
    m.q('#mode').onchange = (e) => { m.q('#ql').textContent = e.target.value === 'set' ? 'Jumlah stok sebenarnya' : 'Jumlah penambahan (+) / pengurangan (−)'; m.q('#qty').value = e.target.value === 'set' ? cur : 0; };
    m.q('[data-n]').onclick = () => m.close();
    m.q('[data-y]').onclick = async () => { try { await A.api('/stock/adjust', { method: 'POST', body: { product_id: p.id, location: loc, mode: m.q('#mode').value, qty: +m.q('#qty').value, note: m.q('#note').value } }); A.toast('Stok diperbarui', 'ok'); m.close(); refresh(); } catch (e) { A.fail(e); } };
  }
  A.pages.stok = {
    title: 'Stok Barang',
    async render(v) {
      let tab = 'display', term = '', low = false;
      v.innerHTML = `<div class="tabs" id="tabs">${Object.keys(A.LOC).map((k) => `<button class="tab${k === tab ? ' on' : ''}" data-t="${k}">${A.LOC[k]}</button>`).join('')}<button class="tab" data-t="mov">Riwayat Mutasi</button></div>
        <div class="row"><input class="inp" id="q" placeholder="Cari barang / SKU / barcode" style="max-width:300px"><button class="btn" id="cam">📷</button><label class="chk small"><input type="checkbox" id="low"> Hanya menipis</label><span class="grow"></span><span id="sum" class="muted"></span></div>
        <div class="card flush gap"><div class="tablewrap" id="tb"></div></div>`;
      const load = async () => {
        if (tab === 'mov') {
          const rows = (await A.api('/stock/movements?limit=500')).filter((m) => !term || `${m.product} ${m.sku} ${m.ref || ''}`.toLowerCase().includes(term.toLowerCase()));
          $('#sum', v).textContent = '';
          $('#tb', v).innerHTML = rows.length ? `<table class="t"><thead><tr><th>Waktu</th><th>Barang</th><th>Lokasi</th><th>Jenis</th><th class="num">Perubahan</th><th class="num">Saldo</th><th>Ref / catatan</th><th>Oleh</th></tr></thead><tbody>${rows.map((m) => `<tr><td class="nowrap">${esc(fmtDT(m.created_at))}</td><td>${esc(m.product)}<div class="small muted">${esc(m.sku)}</div></td><td>${esc(A.LOC[m.location] || m.location)}</td><td>${esc(MOV[m.type] || m.type)}</td><td class="num"><b style="color:${m.qty < 0 ? 'var(--bad)' : 'var(--ok)'}">${m.qty > 0 ? '+' : ''}${m.qty}</b></td><td class="num">${m.balance}</td><td class="small">${esc(m.ref || '')} ${esc(m.note || '')}</td><td class="small">${esc(m.user || '')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Belum ada mutasi</div>';
          return;
        }
        const rows = await A.api(`/products?q=${encodeURIComponent(term)}`);
        const key = A.QTYKEY[tab]; const others = Object.keys(A.LOC).filter((k) => k !== tab);
        const list = rows.filter((p) => !low || p[key] <= p.min_stock);
        $('#sum', v).textContent = `${list.length} barang · total ${num(list.reduce((a, p) => a + p[key], 0))} unit`;
        $('#tb', v).innerHTML = list.length ? `<table class="t"><thead><tr><th>Barang</th><th>Kategori</th><th class="num">Stok ${esc(A.LOC[tab])}</th><th class="num">Min</th>${others.map((k) => `<th class="num">${esc(A.LOC_SHORT[k])}</th>`).join('')}<th>Status</th><th></th></tr></thead><tbody>${list.map((p) => `<tr><td><b>${esc(p.name)}</b><div class="small muted mono">${esc(p.sku)}</div></td><td>${esc(p.category || '-')}</td><td class="num"><b>${p[key]}</b></td><td class="num">${p.min_stock}</td>${others.map((k) => `<td class="num muted">${p[A.QTYKEY[k]]}</td>`).join('')}<td>${p[key] <= 0 ? '<span class="badge bad">Habis</span>' : p[key] <= p.min_stock ? '<span class="badge warn">Menipis</span>' : '<span class="badge ok">Aman</span>'}</td><td class="nowrap"><button class="btn sm" data-card="${p.id}" title="Kartu stok: riwayat keluar-masuk">📒 Kartu</button> ${can(tab === 'display' ? 'stok.koreksi_toko' : 'stok.koreksi_gudang') ? `<button class="btn sm" data-adj="${p.id}">Koreksi</button> ` : ''}${tab === 'display' && p.gt_qty + p.gr_qty > 0 && can('transfer') ? `<a class="btn sm" href="#/transfer">Isi dari gudang</a>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Tidak ada data</div>';
        $$('[data-adj]', v).forEach((b) => (b.onclick = () => adjustForm(rows.find((p) => p.id === +b.dataset.adj), tab, load)));
        $$('[data-card]', v).forEach((b) => (b.onclick = () => A.openStockCard(+b.dataset.card, tab)));
      };
      $('#tabs', v).onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; tab = b.dataset.t; $$('#tabs .tab', v).forEach((x) => x.classList.toggle('on', x === b)); load().catch(A.fail); };
      $('#q', v).oninput = A.debounce((e) => { term = e.target.value; load().catch(A.fail); });
      $('#low', v).onchange = (e) => { low = e.target.checked; load().catch(A.fail); };
      $('#cam', v).onclick = () => A.scan((c) => { $('#q', v).value = c; term = c; load().catch(A.fail); });
      await load();
    },
  };

  // ---------- Transfer antar lokasi ----------
  A.pages.transfer = {
    title: 'Transfer Stok Antar Lokasi',
    async render(v) {
      await A.loadProducts();
      v.innerHTML = `<div class="card"><h2>Pindahkan stok antar lokasi</h2><p class="muted small" style="margin-top:0">Stok lokasi asal berkurang, stok lokasi tujuan bertambah secara otomatis dan tercatat di riwayat mutasi.</p>
        <div class="grid g2"><div><label class="f">Dari</label><select class="inp" id="from">${A.locOptions(Object.keys(A.LOC), 'gudang_ruko')}</select></div><div><label class="f">Ke</label><select class="inp" id="to">${A.locOptions(Object.keys(A.LOC), 'display')}</select></div></div><div id="ed" class="gap-s"></div>
        <div class="grid g2 gap"><div><label class="f">Catatan</label><input class="inp" id="note" placeholder="mis. isi ulang etalase"></div><div class="row" style="align-items:end;justify-content:flex-end"><button class="btn primary lg" id="go">Proses transfer</button></div></div></div>
        <div class="card flush gap"><div style="padding:16px 16px 0"><h2>Riwayat transfer</h2></div><div class="tablewrap" id="hist"></div></div>`;
      const ed = A.itemEditor($('#ed', v), { stock: 'all' });
      const hist = async () => {
        const rows = await A.api('/transfers');
        $('#hist', v).innerHTML = rows.length ? `<table class="t"><thead><tr><th>No.</th><th>Waktu</th><th>Dari → Ke</th><th>Barang</th><th>Oleh</th></tr></thead><tbody>${rows.map((t) => `<tr><td><b>${esc(t.number)}</b></td><td class="nowrap">${esc(fmtDT(t.created_at))}</td><td class="nowrap">${esc(A.LOC[t.from_location] || '-')} → ${esc(A.LOC[t.to_location] || '-')}</td><td>${t.items.map((i) => `${esc(i.name)} <b>×${i.qty}</b>`).join(', ')}${t.note ? `<div class="small muted">${esc(t.note)}</div>` : ''}</td><td>${esc(t.user || '')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Belum ada transfer</div>';
      };
      $('#go', v).onclick = async (e) => {
        const items = ed.get(); if (!items.length) return A.toast('Pilih barang yang akan dipindahkan', 'err');
        const from = $('#from', v).value, to = $('#to', v).value;
        if (from === to) return A.toast('Lokasi asal dan tujuan tidak boleh sama', 'err');
        for (const it of items) { const p = A.state.products.find((x) => x.id === it.product_id); const have = p ? p[A.QTYKEY[from]] : 0; if (p && it.qty > have) return A.toast(`Stok ${A.LOC[from]} "${p.name}" hanya ${have}`, 'err'); }
        e.currentTarget.disabled = true;
        try { const r = await A.api('/transfers', { method: 'POST', body: { items, from, to, note: $('#note', v).value } }); A.toast(`Transfer ${r.number} berhasil`, 'ok'); await A.loadProducts(); ed.set([]); $('#note', v).value = ''; hist(); } catch (er) { A.fail(er); } finally { e.currentTarget.disabled = false; }
      };
      await hist();
    },
  };

  // ---------- Terima barang dari PO (peran Gudang: tanpa harga beli) ----------
  A.pages.terima = {
    title: 'Terima Barang (PO)',
    async render(v) {
      v.innerHTML = '<div class="notice">Daftar PO yang sudah disetujui dan menunggu barang datang. Isi jumlah yang benar-benar diterima; stok bertambah otomatis di lokasi tujuan yang Anda pilih. Barang yang datang sebagian bisa diterima lagi nanti.</div><div class="card flush gap"><div class="tablewrap" id="tb"></div></div>';
      const load = async () => {
        const rows = await A.api('/receiving/po');
        $('#tb', v).innerHTML = rows.length ? `<table class="t"><thead><tr><th>No. PO</th><th>Supplier</th><th>Estimasi</th><th class="num">Sisa (unit)</th><th>Status</th></tr></thead><tbody>${rows.map((p) => `<tr class="click" data-id="${p.id}"><td><b>${esc(p.po_number)}</b></td><td>${esc(p.supplier || '-')}</td><td>${esc(p.expected_date || '-')}</td><td class="num">${num(p.remaining)}</td><td><span class="badge ${p.status === 'partial' ? 'warn' : 'info'}">${p.status === 'partial' ? 'Sebagian' : 'Disetujui'}</span></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Tidak ada PO yang menunggu penerimaan.</div>';
        $$('tr[data-id]', v).forEach((tr) => (tr.onclick = () => receive(+tr.dataset.id).catch(A.fail)));
      };
      async function receive(id) {
        const po = await A.api('/receiving/po/' + id);
        const rem = po.items.filter((i) => i.qty > i.received_qty);
        const m = A.modal(`Terima barang · ${po.po_number}`, `<p style="margin-top:0" class="muted">Supplier: ${esc(po.supplier || '-')}</p>
          <table class="t"><thead><tr><th>Barang</th><th class="num">Sisa</th><th class="num" style="width:120px">Diterima</th></tr></thead><tbody>${rem.map((i) => `<tr><td>${esc(i.name)}<div class="muted small">${esc(i.sku)}</div></td><td class="num">${i.qty - i.received_qty} ${esc(i.unit || '')}</td><td><input class="inp" type="number" min="0" max="${i.qty - i.received_qty}" value="${i.qty - i.received_qty}" data-item="${i.id}"></td></tr>`).join('')}</tbody></table>
          <label class="f gap-s">Simpan ke lokasi</label><select class="inp" id="loc">${A.locOptions(['gudang_ruko', 'gudang_toko'], 'gudang_ruko')}</select>
          <label class="f gap-s">Catatan (mis. nomor surat jalan)</label><input class="inp" id="note">`,
          { footer: '<button class="btn" data-n>Batal</button><button class="btn primary" data-y>Terima barang</button>' });
        m.q('[data-n]').onclick = () => m.close();
        m.q('[data-y]').onclick = async () => {
          const items = m.qa('[data-item]').map((x) => ({ item_id: +x.dataset.item, qty: +x.value || 0 })).filter((x) => x.qty > 0);
          if (!items.length) return A.toast('Isi jumlah barang yang diterima', 'err');
          try { await A.api(`/po/${po.id}/receive`, { method: 'POST', body: { items, location: m.q('#loc').value, note: m.q('#note').value } }); A.toast(`Barang diterima, stok ${A.LOC[m.q('#loc').value]} bertambah`, 'ok'); m.close(); load(); } catch (e) { A.fail(e); }
        };
      }
      await load();
    },
  };
})();
