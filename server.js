// Server HTTP + REST API (tanpa framework; hanya modul bawaan Node.js)
require('./env');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const D = require('./db');
const { q, tx, moveStock, getQty, nextNumber, setting, allSettings, audit, LOCATIONS, LOC_LABEL } = D;
const { calcSale, taxConfig } = require('./public/admin/calc.js'); // rumus diskon + PPN (dipakai juga oleh browser)

D.seed();

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(D.DATA_DIR, 'uploads');
// Hak akses berbasis role (lihat permissions.js). Tiap route menyebut hak yang dibutuhkan:
//   null = publik, 'auth' = cukup login, 'kunci.hak' = harus punya hak itu, [a, b] = salah satu, 'superadmin' = khusus Super Admin.
const P = require('./permissions');
const hasPerm = (user, need) => {
  if (!user) return false;
  if (user.role === 'superadmin') return true;
  if (need === 'superadmin') return false;
  return (Array.isArray(need) ? need : [need]).some((k) => user.perms.includes(k));
};
const PAY_METHODS = ['tunai', 'transfer', 'qris', 'debit', 'cod'];

// ---------- util ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg, status = 400) => new HttpError(status, msg);
const int = (v, def = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : def; };
const str = (v) => (v == null ? '' : String(v).trim());
const nul = (v) => { const s = str(v); return s === '' ? null : s; };
const digits = (s) => String(s || '').replace(/\D/g, '');
const flag = (v, def = 1) => (v === undefined || v === null ? def : (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0));

function uniqueError(e) {
  if (e && /UNIQUE constraint failed/i.test(e.message)) {
    const m = e.message.match(/\.(\w+)$/);
    const f = m ? m[1] : 'data';
    return bad(`Nilai ${f === 'sku' ? 'SKU' : f} sudah dipakai data lain`, 409);
  }
  return e;
}

// ---------- router mini ----------
const routes = [];
function route(method, pattern, minRole, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-z_]+)/gi, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, minRole, handler });
}
const GET = (p, r, h) => route('GET', p, r, h);
const POST = (p, r, h) => route('POST', p, r, h);
const PUT = (p, r, h) => route('PUT', p, r, h);
const DEL = (p, r, h) => route('DELETE', p, r, h);

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(bad('Data terlalu besar', 413)); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(bad('JSON tidak valid')); }
    });
    req.on('error', reject);
  });
}

// role + hak akses terkini dibaca dari database pada setiap permintaan, jadi perubahan role oleh superadmin langsung berlaku
function roleInfo(roleKey) {
  if (roleKey === 'superadmin') return { name: P.BUILTIN.superadmin.name, perms: P.ALL_KEYS };
  const r = q.get('SELECT name, permissions FROM roles WHERE key=?', roleKey);
  return r ? { name: r.name, perms: P.parse(r.permissions) } : { name: roleKey, perms: [] };
}
function sessionUser(u) {
  const ri = roleInfo(u.role);
  return { id: u.id, username: u.username, name: u.name, role: u.role, role_name: ri.name, perms: ri.perms };
}
function currentUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  const u = q.get(`SELECT u.id,u.username,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token=? AND u.active=1 AND s.created_at > datetime('now','localtime','-7 days')`, token);
  return u ? { ...sessionUser(u), token } : null;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serveFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Tidak ditemukan'); }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=300' });
    fs.createReadStream(file).pipe(res);
  });
}

function send(res, status, data, headers = {}) {
  if (Buffer.isBuffer(data) || typeof data === 'string') { res.writeHead(status, headers); return res.end(data); }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
}

// Alamat klien. Di balik proxy/Cloudflare Tunnel semua pengunjung terlihat berasal dari 127.0.0.1, sehingga pembatas login
// akan terkunci untuk SEMUA orang sekaligus. Set TRUST_PROXY=1 agar header CF-Connecting-IP / X-Forwarded-For dipakai
// (hanya aktifkan bila server memang hanya bisa dijangkau lewat proxy tsb).
function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const h = req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (h) return h;
  }
  return req.socket.remoteAddress;
}
const SHOP_PATHS = new Set(['/', '/index.html', '/shop.js', '/shop.css']);
const loginFails = new Map();

async function handler(req, res) {
  const u = new URL(req.url, 'http://x');
  const pathname = decodeURIComponent(u.pathname);
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' };
  if (req.method === 'OPTIONS') return send(res, 204, '', cors);

  if (pathname.startsWith('/api/')) {
    try {
      if (pathname.startsWith('/api/public/') && setting('store_online_enabled', '1') === '0') throw bad('Toko online sedang dinonaktifkan oleh toko.', 404);
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(pathname);
        if (!m) continue;
        const params = {}; r.keys.forEach((k, i) => (params[k] = m[i + 1]));
        let user = null;
        if (r.minRole) {
          user = currentUser(req);
          if (!user) throw bad('Sesi berakhir, silakan login kembali', 401);
          if (r.minRole !== 'auth' && !hasPerm(user, r.minRole)) throw bad('Anda tidak memiliki akses untuk fitur ini', 403);
        }
        const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
        const out = await r.handler({ req, res, params, query: Object.fromEntries(u.searchParams), body, user });
        if (out === undefined) return; // handler sudah mengirim respons sendiri
        return send(res, 200, out, cors);
      }
      throw bad('Endpoint tidak ditemukan', 404);
    } catch (e) {
      e = uniqueError(e);
      if (!e.status) console.error(e);
      return send(res, e.status || 500, { error: e.status ? e.message : 'Terjadi kesalahan pada server: ' + e.message }, cors);
    }
  }

  // file upload gambar produk
  if (pathname.startsWith('/uploads/')) return serveFile(res, path.join(UPLOAD_DIR, path.basename(pathname)));

  // halaman statis
  if (SHOP_PATHS.has(pathname) && setting('store_online_enabled', '1') === '0') { res.writeHead(302, { Location: '/admin/' }); return res.end(); }
  let rel = pathname;
  if (rel === '/admin') { res.writeHead(302, { Location: '/admin/' }); return res.end(); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  return serveFile(res, file);
}

// =====================================================================
//  AUTH
// =====================================================================
// dipakai panel untuk memantau apakah server masih terjangkau (mis. link antar gedung putus)
GET('/api/ping', null, () => ({ ok: true, time: Date.now() }));
POST('/api/login', null, ({ req, body }) => {
  // kunci = perangkat + akun: salah ketik satu akun tidak mengunci akun lain / semua perangkat Wi-Fi yang terlihat sebagai satu IP (NAT)
  const ip = clientIp(req) + '|' + str(body.username).toLowerCase();
  if (loginFails.size > 5000) loginFails.clear();
  const f = loginFails.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - f.t > 10 * 60 * 1000) { f.n = 0; f.t = Date.now(); }
  if (f.n >= 10) throw bad('Terlalu banyak percobaan login. Coba lagi beberapa menit lagi.', 429);
  const u = q.get('SELECT * FROM users WHERE username=? AND active=1', str(body.username).toLowerCase());
  if (!u || !D.verifyPassword(str(body.password), u.password_hash)) {
    f.n++; loginFails.set(ip, f);
    throw bad('Username atau password salah', 401);
  }
  loginFails.delete(ip);
  const token = crypto.randomBytes(24).toString('hex');
  q.run('INSERT INTO sessions(token,user_id) VALUES(?,?)', token, u.id);
  audit(u, 'login', null);
  return { token, user: sessionUser(u) };
});
POST('/api/logout', 'auth', ({ user }) => { q.run('DELETE FROM sessions WHERE token=?', user.token); return { ok: true }; });
GET('/api/me', 'auth', ({ user }) => { const { token, ...me } = user; return me; });
POST('/api/me/password', 'auth', ({ user, body }) => {
  const u = q.get('SELECT * FROM users WHERE id=?', user.id);
  if (!D.verifyPassword(str(body.old_password), u.password_hash)) throw bad('Password lama salah');
  if (str(body.new_password).length < 6) throw bad('Password baru minimal 6 karakter');
  q.run('UPDATE users SET password_hash=? WHERE id=?', D.hashPassword(str(body.new_password)), user.id);
  audit(user, 'ganti_password', null);
  return { ok: true };
});

// =====================================================================
//  PENGGUNA & PENGATURAN  (superadmin)
// =====================================================================
GET('/api/users', 'superadmin', () => q.all('SELECT u.id,u.username,u.name,u.role,COALESCE(r.name,u.role) AS role_name,u.active,u.created_at FROM users u LEFT JOIN roles r ON r.key=u.role ORDER BY u.id'));
POST('/api/users', 'superadmin', ({ user, body }) => {
  const username = str(body.username).toLowerCase();
  if (!/^[a-z0-9_.-]{3,30}$/.test(username)) throw bad('Username 3-30 karakter (huruf kecil, angka, . _ -)');
  if (!roleExists(body.role)) throw bad('Role tidak valid');
  if (str(body.password).length < 6) throw bad('Password minimal 6 karakter');
  if (!str(body.name)) throw bad('Nama wajib diisi');
  const r = q.run('INSERT INTO users(username,name,password_hash,role) VALUES(?,?,?,?)', username, str(body.name), D.hashPassword(str(body.password)), body.role);
  audit(user, 'tambah_user', `${username} (${body.role})`);
  return { id: Number(r.lastInsertRowid) };
});
PUT('/api/users/:id', 'superadmin', ({ user, params, body }) => {
  const id = int(params.id);
  const t = q.get('SELECT * FROM users WHERE id=?', id);
  if (!t) throw bad('User tidak ditemukan', 404);
  const role = body.role || t.role;
  const active = body.active === undefined ? t.active : flag(body.active);
  if (!roleExists(role)) throw bad('Role tidak valid');
  if (id === user.id && (role !== 'superadmin' || !active)) throw bad('Anda tidak bisa menurunkan/menonaktifkan akun Anda sendiri');
  q.run('UPDATE users SET name=?, role=?, active=? WHERE id=?', str(body.name) || t.name, role, active, id);
  if (str(body.password)) {
    if (str(body.password).length < 6) throw bad('Password minimal 6 karakter');
    q.run('UPDATE users SET password_hash=? WHERE id=?', D.hashPassword(str(body.password)), id);
    q.run('DELETE FROM sessions WHERE user_id=?', id);
  }
  if (!active) q.run('DELETE FROM sessions WHERE user_id=?', id);
  audit(user, 'ubah_user', `${t.username}: role=${role} aktif=${active}`);
  return { ok: true };
});
// ---------- ROLE & HAK AKSES (superadmin) ----------
const roleExists = (key) => typeof key === 'string' && key === 'superadmin' || !!q.get('SELECT key FROM roles WHERE key=?', String(key));
function roleOut(r) {
  return { key: r.key, name: r.name, description: r.description || '', builtin: !!r.builtin, locked: r.key === 'superadmin',
    permissions: r.key === 'superadmin' ? P.ALL_KEYS : P.parse(r.permissions),
    users: q.get('SELECT COUNT(*) AS n FROM users WHERE role=?', r.key).n };
}
const slugify = (t) => str(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
GET('/api/roles', 'superadmin', () => ({
  catalog: P.GROUPS,
  roles: q.all("SELECT * FROM roles ORDER BY CASE key WHEN 'superadmin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, builtin DESC, name").map(roleOut),
}));
POST('/api/roles', 'superadmin', ({ user, body }) => {
  const name = str(body.name);
  if (name.length < 2 || name.length > 40) throw bad('Nama role 2-40 karakter');
  const key = slugify(name);
  if (key.length < 2) throw bad('Nama role harus memuat huruf atau angka');
  if (key === 'superadmin' || q.get('SELECT key FROM roles WHERE key=?', key)) throw bad(`Role dengan nama "${name}" sudah ada`, 409);
  let perms = P.normalize(body.permissions);
  if (!perms.length && body.copy_from && q.get('SELECT key FROM roles WHERE key=?', str(body.copy_from))) perms = roleInfo(str(body.copy_from)).perms;
  q.run('INSERT INTO roles(key,name,description,permissions,builtin) VALUES(?,?,?,?,0)', key, name, str(body.description), JSON.stringify(perms));
  audit(user, 'tambah_role', `${name} (${perms.length} hak)`);
  return roleOut(q.get('SELECT * FROM roles WHERE key=?', key));
});
PUT('/api/roles/:key', 'superadmin', ({ user, params, body }) => {
  const r = q.get('SELECT * FROM roles WHERE key=?', params.key);
  if (!r) throw bad('Role tidak ditemukan', 404);
  if (r.key === 'superadmin') throw bad('Role Super Admin selalu memiliki semua hak dan tidak bisa diubah', 400);
  const name = body.name === undefined ? r.name : str(body.name);
  if (name.length < 2 || name.length > 40) throw bad('Nama role 2-40 karakter');
  const perms = body.permissions === undefined ? P.parse(r.permissions) : P.normalize(body.permissions);
  q.run('UPDATE roles SET name=?, description=?, permissions=? WHERE key=?', name, body.description === undefined ? r.description : str(body.description), JSON.stringify(perms), r.key);
  audit(user, 'ubah_role', `${name}: ${perms.length} hak`);
  return roleOut(q.get('SELECT * FROM roles WHERE key=?', r.key));
});
POST('/api/roles/:key/reset', 'superadmin', ({ user, params }) => {
  const def = P.BUILTIN[params.key];
  if (!def || params.key === 'superadmin') throw bad('Hanya role bawaan (selain Super Admin) yang bisa dikembalikan ke pengaturan awal', 400);
  q.run('UPDATE roles SET name=?, description=?, permissions=? WHERE key=?', def.name, def.description, JSON.stringify(def.permissions), params.key);
  audit(user, 'reset_role', def.name);
  return roleOut(q.get('SELECT * FROM roles WHERE key=?', params.key));
});
DEL('/api/roles/:key', 'superadmin', ({ user, params }) => {
  const r = q.get('SELECT * FROM roles WHERE key=?', params.key);
  if (!r) throw bad('Role tidak ditemukan', 404);
  if (r.builtin) throw bad('Role bawaan tidak bisa dihapus (hak aksesnya bisa diubah atau dikembalikan ke awal)');
  const n = q.get('SELECT COUNT(*) AS n FROM users WHERE role=?', r.key).n;
  if (n) throw bad(`Role ini masih dipakai ${n} pengguna. Pindahkan pengguna tersebut ke role lain dulu.`, 409);
  q.run('DELETE FROM roles WHERE key=?', r.key);
  audit(user, 'hapus_role', r.name);
  return { ok: true };
});
const SETTING_KEYS = ['store_name', 'store_address', 'store_phone', 'receipt_footer', 'bank_info', 'qris_note', 'allow_negative_stock', 'paper_width', 'online_hold_hours', 'store_online_enabled', 'tax_enabled', 'tax_rate', 'tax_mode', 'tax_name'];
GET('/api/settings', 'auth', () => allSettings());
PUT('/api/settings', 'superadmin', ({ user, body }) => {
  if (body.tax_rate !== undefined) { const r = Number(String(body.tax_rate).replace(',', '.')); if (!Number.isFinite(r) || r < 0 || r > 100) throw bad('Tarif pajak harus angka 0 sampai 100 (%)'); body.tax_rate = String(r); }
  if (body.tax_mode !== undefined && !['exclusive', 'inclusive'].includes(body.tax_mode)) throw bad('Mode pajak tidak valid');
  if (body.tax_enabled !== undefined) body.tax_enabled = flag(body.tax_enabled, 0) ? '1' : '0';
  for (const k of SETTING_KEYS) if (body[k] !== undefined) q.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, str(body[k]));
  audit(user, 'ubah_pengaturan', null);
  return allSettings();
});
GET('/api/audit', 'superadmin', ({ query }) => q.all('SELECT * FROM audit ORDER BY id DESC LIMIT ?', Math.min(int(query.limit, 200), 1000)));
GET('/api/backup', 'superadmin', ({ res, user }) => {
  const tmp = path.join(D.DATA_DIR, `backup-${Date.now()}.db`);
  D.db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  const buf = fs.readFileSync(tmp); fs.unlinkSync(tmp);
  audit(user, 'backup', null);
  const name = 'backup-toko-' + new Date().toISOString().slice(0, 10) + '.db';
  send(res, 200, buf, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"`, 'Access-Control-Allow-Origin': '*' });
});

// ---------- backup otomatis (mis. ke folder bersama di komputer gedung lain) ----------
const backupState = { last: null };
const localStamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
function backupNow(dir, keep = 30) {
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date(); const p = (n, w = 2) => String(n).padStart(w, '0');
  const file = path.join(dir, `toko-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}.db`);
  D.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const all = fs.readdirSync(dir).filter((f) => /^toko-\d{8}-\d{6}(-\d{3})?\.db$/.test(f)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - Math.max(1, keep)))) { try { fs.unlinkSync(path.join(dir, f)); } catch (_) {} }
  return file;
}
function runBackup() {
  const dir = process.env.BACKUP_DIR; if (!dir) return;
  try { const file = backupNow(dir, parseInt(process.env.BACKUP_KEEP || '30', 10)); backupState.last = { ok: true, at: localStamp(), file: path.basename(file) }; }
  catch (e) { backupState.last = { ok: false, at: localStamp(), error: e.message }; console.error('[backup] GAGAL: ' + e.message); }
}
// alamat yang dipakai staf untuk membuka aplikasi dari HP/komputer lain (kartu "Alamat akses" di Pengaturan)
GET('/api/server-info', 'superadmin', ({ req }) => {
  const secure = !!(req.socket && req.socket.encrypted) || String(req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https' && process.env.TRUST_PROXY === '1';
  const list = lanAddresses();
  return { protocol: secure ? 'https' : 'http', port: PORT, secure, addresses: list.map((n) => n.ip), details: list,
    public_host: process.env.PUBLIC_HOST || null, bound: process.env.HOST || '0.0.0.0' };
});
GET('/api/backup/status', 'superadmin', () => ({ enabled: !!process.env.BACKUP_DIR, dir: process.env.BACKUP_DIR || null, every_hours: parseFloat(process.env.BACKUP_EVERY_HOURS || '6'), last: backupState.last }));

// =====================================================================
//  KATEGORI, PRODUK, UPLOAD
// =====================================================================
// hak yang memakai data barang / stok (Cek Stok, Kasir, SO, permintaan, PO, dll). Role tanpa satupun tidak bisa membaca data barang.
const READ_PRODUCTS = ['cek', 'produk', 'kasir', 'pesanan', 'stok', 'permintaan', 'terima', 'transfer', 'po', 'penjualan.retur', 'laporan'];
GET('/api/categories', READ_PRODUCTS, () => q.all('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id=c.id AND p.active=1) AS products FROM categories c ORDER BY name'));
POST('/api/categories', 'produk.kelola', ({ user, body }) => {
  if (!str(body.name)) throw bad('Nama kategori wajib diisi');
  const r = q.run('INSERT INTO categories(name) VALUES(?)', str(body.name));
  audit(user, 'tambah_kategori', body.name);
  return { id: Number(r.lastInsertRowid) };
});
PUT('/api/categories/:id', 'produk.kelola', ({ params, body }) => { q.run('UPDATE categories SET name=? WHERE id=?', str(body.name), int(params.id)); return { ok: true }; });
DEL('/api/categories/:id', 'produk.kelola', ({ params }) => {
  q.run('UPDATE products SET category_id=NULL WHERE category_id=?', int(params.id));
  q.run('DELETE FROM categories WHERE id=?', int(params.id)); return { ok: true };
});

const QTYSQL = (col, loc) => `COALESCE((SELECT qty FROM stock WHERE product_id=${col} AND location='${loc}'),0)`;
const PRODUCT_SELECT = `SELECT p.*, c.name AS category,
  ${QTYSQL('p.id', 'display')} AS display_qty,
  ${QTYSQL('p.id', 'gudang_toko')} AS gt_qty,
  ${QTYSQL('p.id', 'gudang_ruko')} AS gr_qty,
  ${QTYSQL('p.id', 'display')} + ${QTYSQL('p.id', 'gudang_toko')} + ${QTYSQL('p.id', 'gudang_ruko')} AS total_qty
  FROM products p LEFT JOIN categories c ON c.id=p.category_id`;

function listProducts(query, canSeeCost) {
  const where = []; const args = [];
  if (query.active !== 'all') { where.push('p.active=?'); args.push(query.active === '0' ? 0 : 1); }
  if (query.q) { where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)'); const l = `%${query.q}%`; args.push(l, l, l); }
  if (query.category_id) { where.push('p.category_id=?'); args.push(int(query.category_id)); }
  if (query.low === '1') where.push(QTYSQL('p.id', 'display') + ' <= p.min_stock');
  const rows = q.all(`${PRODUCT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.name LIMIT ?`, ...args, Math.min(int(query.limit, 1000), 5000));
  return rows.map((r) => { const o = { ...r }; if (!canSeeCost) delete o.cost; return o; });
}
GET('/api/products', READ_PRODUCTS, ({ query, user }) => listProducts(query, hasPerm(user, 'harga_beli')));
GET('/api/products/barcode/:code', READ_PRODUCTS, ({ params, user }) => {
  const code = str(params.code);
  const r = q.get(`${PRODUCT_SELECT} WHERE (p.barcode=? OR p.sku=?) AND p.active=1`, code, code);
  if (!r) throw bad('Produk dengan barcode/SKU tersebut tidak ditemukan', 404);
  const o = { ...r }; if (!hasPerm(user, 'harga_beli')) delete o.cost; return o;
});

function ean13Check(d12) { let s = 0; for (let i = 0; i < 12; i++) s += int(d12[i]) * (i % 2 ? 3 : 1); return String((10 - (s % 10)) % 10); }
function genBarcode() {
  for (let i = 0; i < 50; i++) {
    const d12 = '20' + String(Math.floor(Math.random() * 1e10)).padStart(10, '0');
    const code = d12 + ean13Check(d12);
    if (!q.get('SELECT id FROM products WHERE barcode=?', code)) return code;
  }
  throw bad('Gagal membuat barcode otomatis');
}
function productFields(b, cur = {}) {
  const f = {
    name: str(b.name ?? cur.name), sku: str(b.sku ?? cur.sku), barcode: b.barcode === undefined ? cur.barcode : nul(b.barcode),
    category_id: b.category_id === undefined ? cur.category_id : (b.category_id ? int(b.category_id) : null),
    description: b.description === undefined ? cur.description : nul(b.description),
    image: b.image === undefined ? cur.image : nul(b.image),
    price: int(b.price ?? cur.price), cost: int(b.cost ?? cur.cost), unit: str(b.unit ?? cur.unit) || 'pcs',
    min_stock: int(b.min_stock ?? cur.min_stock, 5), show_online: flag(b.show_online, cur.show_online ?? 1),
  };
  for (const k of ['barcode', 'category_id', 'description', 'image']) if (f[k] === undefined) f[k] = null;
  if (!f.name) throw bad('Nama produk wajib diisi');
  if (f.price < 0 || f.cost < 0) throw bad('Harga tidak boleh negatif');
  return f;
}
POST('/api/products', 'produk.kelola', ({ user, body }) => tx(() => {
  const f = productFields(body);
  if (!f.sku) { const m = q.get('SELECT COALESCE(MAX(id),0)+1 AS n FROM products'); f.sku = 'RH-' + String(m.n).padStart(4, '0'); }
  if (!f.barcode) f.barcode = genBarcode();
  const r = q.run(`INSERT INTO products(sku,barcode,name,category_id,description,image,price,cost,unit,min_stock,show_online)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`, f.sku, f.barcode, f.name, f.category_id, f.description, f.image, f.price, f.cost, f.unit, f.min_stock, f.show_online);
  const id = Number(r.lastInsertRowid);
  for (const [loc, key] of [['display', 'display_qty'], ['gudang_toko', 'gt_qty'], ['gudang_ruko', 'gr_qty']]) {
    const n = int(body[key]);
    if (n > 0) moveStock({ productId: id, location: loc, delta: n, type: 'initial', note: 'Stok awal', userId: user.id });
  }
  audit(user, 'tambah_produk', `${f.sku} ${f.name}`);
  return { id, sku: f.sku, barcode: f.barcode };
}));
PUT('/api/products/:id', 'produk.kelola', ({ user, params, body }) => {
  const id = int(params.id);
  const cur = q.get('SELECT * FROM products WHERE id=?', id);
  if (!cur) throw bad('Produk tidak ditemukan', 404);
  const f = productFields(body, cur);
  if (!f.sku) f.sku = cur.sku; if (!f.barcode) f.barcode = cur.barcode || genBarcode();
  const active = body.active === undefined ? cur.active : flag(body.active);
  q.run(`UPDATE products SET sku=?,barcode=?,name=?,category_id=?,description=?,image=?,price=?,cost=?,unit=?,min_stock=?,show_online=?,active=? WHERE id=?`,
    f.sku, f.barcode, f.name, f.category_id, f.description, f.image, f.price, f.cost, f.unit, f.min_stock, f.show_online, active, id);
  audit(user, 'ubah_produk', `${f.sku} ${f.name}` + (cur.price !== f.price ? ` harga ${cur.price}->${f.price}` : ''));
  return { ok: true };
});
DEL('/api/products/:id', 'produk.kelola', ({ user, params }) => tx(() => {
  const id = int(params.id);
  const p = q.get('SELECT * FROM products WHERE id=?', id);
  if (!p) throw bad('Produk tidak ditemukan', 404);
  const used = ['sale_items', 'po_items', 'order_items', 'transfer_items'].some((t) => q.get(`SELECT 1 AS x FROM ${t} WHERE product_id=? LIMIT 1`, id));
  if (used) {
    q.run('UPDATE products SET active=0 WHERE id=?', id);
    audit(user, 'arsipkan_produk', `${p.sku} ${p.name}`);
    return { archived: true, message: 'Produk sudah punya riwayat transaksi, jadi diarsipkan (disembunyikan), bukan dihapus permanen.' };
  }
  q.run('DELETE FROM stock_movements WHERE product_id=?', id);
  q.run('DELETE FROM products WHERE id=?', id);
  audit(user, 'hapus_produk', `${p.sku} ${p.name}`);
  return { deleted: true, message: 'Produk dihapus permanen.' };
}));

const MIMEEXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
POST('/api/upload', 'produk.kelola', ({ body }) => {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(str(body.data));
  if (!m) throw bad('Format gambar tidak didukung (JPG/PNG/WebP)');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 3 * 1024 * 1024) throw bad('Ukuran gambar maksimal 3 MB');
  const name = crypto.randomBytes(8).toString('hex') + MIMEEXT[m[1]];
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return { url: '/uploads/' + name };
});

// =====================================================================
//  STOK & TRANSFER GUDANG -> TOKO
// =====================================================================
POST('/api/stock/adjust', ['stok.koreksi_toko', 'stok.koreksi_gudang'], ({ user, body }) => tx(() => {
  const pid = int(body.product_id); const loc = body.location;
  if (!LOCATIONS.includes(loc)) throw bad('Lokasi stok tidak valid');
  if (!hasPerm(user, loc === 'display' ? 'stok.koreksi_toko' : 'stok.koreksi_gudang')) throw bad(`Anda tidak memiliki hak mengoreksi stok ${LOC_LABEL[loc]}`, 403);
  if (!q.get('SELECT id FROM products WHERE id=?', pid)) throw bad('Produk tidak ditemukan', 404);
  const qty = int(body.qty);
  const cur = getQty(pid, loc);
  let delta, type;
  if (body.mode === 'set') { if (qty < 0) throw bad('Stok tidak boleh negatif'); delta = qty - cur; type = 'opname'; } else { delta = qty; type = 'adjust'; }
  if (delta === 0) return { balance: cur };
  const balance = moveStock({ productId: pid, location: loc, delta, type, note: nul(body.note), userId: user.id });
  audit(user, 'koreksi_stok', `produk ${pid} ${loc} ${delta > 0 ? '+' : ''}${delta} (${body.note || '-'})`);
  return { balance };
}));
GET('/api/stock/movements', 'stok', ({ query }) => {
  const where = []; const args = [];
  if (query.product_id) { where.push('m.product_id=?'); args.push(int(query.product_id)); }
  if (query.location) { where.push('m.location=?'); args.push(query.location); }
  return q.all(`SELECT m.*, p.name AS product, p.sku, u.name AS user FROM stock_movements m
    JOIN products p ON p.id=m.product_id LEFT JOIN users u ON u.id=m.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.id DESC LIMIT ?`, ...args, Math.min(int(query.limit, 100), 1000));
});

// ---------- KARTU STOK: riwayat keluar-masuk satu barang (saldo awal, masuk, keluar, saldo berjalan) ----------
// Dibangun dari buku mutasi stock_movements, jadi otomatis mencakup penjualan, void, retur, SO, transfer, PO, dan koreksi.
const MOV_LABEL = { initial: 'Stok awal', sale: 'Penjualan', sale_return: 'Retur customer', void: 'Void penjualan', order: 'Sales Order (dipesan)', order_cancel: 'Sales Order batal', transfer_out: 'Transfer keluar', transfer_in: 'Transfer masuk', po_in: 'Terima PO supplier', opname: 'Stok opname', adjust: 'Koreksi stok' };
// Kelompok jenis untuk filter "Jenis" di Kartu Stok (padanan Type: Purchase / Sales / ... di aplikasi lama)
const MOV_GROUP = { po_in: 'Pembelian', sale: 'Penjualan', void: 'Penjualan', sale_return: 'Penjualan', order: 'Penjualan', order_cancel: 'Penjualan',
  transfer_out: 'Transfer', transfer_in: 'Transfer', initial: 'Koreksi', opname: 'Koreksi', adjust: 'Koreksi' };
const CARD_LIMIT = 5000;
// period=all -> sejak mutasi pertama (seperti aplikasi lama bila "Bulan" tidak dicentang); selain itu from/to, bawaan 30 hari terakhir
function cardRange(query, pid) {
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
  const today = ymd(new Date());
  let to = isDate(query.to) ? query.to : today, from;
  if (query.period === 'all') {
    const r = pid ? q.get('SELECT MIN(date(created_at)) AS d FROM stock_movements WHERE product_id=?', pid) : q.get('SELECT MIN(date(created_at)) AS d FROM stock_movements');
    from = r && r.d ? r.d : today;
  } else from = isDate(query.from) ? query.from : ymd(new Date(Date.now() - 29 * 864e5));
  if (from > to) [from, to] = [to, from];
  return { from, to, today };
}
// Keterangan (nama customer / supplier) dan Harga per baris, dari dokumen asal mutasi. Harga beli hanya untuk pemegang hak harga_beli.
function cardDocInfo(pid, rows, canCost) {
  const need = (...t) => rows.some((r) => t.includes(r.type));
  const sales = new Map(), orders = new Map(), pos = new Map(), rets = new Map();
  if (need('sale', 'void')) for (const r of q.all('SELECT s.invoice_no AS k, s.customer_name AS who, si.price FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE si.product_id=?', pid)) sales.set(r.k, r);
  if (need('order', 'order_cancel')) for (const r of q.all('SELECT o.order_no AS k, o.customer_name AS who, oi.price FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.product_id=?', pid)) orders.set(r.k, r);
  if (need('po_in')) for (const r of q.all('SELECT po.po_number AS k, sp.name AS who, i.cost AS price FROM po_items i JOIN purchase_orders po ON po.id=i.po_id LEFT JOIN suppliers sp ON sp.id=po.supplier_id WHERE i.product_id=?', pid)) pos.set(r.k, r);
  if (need('sale_return')) for (const r of q.all('SELECT rt.return_no AS k, s.customer_name AS who, ri.unit_refund AS price FROM sale_return_items ri JOIN sale_returns rt ON rt.id=ri.return_id JOIN sales s ON s.id=rt.sale_id WHERE ri.product_id=?', pid)) rets.set(r.k, r);
  for (const r of rows) {
    const d = (r.type === 'sale' || r.type === 'void') ? sales.get(r.ref) : (r.type === 'order' || r.type === 'order_cancel') ? orders.get(r.ref) : r.type === 'po_in' ? pos.get(r.ref) : r.type === 'sale_return' ? rets.get(r.ref) : null;
    r.party = d ? (d.who || (r.type === 'po_in' ? null : 'Pelanggan umum')) : null;
    r.price = d && (r.type !== 'po_in' || canCost) ? d.price : null;
    r.price_kind = r.price == null ? null : r.type === 'po_in' ? 'beli' : 'jual';
  }
}
function stockCard(query, user) {
  const pid = int(query.product_id);
  const p = q.get('SELECT id, name, sku, barcode, min_stock, description, unit FROM products WHERE id=?', pid);
  if (!p) throw bad('Pilih barang terlebih dulu', 404);
  const loc = str(query.location) || 'all';
  if (loc !== 'all' && !LOCATIONS.includes(loc)) throw bad('Lokasi stok tidak valid');
  const { from, to, today } = cardRange(query, pid);
  const locs = loc === 'all' ? LOCATIONS : [loc];
  // saldo awal = saldo setelah mutasi terakhir SEBELUM tanggal awal (per lokasi, lalu dijumlah)
  const opening = locs.reduce((a, l) => {
    const r = q.get('SELECT balance FROM stock_movements WHERE product_id=? AND location=? AND created_at < ? ORDER BY id DESC LIMIT 1', pid, l, from + ' 00:00:00');
    return a + (r ? r.balance : 0);
  }, 0);
  const raw = q.all(`SELECT m.*, u.name AS user FROM stock_movements m LEFT JOIN users u ON u.id=m.user_id
    WHERE m.product_id=? ${loc === 'all' ? '' : 'AND m.location=?'} AND m.created_at >= ? AND m.created_at < date(?, '+1 day')
    ORDER BY m.id LIMIT ?`, ...[pid, ...(loc === 'all' ? [] : [loc]), from + ' 00:00:00', to, CARD_LIMIT + 1]);
  const truncated = raw.length > CARD_LIMIT; if (truncated) raw.pop();
  // saldo berjalan dihitung dari SEMUA mutasi; filter Jenis / transfer hanya menyembunyikan baris, saldonya tetap saldo sebenarnya
  let bal = opening;
  const full = raw.map((m) => {
    const inn = m.qty > 0 ? m.qty : 0, out = m.qty < 0 ? -m.qty : 0;
    bal += m.qty;
    return { id: m.id, created_at: m.created_at, type: m.type, type_label: MOV_LABEL[m.type] || m.type, group: MOV_GROUP[m.type] || 'Koreksi', location: m.location, location_label: LOC_LABEL[m.location] || m.location,
      ref: m.ref, note: m.note, user: m.user, in: inn, out, balance: bal };
  });
  const grp = str(query.type).toLowerCase();                   // '', all, pembelian, penjualan, transfer, koreksi
  const wantTransfer = query.show_transfer === undefined || query.show_transfer === '1' || grp === 'transfer' || loc !== 'all';
  const rows = full.filter((r) => (!grp || grp === 'all' || r.group.toLowerCase() === grp) && (wantTransfer || r.group !== 'Transfer'));
  const totalIn = rows.reduce((a, r) => a + r.in, 0), totalOut = rows.reduce((a, r) => a + r.out, 0);
  cardDocInfo(pid, rows, hasPerm(user, 'harga_beli'));
  const current = locs.reduce((a, l) => a + getQty(pid, l), 0);
  // pemeriksaan: bila rentang sampai hari ini, saldo akhir kartu harus sama dengan stok yang tercatat sekarang
  const mismatch = !truncated && to >= today && bal !== current;
  return { product: p, location: loc, location_label: loc === 'all' ? 'Semua lokasi' : LOC_LABEL[loc], from, to, period: query.period === 'all' ? 'all' : 'range', type: grp || 'all', show_transfer: wantTransfer,
    opening, rows, total_in: totalIn, total_out: totalOut, closing: bal, current, available: current, hidden: full.length - rows.length, mismatch, truncated };
}
// Rekap kartu stok SEMUA barang untuk satu lokasi (atau semua lokasi): saldo awal, masuk, keluar, saldo akhir per barang.
function stockRecap(query) {
  const loc = str(query.location) || 'all';
  if (loc !== 'all' && !LOCATIONS.includes(loc)) throw bad('Lokasi stok tidak valid');
  const { from, to, today } = cardRange(query, null);
  const locs = loc === 'all' ? LOCATIONS : [loc];
  const ph = locs.map(() => '?').join(',');
  const open = new Map(), inn = new Map(), out = new Map(), cur = new Map();
  for (const r of q.all(`SELECT product_id, SUM(balance) AS v FROM stock_movements WHERE id IN
      (SELECT MAX(id) FROM stock_movements WHERE created_at < ? AND location IN (${ph}) GROUP BY product_id, location) GROUP BY product_id`, from + ' 00:00:00', ...locs)) open.set(r.product_id, r.v);
  for (const r of q.all(`SELECT product_id, SUM(CASE WHEN qty>0 THEN qty ELSE 0 END) AS i, SUM(CASE WHEN qty<0 THEN -qty ELSE 0 END) AS o FROM stock_movements
      WHERE location IN (${ph}) AND created_at >= ? AND created_at < date(?, '+1 day') GROUP BY product_id`, ...locs, from + ' 00:00:00', to)) { inn.set(r.product_id, r.i); out.set(r.product_id, r.o); }
  for (const r of q.all(`SELECT product_id, SUM(qty) AS v FROM stock WHERE location IN (${ph}) GROUP BY product_id`, ...locs)) cur.set(r.product_id, r.v);
  const term = str(query.q).toLowerCase();
  const hideEmpty = query.hide_empty === '1';
  const rows = [];
  for (const p of q.all('SELECT id, name, sku, barcode, min_stock, active FROM products ORDER BY name COLLATE NOCASE')) {
    const o = open.get(p.id) || 0, i = inn.get(p.id) || 0, u = out.get(p.id) || 0, c = cur.get(p.id) || 0;
    const active = o || i || u || c;
    if (!p.active && !active) continue;                          // barang arsip hanya muncul bila pernah/masih punya stok
    if (hideEmpty && !active) continue;
    if (term && !`${p.name} ${p.sku} ${p.barcode || ''}`.toLowerCase().includes(term)) continue;
    const closing = o + i - u;
    rows.push({ product_id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, archived: !p.active, opening: o, in: i, out: u, closing, current: c, min_stock: p.min_stock, mismatch: to >= today && closing !== c });
  }
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  return { mode: 'recap', location: loc, location_label: loc === 'all' ? 'Semua lokasi' : LOC_LABEL[loc], from, to, rows,
    totals: { opening: sum('opening'), in: sum('in'), out: sum('out'), closing: sum('closing'), current: sum('current') }, mismatch_count: rows.filter((r) => r.mismatch).length };
}
GET('/api/stock/card', ['stok', 'stok.kartu'], ({ res, query, user }) => {
  if (!int(query.product_id)) {
    const r = stockRecap(query);
    if (query.format !== 'csv') return r;
    const csv = '﻿' + [['Rekap Kartu Stok: ' + r.location_label], [`Periode ${r.from} s/d ${r.to}`],
      ['Barang', 'SKU', 'Barcode', 'Saldo awal', 'Masuk', 'Keluar', 'Saldo akhir', 'Stok tercatat sekarang'],
      ...r.rows.map((x) => [x.name, x.sku, x.barcode, x.opening, x.in || '', x.out || '', x.closing, x.current]),
      ['Total', '', '', r.totals.opening, r.totals.in, r.totals.out, r.totals.closing, r.totals.current]].map((x) => x.map(csvCell).join(';')).join('\r\n');
    send(res, 200, Buffer.from(csv, 'utf8'), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="rekap-kartu-stok-${r.location}-${r.from}_${r.to}.csv"`, 'Access-Control-Allow-Origin': '*' });
    return;
  }
  const c = stockCard(query, user);
  if (query.format !== 'csv') return c;
  const header = ['No', 'Tanggal', 'Jenis', 'ID', 'Keterangan', 'Masuk', 'Keluar', 'Saldo', 'Harga', 'Lokasi', 'Dicatat oleh'];
  const rows = [['', '', 'Saldo awal', '', '', '', '', c.opening, '', c.location_label, ''],
    ...c.rows.map((r, i) => [i + 1, r.created_at, r.type_label, r.ref, [r.party, r.note].filter(Boolean).join(' - '), r.in || '', r.out || '', r.balance, r.price == null ? '' : r.price, r.location_label, r.user]),
    ['', '', 'Total / saldo akhir', '', '', c.total_in, c.total_out, c.closing, '', c.location_label, '']];
  const csv = '\ufeff' + [[`Kartu Stok: ${c.product.name} (${c.product.sku})`], [`Periode ${c.from} s/d ${c.to}`], header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
  const name = `kartu-stok-${String(c.product.sku).replace(/[^\w-]+/g, '_')}-${c.from}_${c.to}`;
  send(res, 200, Buffer.from(csv, 'utf8'), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"`, 'Access-Control-Allow-Origin': '*' });
});

function cleanItems(items, field = 'qty') {
  if (!Array.isArray(items) || !items.length) throw bad('Minimal satu barang');
  const map = new Map();
  for (const it of items) {
    const pid = int(it.product_id); const qty = int(it[field]);
    if (!pid || qty <= 0) throw bad('Jumlah barang harus lebih dari 0');
    map.set(pid, (map.get(pid) || 0) + qty);
  }
  return [...map].map(([product_id, qty]) => ({ product_id, qty }));
}
POST('/api/transfers', 'transfer', ({ user, body }) => tx(() => {
  const items = cleanItems(body.items);
  const from = body.from || 'gudang_ruko', to = body.to || 'display';
  if (!LOCATIONS.includes(from) || !LOCATIONS.includes(to)) throw bad('Lokasi stok tidak valid');
  if (from === to) throw bad('Lokasi asal dan tujuan tidak boleh sama');
  const number = nextNumber('TRF', 'transfers', 'number');
  const id = Number(q.run('INSERT INTO transfers(number,note,user_id,from_location,to_location) VALUES(?,?,?,?,?)', number, nul(body.note), user.id, from, to).lastInsertRowid);
  for (const it of items) {
    if (!q.get('SELECT id FROM products WHERE id=? AND active=1', it.product_id)) throw bad('Ada produk yang tidak valid/arsip');
    moveStock({ productId: it.product_id, location: from, delta: -it.qty, type: 'transfer_out', ref: number, note: `Ke ${LOC_LABEL[to]}`, userId: user.id });
    moveStock({ productId: it.product_id, location: to, delta: it.qty, type: 'transfer_in', ref: number, note: `Dari ${LOC_LABEL[from]}`, userId: user.id });
    q.run('INSERT INTO transfer_items(transfer_id,product_id,qty) VALUES(?,?,?)', id, it.product_id, it.qty);
  }
  audit(user, 'transfer_stok', `${number} ${LOC_LABEL[from]} → ${LOC_LABEL[to]}`);
  return { id, number };
}));
GET('/api/transfers', 'transfer', () => {
  const rows = q.all('SELECT t.*, u.name AS user FROM transfers t LEFT JOIN users u ON u.id=t.user_id ORDER BY t.id DESC LIMIT 100');
  return rows.map((t) => ({ ...t, items: q.all('SELECT ti.qty, p.name, p.sku FROM transfer_items ti JOIN products p ON p.id=ti.product_id WHERE ti.transfer_id=?', t.id) }));
});

// =====================================================================
//  PERMINTAAN BARANG: toko meminta, gudang menyiapkan & mengirim, toko konfirmasi terima
//  (bukan PO: PO hanya untuk pembelian ke supplier). Stok gudang berkurang saat DIKIRIM; stok toko bertambah
//  sebesar jumlah yang DITERIMA (barang di jalan tidak masuk stok mana pun).
// =====================================================================
const REQ_OPEN = ['requested', 'preparing', 'shipped'];
function getRequest(id) {
  const r = q.get(`SELECT r.*, c.name AS created_by_name, p.name AS prepared_by_name, s.name AS shipped_by_name, v.name AS received_by_name
    FROM stock_requests r LEFT JOIN users c ON c.id=r.created_by LEFT JOIN users p ON p.id=r.prepared_by
    LEFT JOIN users s ON s.id=r.shipped_by LEFT JOIN users v ON v.id=r.received_by WHERE r.id=?`, id);
  if (!r) throw bad('Permintaan tidak ditemukan', 404);
  const items = q.all(`SELECT i.*, p.name, p.sku, p.unit,
      ${QTYSQL('i.product_id', r.from_location)} AS src_qty,
      ${QTYSQL('i.product_id', r.to_location)} AS dst_qty
    FROM stock_request_items i JOIN products p ON p.id=i.product_id WHERE i.request_id=? ORDER BY i.id`, id);
  const open = ['requested', 'preparing'].includes(r.status);
  return { ...r, items: items.map((i) => ({ ...i, short: open && i.src_qty < i.qty })),
    has_short: open && items.some((i) => i.src_qty < i.qty),
    discrepancy: r.status === 'received' && items.some((i) => i.received_qty < i.sent_qty) };
}
GET('/api/requests', 'permintaan', ({ query }) => {
  const where = []; const args = [];
  if (query.status === 'open') where.push(`r.status IN ('requested','preparing','shipped')`);
  else if (query.status === 'closed') where.push(`r.status IN ('received','rejected','cancelled')`);
  else if (query.status) { where.push('r.status=?'); args.push(query.status); }
  const rows = q.all(`SELECT r.id,r.number,r.status,r.urgent,r.note,r.from_location,r.to_location,r.created_at,r.shipped_at,r.received_at,c.name AS created_by_name
    FROM stock_requests r LEFT JOIN users c ON c.id=r.created_by ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (r.status IN ('requested','preparing')) DESC, r.urgent DESC, r.id DESC LIMIT 300`, ...args);
  return rows.map((r) => ({ ...r, items: q.all('SELECT p.name, i.qty, i.sent_qty, i.received_qty FROM stock_request_items i JOIN products p ON p.id=i.product_id WHERE i.request_id=? ORDER BY i.id', r.id) }));
});
GET('/api/requests/:id', 'permintaan', ({ params }) => getRequest(int(params.id)));
POST('/api/requests', 'permintaan.buat', ({ user, body }) => tx(() => {
  const items = cleanItems(body.items);
  const from = body.from_location || 'gudang_ruko', to = body.to_location || 'display';
  if (!['gudang_toko', 'gudang_ruko'].includes(from)) throw bad('Asal barang harus Gudang Toko atau Gudang Ruko');
  if (!['display', 'gudang_toko'].includes(to)) throw bad('Tujuan barang harus Display Toko atau Gudang Toko');
  if (from === to) throw bad('Asal dan tujuan tidak boleh sama');
  for (const it of items) if (!q.get('SELECT id FROM products WHERE id=? AND active=1', it.product_id)) throw bad('Ada produk yang tidak valid/arsip');
  const number = nextNumber('REQ', 'stock_requests', 'number');
  const id = Number(q.run('INSERT INTO stock_requests(number,urgent,note,created_by,from_location,to_location) VALUES(?,?,?,?,?,?)', number, flag(body.urgent, 0), nul(body.note), user.id, from, to).lastInsertRowid);
  for (const it of items) q.run('INSERT INTO stock_request_items(request_id,product_id,qty) VALUES(?,?,?)', id, it.product_id, it.qty);
  audit(user, 'buat_permintaan', number);
  return getRequest(id);
}));
POST('/api/requests/:id/cancel', 'permintaan.buat', ({ user, params }) => tx(() => {
  const r = getRequest(int(params.id));
  if (r.status !== 'requested') throw bad('Permintaan yang sudah diproses gudang tidak bisa dibatalkan. Hubungi gudang.');
  if (r.created_by !== user.id && !hasPerm(user, 'permintaan.batal_semua')) throw bad('Hanya pembuat permintaan (atau yang berhak) yang boleh membatalkan', 403);
  q.run("UPDATE stock_requests SET status='cancelled', updated_at=datetime('now','localtime') WHERE id=?", r.id);
  audit(user, 'batal_permintaan', r.number);
  return getRequest(r.id);
}));
POST('/api/requests/:id/prepare', 'permintaan.proses', ({ user, params }) => tx(() => {
  const r = getRequest(int(params.id));
  if (r.status !== 'requested') throw bad(`Permintaan berstatus "${r.status}", tidak bisa mulai disiapkan`);
  q.run("UPDATE stock_requests SET status='preparing', prepared_by=?, prepared_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?", user.id, r.id);
  audit(user, 'siapkan_permintaan', r.number);
  return getRequest(r.id);
}));
POST('/api/requests/:id/reject', 'permintaan.proses', ({ user, params, body }) => tx(() => {
  const r = getRequest(int(params.id));
  if (!['requested', 'preparing'].includes(r.status)) throw bad(`Permintaan berstatus "${r.status}", tidak bisa ditolak`);
  const reason = str(body.reason); if (!reason) throw bad('Alasan penolakan wajib diisi');
  q.run("UPDATE stock_requests SET status='rejected', reject_reason=?, prepared_by=COALESCE(prepared_by,?), updated_at=datetime('now','localtime') WHERE id=?", reason, user.id, r.id);
  audit(user, 'tolak_permintaan', `${r.number}: ${reason}`);
  return getRequest(r.id);
}));
POST('/api/requests/:id/ship', 'permintaan.proses', ({ user, params, body }) => tx(() => {
  const r = getRequest(int(params.id));
  if (!['requested', 'preparing'].includes(r.status)) throw bad(`Permintaan berstatus "${r.status}", tidak bisa dikirim`);
  const sent = new Map((body.items || []).map((x) => [int(x.item_id), int(x.qty)]));
  let total = 0;
  for (const it of r.items) {
    const n = sent.has(it.id) ? sent.get(it.id) : 0;
    if (n < 0) throw bad('Jumlah kirim tidak boleh negatif');
    if (n > it.qty) throw bad(`Jumlah kirim "${it.name}" melebihi yang diminta (${it.qty})`);
    if (n > it.src_qty) throw bad(`Stok ${LOC_LABEL[r.from_location]} "${it.name}" hanya ${it.src_qty}, tidak cukup untuk mengirim ${n}`);
    if (n < it.qty && !str(body.note)) throw bad(`Jumlah kirim "${it.name}" kurang dari permintaan. Isi catatan alasannya (mis. stok gudang kurang)`);
    total += n;
  }
  if (total <= 0) throw bad('Isi jumlah yang dikirim (minimal satu barang). Bila tidak ada yang bisa dikirim, gunakan Tolak.');
  for (const it of r.items) {
    const n = sent.get(it.id) || 0;
    q.run('UPDATE stock_request_items SET sent_qty=? WHERE id=?', n, it.id);
    if (n > 0) moveStock({ productId: it.product_id, location: r.from_location, delta: -n, type: 'transfer_out', ref: r.number, note: `Permintaan → ${LOC_LABEL[r.to_location]}`, userId: user.id });
  }
  q.run("UPDATE stock_requests SET status='shipped', ship_note=?, shipped_by=?, shipped_at=datetime('now','localtime'), prepared_by=COALESCE(prepared_by,?), updated_at=datetime('now','localtime') WHERE id=?", nul(body.note), user.id, user.id, r.id);
  audit(user, 'kirim_permintaan', `${r.number} (${total} unit)`);
  return getRequest(r.id);
}));
POST('/api/requests/:id/receive', 'permintaan.buat', ({ user, params, body }) => tx(() => {
  const r = getRequest(int(params.id));
  if (r.status !== 'shipped') throw bad(`Permintaan berstatus "${r.status}", tidak bisa dikonfirmasi diterima`);
  const got = new Map((body.items || []).map((x) => [int(x.item_id), int(x.qty)]));
  let diff = false;
  for (const it of r.items) {
    const n = got.has(it.id) ? got.get(it.id) : it.sent_qty;
    if (n < 0 || n > it.sent_qty) throw bad(`Jumlah diterima "${it.name}" harus 0 sampai ${it.sent_qty} (yang dikirim gudang)`);
    if (n < it.sent_qty) { diff = true; if (!str(body.note)) throw bad(`Jumlah diterima "${it.name}" kurang dari yang dikirim. Isi catatan selisihnya`); }
    q.run('UPDATE stock_request_items SET received_qty=? WHERE id=?', n, it.id);
    if (n > 0) moveStock({ productId: it.product_id, location: r.to_location, delta: n, type: 'transfer_in', ref: r.number, note: `Permintaan dari ${LOC_LABEL[r.from_location]}`, userId: user.id });
  }
  q.run("UPDATE stock_requests SET status='received', receive_note=?, received_by=?, received_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?", nul(body.note), user.id, r.id);
  audit(user, 'terima_permintaan', `${r.number}${diff ? ' (ADA SELISIH)' : ''}`);
  return getRequest(r.id);
}));

// =====================================================================
//  PENJUALAN (KASIR)
// =====================================================================
function getSale(id) {
  const s = q.get('SELECT s.*, u.name AS cashier FROM sales s LEFT JOIN users u ON u.id=s.user_id WHERE s.id=?', id);
  if (!s) throw bad('Transaksi tidak ditemukan', 404);
  const items = q.all(`SELECT si.*,
    si.qty-COALESCE((SELECT SUM(sri.qty) FROM sale_return_items sri JOIN sale_returns sr ON sr.id=sri.return_id WHERE sri.sale_item_id=si.id),0) AS remaining_qty,
    COALESCE((SELECT SUM(sri.qty) FROM sale_return_items sri JOIN sale_returns sr ON sr.id=sri.return_id WHERE sri.sale_item_id=si.id),0) AS returned_qty
    FROM sale_items si WHERE si.sale_id=?`, id);
  const returns = q.all(`SELECT sr.*,u.name AS user_name,ce.expense_no
    FROM sale_returns sr LEFT JOIN users u ON u.id=sr.user_id
    LEFT JOIN cash_expenses ce ON ce.id=sr.cash_expense_id
    WHERE sr.sale_id=? ORDER BY sr.id DESC`, id).map((r) => ({
      ...r, items: q.all('SELECT * FROM sale_return_items WHERE return_id=? ORDER BY id', r.id)
    }));
  return { ...s, items, returns, returned_total: returns.reduce((a, r) => a + r.refund_amount, 0), remaining_refundable: Math.max(0, s.total - returns.reduce((a, r) => a + r.refund_amount, 0)), store: allSettings() };
}
function recordPayment(refType, refId, method, amount, note, userId) {
  q.run('INSERT INTO payments(ref_type,ref_id,method,amount,note,user_id) VALUES(?,?,?,?,?,?)', refType, refId, method, amount, note, userId);
}
POST('/api/sales', 'kasir', ({ user, body }) => tx(() => {
  const items = cleanItems(body.items);
  const method = body.payment_method || 'tunai';
  if (!PAY_METHODS.includes(method) || method === 'cod') throw bad('Metode pembayaran tidak valid');
  const lines = items.map((it) => {
    const p = q.get('SELECT * FROM products WHERE id=? AND active=1', it.product_id);
    if (!p) throw bad('Ada produk yang tidak ditemukan / sudah diarsipkan');
    return { p, qty: it.qty };
  });
  const subtotalRaw = lines.reduce((a, l) => a + l.p.price * l.qty, 0);
  // diskon: rupiah + persen (klien lama yang hanya mengirim `discount` dianggap diskon rupiah)
  const rpIn = body.discount_rp !== undefined ? body.discount_rp : body.discount;
  const pctIn = Number(String(body.discount_pct == null || body.discount_pct === '' ? 0 : body.discount_pct).replace(',', '.'));
  if (!Number.isFinite(pctIn) || pctIn < 0 || pctIn > 100) throw bad('Diskon persen harus 0 sampai 100');
  if (int(rpIn) < 0) throw bad('Diskon rupiah tidak boleh negatif');
  const c = calcSale(subtotalRaw, rpIn, pctIn, taxConfig(allSettings()));
  const { subtotal, discount, total } = c;
  let paid = method === 'tunai' ? int(body.paid) : total;
  if (paid < total) throw bad('Uang yang dibayarkan kurang dari total');
  const invoice = nextNumber('INV', 'sales', 'invoice_no');
  const allowNeg = setting('allow_negative_stock') === '1';
  const id = Number(q.run(`INSERT INTO sales(invoice_no,channel,customer_name,customer_phone,subtotal,discount,discount_rp,discount_pct,tax_rate,tax_mode,tax_amount,total,paid,change_amount,payment_method,note,user_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, invoice, 'pos', nul(body.customer_name), nul(body.customer_phone), subtotal, discount, c.discount_rp, c.discount_pct, c.tax_rate, c.tax_mode, c.tax_amount, total, paid, paid - total, method, nul(body.note), user.id).lastInsertRowid);
  for (const l of lines) {
    q.run('INSERT INTO sale_items(sale_id,product_id,name,price,cost,qty) VALUES(?,?,?,?,?,?)', id, l.p.id, l.p.name, l.p.price, l.p.cost, l.qty);
    moveStock({ productId: l.p.id, location: 'display', delta: -l.qty, type: 'sale', ref: invoice, userId: user.id, allowNegative: allowNeg });
  }
  recordPayment('sale', id, method, total, null, user.id);
  return getSale(id);
}));
GET('/api/sales', 'penjualan', ({ query, user }) => {
  const where = ['1=1']; const args = [];
  if (query.from) { where.push('date(s.created_at)>=?'); args.push(query.from); }
  if (query.to) { where.push('date(s.created_at)<=?'); args.push(query.to); }
  if (query.q) { where.push('(s.invoice_no LIKE ? OR s.customer_name LIKE ?)'); args.push(`%${query.q}%`, `%${query.q}%`); }
  if (query.status) { where.push('s.status=?'); args.push(query.status); }
  if (!hasPerm(user, 'penjualan.semua')) { // tanpa hak "lihat semua": hanya transaksinya sendiri, 3 hari terakhir
    where.push("date(s.created_at)>=date('now','localtime','-2 days')");
    where.push('s.user_id=?'); args.push(user.id);
  }
  return q.all(`SELECT s.id,s.invoice_no,s.channel,s.customer_name,s.total,s.discount,s.discount_rp,s.discount_pct,s.payment_method,s.status,s.created_at,u.name AS cashier,
    (SELECT SUM(qty) FROM sale_items WHERE sale_id=s.id) AS items
    FROM sales s LEFT JOIN users u ON u.id=s.user_id WHERE ${where.join(' AND ')} ORDER BY s.id DESC LIMIT ?`, ...args, Math.min(int(query.limit, 200), 2000));
});
GET('/api/sales/:id', 'penjualan', ({ params, user }) => {
  const sale = getSale(int(params.id));
  if (!hasPerm(user, 'penjualan.semua') && sale.user_id !== user.id) throw bad('Anda hanya dapat melihat transaksi milik Anda sendiri', 403);
  return sale;
});
POST('/api/sales/:id/void', 'penjualan.void', ({ user, params, body }) => tx(() => {
  const s = getSale(int(params.id));
  if (s.status !== 'paid') throw bad('Transaksi sudah dibatalkan');
  if (s.returned_total > 0) throw bad('Transaksi yang sudah memiliki retur tidak dapat di-void. Lanjutkan melalui proses retur.');
  if (s.order_id) throw bad('Transaksi ini berasal dari Sales Order. Batalkan lewat menu Sales Order (SO).');
  if (!str(body.reason)) throw bad('Alasan pembatalan wajib diisi');
  for (const it of s.items) moveStock({ productId: it.product_id, location: 'display', delta: it.qty, type: 'void', ref: s.invoice_no, userId: user.id, allowNegative: true });
  q.run("UPDATE sales SET status='void', void_reason=? WHERE id=?", str(body.reason), s.id);
  audit(user, 'void_penjualan', `${s.invoice_no}: ${body.reason}`);
  return getSale(s.id);
}));

// =====================================================================
//  RETUR BARANG CUSTOMER — satu retur = satu refund kas + mutasi stok atomik
// =====================================================================
function getSaleReturn(id) {
  const r = q.get(`SELECT sr.*,s.invoice_no,s.customer_name,s.customer_phone,u.name AS user_name,ce.expense_no
    FROM sale_returns sr JOIN sales s ON s.id=sr.sale_id
    LEFT JOIN users u ON u.id=sr.user_id LEFT JOIN cash_expenses ce ON ce.id=sr.cash_expense_id
    WHERE sr.id=?`, id);
  if (!r) throw bad('Retur tidak ditemukan', 404);
  return { ...r, items: q.all('SELECT * FROM sale_return_items WHERE return_id=? ORDER BY id', id) };
}
GET('/api/sales/:id/returns', 'penjualan.retur', ({ params, user }) => {
  const sale = getSale(int(params.id));
  if (!hasPerm(user, 'penjualan.semua') && sale.user_id !== user.id) throw bad('Anda hanya dapat melihat retur transaksi milik Anda sendiri', 403);
  return sale.returns;
});
GET('/api/returns', 'penjualan.retur', ({ query, user }) => {
  const where = ['1=1']; const args = [];
  if (query.from) { where.push('date(sr.created_at)>=?'); args.push(query.from); }
  if (query.to) { where.push('date(sr.created_at)<=?'); args.push(query.to); }
  if (query.q) { where.push('(sr.return_no LIKE ? OR s.invoice_no LIKE ? OR s.customer_name LIKE ?)'); args.push(`%${query.q}%`,`%${query.q}%`,`%${query.q}%`); }
  if (!hasPerm(user, 'penjualan.semua')) { where.push('s.user_id=?'); args.push(user.id); }
  return q.all(`SELECT sr.id,sr.return_no,sr.sale_id,s.invoice_no,s.customer_name,sr.refund_amount,sr.location,sr.reason,sr.created_at,
    ce.expense_no,u.name AS user_name
    FROM sale_returns sr JOIN sales s ON s.id=sr.sale_id LEFT JOIN cash_expenses ce ON ce.id=sr.cash_expense_id
    LEFT JOIN users u ON u.id=sr.user_id WHERE ${where.join(' AND ')} ORDER BY sr.id DESC LIMIT 1000`, ...args);
});
GET('/api/returns/:id', 'penjualan.retur', ({ params, user }) => {
  const r = getSaleReturn(int(params.id));
  const sale = getSale(r.sale_id);
  if (!hasPerm(user, 'penjualan.semua') && sale.user_id !== user.id) throw bad('Anda hanya dapat melihat retur transaksi milik Anda sendiri', 403);
  return r;
});
POST('/api/sales/:id/returns', 'penjualan.retur', ({ user, params, body }) => tx(() => {
  const sale = getSale(int(params.id));
  if (!hasPerm(user, 'penjualan.semua') && sale.user_id !== user.id) throw bad('Anda hanya dapat meretur transaksi milik Anda sendiri', 403);
  if (sale.status !== 'paid') throw bad('Transaksi batal tidak dapat diretur');
  const reason = str(body.reason);
  if (!reason) throw bad('Alasan retur wajib diisi');
  const location = LOCATIONS.includes(body.location) ? body.location : 'display';
  if (!Array.isArray(body.items) || !body.items.length) throw bad('Pilih minimal satu barang yang diretur');
  const chosen = [];
  for (const row of body.items) {
    const saleItem = sale.items.find((x) => x.id === int(row.sale_item_id));
    const qty = int(row.qty);
    if (!saleItem || qty <= 0) throw bad('Detail barang retur tidak valid');
    if (qty > saleItem.remaining_qty) throw bad(`Jumlah retur ${saleItem.name} melebihi sisa yang dapat diretur (${saleItem.remaining_qty})`);
    const unitRefund = sale.subtotal > 0 ? Math.round(saleItem.price * sale.total / sale.subtotal) : 0; // proporsional terhadap total dibayar (setelah diskon, termasuk PPN)
    chosen.push({ saleItem, qty, unitRefund, restockQty: flag(row.restock, 1) ? qty : 0 });
  }
  const refund = chosen.reduce((n, x) => n + x.unitRefund * x.qty, 0);
  if (refund <= 0) throw bad('Nilai refund harus lebih dari 0');
  const already = sale.returned_total || 0;
  if (already + refund > sale.total) throw bad('Total refund melebihi nilai bersih transaksi. Periksa pembulatan diskon atau jumlah retur.');
  const returnNo = nextNumber('RET', 'sale_returns', 'return_no');
  const expenseNo = nextNumber('KAS', 'cash_expenses', 'expense_no');
  const spentAt = ymd(new Date());
  const description = `Refund retur ${returnNo} · Invoice ${sale.invoice_no} · ${sale.customer_name || 'Customer'}`;
  const expenseId = Number(q.run(`INSERT INTO cash_expenses(expense_no,spent_at,category,description,amount,user_id)
    VALUES(?,?,?,?,?,?)`, expenseNo, spentAt, 'Refund Retur Barang', description, refund, user.id).lastInsertRowid);
  const returnId = Number(q.run(`INSERT INTO sale_returns(return_no,sale_id,cash_expense_id,refund_amount,location,reason,note,user_id)
    VALUES(?,?,?,?,?,?,?,?)`, returnNo, sale.id, expenseId, refund, location, reason, nul(body.note), user.id).lastInsertRowid);
  for (const x of chosen) {
    q.run(`INSERT INTO sale_return_items(return_id,sale_item_id,product_id,name,qty,restock_qty,unit_refund)
      VALUES(?,?,?,?,?,?,?)`, returnId, x.saleItem.id, x.saleItem.product_id, x.saleItem.name, x.qty, x.restockQty, x.unitRefund);
    if (x.restockQty) moveStock({ productId: x.saleItem.product_id, location, delta: x.restockQty, type: 'sale_return', ref: returnNo, note: `Retur dari ${sale.invoice_no}`, userId: user.id });
  }
  audit(user, 'retur_penjualan', `${returnNo} · ${sale.invoice_no} · refund ${refund} · kas ${expenseNo}`);
  return getSaleReturn(returnId);
}));

// =====================================================================
//  PEMESANAN (ORDER)  — publik (toko online) & internal (telepon/WA)
// =====================================================================
function createOrder(body, userId, source) {
  const srcLoc = source === 'online' ? 'display' : (body.source_location || 'display');
  if (!LOCATIONS.includes(srcLoc)) throw bad('Lokasi pengambilan barang tidak valid');
  const name = str(body.customer_name), phone = str(body.phone);
  if (!name) throw bad('Nama wajib diisi');
  if (digits(phone).length < 8) throw bad('Nomor HP/WhatsApp tidak valid');
  const items = cleanItems(body.items);
  const method = PAY_METHODS.includes(body.payment_method) ? body.payment_method : 'transfer';
  return tx(() => {
    const lines = items.map((it) => {
      const p = q.get(`SELECT * FROM products WHERE id=? AND active=1 ${source === 'online' ? 'AND show_online=1' : ''}`, it.product_id);
      if (!p) throw bad('Ada produk yang tidak tersedia');
      return { p, qty: it.qty };
    });
    const subtotal = lines.reduce((a, l) => a + l.p.price * l.qty, 0);
    const discount = source === 'online' ? 0 : Math.max(0, int(body.discount));
    if (discount >= subtotal && discount > 0) throw bad('Diskon harus lebih kecil dari subtotal');
    const total = subtotal - discount;
    const order_no = nextNumber('ORD', 'orders', 'order_no');
    const id = Number(q.run(`INSERT INTO orders(order_no,source,customer_name,phone,address,notes,payment_method,total,discount,user_id,source_location) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      order_no, source, name, phone, nul(body.address), nul(body.notes), method, total, discount, userId, srcLoc).lastInsertRowid);
    const allowNeg = setting('allow_negative_stock') === '1';
    for (const l of lines) {
      q.run('INSERT INTO order_items(order_id,product_id,name,price,qty) VALUES(?,?,?,?,?)', id, l.p.id, l.p.name, l.p.price, l.qty);
      moveStock({ productId: l.p.id, location: srcLoc, delta: -l.qty, type: 'order', ref: order_no, userId, allowNegative: allowNeg });
    }
    return { id, order_no, total };
  });
}
// status bayar dihitung dari jumlah yang sudah diterima vs total nota (pembayaran bisa kapan saja, juga bertahap)
const payStatus = (total, paid) => (paid <= 0 ? 'belum' : paid >= total ? 'lunas' : 'sebagian');
function getOrder(id) {
  const o = q.get(`SELECT o.*, u.name AS handler, pk.name AS packed_by_name, fb.name AS final_by_name FROM orders o
    LEFT JOIN users u ON u.id=o.user_id LEFT JOIN users pk ON pk.id=o.packed_by LEFT JOIN users fb ON fb.id=o.final_by WHERE o.id=?`, id);
  if (!o) throw bad('Pesanan tidak ditemukan', 404);
  const items = q.all('SELECT * FROM order_items WHERE order_id=?', id);
  const invoice = o.si_id ? q.get('SELECT id,si_no,status,issued_at,void_reason FROM sales_invoices WHERE id=?', o.si_id) : null;
  return { ...o, items, subtotal: items.reduce((t, i) => t + i.price * i.qty, 0), remaining: Math.max(0, o.total - o.paid_amount),
    invoice, finalized: !!(invoice && invoice.status === 'terbit'),
    invoices: q.all('SELECT id,si_no,status,issued_at,void_reason,voided_at FROM sales_invoices WHERE order_id=? ORDER BY id DESC', id),
    sale: o.sale_id ? q.get('SELECT id,invoice_no FROM sales WHERE id=?', o.sale_id) : null };
}
// Transaksi penjualan (masuk laporan) tercatat begitu SO sudah final (SI terbit) DAN lunas, mana pun yang terjadi belakangan. Nomor invoice = nomor SI.
function ensureOrderSale(orderId, userId) {
  const o = getOrder(orderId);
  if (o.sale_id || !o.finalized || o.payment_status !== 'lunas') return o;
  const method = PAY_METHODS.includes(o.payment_method) && o.payment_method !== 'cod' ? o.payment_method : 'transfer';
  const saleId = Number(q.run(`INSERT INTO sales(invoice_no,channel,customer_name,customer_phone,subtotal,discount,total,paid,change_amount,payment_method,note,order_id,user_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, o.invoice.si_no, 'order', o.customer_name, o.phone, o.subtotal, o.discount, o.total, o.paid_amount, Math.max(0, o.paid_amount - o.total), method, 'SO ' + o.order_no, o.id, userId).lastInsertRowid);
  for (const it of o.items) {
    const p = q.get('SELECT cost FROM products WHERE id=?', it.product_id);
    q.run('INSERT INTO sale_items(sale_id,product_id,name,price,cost,qty) VALUES(?,?,?,?,?,?)', saleId, it.product_id, it.name, it.price, p ? p.cost : 0, it.qty);
  }
  q.run('UPDATE orders SET sale_id=? WHERE id=?', saleId, o.id);
  return getOrder(o.id);
}

// --- publik ---
GET('/api/public/info', null, () => { const s = allSettings(); return { store_name: s.store_name, store_address: s.store_address, store_phone: s.store_phone, bank_info: s.bank_info, qris_note: s.qris_note }; });
GET('/api/public/categories', null, () => q.all('SELECT id,name FROM categories ORDER BY name'));
GET('/api/public/products', null, ({ query }) => {
  const where = ['p.active=1', 'p.show_online=1']; const args = [];
  if (query.q) { where.push('p.name LIKE ?'); args.push(`%${query.q}%`); }
  if (query.category_id) { where.push('p.category_id=?'); args.push(int(query.category_id)); }
  return q.all(`SELECT p.id,p.name,p.description,p.image,p.price,p.unit,p.category_id,c.name AS category,
    ${QTYSQL('p.id', 'display')} AS stock
    FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE ${where.join(' AND ')} ORDER BY p.name LIMIT 500`, ...args);
});
// pembatas: cegah pesanan palsu beruntun yang mengunci stok
const orderHits = new Map();
function limitOrders(ip) {
  const now = Date.now(); const max = parseInt(process.env.ORDER_LIMIT || '8', 10);
  const hits = (orderHits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (hits.length >= max) throw bad('Terlalu banyak pesanan dari perangkat ini. Coba lagi beberapa menit lagi atau hubungi toko lewat WhatsApp.', 429);
  hits.push(now); orderHits.set(ip, hits);
}
POST('/api/public/orders', null, ({ req, body }) => {
  limitOrders(clientIp(req));
  const r = createOrder(body, null, 'online');
  return { order_no: r.order_no, total: r.total };
});
GET('/api/public/orders/:no', null, ({ params, query }) => {
  const o = q.get('SELECT * FROM orders WHERE order_no=?', str(params.no).toUpperCase());
  const a = digits(query.phone), b = o ? digits(o.phone) : '';
  if (!o || !a || a.slice(-8) !== b.slice(-8)) throw bad('Pesanan tidak ditemukan. Periksa nomor pesanan dan nomor HP.', 404);
  return { order_no: o.order_no, status: o.status, payment_status: o.payment_status, payment_method: o.payment_method, total: o.total, created_at: o.created_at,
    items: q.all('SELECT name,price,qty FROM order_items WHERE order_id=?', o.id) };
});

// Pesanan online yang tidak dibayar dalam N jam (pengaturan online_hold_hours; 0 = nonaktif) dibatalkan otomatis & stok dikembalikan.
// COD dikecualikan (dibayar saat barang tiba) dan pesanan yang sudah diproses staf tidak disentuh.
function expireOnlineOrders() {
  const hours = parseFloat(setting('online_hold_hours', '24'));
  if (!(hours > 0)) return 0;
  const rows = q.all(`SELECT id FROM orders WHERE source='online' AND status='baru' AND payment_status='belum' AND COALESCE(payment_method,'')<>'cod'
    AND created_at <= datetime('now','localtime',?)`, `-${Math.round(hours * 60)} minutes`);
  for (const r of rows) tx(() => {
    const o = getOrder(r.id);
    for (const it of o.items) moveStock({ productId: it.product_id, location: o.source_location || 'display', delta: it.qty, type: 'order_cancel', ref: o.order_no, note: 'Batal otomatis: belum dibayar', allowNegative: true });
    q.run("UPDATE orders SET status='batal', updated_at=datetime('now','localtime') WHERE id=?", o.id);
    audit(null, 'batal_otomatis', o.order_no);
  });
  return rows.length;
}

// --- internal ---
GET('/api/orders', 'pesanan', ({ query }) => {
  const where = ['1=1']; const args = [];
  if (query.status === 'aktif') where.push("status IN ('baru','diproses','dikirim')");
  else if (query.status) { where.push('status=?'); args.push(query.status); }
  if (query.q) { where.push('(order_no LIKE ? OR customer_name LIKE ? OR phone LIKE ?)'); const l = `%${query.q}%`; args.push(l, l, l); }
  return q.all(`SELECT o.*, (SELECT SUM(qty) FROM order_items WHERE order_id=o.id) AS items,
    (SELECT si_no FROM sales_invoices WHERE id=o.si_id AND status='terbit') AS si_no FROM orders o WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT 300`, ...args);
});
GET('/api/orders/:id', 'pesanan', ({ params }) => getOrder(int(params.id)));
POST('/api/orders', 'pesanan', ({ user, body }) => { const r = createOrder(body, user.id, body.source === 'wa' ? 'wa' : 'manual'); audit(user, 'buat_pesanan', r.order_no); return r; });
POST('/api/orders/:id/status', 'pesanan', ({ user, params, body }) => tx(() => {
  const o = getOrder(int(params.id));
  const to = body.status;
  if (!['baru', 'diproses', 'dikirim', 'selesai', 'batal'].includes(to)) throw bad('Status tidak valid');
  if (o.status === 'batal' || o.status === 'selesai') throw bad(`Pesanan sudah ${o.status}, tidak bisa diubah`);
  if (to === 'selesai' && o.payment_status !== 'lunas') throw bad('Catat pembayaran terlebih dahulu sebelum menyelesaikan pesanan');
  if (to === 'batal') {
    if (!hasPerm(user, 'pesanan.batal_lunas') && o.paid_amount > 0) throw bad('SO yang sudah dibayar (penuh atau sebagian) hanya bisa dibatalkan oleh yang berhak', 403);
    if (o.finalized) q.run("UPDATE sales_invoices SET status='void', void_reason='SO dibatalkan', voided_by=?, voided_at=datetime('now','localtime') WHERE id=?", user.id, o.si_id);
    for (const it of o.items) moveStock({ productId: it.product_id, location: o.source_location || 'display', delta: it.qty, type: 'order_cancel', ref: o.order_no, userId: user.id, allowNegative: true });
    if (o.sale_id) q.run("UPDATE sales SET status='void', void_reason=? WHERE id=?", 'Pesanan ' + o.order_no + ' dibatalkan', o.sale_id);
  }
  q.run("UPDATE orders SET status=?, updated_at=datetime('now','localtime') WHERE id=?", to, o.id);
  audit(user, 'status_pesanan', `${o.order_no} ${o.status}->${to}`);
  return getOrder(o.id);
}));
POST('/api/orders/:id/pay', 'pesanan', ({ user, params, body }) => tx(() => {
  const o = getOrder(int(params.id));
  if (o.status === 'batal') throw bad('SO sudah dibatalkan');
  if (o.payment_status === 'lunas') throw bad('SO sudah lunas');
  const method = PAY_METHODS.includes(body.method) && body.method !== 'cod' ? body.method : 'transfer';
  const amount = body.amount === undefined || body.amount === null || body.amount === '' ? o.remaining : int(body.amount);
  if (!(amount > 0)) throw bad('Jumlah pembayaran harus lebih dari 0');
  if (amount > o.remaining) throw bad(`Jumlah pembayaran melebihi sisa tagihan (${o.remaining})`);
  const paid = o.paid_amount + amount;
  recordPayment('order', o.id, method, amount, nul(body.note), user.id);
  q.run(`UPDATE orders SET paid_amount=?, payment_status=?, payment_method=?, status=CASE WHEN status='baru' THEN 'diproses' ELSE status END, updated_at=datetime('now','localtime') WHERE id=?`,
    paid, payStatus(o.total, paid), method, o.id);
  audit(user, 'bayar_pesanan', `${o.order_no} ${method} ${amount}${paid >= o.total ? ' (lunas)' : ''}`);
  return ensureOrderSale(o.id, user.id);
}));

// Edit nota: hanya selama SO belum difinalkan. Selisih qty langsung menyesuaikan stok yang sudah dipesan dari lokasi pengambilan.
PUT('/api/orders/:id', 'pesanan.edit', ({ user, params, body }) => tx(() => {
  const o = getOrder(int(params.id));
  if (o.status === 'batal' || o.status === 'selesai') throw bad(`SO sudah ${o.status}, tidak bisa diedit`);
  if (o.finalized) throw bad(`SO sudah difinalkan (Sales Invoice ${o.invoice.si_no} terbit), nota terkunci. Buka kembali final bila perlu mengedit`);
  const name = body.customer_name !== undefined ? str(body.customer_name) : o.customer_name;
  const phone = body.phone !== undefined ? str(body.phone) : o.phone;
  if (!name) throw bad('Nama wajib diisi');
  if (digits(phone).length < 8) throw bad('Nomor HP/WhatsApp tidak valid');
  const oldQty = new Map(o.items.map((i) => [i.product_id, i]));
  let lines = o.items.map((i) => ({ product_id: i.product_id, name: i.name, price: i.price, qty: i.qty }));
  if (body.items !== undefined) {
    if (!Array.isArray(body.items) || !body.items.length) throw bad('Minimal satu barang');
    const map = new Map();
    for (const it of body.items) {
      const pid = int(it.product_id), qty = int(it.qty);
      if (!pid || qty <= 0) throw bad('Jumlah barang harus lebih dari 0');
      if (map.has(pid)) { map.get(pid).qty += qty; continue; }
      const prev = oldQty.get(pid), p = q.get('SELECT * FROM products WHERE id=?', pid);
      if (!prev && (!p || !p.active)) throw bad('Ada produk yang tidak tersedia');
      const price = it.price !== undefined && it.price !== null && it.price !== '' ? int(it.price, -1) : (prev ? prev.price : p.price);
      if (price < 0) throw bad('Harga tidak valid');
      map.set(pid, { product_id: pid, name: prev ? prev.name : p.name, price, qty });
    }
    lines = [...map.values()];
  }
  const subtotal = lines.reduce((t, l) => t + l.price * l.qty, 0);
  const discount = body.discount !== undefined ? Math.max(0, int(body.discount)) : o.discount;
  if (discount >= subtotal) throw bad('Diskon harus lebih kecil dari subtotal');
  const total = subtotal - discount;
  const allowNeg = setting('allow_negative_stock') === '1';
  const newQty = new Map(lines.map((l) => [l.product_id, l.qty]));
  for (const pid of new Set([...oldQty.keys(), ...newQty.keys()])) {
    const diff = (oldQty.get(pid)?.qty || 0) - (newQty.get(pid) || 0);   // + = barang dikembalikan ke stok, - = tambah dipesan
    if (!diff) continue;
    moveStock({ productId: pid, location: o.source_location || 'display', delta: diff, type: diff < 0 ? 'order' : 'order_cancel', ref: o.order_no, note: 'Edit nota SO', userId: user.id, allowNegative: diff > 0 ? true : allowNeg });
  }
  q.run('DELETE FROM order_items WHERE order_id=?', o.id);
  for (const l of lines) q.run('INSERT INTO order_items(order_id,product_id,name,price,qty) VALUES(?,?,?,?,?)', o.id, l.product_id, l.name, l.price, l.qty);
  q.run(`UPDATE orders SET customer_name=?, phone=?, address=?, notes=?, discount=?, total=?, payment_status=?, updated_at=datetime('now','localtime') WHERE id=?`,
    name, phone, body.address !== undefined ? nul(body.address) : o.address, body.notes !== undefined ? nul(body.notes) : o.notes, discount, total, payStatus(total, o.paid_amount), o.id);
  audit(user, 'edit_nota_so', `${o.order_no}: total ${o.total}->${total}`);
  return getOrder(o.id);
}));

// Finalkan SO: nota terkunci dan Sales Invoice (SI) terbit. Tidak butuh syarat packing atau pembayaran.
POST('/api/orders/:id/finalize', 'pesanan.final', ({ user, params }) => tx(() => {
  const o = getOrder(int(params.id));
  if (o.status === 'batal') throw bad('SO sudah dibatalkan');
  if (o.finalized) throw bad(`SO sudah difinalkan (Sales Invoice ${o.invoice.si_no})`);
  if (!o.items.length) throw bad('SO belum punya barang');
  const si_no = nextNumber('SI', 'sales_invoices', 'si_no');
  const siId = Number(q.run(`INSERT INTO sales_invoices(si_no,order_id,customer_name,customer_phone,address,notes,subtotal,discount,total,items_json,issued_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`, si_no, o.id, o.customer_name, o.phone, o.address, o.notes, o.subtotal, o.discount, o.total,
    JSON.stringify(o.items.map((i) => ({ product_id: i.product_id, name: i.name, price: i.price, qty: i.qty }))), user.id).lastInsertRowid);
  q.run(`UPDATE orders SET si_id=?, final_at=datetime('now','localtime'), final_by=?, status=CASE WHEN status='baru' THEN 'diproses' ELSE status END, updated_at=datetime('now','localtime') WHERE id=?`, siId, user.id, o.id);
  audit(user, 'final_so', `${o.order_no} -> ${si_no}`);
  return ensureOrderSale(o.id, user.id);
}));
// Buka kembali final: SI dibatalkan (void, nomornya tidak dipakai lagi) dan nota bisa diedit. Tidak bisa bila SO sudah lunas dan tercatat sebagai penjualan.
POST('/api/orders/:id/reopen', 'pesanan.final', ({ user, params, body }) => tx(() => {
  const o = getOrder(int(params.id));
  if (!o.finalized) throw bad('SO belum difinalkan');
  if (o.status === 'batal' || o.status === 'selesai') throw bad(`SO sudah ${o.status}`);
  if (o.sale_id) throw bad('SO sudah lunas dan tercatat sebagai penjualan, final tidak bisa dibuka. Batalkan SO bila perlu');
  const reason = str(body.reason);
  if (!reason) throw bad('Alasan membuka kembali wajib diisi');
  q.run("UPDATE sales_invoices SET status='void', void_reason=?, voided_by=?, voided_at=datetime('now','localtime') WHERE id=?", reason, user.id, o.si_id);
  q.run("UPDATE orders SET si_id=NULL, final_at=NULL, final_by=NULL, updated_at=datetime('now','localtime') WHERE id=?", o.id);
  audit(user, 'buka_final_so', `${o.order_no} ${o.invoice.si_no}: ${reason}`);
  return getOrder(o.id);
}));

// Tim SO menandai pesanan selesai dikemas (penanda saja; tidak menjadi syarat Finalkan SO / terbit SI).
POST('/api/orders/:id/pack', 'pesanan.packing', ({ user, params, body }) => tx(() => {
  const o = getOrder(int(params.id));
  if (o.status === 'batal') throw bad('Pesanan sudah dibatalkan, status packing tidak bisa diubah');
  const undo = body.packed === false;
  if (undo && !o.packed_at) throw bad('Pesanan belum ditandai selesai packing');
  if (!undo && o.packed_at) throw bad('Pesanan sudah ditandai selesai packing');
  if (undo) q.run("UPDATE orders SET packed_at=NULL, packed_by=NULL, updated_at=datetime('now','localtime') WHERE id=?", o.id);
  else q.run("UPDATE orders SET packed_at=datetime('now','localtime'), packed_by=?, updated_at=datetime('now','localtime') WHERE id=?", user.id, o.id);
  audit(user, undo ? 'batal_packing_pesanan' : 'packing_pesanan', o.order_no);
  return getOrder(o.id);
}));
// Data Sales Invoice (SI) untuk dicetak. Bisa setelah SO difinalkan; status bayar diambil saat dicetak (lunas / sebagian / belum).
GET('/api/orders/:id/invoice', 'pesanan.invoice', ({ user, params }) => {
  const o = getOrder(int(params.id));
  if (o.status === 'batal') throw bad('SO sudah dibatalkan');
  if (!o.finalized) throw bad('Sales Invoice belum terbit. Finalkan SO terlebih dahulu');
  const si = q.get('SELECT * FROM sales_invoices WHERE id=?', o.si_id);
  const issuer = si.issued_by ? q.get('SELECT name FROM users WHERE id=?', si.issued_by) : null;
  audit(user, 'cetak_invoice_so', `${o.order_no} ${si.si_no}`);
  return { doc_title: 'SALES INVOICE', invoice_no: si.si_no, order_no: o.order_no, created_at: si.issued_at, status: 'terbit',
    customer_name: si.customer_name, customer_phone: si.customer_phone, address: si.address, notes: si.notes,
    items: JSON.parse(si.items_json || '[]'), subtotal: si.subtotal, discount: si.discount, total: si.total,
    pay_status: o.payment_status, paid_amount: o.paid_amount, remaining: o.remaining, payment_method: o.payment_method,
    cashier: issuer ? issuer.name : null, store: allSettings() };
});

// =====================================================================
//  DATA PELANGGAN
// =====================================================================
GET('/api/customers', ['customer', 'kasir', 'pesanan'], () => q.all('SELECT * FROM customers WHERE active=1 ORDER BY name'));
POST('/api/customers', 'customer', ({ user, body }) => {
  const name = str(body.name);
  if (!name) throw bad('Nama pelanggan wajib diisi');
  const id = Number(q.run('INSERT INTO customers(name,phone,address,notes) VALUES(?,?,?,?)',
    name, nul(body.phone), nul(body.address), nul(body.notes)).lastInsertRowid);
  audit(user, 'tambah_pelanggan', name);
  return { id };
});
PUT('/api/customers/:id', 'customer', ({ user, params, body }) => {
  const id = int(params.id), name = str(body.name);
  if (!name) throw bad('Nama pelanggan wajib diisi');
  const r = q.run('UPDATE customers SET name=?,phone=?,address=?,notes=? WHERE id=? AND active=1',
    name, nul(body.phone), nul(body.address), nul(body.notes), id);
  if (!r.changes) throw bad('Pelanggan tidak ditemukan', 404);
  audit(user, 'ubah_pelanggan', name);
  return { ok: true };
});
DEL('/api/customers/:id', 'customer', ({ user, params }) => {
  const c = q.get('SELECT name FROM customers WHERE id=? AND active=1', int(params.id));
  if (!c) throw bad('Pelanggan tidak ditemukan', 404);
  q.run('UPDATE customers SET active=0 WHERE id=?', int(params.id));
  audit(user, 'arsip_pelanggan', c.name);
  return { ok: true };
});

// =====================================================================
//  SUPPLIER & PURCHASE ORDER
// =====================================================================
GET('/api/suppliers', ['supplier', 'po'], () => q.all('SELECT * FROM suppliers WHERE active=1 ORDER BY name'));
POST('/api/suppliers', 'supplier', ({ body }) => {
  if (!str(body.name)) throw bad('Nama supplier wajib diisi');
  return { id: Number(q.run('INSERT INTO suppliers(name,phone,address) VALUES(?,?,?)', str(body.name), nul(body.phone), nul(body.address)).lastInsertRowid) };
});
PUT('/api/suppliers/:id', 'supplier', ({ params, body }) => { q.run('UPDATE suppliers SET name=?,phone=?,address=? WHERE id=?', str(body.name), nul(body.phone), nul(body.address), int(params.id)); return { ok: true }; });
DEL('/api/suppliers/:id', 'supplier', ({ params }) => { q.run('UPDATE suppliers SET active=0 WHERE id=?', int(params.id)); return { ok: true }; });

function poItems(poId) {
  return q.all(`SELECT i.*, p.name, p.sku, p.unit FROM po_items i JOIN products p ON p.id=i.product_id WHERE i.po_id=? ORDER BY i.id`, poId);
}
function getPO(id) {
  const po = q.get(`SELECT po.*, s.name AS supplier, s.phone AS supplier_phone, c.name AS created_by_name, a.name AS approved_by_name
    FROM purchase_orders po LEFT JOIN suppliers s ON s.id=po.supplier_id LEFT JOIN users c ON c.id=po.created_by LEFT JOIN users a ON a.id=po.approved_by WHERE po.id=?`, id);
  if (!po) throw bad('PO tidak ditemukan', 404);
  const items = poItems(id);
  const revisions = q.all('SELECT r.id,r.revision,r.note,r.snapshot,r.created_at,u.name AS user FROM po_revisions r LEFT JOIN users u ON u.id=r.user_id WHERE r.po_id=? ORDER BY r.id DESC', id)
    .map((r) => ({ ...r, snapshot: JSON.parse(r.snapshot) }));
  return { ...po, items, total: items.reduce((a, i) => a + i.qty * i.cost, 0), revisions, store: allSettings() };
}
GET('/api/suppliers/:id/purchases', 'supplier', ({ params }) => {
  const supplierId = int(params.id);
  const supplier = q.get('SELECT id,name FROM suppliers WHERE id=?', supplierId);
  if (!supplier) throw bad('Supplier tidak ditemukan', 404);
  const orders = q.all(`SELECT po.id, po.po_number, po.created_at, po.status,
    COALESCE((SELECT SUM(qty*cost) FROM po_items WHERE po_id=po.id),0) AS total
    FROM purchase_orders po WHERE po.supplier_id=? ORDER BY po.created_at DESC, po.id DESC`, supplierId);
  return { supplier, orders: orders.map((po) => ({ ...po,
    items: poItems(po.id).map((i) => ({ name: i.name, qty: i.qty, unit: i.unit }))
  })), total: orders.reduce((sum, po) => sum + po.total, 0) };
});

function poItemsInput(items) {
  if (!Array.isArray(items) || !items.length) throw bad('PO harus berisi minimal satu barang');
  const seen = new Set();
  return items.map((it) => {
    const pid = int(it.product_id), qty = int(it.qty), cost = int(it.cost);
    if (!q.get('SELECT id FROM products WHERE id=?', pid)) throw bad('Ada produk yang tidak valid');
    if (qty <= 0) throw bad('Jumlah barang harus lebih dari 0');
    if (cost < 0) throw bad('Harga beli tidak boleh negatif');
    if (seen.has(pid)) throw bad('Barang yang sama tidak boleh muncul dua kali di satu PO');
    seen.add(pid);
    return { product_id: pid, qty, cost };
  });
}
GET('/api/po', 'po', ({ query }) => {
  const where = ['1=1']; const args = [];
  if (query.status === 'open') where.push("po.status IN ('draft','submitted','approved','partial')");
  else if (query.status) { where.push('po.status=?'); args.push(query.status); }
  return q.all(`SELECT po.*, s.name AS supplier, u.name AS created_by_name,
    (SELECT COALESCE(SUM(qty*cost),0) FROM po_items WHERE po_id=po.id) AS total,
    (SELECT COUNT(*) FROM po_items WHERE po_id=po.id) AS lines
    FROM purchase_orders po LEFT JOIN suppliers s ON s.id=po.supplier_id LEFT JOIN users u ON u.id=po.created_by
    WHERE ${where.join(' AND ')} ORDER BY po.id DESC LIMIT 300`, ...args);
});
GET('/api/po/:id', 'po', ({ params }) => getPO(int(params.id)));
// PENERIMAAN BARANG untuk peran Gudang: hanya PO yang sudah disetujui, tanpa harga beli / total
GET('/api/receiving/po', 'terima', () => q.all(`SELECT po.id, po.po_number, po.status, po.expected_date, po.notes, s.name AS supplier,
  (SELECT COUNT(*) FROM po_items WHERE po_id=po.id) AS lines,
  (SELECT COALESCE(SUM(qty-received_qty),0) FROM po_items WHERE po_id=po.id) AS remaining
  FROM purchase_orders po LEFT JOIN suppliers s ON s.id=po.supplier_id WHERE po.status IN ('approved','partial') ORDER BY po.id DESC LIMIT 200`));
GET('/api/receiving/po/:id', 'terima', ({ params }) => {
  const po = getPO(int(params.id));
  if (!['approved', 'partial'].includes(po.status)) throw bad('PO ini tidak sedang menunggu penerimaan barang', 404);
  return { id: po.id, po_number: po.po_number, status: po.status, supplier: po.supplier, expected_date: po.expected_date, notes: po.notes,
    items: po.items.map((i) => ({ id: i.id, product_id: i.product_id, name: i.name, sku: i.sku, unit: i.unit, qty: i.qty, received_qty: i.received_qty })) };
});
POST('/api/po', 'po', ({ user, body }) => tx(() => {
  const items = poItemsInput(body.items);
  if (body.supplier_id && !q.get('SELECT id FROM suppliers WHERE id=?', int(body.supplier_id))) throw bad('Supplier tidak valid');
  const number = nextNumber('PO', 'purchase_orders', 'po_number');
  const status = body.submit ? 'submitted' : 'draft';
  const id = Number(q.run('INSERT INTO purchase_orders(po_number,supplier_id,status,notes,expected_date,created_by) VALUES(?,?,?,?,?,?)',
    number, body.supplier_id ? int(body.supplier_id) : null, status, nul(body.notes), nul(body.expected_date), user.id).lastInsertRowid);
  for (const it of items) q.run('INSERT INTO po_items(po_id,product_id,qty,cost) VALUES(?,?,?,?)', id, it.product_id, it.qty, it.cost);
  audit(user, 'buat_po', number);
  return getPO(id);
}));
// REVISI PO: ganti seluruh daftar barang (tambah / ubah / hapus baris), simpan snapshot versi sebelumnya
PUT('/api/po/:id', 'po', ({ user, params, body }) => tx(() => {
  const po = getPO(int(params.id));
  if (!['draft', 'submitted', 'approved'].includes(po.status)) throw bad(`PO berstatus "${po.status}" tidak dapat direvisi`);
  const items = poItemsInput(body.items);
  const snapshot = { supplier_id: po.supplier_id, supplier: po.supplier, notes: po.notes, expected_date: po.expected_date, status: po.status,
    items: po.items.map((i) => ({ product_id: i.product_id, name: i.name, sku: i.sku, qty: i.qty, cost: i.cost })) };
  const newRev = po.revision + 1;
  q.run('INSERT INTO po_revisions(po_id,revision,snapshot,note,user_id) VALUES(?,?,?,?,?)', po.id, po.revision, JSON.stringify(snapshot), nul(body.revision_note), user.id);
  q.run('DELETE FROM po_items WHERE po_id=?', po.id);
  for (const it of items) q.run('INSERT INTO po_items(po_id,product_id,qty,cost) VALUES(?,?,?,?)', po.id, it.product_id, it.qty, it.cost);
  const status = po.status === 'approved' ? 'submitted' : po.status; // revisi PO yang sudah disetujui harus disetujui ulang
  q.run("UPDATE purchase_orders SET supplier_id=?, notes=?, expected_date=?, revision=?, status=?, approved_by=CASE WHEN ?='submitted' AND status='approved' THEN NULL ELSE approved_by END, updated_at=datetime('now','localtime') WHERE id=?",
    body.supplier_id ? int(body.supplier_id) : po.supplier_id, body.notes === undefined ? po.notes : nul(body.notes), body.expected_date === undefined ? po.expected_date : nul(body.expected_date), newRev, status, status, po.id);
  audit(user, 'revisi_po', `${po.po_number} rev ${newRev}${status !== po.status ? ' (perlu disetujui ulang)' : ''}`);
  return getPO(po.id);
}));
const PO_FLOW = { draft: ['submitted', 'cancelled'], submitted: ['approved', 'draft', 'cancelled'], approved: ['cancelled'], partial: ['cancelled'] };
POST('/api/po/:id/status', 'po', ({ user, params, body }) => tx(() => {
  const po = getPO(int(params.id));
  const to = body.status;
  if (!(PO_FLOW[po.status] || []).includes(to)) throw bad(`Status PO tidak dapat diubah dari "${po.status}" ke "${to}"`);
  if (po.status === 'partial' && to === 'cancelled') { /* sisa yang belum datang dibatalkan; stok yang sudah masuk tetap */ }
  q.run("UPDATE purchase_orders SET status=?, approved_by=?, updated_at=datetime('now','localtime') WHERE id=?", to, to === 'approved' ? user.id : (to === 'submitted' || to === 'draft' ? null : po.approved_by), po.id);
  audit(user, 'status_po', `${po.po_number} ${po.status}->${to}`);
  return getPO(po.id);
}));
// TERIMA BARANG: stok masuk ke GUDANG
POST('/api/po/:id/receive', 'terima', ({ user, params, body }) => tx(() => {
  const po = getPO(int(params.id));
  if (!['approved', 'partial'].includes(po.status)) throw bad('PO harus berstatus disetujui sebelum barang diterima');
  const dest = ['gudang_ruko', 'gudang_toko'].includes(body.location) ? body.location : 'gudang_ruko';
  const recv = (body.items || []).map((x) => ({ item_id: int(x.item_id), qty: int(x.qty) })).filter((x) => x.qty > 0);
  if (!recv.length) throw bad('Isi jumlah barang yang diterima');
  for (const r of recv) {
    const it = po.items.find((i) => i.id === r.item_id);
    if (!it) throw bad('Baris PO tidak valid');
    if (r.qty > it.qty - it.received_qty) throw bad(`Jumlah diterima untuk "${it.name}" melebihi sisa pesanan (${it.qty - it.received_qty})`);
    moveStock({ productId: it.product_id, location: dest, delta: r.qty, type: 'po_in', ref: po.po_number, note: nul(body.note), userId: user.id });
    q.run('UPDATE po_items SET received_qty=received_qty+? WHERE id=?', r.qty, it.id);
    if (it.cost > 0) q.run('UPDATE products SET cost=? WHERE id=?', it.cost, it.product_id); // harga beli terakhir
  }
  const left = q.get('SELECT COUNT(*) AS n FROM po_items WHERE po_id=? AND received_qty<qty', po.id).n;
  q.run("UPDATE purchase_orders SET status=?, updated_at=datetime('now','localtime') WHERE id=?", left ? 'partial' : 'received', po.id);
  audit(user, 'terima_po', `${po.po_number}${left ? ' (sebagian)' : ' (lengkap)'}`);
  return hasPerm(user, ['po', 'harga_beli']) ? getPO(po.id) : { ok: true, status: left ? 'partial' : 'received' }; // yang tak berhak tidak melihat harga beli
}));
DEL('/api/po/:id', 'po', ({ user, params }) => {
  const po = getPO(int(params.id));
  if (!['draft', 'cancelled'].includes(po.status)) throw bad('Hanya PO draft/batal yang bisa dihapus');
  q.run('DELETE FROM purchase_orders WHERE id=?', po.id);
  audit(user, 'hapus_po', po.po_number);
  return { ok: true };
});

// =====================================================================
//  DASHBOARD & LAPORAN
// =====================================================================
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

GET('/api/dashboard', 'dashboard', ({ user }) => {
  const S = "status='paid'";
  const today = q.get(`SELECT COUNT(*) AS trx, COALESCE(SUM(total-tax_amount),0) AS revenue FROM sales WHERE ${S} AND date(created_at)=date('now','localtime')`);
  const todayItems = q.get(`SELECT COALESCE(SUM(si.qty),0) AS n FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.${S} AND date(s.created_at)=date('now','localtime')`).n;
  const month = q.get(`SELECT COUNT(*) AS trx, COALESCE(SUM(total-tax_amount),0) AS revenue FROM sales WHERE ${S} AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now','localtime')`);
  const days = 14; const series = [];
  const rows = q.all(`SELECT date(created_at) AS d, COUNT(*) AS trx, SUM(total-tax_amount) AS revenue FROM sales WHERE ${S} AND date(created_at)>=date('now','localtime','-${days - 1} days') GROUP BY d`);
  const byDay = Object.fromEntries(rows.map((r) => [r.d, r]));
  for (let i = days - 1; i >= 0; i--) { const dt = new Date(); dt.setDate(dt.getDate() - i); const k = ymd(dt); series.push({ date: k, trx: byDay[k]?.trx || 0, revenue: byDay[k]?.revenue || 0 }); }
  const top = q.all(`SELECT si.name, SUM(si.qty) AS qty, SUM(si.qty*si.price) AS revenue FROM sale_items si JOIN sales s ON s.id=si.sale_id
    WHERE s.${S} AND date(s.created_at)>=date('now','localtime','-29 days') GROUP BY si.product_id ORDER BY qty DESC LIMIT 5`);
  const low = q.all(`${PRODUCT_SELECT} WHERE p.active=1 AND display_qty <= p.min_stock ORDER BY display_qty ASC LIMIT 10`)
    .map((r) => ({ id: r.id, name: r.name, sku: r.sku, display_qty: r.display_qty, gt_qty: r.gt_qty, gr_qty: r.gr_qty, min_stock: r.min_stock }));
  const byMethod = q.all(`SELECT payment_method AS method, COUNT(*) AS trx, SUM(total) AS revenue FROM sales WHERE ${S} AND date(created_at)=date('now','localtime') GROUP BY payment_method`);
  const orders = q.get(`SELECT SUM(status IN ('baru','diproses','dikirim')) AS aktif, SUM(status='baru') AS baru, SUM(status NOT IN ('batal','selesai') AND payment_status<>'lunas') AS belum_bayar FROM orders`);
  const out = { today: { ...today, items: todayItems }, month, series, top, low, by_method: byMethod, orders: { aktif: orders.aktif || 0, baru: orders.baru || 0, belum_bayar: orders.belum_bayar || 0 },
    recent: q.all(`SELECT id,invoice_no,total,payment_method,channel,status,created_at FROM sales ORDER BY id DESC LIMIT 8`) };
  if (hasPerm(user, 'po')) out.po_open = q.get("SELECT COUNT(*) AS n FROM purchase_orders WHERE status IN ('submitted','approved','partial')").n;
  if (hasPerm(user, 'harga_beli')) out.stock_value = q.get(`SELECT COALESCE(SUM(CASE WHEN st.location='display' THEN st.qty*p.cost END),0) AS display, COALESCE(SUM(CASE WHEN st.location='gudang_toko' THEN st.qty*p.cost END),0) AS gudang_toko, COALESCE(SUM(CASE WHEN st.location='gudang_ruko' THEN st.qty*p.cost END),0) AS gudang_ruko FROM stock st JOIN products p ON p.id=st.product_id WHERE p.active=1`);
  return out;
});

// =====================================================================
//  PENGELUARAN KAS
// =====================================================================
const CASH_CATEGORIES = ['Operasional', 'Ongkir / transport', 'Perlengkapan (plastik, kertas, dll)', 'Konsumsi', 'Gaji / uang makan', 'Listrik / air / internet', 'Lain-lain'];
GET('/api/cash-categories', 'kas', () => CASH_CATEGORIES);
POST('/api/cash-expenses', 'kas', ({ user, body }) => {
  const amount = int(body.amount), category = str(body.category);
  if (amount <= 0) throw bad('Jumlah pengeluaran harus lebih dari 0');
  if (!category) throw bad('Kategori wajib diisi');
  if (!str(body.description)) throw bad('Keterangan wajib diisi');
  const spent = /^\d{4}-\d{2}-\d{2}$/.test(body.spent_at || '') ? body.spent_at : ymd(new Date());
  const no = nextNumber('KAS', 'cash_expenses', 'expense_no');
  const id = Number(q.run('INSERT INTO cash_expenses(expense_no,spent_at,category,description,amount,user_id) VALUES(?,?,?,?,?,?)', no, spent, category, str(body.description), amount, user.id).lastInsertRowid);
  audit(user, 'pengeluaran_kas', `${no} ${category} ${amount}`);
  return q.get('SELECT * FROM cash_expenses WHERE id=?', id);
});
// pencatat hanya melihat catatannya sendiri hari ini (supaya salah input bisa dicek); laporan lengkap lewat /api/reports/cash
GET('/api/cash-expenses/mine', 'kas', ({ user }) => q.all("SELECT * FROM cash_expenses WHERE user_id=? AND date(created_at)=date('now','localtime') ORDER BY id DESC", user.id));
function cashReport(from, to) {
  const W = 'date(e.spent_at)>=? AND date(e.spent_at)<=?';
  const total = q.get(`SELECT COUNT(*) AS n, COALESCE(SUM(e.amount),0) AS total FROM cash_expenses e WHERE ${W}`, from, to);
  return { from, to, total,
    by_category: q.all(`SELECT e.category, COUNT(*) AS n, SUM(e.amount) AS total FROM cash_expenses e WHERE ${W} GROUP BY e.category ORDER BY total DESC`, from, to),
    daily: q.all(`SELECT e.spent_at AS date, COUNT(*) AS n, SUM(e.amount) AS total FROM cash_expenses e WHERE ${W} GROUP BY e.spent_at ORDER BY e.spent_at`, from, to),
    rows: q.all(`SELECT e.*, u.name AS user_name FROM cash_expenses e LEFT JOIN users u ON u.id=e.user_id WHERE ${W} ORDER BY e.spent_at DESC, e.id DESC LIMIT 2000`, from, to) };
}

function salesReport(from, to) {
  const W = "s.status='paid' AND date(s.created_at)>=? AND date(s.created_at)<=?";
  const totals = q.get(`SELECT COUNT(*) AS trx, COALESCE(SUM(s.subtotal),0) AS gross, COALESCE(SUM(s.discount),0) AS discount, COALESCE(SUM(s.total),0) AS revenue FROM sales s WHERE ${W}`, from, to);
  const agg = q.get(`SELECT COALESCE(SUM(si.qty),0) AS items, COALESCE(SUM(si.qty*si.cost),0) AS cogs FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE ${W}`, from, to);
  const returns = q.get(`SELECT COUNT(*) AS n, COALESCE(SUM(refund_amount),0) AS total,
    COALESCE((SELECT SUM(sri.qty) FROM sale_return_items sri JOIN sale_returns sr ON sr.id=sri.return_id WHERE date(sr.created_at)>=? AND date(sr.created_at)<=?),0) AS qty
    FROM sale_returns WHERE date(created_at)>=? AND date(created_at)<=?`, from, to, from, to);
  const returnItems = q.get(`SELECT COALESCE(SUM(sri.qty),0) AS qty, COALESCE(SUM(sri.restock_qty*si.cost),0) AS restocked_cogs
    FROM sale_return_items sri JOIN sale_returns sr ON sr.id=sri.return_id JOIN sale_items si ON si.id=sri.sale_item_id
    WHERE date(sr.created_at)>=? AND date(sr.created_at)<=?`, from, to);
  // PPN yang dipungut bukan pendapatan toko: dipisahkan dari omzet & laba. Refund (retur) mengurangi PPN secara proporsional.
  const taxGross = q.get(`SELECT COALESCE(SUM(s.tax_amount),0) AS v FROM sales s WHERE ${W}`, from, to).v;
  const taxReturned = q.get(`SELECT COALESCE(SUM(ROUND(1.0*sr.refund_amount*s.tax_amount/s.total)),0) AS v FROM sale_returns sr JOIN sales s ON s.id=sr.sale_id
    WHERE s.total>0 AND s.tax_amount>0 AND date(sr.created_at)>=? AND date(sr.created_at)<=?`, from, to).v;
  const netTax = taxGross - taxReturned;
  const netRevenue = totals.revenue - returns.total - netTax;
  const netCogs = Math.max(0, agg.cogs - returnItems.restocked_cogs);
  const voided = q.get("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total FROM sales s WHERE s.status='void' AND date(s.created_at)>=? AND date(s.created_at)<=?", from, to);
  return {
    from, to, totals: { ...totals, ...agg, revenue: netRevenue, gross_revenue: totals.revenue, return_amount: returns.total, tax: netTax, tax_collected: taxGross, tax_returned: taxReturned,
      items: agg.items, cogs: netCogs, profit: netRevenue - netCogs,
      avg: totals.trx ? Math.round(netRevenue / totals.trx) : 0 }, returns, voided,
    daily: q.all(`SELECT date(s.created_at) AS date, COUNT(*) AS trx, SUM(s.total-s.tax_amount) AS revenue, SUM(s.discount) AS discount, SUM(s.tax_amount) AS tax FROM sales s WHERE ${W} GROUP BY date(s.created_at) ORDER BY date`, from, to),
    by_method: q.all(`SELECT s.payment_method AS method, COUNT(*) AS trx, SUM(s.total) AS revenue FROM sales s WHERE ${W} GROUP BY s.payment_method ORDER BY revenue DESC`, from, to),
    by_channel: q.all(`SELECT s.channel, COUNT(*) AS trx, SUM(s.total-s.tax_amount) AS revenue FROM sales s WHERE ${W} GROUP BY s.channel`, from, to),
    by_cashier: q.all(`SELECT COALESCE(u.name,'-') AS cashier, COUNT(*) AS trx, SUM(s.total-s.tax_amount) AS revenue FROM sales s LEFT JOIN users u ON u.id=s.user_id WHERE ${W} GROUP BY s.user_id ORDER BY revenue DESC`, from, to),
    by_product: q.all(`SELECT si.name, SUM(si.qty) AS qty, SUM(si.qty*si.price) AS revenue, SUM(si.qty*(si.price-si.cost)) AS profit FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE ${W} GROUP BY si.product_id ORDER BY revenue DESC LIMIT 100`, from, to),
  };
}
function rangeOf(query) {
  const now = new Date();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : ymd(now);
  return [from, to];
}
GET('/api/reports/sales', 'laporan.penjualan', ({ user, query }) => {
  const r = salesReport(...rangeOf(query));
  if (!hasPerm(user, 'laporan')) { // tanpa hak Laporan lengkap: HPP & laba disembunyikan
    delete r.totals.cogs; delete r.totals.profit;
    r.by_product = r.by_product.map(({ profit, ...rest }) => rest);
  }
  return r;
});
GET('/api/reports/cash', 'kas.laporan', ({ query }) => cashReport(...rangeOf(query)));
GET('/api/reports/stock', 'laporan', () => {
  const rows = q.all(`${PRODUCT_SELECT} WHERE p.active=1 ORDER BY p.name`).map((p) => ({ ...p, display_value: p.display_qty * p.cost, gt_value: p.gt_qty * p.cost, gr_value: p.gr_qty * p.cost }));
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  return { rows, totals: { display_value: sum('display_value'), gt_value: sum('gt_value'), gr_value: sum('gr_value'), display_qty: sum('display_qty'), gt_qty: sum('gt_qty'), gr_qty: sum('gr_qty') } };
});
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
GET('/api/reports/export', 'auth', ({ user, res, query }) => {
  const [from, to] = rangeOf(query);
  let header, rows, name;
  const need = query.type === 'cash' ? 'kas.laporan' : (query.type === 'stock' || query.type === 'items') ? 'laporan' : 'laporan.penjualan';
  if (!hasPerm(user, need)) throw bad('Anda tidak memiliki akses untuk fitur ini', 403);
  if (query.type === 'cash') {
    header = ['Tanggal', 'No. Kas', 'Kategori', 'Keterangan', 'Jumlah', 'Dicatat oleh'];
    rows = cashReport(from, to).rows.map((r) => [r.spent_at, r.expense_no, r.category, r.description, r.amount, r.user_name]);
    name = `pengeluaran-kas-${from}_${to}`;
  } else if (query.type === 'stock') {
    header = ['SKU', 'Barcode', 'Nama', 'Kategori', 'Stok Display Toko', 'Stok Gudang Toko', 'Stok Gudang Ruko', 'Min Stok Display', 'Harga Beli', 'Harga Jual', 'Nilai Stok (Beli)'];
    rows = q.all(`${PRODUCT_SELECT} WHERE p.active=1 ORDER BY p.name`).map((p) => [p.sku, p.barcode, p.name, p.category, p.display_qty, p.gt_qty, p.gr_qty, p.min_stock, p.cost, p.price, p.total_qty * p.cost]);
    name = 'stok-' + ymd(new Date());
  } else if (query.type === 'items') {
    header = ['Tanggal', 'Invoice', 'Produk', 'Qty', 'Harga', 'Subtotal', 'HPP', 'Laba'];
    rows = q.all(`SELECT s.created_at,s.invoice_no,si.name,si.qty,si.price,si.cost FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.status='paid' AND date(s.created_at)>=? AND date(s.created_at)<=? ORDER BY s.id`, from, to)
      .map((r) => [r.created_at, r.invoice_no, r.name, r.qty, r.price, r.qty * r.price, r.qty * r.cost, r.qty * (r.price - r.cost)]);
    name = `penjualan-per-item-${from}_${to}`;
  } else {
    header = ['Tanggal', 'Invoice', 'Kanal', 'Pelanggan', 'Kasir', 'Metode', 'Subtotal', 'Diskon (Rp, total)', 'Diskon (%) diinput', 'Setelah Diskon', 'Pajak (PPN)', 'Total', 'Status'];
    rows = q.all(`SELECT s.*, u.name AS cashier FROM sales s LEFT JOIN users u ON u.id=s.user_id WHERE date(s.created_at)>=? AND date(s.created_at)<=? ORDER BY s.id`, from, to)
      .map((s) => [s.created_at, s.invoice_no, s.channel, s.customer_name, s.cashier, s.payment_method, s.subtotal, s.discount, s.discount_pct || 0, s.subtotal - s.discount, s.tax_amount || 0, s.total, s.status]);
    name = `penjualan-${from}_${to}`;
  }
  const csv = '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
  send(res, 200, Buffer.from(csv, 'utf8'), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"`, 'Access-Control-Allow-Origin': '*' });
});

// =====================================================================
//  START
// =====================================================================
const isTailscale = (ip) => { const [a, b] = ip.split('.').map(Number); return a === 100 && b >= 64 && b <= 127; }; // 100.64.0.0/10 (CGNAT, dipakai Tailscale)
function lanAddresses() {
  return Object.values(require('os').networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => ({ ip: n.address, kind: isTailscale(n.address) ? 'tailscale' : 'lan' }));
}
function tlsFiles() {
  const certDir = path.join(__dirname, 'certs');
  const cert = process.env.TLS_CERT || path.join(certDir, 'cert.pem'), key = process.env.TLS_KEY || path.join(certDir, 'key.pem');
  return process.env.HTTPS !== '0' && fs.existsSync(cert) && fs.existsSync(key) ? { cert, key } : null;
}
function start() {
  const tls = tlsFiles(); const useHttps = !!tls;
  const HOST = process.env.HOST || '0.0.0.0'; // 127.0.0.1 = hanya bisa diakses lewat "tailscale serve" di komputer ini
  if (process.env.BACKUP_DIR) {
    runBackup(); console.log(`  Backup otomatis: ${process.env.BACKUP_DIR} (tiap ${process.env.BACKUP_EVERY_HOURS || 6} jam)`);
    setInterval(runBackup, Math.max(0.01, parseFloat(process.env.BACKUP_EVERY_HOURS || '6')) * 3600 * 1000).unref();
  }
  const every = parseInt(process.env.EXPIRE_CHECK_SEC || '600', 10) * 1000;
  setInterval(() => { try { const n = expireOnlineOrders(); if (n) console.log(`[otomatis] ${n} pesanan online belum dibayar dibatalkan, stok dikembalikan`); } catch (e) { console.error(e); } }, every).unref();
  const server = useHttps
    ? https.createServer({ key: fs.readFileSync(tls.key), cert: fs.readFileSync(tls.cert) }, handler)
    : http.createServer(handler);
  // Port tambahan HTTP biasa khusus komputer ini (127.0.0.1): "localhost" dianggap aman oleh browser sehingga tombol Install/PWA
  // dan kamera tetap jalan di PC server walau port utama memakai sertifikat buatan sendiri. Tidak terjangkau dari jaringan.
  const LP = parseInt(process.env.LOCAL_HTTP_PORT || '0', 10);
  if (LP && useHttps) http.createServer(handler).listen(LP, '127.0.0.1', () => console.log(`  PC ini (bisa di-Install): http://localhost:${LP}/admin/`));
  server.listen(PORT, HOST, () => {
    const proto = useHttps ? 'https' : 'http';
    console.log(`\n  Hosana berjalan!\n`);
    console.log(`  Toko online : ${proto}://localhost:${PORT}/`);
    console.log(`  Admin/Kasir : ${proto}://localhost:${PORT}/admin/`);
    if (HOST === '0.0.0.0') for (const n of lanAddresses()) console.log(`  ${n.kind === 'tailscale' ? 'Lewat Tailscale     ' : 'Dari HP (satu Wi-Fi)'}: ${proto}://${n.ip}:${PORT}/admin/`);
    else console.log(`  Hanya melayani ${HOST} (mode di belakang tailscale serve)`);
    if (process.env.PUBLIC_HOST) console.log(`  Alamat nama        : https://${process.env.PUBLIC_HOST}/admin/`);
    if (!useHttps) console.log(`\n  Catatan: kamera/scan barcode di HP butuh HTTPS. Lihat README (bagian "Scan barcode di HP").`);
    console.log('');
  });
}
if (require.main === module) start();
module.exports = { handler, expireOnlineOrders, backupNow };
