/* Shell aplikasi: login, menu per role, routing hash */
(function () {
  const A = window.App, S = A.state, { $, $$, esc, initials, can } = A;
  const root = $('#root');
  const ROLE = { superadmin: 'Super Admin', admin: 'Admin', staf: 'Staf' };
  const MENU = [
    ['dashboard', 'Dashboard', '▦', 'staf'], ['kasir', 'Kasir', '🛒', 'staf'], ['pesanan', 'Pemesanan', '📦', 'staf'], ['penjualan', 'Riwayat Penjualan', '🧾', 'staf'],
    ['-', 'Barang & Stok'], ['produk', 'Data Barang', '🏷', 'staf'], ['stok', 'Stok Toko / Gudang', '📊', 'staf'], ['transfer', 'Transfer Gudang→Toko', '🔁', 'admin'],
    ['-', 'Pembelian', 'admin'], ['po', 'Purchase Order', '📝', 'admin'], ['supplier', 'Supplier', '🚚', 'admin'],
    ['-', 'Manajemen', 'admin'], ['laporan', 'Laporan', '📈', 'admin'], ['pengguna', 'Pengguna & Role', '👥', 'superadmin'], ['pengaturan', 'Pengaturan', '⚙', 'superadmin'],
  ];
  let cleanup = null; let current = null;

  A.go = (page) => { if (location.hash === '#/' + page) route(); else location.hash = '#/' + page; };
  A.onLogout = (expired) => {
    try { localStorage.removeItem('token'); } catch (_) {}
    S.token = null; S.user = null; if (cleanup) { cleanup(); cleanup = null; }
    showLogin(expired ? 'Sesi berakhir, silakan login kembali.' : '');
  };

  function showLogin(note = '') {
    const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    const base = A.apiBase();
    root.innerHTML = `<div class="login"><form class="box" id="lf"><h1>${esc(S.settings.store_name || 'Toko Asesoris Rohani')}</h1><p class="muted">Masuk ke sistem toko</p>
      ${note ? `<div class="notice warn" style="margin-bottom:12px">${esc(note)}</div>` : ''}
      <label class="f">Username</label><input class="inp" name="username" autocomplete="username" autocapitalize="none" autofocus>
      <label class="f gap-s">Password</label><input class="inp" name="password" type="password" autocomplete="current-password">
      <details class="gap-s" ${native && !base ? 'open' : ''}><summary class="small muted" style="cursor:pointer">Alamat server${base ? ': ' + esc(base) : ''}</summary><input class="inp gap-s" name="apiBase" placeholder="http://192.168.1.10:3000" value="${esc(base)}"><div class="small muted gap-s">Kosongkan jika membuka dari alamat server itu sendiri. Untuk aplikasi Android, isi alamat komputer server (satu Wi-Fi).</div></details>
      <button class="btn primary lg block gap" type="submit">Masuk</button><div class="small muted center gap-s" id="lerr" style="color:var(--bad)"></div></form></div>`;
    $('#lf').onsubmit = async (e) => {
      e.preventDefault(); const f = A.formData(e.target); const btn = $('button', e.target); btn.disabled = true; $('#lerr').textContent = '';
      try {
        let b = (f.apiBase || '').trim().replace(/\/+$/, ''); if (b && !/^https?:\/\//.test(b)) b = 'http://' + b;
        try { b ? localStorage.setItem('apiBase', b) : localStorage.removeItem('apiBase'); } catch (_) {}
        const r = await A.api('/login', { method: 'POST', body: { username: f.username, password: f.password } });
        S.token = r.token; try { localStorage.setItem('token', r.token); } catch (_) {}
        S.user = r.user; await boot();
      } catch (er) { $('#lerr').textContent = er.message; btn.disabled = false; }
    };
  }

  function shell() {
    const sections = []; let last = null;
    for (const m of MENU) {
      if (m[0] === '-') { last = { title: m[1], role: m[2] || 'staf', items: [] }; sections.push(last); continue; }
      if (!last) { last = { title: '', role: 'staf', items: [] }; sections.push(last); }
      if (can(m[3])) last.items.push(m);
    }
    const nav = sections.filter((s) => s.items.length && can(s.role)).map((s) => `${s.title ? `<div class="sep">${esc(s.title)}</div>` : ''}${s.items.map((m) => `<a href="#/${m[0]}" data-p="${m[0]}"><span class="ic">${m[2]}</span>${esc(m[1])}</a>`).join('')}`).join('');
    root.innerHTML = `<div id="app"><aside class="side" id="side"><div class="brand"><b><i></i>${esc(S.settings.store_name || 'Toko Rohani')}</b><span>Sistem Toko Terintegrasi</span></div><nav class="nav" id="nav">${nav}</nav>
      <div class="me"><b>${esc(S.user.name)}</b><span>${ROLE[S.user.role]}</span><div class="row gap-s"><button class="btn sm" id="pw">Ganti password</button><button class="btn sm" id="out">Keluar</button></div></div></aside><div class="scrim" id="scrim"></div>
      <div class="main"><header class="top"><button class="btn burger" id="burger" aria-label="Menu">☰</button><h1 id="ttl"></h1><button class="btn sm" id="install" hidden>⬇ Pasang aplikasi</button><span class="badge ${navigator.onLine ? 'ok' : 'bad'}" id="net">${navigator.onLine ? 'online' : 'offline'}</span></header><main id="view"></main></div></div>`;
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
    const setNet = () => { const n = $('#net'); if (n) { n.textContent = navigator.onLine ? 'online' : 'offline'; n.className = 'badge ' + (navigator.onLine ? 'ok' : 'bad'); } };
    window.addEventListener('online', setNet); window.addEventListener('offline', setNet);
    if (window.__installPrompt) $('#install').hidden = false;
    $('#install').onclick = async () => { const p = window.__installPrompt; if (!p) return; p.prompt(); await p.userChoice; window.__installPrompt = null; $('#install').hidden = true; };
  }

  async function route() {
    if (!S.user) return;
    let page = (location.hash.replace(/^#\//, '') || 'dashboard').split('?')[0];
    const def = A.pages[page]; const menu = MENU.find((m) => m[0] === page);
    if (!def || (menu && !can(menu[3]))) { page = 'dashboard'; }
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
