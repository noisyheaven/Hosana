/* Toko online pelanggan: katalog, keranjang, checkout, lacak pesanan. Memakai /api/public/* */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
  const initials = (n) => String(n || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
  const PAY = { transfer: ['Transfer bank', 'Kirim bukti transfer lewat WhatsApp setelah memesan.'], qris: ['QRIS', 'Kode QRIS diberikan toko lewat WhatsApp.'], cod: ['Bayar di tempat (COD)', 'Bayar tunai saat barang diterima.'] };

  let info = {}, cats = [], products = [], catId = '', term = '';
  let cart = store.get('cart', {}); // {product_id: qty}

  async function api(path, opt = {}) {
    let r;
    try { r = await fetch('/api/public' + path, { method: opt.method || 'GET', headers: { 'Content-Type': 'application/json' }, body: opt.body ? JSON.stringify(opt.body) : undefined }); }
    catch (_) { throw new Error('Tidak dapat terhubung ke toko. Periksa koneksi internet Anda.'); }
    let d = {}; try { d = await r.json(); } catch (_) {}
    if (!r.ok) throw new Error(d.error || 'Terjadi kesalahan');
    return d;
  }
  let tt; function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 2200); }

  // ---------- katalog ----------
  function drawCats() {
    $('#cats').innerHTML = [{ id: '', name: 'Semua' }, ...cats].map((c) => `<button type="button" data-c="${c.id}" aria-pressed="${String(c.id) === String(catId)}">${esc(c.name)}</button>`).join('');
  }
  function drawGrid() {
    const t = term.toLowerCase();
    const list = products.filter((p) => (!catId || String(p.category_id) === String(catId)) && (!t || p.name.toLowerCase().includes(t)));
    $('#count').textContent = list.length ? `${list.length} barang` : '';
    $('#grid').innerHTML = list.length ? list.map((p) => {
      const out = p.stock <= 0, low = p.stock > 0 && p.stock <= 5;
      const img = p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">` : `<div class="ph" aria-hidden="true">${esc(initials(p.name))}</div>`;
      return `<article class="card ${out ? 'out' : ''}"><div class="arch">${img}${out ? '<span class="tag">Stok habis</span>' : low ? `<span class="tag low">Sisa ${p.stock}</span>` : ''}</div>
        <h3>${esc(p.name)}</h3><div class="cat">${esc(p.category || '')}</div>
        <div class="foot2"><span class="price">${rp(p.price)}</span><button class="add" data-add="${p.id}" ${out ? 'disabled' : ''}>${out ? 'Habis' : 'Tambah'}</button></div></article>`;
    }).join('') : `<p class="empty">${products.length ? 'Tidak ada barang yang cocok. Coba kata kunci lain atau pilih "Semua".' : 'Belum ada barang yang dijual online.'}</p>`;
  }

  // ---------- keranjang ----------
  const byId = (id) => products.find((p) => p.id === +id);
  function cartLines() { return Object.entries(cart).map(([id, qty]) => ({ p: byId(id), qty })).filter((l) => l.p && l.p.stock > 0).map((l) => ({ ...l, qty: Math.min(l.qty, l.p.stock) })); }
  function saveCart() { const o = {}; cartLines().forEach((l) => { o[l.p.id] = l.qty; }); cart = o; store.set('cart', o); $('#cartn').textContent = cartLines().reduce((a, l) => a + l.qty, 0); }
  function add(id) {
    const p = byId(id); if (!p) return;
    const cur = cart[id] || 0;
    if (cur >= p.stock) return toast(`Stok ${p.name} hanya ${p.stock}`);
    cart[id] = cur + 1; saveCart(); toast('Masuk keranjang: ' + p.name);
  }
  function open() { $('#sheet').classList.add('on'); $('#scrim').classList.add('on'); $('#sheet').setAttribute('aria-hidden', 'false'); }
  function close() { $('#sheet').classList.remove('on'); $('#scrim').classList.remove('on'); $('#sheet').setAttribute('aria-hidden', 'true'); }
  const head = (t) => `<div class="sh-h"><h2>${t}</h2><button class="x" data-close aria-label="Tutup">&times;</button></div>`;

  function viewCart() {
    saveCart(); const lines = cartLines(); const total = lines.reduce((a, l) => a + l.qty * l.p.price, 0);
    $('#sheet').innerHTML = head('Keranjang') + `<div class="sh-b">${lines.length ? lines.map((l) => `<div class="line"><b>${esc(l.p.name)}</b><span>${rp(l.qty * l.p.price)}</span>
      <span class="qty"><button data-dec="${l.p.id}" aria-label="Kurangi">−</button><span>${l.qty}</span><button data-inc="${l.p.id}" aria-label="Tambah">+</button></span><button class="rm" data-rm="${l.p.id}">Hapus</button></div>`).join('') : '<p class="muted" style="text-align:center;padding:40px 0">Keranjang masih kosong.<br>Pilih barang di katalog, lalu tekan "Tambah".</p>'}</div>
      ${lines.length ? `<div class="sh-f"><div class="tot"><span>Total</span><span>${rp(total)}</span></div><button class="btn" data-checkout>Lanjut ke pemesanan</button></div>` : ''}`;
  }
  function viewCheckout() {
    const lines = cartLines(); const total = lines.reduce((a, l) => a + l.qty * l.p.price, 0); const me = store.get('me', {});
    $('#sheet').innerHTML = head('Data pemesan') + `<form class="sh-b" id="cf" novalidate>
      <label class="f" for="n">Nama</label><input class="inp" id="n" name="customer_name" autocomplete="name" value="${esc(me.n || '')}" required>
      <label class="f" for="h">Nomor WhatsApp / HP</label><input class="inp" id="h" name="phone" inputmode="tel" autocomplete="tel" value="${esc(me.h || '')}" required>
      <label class="f" for="a">Alamat pengiriman (kosongkan jika ambil di toko)</label><textarea class="inp" id="a" name="address">${esc(me.a || '')}</textarea>
      <label class="f" for="o">Catatan</label><input class="inp" id="o" name="notes">
      <label class="f">Cara pembayaran</label><div class="pay">${Object.entries(PAY).map(([k, v], i) => `<label><input type="radio" name="payment_method" value="${k}" ${i === 0 ? 'checked' : ''}><span><b>${v[0]}</b><br><span class="small muted">${v[1]}</span></span></label>`).join('')}</div>
      <div class="err" id="err" role="alert"></div></form>
      <div class="sh-f"><div class="tot"><span>Total (${lines.reduce((a, l) => a + l.qty, 0)} barang)</span><span>${rp(total)}</span></div><button class="btn" id="send">Pesan sekarang</button><button class="btn alt" data-cartback>Kembali ke keranjang</button></div>`;
    $('#send').onclick = submit;
  }
  async function submit() {
    const f = $('#cf'), btn = $('#send'), err = $('#err'); err.textContent = '';
    const v = Object.fromEntries(new FormData(f).entries());
    if (!v.customer_name.trim()) return (err.textContent = 'Isi nama Anda.');
    if (v.phone.replace(/\D/g, '').length < 8) return (err.textContent = 'Nomor WhatsApp / HP belum benar.');
    btn.disabled = true; btn.textContent = 'Mengirim pesanan…';
    try {
      const lines = cartLines();
      const r = await api('/orders', { method: 'POST', body: { ...v, items: lines.map((l) => ({ product_id: l.p.id, qty: l.qty })) } });
      store.set('me', { n: v.customer_name, h: v.phone, a: v.address }); store.set('last', { no: r.order_no, phone: v.phone });
      cart = {}; saveCart(); viewDone(r, v, lines);
      load().catch(() => {}); // segarkan stok
    } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Pesan sekarang'; }
  }
  function viewDone(r, v, lines) {
    const how = v.payment_method === 'transfer' ? info.bank_info : v.payment_method === 'qris' ? info.qris_note : 'Siapkan uang tunai saat barang diterima.';
    const wa = String(info.store_phone || '').replace(/\D/g, '');
    const msg = `Halo, saya ${v.customer_name}. Saya sudah memesan ${r.order_no} (total ${rp(r.total)}) dengan pembayaran ${PAY[v.payment_method][0]}.`;
    $('#sheet').innerHTML = head('Pesanan diterima') + `<div class="sh-b"><div class="done"><div>Nomor pesanan Anda</div><div class="no">${esc(r.order_no)}</div>
      <div class="muted small">Simpan nomor ini untuk melacak pesanan.</div></div>
      <ul class="items">${lines.map((l) => `<li><span>${l.qty} × ${esc(l.p.name)}</span><span>${rp(l.qty * l.p.price)}</span></li>`).join('')}<li><b>Total</b><b>${rp(r.total)}</b></li></ul>
      <div class="box"><b>Cara bayar: ${esc(PAY[v.payment_method][0])}</b>\n${esc(how || '')}</div></div>
      <div class="sh-f">${wa ? `<a class="btn" style="text-align:center;text-decoration:none;line-height:22px" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${encodeURIComponent(msg)}">Konfirmasi lewat WhatsApp</a>` : ''}<button class="btn alt" data-close>Selesai</button></div>`;
  }

  // ---------- lacak ----------
  function viewTrack(res, errMsg) {
    const last = store.get('last', {});
    $('#sheet').innerHTML = head('Lacak pesanan') + `<form class="sh-b" id="tf"><label class="f" for="tn">Nomor pesanan</label><input class="inp" id="tn" value="${esc(last.no || '')}" placeholder="ORD-20260101-0001" autocapitalize="characters">
      <label class="f" for="tp">Nomor HP yang dipakai memesan</label><input class="inp" id="tp" inputmode="tel" value="${esc(last.phone || '')}">
      <div class="err" role="alert">${esc(errMsg || '')}</div><button class="btn" style="margin-top:10px" type="submit">Cek status</button>
      ${res ? `<div class="box" style="margin-top:16px"><div><span class="st">${esc(({ baru: 'Baru masuk', diproses: 'Sedang diproses', dikirim: 'Dikirim', selesai: 'Selesai', batal: 'Dibatalkan' })[res.status] || res.status)}</span> <span class="small muted">${res.payment_status === 'lunas' ? 'Sudah dibayar' : 'Belum dibayar'}</span></div>
      <ul class="items">${res.items.map((i) => `<li><span>${i.qty} × ${esc(i.name)}</span><span>${rp(i.qty * i.price)}</span></li>`).join('')}<li><b>Total</b><b>${rp(res.total)}</b></li></ul></div>` : ''}</form>`;
    $('#tf').onsubmit = async (e) => {
      e.preventDefault(); const no = $('#tn').value.trim(), ph = $('#tp').value.trim();
      try { const r = await api('/orders/' + encodeURIComponent(no) + '?phone=' + encodeURIComponent(ph)); store.set('last', { no, phone: ph }); viewTrack(r); } catch (er) { viewTrack(null, er.message); }
    };
  }

  // ---------- init ----------
  async function load() { products = await api('/products'); drawGrid(); saveCart(); }
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.dataset.c !== undefined && t.closest('#cats')) { catId = t.dataset.c; drawCats(); drawGrid(); }
    else if (t.dataset.add) add(t.dataset.add);
    else if (t.dataset.inc) { add(t.dataset.inc); viewCart(); }
    else if (t.dataset.dec) { const id = t.dataset.dec; cart[id] = (cart[id] || 1) - 1; if (cart[id] <= 0) delete cart[id]; viewCart(); }
    else if (t.dataset.rm) { delete cart[t.dataset.rm]; viewCart(); }
    else if (t.dataset.checkout !== undefined) viewCheckout();
    else if (t.dataset.cartback !== undefined) viewCart();
    else if (t.dataset.close !== undefined || t.id === 'scrim') close();
  });
  $('#cartbtn').onclick = () => { viewCart(); open(); };
  $('#track').onclick = () => { viewTrack(); open(); };
  $('#q').addEventListener('input', (e) => { term = e.target.value.trim(); drawGrid(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  (async () => {
    try {
      [info, cats] = await Promise.all([api('/info'), api('/categories')]);
      document.title = info.store_name || document.title; $('#logo').textContent = info.store_name || 'Toko Asesoris Rohani';
      $('#foot').innerHTML = `<b>${esc(info.store_name)}</b><div>${esc(info.store_address || '')}</div>${info.store_phone ? `<div>WhatsApp: ${esc(info.store_phone)}</div>` : ''}`;
      drawCats(); await load();
    } catch (e) { $('#grid').innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
  })();
})();
