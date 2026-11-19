/* Cek Stok: staf scan barcode / ketik nama, langsung melihat stok di TOKO dan di GUDANG.
   Contoh: pelanggan bertanya "patung Bunda Maria ada berapa?" -> scan barang, lihat stok toko & gudang. */
(function () {
  const A = window.App, { $, esc, num, rp } = A;

  // tiga kotak stok: Display Toko, Gudang Toko, Gudang Ruko
  const stkBoxes = (p) => { const unit = esc(p.unit || 'pcs'); return Object.keys(A.LOC).map((k) => { const n = p[A.QTYKEY[k]]; return `<div class="stk ${n <= 0 ? 'zero' : ''}"><span>${esc(A.LOC[k])}</span><b>${num(n)}</b><small>${unit}</small></div>`; }).join(''); };

  function card(p) {
    let msg, cls;
    const elsewhere = p.gt_qty + p.gr_qty;
    if (p.display_qty > 0) { msg = p.display_qty <= p.min_stock ? 'Display menipis' : 'Tersedia di display toko'; cls = p.display_qty <= p.min_stock ? 'warn' : 'ok'; }
    else if (elsewhere > 0) { msg = `Habis di display, ada di ${[p.gt_qty > 0 ? 'Gudang Toko' : '', p.gr_qty > 0 ? 'Gudang Ruko' : ''].filter(Boolean).join(' & ')}`; cls = 'warn'; }
    else { msg = 'Habis di semua lokasi'; cls = 'bad'; }
    const help = p.display_qty > 0 ? ''
      : elsewhere > 0 ? ((A.can('permintaan.buat') ? `<a class="btn primary sm gap-s" href="#/permintaan?add=${p.id}">Minta dari gudang</a> ` : '') + (A.can('transfer') ? '<a class="btn sm gap-s" href="#/transfer">Pindahkan langsung</a>' : ''))
      : '<div class="small muted gap-s">Tawarkan Sales Order (SO) ke pelanggan, atau beri tahu pimpinan agar membuat PO ke supplier.</div>';
    const unit = esc(p.unit || 'pcs');
    return `<div class="card cek"><div class="row cekhead" data-detail="${p.id}" role="button" tabindex="0" title="Lihat detail barang">${A.thumb(p)}<div class="grow"><h2>${esc(p.name)}</h2>
      <div class="muted small">${esc(p.category || 'Tanpa kategori')} · ${esc(p.sku)}</div><b>${rp(p.price)}</b></div><span class="muted small nowrap">Detail ›</span></div>
      <div class="stkrow gap-s">${stkBoxes(p)}</div>
      <div class="gap-s"><span class="badge ${cls}">${msg}</span></div>${help}</div>`;
  }

  function detail(p) {
    const unit = esc(p.unit || 'pcs');
    const img = p.image ? `<img src="${A.apiBase()}${esc(p.image)}" alt="" style="width:100%;max-height:260px;object-fit:contain;background:#faf6ee;border-radius:10px">` : '';
    const m = A.modal('Detail barang', `${img}<h2 style="margin:12px 0 2px">${esc(p.name)}</h2>
      <div class="muted small">${esc(p.category || 'Tanpa kategori')}</div><div style="font-size:1.3rem;font-weight:800;margin:6px 0">${rp(p.price)} <span class="muted small">/ ${unit}</span></div>
      <div class="stkrow">${stkBoxes(p)}</div>
      ${p.description ? `<p class="gap-s" style="white-space:pre-wrap">${esc(p.description)}</p>` : '<p class="muted small gap-s">Belum ada deskripsi untuk barang ini.</p>'}
      <table class="t gap-s"><tbody><tr><td class="muted">Kode (SKU)</td><td>${esc(p.sku)}</td></tr><tr><td class="muted">Barcode</td><td>${esc(p.barcode || '-')}</td></tr><tr><td class="muted">Stok minimum display</td><td>${num(p.min_stock)}</td></tr><tr><td class="muted">Total semua lokasi</td><td><b>${num(p.total_qty)}</b> ${unit}</td></tr></tbody></table>`,
      { footer: '<button class="btn" data-x2>Tutup</button>' });
    m.q('[data-x2]').onclick = () => m.close();
  }

  A.pages.cek = {
    title: 'Cek Stok',
    async render(v) {
      v.innerHTML = `<div class="cekwrap"><div class="card"><button class="btn primary lg block" id="scan">📷 Scan barcode barang</button>
        <div class="row gap-s"><input class="inp grow" id="q" placeholder="…atau ketik nama / SKU, mis. patung bunda maria" autocomplete="off"><button class="btn" id="go">Cari</button></div>
        <div class="small muted gap-s">Memakai scanner USB/Bluetooth? Klik kolom di atas lalu tembak barcode barangnya.</div></div><div id="res" class="gap"></div></div>`;
      const q = $('#q', v), res = $('#res', v); let seq = 0, timer = null; const byId = new Map();
      const show = async (text) => {
        text = text.trim(); const my = ++seq;
        if (!text) { res.innerHTML = ''; return; }
        res.innerHTML = '<div class="muted center">Mencari…</div>';
        try {
          // pencarian server mencakup nama, SKU, dan barcode; bila ada yang cocok persis dengan kode, tampilkan itu saja
          let list = await A.api('/products?limit=30&q=' + encodeURIComponent(text));
          const exact = list.filter((x) => x.barcode === text || String(x.sku).toLowerCase() === text.toLowerCase());
          if (exact.length === 1) list = exact;
          if (my !== seq) return;
          byId.clear(); list.forEach((x) => byId.set(x.id, x));
          res.innerHTML = !list.length ? `<div class="notice warn">Tidak ada barang untuk "${esc(text)}". Coba kata kunci lebih pendek (mis. "patung"), atau periksa apakah barangnya sudah terdaftar di Data Barang.</div>`
            : (list.length > 1 ? `<div class="muted small" style="margin-bottom:8px">${list.length} barang cocok</div>` : '') + list.map(card).join('');
        } catch (e) { if (my === seq) res.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; }
      };
      const open = (e) => { const h = e.target.closest('[data-detail]'); if (h && byId.get(+h.dataset.detail)) detail(byId.get(+h.dataset.detail)); };
      res.addEventListener('click', open);
      res.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { open(e); if (e.target.closest('[data-detail]')) e.preventDefault(); } });
      q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => show(q.value), 300); });
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); show(q.value); q.select(); } });
      $('#go', v).onclick = () => { clearTimeout(timer); show(q.value); };
      $('#scan', v).onclick = () => A.scan((code) => { q.value = code; show(code); }, { title: 'Scan barcode barang' });
      if (!(window.matchMedia && matchMedia('(pointer:coarse)').matches)) q.focus(); // di HP jangan langsung munculkan keyboard
      return () => clearTimeout(timer);
    },
  };
})();
