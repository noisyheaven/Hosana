/* Shell aplikasi: login, menu per role, routing hash */
(function () {
  const A = window.App, S = A.state, { $, $$, esc, initials, can } = A;
  const root = $('#root');
  // [halaman, judul, ikon, hak yang dibutuhkan]; baris ['-', judul] = judul bagian. Menu hanya tampil bila role punya haknya.
  const MENU = [
    ['dashboard', 'Dashboard', '▦', 'dashboard'], ['kasir', 'Kasir', '🛒', 'kasir'], ['cek', 'Cek Stok', '🔎', 'cek'], ['pesanan', 'Sales Order (SO)', '📦', 'pesanan'], ['penjualan', 'Riwayat Penjualan', '🧾', 'penjualan'], ['retur', 'Retur Barang', '↩️', 'penjualan.retur'], ['kas', 'Pengeluaran Kas', '💸', 'kas'],
    ['-', 'Barang & Stok'], ['produk', 'Data Barang', '🏷', 'produk'], ['stok', 'Stok per Lokasi', '📊', 'stok'], ['kartu', 'Kartu Stok', '📒', ['stok', 'stok.kartu']], ['permintaan', 'Permintaan Barang', '📨', 'permintaan'], ['terima', 'Terima Barang Supplier', '📥', 'terima'], ['transfer', 'Transfer Antar Lokasi', '🔁', 'transfer'],
    ['-', 'Pembelian'], ['po', 'PO ke Supplier', '📝', 'po'], ['supplier', 'Supplier', '🚚', 'supplier'],
    ['-', 'Manajemen'], ['laporan', 'Laporan', '📈', 'laporan.penjualan'], ['kas_laporan', 'Laporan Kas', '🧮', 'kas.laporan'], ['pelanggan', 'Data Pelanggan', '👤', 'customer'], ['pengguna', 'Pengguna & Role', '👥', 'superadmin'], ['pengaturan', 'Pengaturan', '⚙', 'superadmin'],
  ];
  // halaman awal: kebiasaan tiap role bawaan bila masih berhak, selain itu menu pertama yang boleh dibuka
  const HOME = { superadmin: 'dashboard', admin: 'stok', sales_admin: 'pesanan', admin_gudang: 'permintaan', staf: 'cek', kasir: 'kasir', tim_so: 'pesanan' };
  A.home = () => {
    const pref = S.user && HOME[S.user.role];
    if (pref) { const m = MENU.find((x) => x[0] === pref); if (m && can(m[3])) return pref; }
    const first = MENU.find((m) => m[0] !== '-' && can(m[3]));
    return first ? first[0] : null;
  };
  let cleanup = null; let current = null;

  A.go = (page) => { if (location.hash === '#/' + page) route(); else location.hash = '#/' + page; };
  A.onLogout = (expired) => {
    try { localStorage.removeItem('token'); } catch (_) {}
    S.token = null; S.user = null; if (cleanup) { cleanup(); cleanup = null; }
    showLogin(expired ? 'Sesi berakhir, silakan login kembali.' : '');
  };

  function showLogin(note = '') {
    root.innerHTML = `<div class="login"><form class="box" id="lf"><h1>${esc(S.settings.store_name || 'Hosana')}</h1><p class="muted">Masuk ke sistem toko</p>
      ${note ? `<div class="notice warn" style="margin-bottom:12px">${esc(note)}</div>` : ''}
      <label class="f">Username</label><input class="inp" name="username" autocomplete="username" autocapitalize="none" autofocus>
      <label class="f gap-s">Password</label><input class="inp" name="password" type="password" autocomplete="current-password">
      <button class="btn primary lg block gap" type="submit">Masuk</button><div class="small muted center gap-s" id="lerr" style="color:var(--bad)"></div></form></div>`;
    $('#lf').onsubmit = async (e) => {
      e.preventDefault(); const f = A.formData(e.target); const btn = $('button', e.target); btn.disabled = true; $('#lerr').textContent = '';
      try {
        const r = await A.api('/login', { method: 'POST', body: { username: f.username, password: f.password } });
        S.token = r.token; try { localStorage.setItem('token', r.token); } catch (_) {}
        S.user = r.user; await boot();
      } catch (er) { $('#lerr').textContent = er.message; btn.disabled = false; }
    };
  }

  function shell() {
    const sections = []; let last = null;
    for (const m of MENU) {
      if (m[0] === '-') { last = { title: m[1], items: [] }; sections.push(last); continue; }
      if (!last) { last = { title: '', items: [] }; sections.push(last); }
      if (can(m[3])) last.items.push(m);
    }
    const nav = sections.filter((s) => s.items.length).map((s) => `${s.title ? `<div class="sep">${esc(s.title)}</div>` : ''}${s.items.map((m) => `<a href="#/${m[0]}" data-p="${m[0]}"><span class="ic">${m[2]}</span>${esc(m[1])}</a>`).join('')}`).join('');
    root.innerHTML = `<div id="app"><aside class="side" id="side"><div class="brand"><b><i></i>${esc(S.settings.store_name || 'Hosana')}</b><span>Sistem Toko Terintegrasi</span></div><nav class="nav" id="nav">${nav}</nav>
      <div class="me"><b>${esc(S.user.name)}</b><span>${esc(S.user.role_name || S.user.role)}</span><div class="row gap-s"><button class="btn sm" id="pw">Ganti password</button><button class="btn sm" id="out">Keluar</button></div></div></aside><div class="scrim" id="scrim"></div>
      <div class="main"><header class="top"><button class="btn burger" id="burger" aria-label="Menu">☰</button><h1 id="ttl"></h1><button class="btn sm" id="install" hidden>⬇ Pasang aplikasi</button><span class="badge ok" id="net" title="Status sambungan ke server toko">terhubung</span></header><div class="downbar hidden" id="downbar" role="alert">Sambungan ke server terputus, transaksi belum bisa disimpan. Isian di layar tidak hilang. Setelah tulisan ini hilang, tekan Bayar / Simpan lagi.</div><main id="view"></main></div></div>`;
    const side = $('#side'), scrim = $('#scrim');
    $('#burger').onclick = () => { side.classList.add('open'); scrim.classList.add('open'); };
    scrim.onclick = () => { side.classList.remove('open'); scrim.classList.remove('open'); };
    $('#nav').onclick = (e) => { if (e.target.closest('a')) { side.classList.remove('open'); scrim.classList.remove('open'); } };
    $('#out').onclick = async () => { try { await A.api('/logout', { method: 'POST' }); } catch (_) {} A.onLogout(); };
    $('#pw').onclick = () => {
      const m = A.modal('Ganti password', `<label class="f">Password lama</label><input class="inp" type="password" id="o"><label class="f gap-s">Password baru (min. 6 karakter)</label><input class="inp" type="password" id="n">`, { footer: '<button class="btn" data-n>Batal</button><button class="btn primary" data-y>Simpan</button>' });
      m.q('[data-n]').onclick = () => m.close();
      m.q('[data-y]').onclick = async () => { try { await A.api('/me/password', { method: 'POST', body: { old_password: m.q('#o').value, new_password: m.q('#n').value } }); A.toast('Password diganti', 'ok'); m.close(); } catch (e) { A.fail(e); } };
    };
    // pantau server tiap 8 detik (bukan sekadar status Wi-Fi): berguna saat link antar gedung / Wi-Fi putus
    clearInterval(shell.hb);
    let up = true;
    let ms = null;
    const paint = () => {
      const n = $('#net'), b = $('#downbar');
      if (n) {
        const slow = up && ms != null && ms > 400;
        n.textContent = up ? (ms != null ? `terhubung · ${ms} ms` : 'terhubung') : 'server tidak terjangkau';
        n.className = 'badge ' + (!up ? 'bad' : slow ? 'warn' : 'ok');
        n.title = !up ? 'Server tidak terjangkau' : slow ? 'Sambungan lambat (' + ms + ' ms). Periksa sinyal Wi-Fi / link antar gedung.' : 'Sambungan ke server baik (waktu tanggap ' + ms + ' ms)';
      }
      if (b) b.classList.toggle('hidden', up);
    };
    const ping = async () => {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 4000); const t0 = performance.now();
      try { const r = await fetch(A.apiBase() + '/api/ping', { signal: c.signal, cache: 'no-store' }); up = r.ok; ms = Math.round(performance.now() - t0); } catch (_) { up = false; ms = null; }
      clearTimeout(t); paint();
    };
    shell.hb = setInterval(ping, 8000);
    ping();
    window.addEventListener('online', ping); window.addEventListener('offline', () => { up = false; paint(); });
    if (window.__installPrompt) $('#install').hidden = false;
    $('#install').onclick = async () => { const p = window.__installPrompt; if (!p) return; p.prompt(); await p.userChoice; window.__installPrompt = null; $('#install').hidden = true; };
  }

  async function route() {
    if (!S.user) return;
    let page = (location.hash.replace(/^#\//, '') || A.home() || '').split('?')[0];
    const def = A.pages[page]; const menu = MENU.find((m) => m[0] === page);
    if (!def || (menu && !can(menu[3]))) { page = A.home(); }
    if (!page) { // role tanpa satu pun hak menu (mis. role baru yang belum diatur)
      if (cleanup) { try { cleanup(); } catch (_) {} cleanup = null; }
      current = null; $$('#nav a').forEach((a) => a.classList.remove('on')); $('#ttl').textContent = 'Belum ada akses';
      $('#view').innerHTML = '<div class="notice warn">Role Anda belum diberi hak akses ke menu apa pun. Hubungi Super Admin untuk mengatur hak akses role Anda.</div>';
      return;
    }
    if (cleanup) { try { cleanup(); } catch (_) {} cleanup = null; }
    document.querySelectorAll('.ov').forEach((o) => o.remove());
    current = page;
    $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.p === page));
    $('#ttl').textContent = A.pages[page].title; document.title = A.pages[page].title + ' · ' + (S.settings.store_name || 'Toko');
    const v = $('#view'); const fresh = v.cloneNode(false); v.replaceWith(fresh); // buang event listener lama
    try { const r = await A.pages[page].render(fresh); if (typeof r === 'function' && current === page) cleanup = r; } catch (e) { if (current === page) fresh.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; }
  }
  A.go = (page) => { if (location.hash === '#/' + page) route(); else location.hash = '#/' + page; };
  window.addEventListener('hashchange', route);

  // Hak akses bisa diubah Super Admin kapan saja: segarkan menu saat tab dibuka lagi, tiap menit, dan saat server menolak (403)
  let refreshing = false;
  async function refreshMe() {
    if (refreshing || !S.token || !S.user) return; refreshing = true;
    try {
      const me = await A.api('/me');
      const sig = (u) => [u.role, u.role_name, ...(u.perms || [])].join('|');
      if (sig(me) !== sig(S.user)) { S.user = me; shell(); route(); A.toast('Hak akses Anda diperbarui', 'ok'); }
    } catch (_) {} finally { setTimeout(() => { refreshing = false; }, 3000); }
  }
  A.onForbidden = refreshMe;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshMe(); });
  setInterval(refreshMe, 60000);

  async function boot() {
    if (!S.token) return showLogin();
    try {
      S.user = await A.api('/me'); await A.loadSettings();
    } catch (e) { if (!S.token) return; return showLogin(e.message); }
    shell(); route();
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installPrompt = e; const b = $('#install'); if (b) b.hidden = false; });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  boot();
})();
