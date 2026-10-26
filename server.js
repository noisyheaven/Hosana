// Server HTTP + REST API (tanpa framework; hanya modul bawaan Node.js)
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const D = require('./db');
const { q, tx, moveStock, getQty, nextNumber, setting, allSettings, audit } = D;

D.seed();

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(D.DATA_DIR, 'uploads');
const RANK = { staf: 1, admin: 2, superadmin: 3 };
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

function currentUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  const u = q.get(`SELECT u.id,u.username,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token=? AND u.active=1 AND s.created_at > datetime('now','localtime','-7 days')`, token);
  return u ? { ...u, token } : null;
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

const loginFails = new Map();

async function handler(req, res) {
  const u = new URL(req.url, 'http://x');
  const pathname = decodeURIComponent(u.pathname);
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' };
  if (req.method === 'OPTIONS') return send(res, 204, '', cors);

  if (pathname.startsWith('/api/')) {
    try {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(pathname);
        if (!m) continue;
        const params = {}; r.keys.forEach((k, i) => (params[k] = m[i + 1]));
        let user = null;
        if (r.minRole) {
          user = currentUser(req);
          if (!user) throw bad('Sesi berakhir, silakan login kembali', 401);
          if (r.minRole !== 'auth' && RANK[user.role] < RANK[r.minRole]) throw bad('Anda tidak memiliki akses untuk fitur ini', 403);
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
POST('/api/login', null, ({ req, body }) => {
  const ip = req.socket.remoteAddress;
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
  return { token, user: { id: u.id, username: u.username, name: u.name, role: u.role } };
});
POST('/api/logout', 'auth', ({ user }) => { q.run('DELETE FROM sessions WHERE token=?', user.token); return { ok: true }; });
GET('/api/me', 'auth', ({ user }) => ({ id: user.id, username: user.username, name: user.name, role: user.role }));
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
GET('/api/users', 'superadmin', () => q.all('SELECT id,username,name,role,active,created_at FROM users ORDER BY id'));
POST('/api/users', 'superadmin', ({ user, body }) => {
  const username = str(body.username).toLowerCase();
  if (!/^[a-z0-9_.-]{3,30}$/.test(username)) throw bad('Username 3-30 karakter (huruf kecil, angka, . _ -)');
  if (!RANK[body.role]) throw bad('Role tidak valid');
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
  if (!RANK[role]) throw bad('Role tidak valid');
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
const SETTING_KEYS = ['store_name', 'store_address', 'store_phone', 'receipt_footer', 'bank_info', 'qris_note', 'allow_negative_stock', 'paper_width', 'online_hold_hours'];
GET('/api/settings', 'auth', () => allSettings());
PUT('/api/settings', 'superadmin', ({ user, body }) => {
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

// =====================================================================
//  KATEGORI, PRODUK, UPLOAD
// =====================================================================
GET('/api/categories', 'auth', () => q.all('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id=c.id AND p.active=1) AS products FROM categories c ORDER BY name'));
POST('/api/categories', 'admin', ({ user, body }) => {
  if (!str(body.name)) throw bad('Nama kategori wajib diisi');
  const r = q.run('INSERT INTO categories(name) VALUES(?)', str(body.name));
  audit(user, 'tambah_kategori', body.name);
  return { id: Number(r.lastInsertRowid) };
});
PUT('/api/categories/:id', 'admin', ({ params, body }) => { q.run('UPDATE categories SET name=? WHERE id=?', str(body.name), int(params.id)); return { ok: true }; });
DEL('/api/categories/:id', 'admin', ({ params }) => {
  q.run('UPDATE products SET category_id=NULL WHERE category_id=?', int(params.id));
  q.run('DELETE FROM categories WHERE id=?', int(params.id)); return { ok: true };
});

const PRODUCT_SELECT = `SELECT p.*, c.name AS category,
  COALESCE((SELECT qty FROM stock WHERE product_id=p.id AND location='store'),0) AS store_qty,
  COALESCE((SELECT qty FROM stock WHERE product_id=p.id AND location='warehouse'),0) AS wh_qty
  FROM products p LEFT JOIN categories c ON c.id=p.category_id`;

function listProducts(query, canSeeCost) {
  const where = []; const args = [];
  if (query.active !== 'all') { where.push('p.active=?'); args.push(query.active === '0' ? 0 : 1); }
  if (query.q) { where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)'); const l = `%${query.q}%`; args.push(l, l, l); }
  if (query.category_id) { where.push('p.category_id=?'); args.push(int(query.category_id)); }
  if (query.low === '1') where.push("COALESCE((SELECT qty FROM stock WHERE product_id=p.id AND location='store'),0) <= p.min_stock");
  const rows = q.all(`${PRODUCT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.name LIMIT ?`, ...args, Math.min(int(query.limit, 1000), 5000));
  return rows.map((r) => { const o = { ...r }; if (!canSeeCost) delete o.cost; return o; });
}
GET('/api/products', 'auth', ({ query, user }) => listProducts(query, RANK[user.role] >= 2));
GET('/api/products/barcode/:code', 'auth', ({ params, user }) => {
  const code = str(params.code);
  const r = q.get(`${PRODUCT_SELECT} WHERE (p.barcode=? OR p.sku=?) AND p.active=1`, code, code);
  if (!r) throw bad('Produk dengan barcode/SKU tersebut tidak ditemukan', 404);
  const o = { ...r }; if (RANK[user.role] < 2) delete o.cost; return o;
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
POST('/api/products', 'admin', ({ user, body }) => tx(() => {
  const f = productFields(body);
  if (!f.sku) { const m = q.get('SELECT COALESCE(MAX(id),0)+1 AS n FROM products'); f.sku = 'RH-' + String(m.n).padStart(4, '0'); }
  if (!f.barcode) f.barcode = genBarcode();
  const r = q.run(`INSERT INTO products(sku,barcode,name,category_id,description,image,price,cost,unit,min_stock,show_online)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`, f.sku, f.barcode, f.name, f.category_id, f.description, f.image, f.price, f.cost, f.unit, f.min_stock, f.show_online);
  const id = Number(r.lastInsertRowid);
  const sq = int(body.store_qty), wq = int(body.wh_qty);
  if (sq > 0) moveStock({ productId: id, location: 'store', delta: sq, type: 'initial', note: 'Stok awal', userId: user.id });
  if (wq > 0) moveStock({ productId: id, location: 'warehouse', delta: wq, type: 'initial', note: 'Stok awal', userId: user.id });
  audit(user, 'tambah_produk', `${f.sku} ${f.name}`);
  return { id, sku: f.sku, barcode: f.barcode };
}));
PUT('/api/products/:id', 'admin', ({ user, params, body }) => {
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
DEL('/api/products/:id', 'admin', ({ user, params }) => tx(() => {
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
POST('/api/upload', 'admin', ({ body }) => {
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
POST('/api/stock/adjust', 'admin', ({ user, body }) => tx(() => {
  const pid = int(body.product_id); const loc = body.location;
  if (!['store', 'warehouse'].includes(loc)) throw bad('Lokasi stok tidak valid');
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
GET('/api/stock/movements', 'auth', ({ query }) => {
  const where = []; const args = [];
  if (query.product_id) { where.push('m.product_id=?'); args.push(int(query.product_id)); }
  if (query.location) { where.push('m.location=?'); args.push(query.location); }
  return q.all(`SELECT m.*, p.name AS product, p.sku, u.name AS user FROM stock_movements m
    JOIN products p ON p.id=m.product_id LEFT JOIN users u ON u.id=m.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.id DESC LIMIT ?`, ...args, Math.min(int(query.limit, 100), 1000));
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
POST('/api/transfers', 'admin', ({ user, body }) => tx(() => {
  const items = cleanItems(body.items);
  const number = nextNumber('TRF', 'transfers', 'number');
  const id = Number(q.run('INSERT INTO transfers(number,note,user_id) VALUES(?,?,?)', number, nul(body.note), user.id).lastInsertRowid);
  for (const it of items) {
    if (!q.get('SELECT id FROM products WHERE id=? AND active=1', it.product_id)) throw bad('Ada produk yang tidak valid/arsip');
    moveStock({ productId: it.product_id, location: 'warehouse', delta: -it.qty, type: 'transfer_out', ref: number, userId: user.id });
    moveStock({ productId: it.product_id, location: 'store', delta: it.qty, type: 'transfer_in', ref: number, userId: user.id });
    q.run('INSERT INTO transfer_items(transfer_id,product_id,qty) VALUES(?,?,?)', id, it.product_id, it.qty);
  }
  audit(user, 'transfer_gudang', number);
  return { id, number };
}));
GET('/api/transfers', 'auth', () => {
  const rows = q.all('SELECT t.*, u.name AS user FROM transfers t LEFT JOIN users u ON u.id=t.user_id ORDER BY t.id DESC LIMIT 100');
  return rows.map((t) => ({ ...t, items: q.all('SELECT ti.qty, p.name, p.sku FROM transfer_items ti JOIN products p ON p.id=ti.product_id WHERE ti.transfer_id=?', t.id) }));
});

// =====================================================================
//  PENJUALAN (KASIR)
// =====================================================================
function getSale(id) {
  const s = q.get('SELECT s.*, u.name AS cashier FROM sales s LEFT JOIN users u ON u.id=s.user_id WHERE s.id=?', id);
  if (!s) throw bad('Transaksi tidak ditemukan', 404);
  return { ...s, items: q.all('SELECT * FROM sale_items WHERE sale_id=?', id), store: allSettings() };
}
function recordPayment(refType, refId, method, amount, note, userId) {
  q.run('INSERT INTO payments(ref_type,ref_id,method,amount,note,user_id) VALUES(?,?,?,?,?,?)', refType, refId, method, amount, note, userId);
}
POST('/api/sales', 'staf', ({ user, body }) => tx(() => {
  const items = cleanItems(body.items);
  const method = body.payment_method || 'tunai';
  if (!PAY_METHODS.includes(method) || method === 'cod') throw bad('Metode pembayaran tidak valid');
  const lines = items.map((it) => {
    const p = q.get('SELECT * FROM products WHERE id=? AND active=1', it.product_id);
    if (!p) throw bad('Ada produk yang tidak ditemukan / sudah diarsipkan');
    return { p, qty: it.qty };
  });
  const subtotal = lines.reduce((a, l) => a + l.p.price * l.qty, 0);
  const discount = Math.max(0, Math.min(int(body.discount), subtotal));
  const total = subtotal - discount;
  let paid = method === 'tunai' ? int(body.paid) : total;
  if (paid < total) throw bad('Uang yang dibayarkan kurang dari total');
  const invoice = nextNumber('INV', 'sales', 'invoice_no');
  const allowNeg = setting('allow_negative_stock') === '1';
  const id = Number(q.run(`INSERT INTO sales(invoice_no,channel,customer_name,customer_phone,subtotal,discount,total,paid,change_amount,payment_method,note,user_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, invoice, 'pos', nul(body.customer_name), nul(body.customer_phone), subtotal, discount, total, paid, paid - total, method, nul(body.note), user.id).lastInsertRowid);
  for (const l of lines) {
    q.run('INSERT INTO sale_items(sale_id,product_id,name,price,cost,qty) VALUES(?,?,?,?,?,?)', id, l.p.id, l.p.name, l.p.price, l.p.cost, l.qty);
    moveStock({ productId: l.p.id, location: 'store', delta: -l.qty, type: 'sale', ref: invoice, userId: user.id, allowNegative: allowNeg });
  }
  recordPayment('sale', id, method, total, null, user.id);
  return getSale(id);
}));
GET('/api/sales', 'staf', ({ query, user }) => {
  const where = ['1=1']; const args = [];
  if (query.from) { where.push('date(s.created_at)>=?'); args.push(query.from); }
  if (query.to) { where.push('date(s.created_at)<=?'); args.push(query.to); }
  if (query.q) { where.push('(s.invoice_no LIKE ? OR s.customer_name LIKE ?)'); args.push(`%${query.q}%`, `%${query.q}%`); }
  if (query.status) { where.push('s.status=?'); args.push(query.status); }
  if (RANK[user.role] < 2 && !query.from) { where.push("date(s.created_at)>=date('now','localtime','-2 days')"); } // staf: 3 hari terakhir saja
  return q.all(`SELECT s.id,s.invoice_no,s.channel,s.customer_name,s.total,s.payment_method,s.status,s.created_at,u.name AS cashier,
    (SELECT SUM(qty) FROM sale_items WHERE sale_id=s.id) AS items
    FROM sales s LEFT JOIN users u ON u.id=s.user_id WHERE ${where.join(' AND ')} ORDER BY s.id DESC LIMIT ?`, ...args, Math.min(int(query.limit, 200), 2000));
});
GET('/api/sales/:id', 'staf', ({ params }) => getSale(int(params.id)));
POST('/api/sales/:id/void', 'admin', ({ user, params, body }) => tx(() => {
  const s = getSale(int(params.id));
  if (s.status !== 'paid') throw bad('Transaksi sudah dibatalkan');
  if (s.order_id) throw bad('Transaksi ini berasal dari pemesanan. Batalkan lewat menu Pemesanan.');
  if (!str(body.reason)) throw bad('Alasan pembatalan wajib diisi');
  for (const it of s.items) moveStock({ productId: it.product_id, location: 'store', delta: it.qty, type: 'void', ref: s.invoice_no, userId: user.id, allowNegative: true });
  q.run("UPDATE sales SET status='void', void_reason=? WHERE id=?", str(body.reason), s.id);
  audit(user, 'void_penjualan', `${s.invoice_no}: ${body.reason}`);
  return getSale(s.id);
}));

// =====================================================================
//  PEMESANAN (ORDER)  — publik (toko online) & internal (telepon/WA)
// =====================================================================
function createOrder(body, userId, source) {
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
    const total = lines.reduce((a, l) => a + l.p.price * l.qty, 0);
    const order_no = nextNumber('ORD', 'orders', 'order_no');
    const id = Number(q.run(`INSERT INTO orders(order_no,source,customer_name,phone,address,notes,payment_method,total,user_id) VALUES(?,?,?,?,?,?,?,?,?)`,
      order_no, source, name, phone, nul(body.address), nul(body.notes), method, total, userId).lastInsertRowid);
    const allowNeg = setting('allow_negative_stock') === '1';
    for (const l of lines) {
      q.run('INSERT INTO order_items(order_id,product_id,name,price,qty) VALUES(?,?,?,?,?)', id, l.p.id, l.p.name, l.p.price, l.qty);
      moveStock({ productId: l.p.id, location: 'store', delta: -l.qty, type: 'order', ref: order_no, userId, allowNegative: allowNeg });
    }
    return { id, order_no, total };
  });
}
function getOrder(id) {
  const o = q.get('SELECT o.*, u.name AS handler FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE o.id=?', id);
  if (!o) throw bad('Pesanan tidak ditemukan', 404);
  return { ...o, items: q.all('SELECT * FROM order_items WHERE order_id=?', id), sale: o.sale_id ? q.get('SELECT id,invoice_no FROM sales WHERE id=?', o.sale_id) : null };
}

// --- publik ---
GET('/api/public/info', null, () => { const s = allSettings(); return { store_name: s.store_name, store_address: s.store_address, store_phone: s.store_phone, bank_info: s.bank_info, qris_note: s.qris_note }; });
GET('/api/public/categories', null, () => q.all('SELECT id,name FROM categories ORDER BY name'));
GET('/api/public/products', null, ({ query }) => {
  const where = ['p.active=1', 'p.show_online=1']; const args = [];
  if (query.q) { where.push('p.name LIKE ?'); args.push(`%${query.q}%`); }
  if (query.category_id) { where.push('p.category_id=?'); args.push(int(query.category_id)); }
  return q.all(`SELECT p.id,p.name,p.description,p.image,p.price,p.unit,p.category_id,c.name AS category,
    COALESCE((SELECT qty FROM stock WHERE product_id=p.id AND location='store'),0) AS stock
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
  limitOrders(req.socket.remoteAddress);
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
    for (const it of o.items) moveStock({ productId: it.product_id, location: 'store', delta: it.qty, type: 'order_cancel', ref: o.order_no, note: 'Batal otomatis: belum dibayar', allowNegative: true });
    q.run("UPDATE orders SET status='batal', updated_at=datetime('now','localtime') WHERE id=?", o.id);
    audit(null, 'batal_otomatis', o.order_no);
  });
  return rows.length;
}

// --- internal ---
GET('/api/orders', 'staf', ({ query }) => {
  const where = ['1=1']; const args = [];
  if (query.status === 'aktif') where.push("status IN ('baru','diproses','dikirim')");
  else if (query.status) { where.push('status=?'); args.push(query.status); }
  if (query.q) { where.push('(order_no LIKE ? OR customer_name LIKE ? OR phone LIKE ?)'); const l = `%${query.q}%`; args.push(l, l, l); }
  return q.all(`SELECT o.*, (SELECT SUM(qty) FROM order_items WHERE order_id=o.id) AS items FROM orders o WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT 300`, ...args);
});
GET('/api/orders/:id', 'staf', ({ params }) => getOrder(int(params.id)));
POST('/api/orders', 'staf', ({ user, body }) => { const r = createOrder(body, user.id, body.source === 'wa' ? 'wa' : 'manual'); audit(user, 'buat_pesanan', r.order_no); return r; });
POST('/api/orders/:id/status', 'staf', ({ user, params, body }) => tx(() => {
  const o = getOrder(int(params.id));
  const to = body.status;
  if (!['baru', 'diproses', 'dikirim', 'selesai', 'batal'].includes(to)) throw bad('Status tidak valid');
  if (o.status === 'batal' || o.status === 'selesai') throw bad(`Pesanan sudah ${o.status}, tidak bisa diubah`);
  if (to === 'selesai' && o.payment_status !== 'lunas') throw bad('Catat pembayaran terlebih dahulu sebelum menyelesaikan pesanan');
  if (to === 'batal') {
    if (RANK[user.role] < 2 && o.payment_status === 'lunas') throw bad('Pesanan yang sudah dibayar hanya bisa dibatalkan oleh admin', 403);
    for (const it of o.items) moveStock({ productId: it.product_id, location: 'store', delta: it.qty, type: 'order_cancel', ref: o.order_no, userId: user.id, allowNegative: true });
    if (o.sale_id) q.run("UPDATE sales SET status='void', void_reason=? WHERE id=?", 'Pesanan ' + o.order_no + ' dibatalkan', o.sale_id);
  }
  q.run("UPDATE orders SET status=?, updated_at=datetime('now','localtime') WHERE id=?", to, o.id);
  audit(user, 'status_pesanan', `${o.order_no} ${o.status}->${to}`);
  return getOrder(o.id);
}));
POST('/api/orders/:id/pay', 'staf', ({ user, params, body }) => tx(() => {
  const o = getOrder(int(params.id));
  if (o.status === 'batal') throw bad('Pesanan sudah dibatalkan');
  if (o.payment_status === 'lunas') throw bad('Pesanan sudah lunas');
  const method = PAY_METHODS.includes(body.method) && body.method !== 'cod' ? body.method : 'transfer';
  const invoice = nextNumber('INV', 'sales', 'invoice_no');
  const saleId = Number(q.run(`INSERT INTO sales(invoice_no,channel,customer_name,customer_phone,subtotal,discount,total,paid,change_amount,payment_method,note,order_id,user_id)
    VALUES(?,?,?,?,?,0,?,?,0,?,?,?,?)`, invoice, 'order', o.customer_name, o.phone, o.total, o.total, o.total, method, nul(body.note) || 'Pesanan ' + o.order_no, o.id, user.id).lastInsertRowid);
  for (const it of o.items) {
    const p = q.get('SELECT cost FROM products WHERE id=?', it.product_id);
    q.run('INSERT INTO sale_items(sale_id,product_id,name,price,cost,qty) VALUES(?,?,?,?,?,?)', saleId, it.product_id, it.name, it.price, p ? p.cost : 0, it.qty);
  }
  recordPayment('sale', saleId, method, o.total, nul(body.note), user.id);
  q.run("UPDATE orders SET payment_status='lunas', payment_method=?, sale_id=?, status=CASE WHEN status='baru' THEN 'diproses' ELSE status END, updated_at=datetime('now','localtime') WHERE id=?", method, saleId, o.id);
  audit(user, 'bayar_pesanan', `${o.order_no} ${method}`);
  return getOrder(o.id);
}));

// =====================================================================
//  SUPPLIER & PURCHASE ORDER
// =====================================================================
GET('/api/suppliers', 'admin', () => q.all('SELECT * FROM suppliers WHERE active=1 ORDER BY name'));
POST('/api/suppliers', 'admin', ({ body }) => {
  if (!str(body.name)) throw bad('Nama supplier wajib diisi');
  return { id: Number(q.run('INSERT INTO suppliers(name,phone,address) VALUES(?,?,?)', str(body.name), nul(body.phone), nul(body.address)).lastInsertRowid) };
});
PUT('/api/suppliers/:id', 'admin', ({ params, body }) => { q.run('UPDATE suppliers SET name=?,phone=?,address=? WHERE id=?', str(body.name), nul(body.phone), nul(body.address), int(params.id)); return { ok: true }; });
DEL('/api/suppliers/:id', 'admin', ({ params }) => { q.run('UPDATE suppliers SET active=0 WHERE id=?', int(params.id)); return { ok: true }; });

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
GET('/api/po', 'admin', ({ query }) => {
  const where = ['1=1']; const args = [];
  if (query.status === 'open') where.push("po.status IN ('draft','submitted','approved','partial')");
  else if (query.status) { where.push('po.status=?'); args.push(query.status); }
  return q.all(`SELECT po.*, s.name AS supplier, u.name AS created_by_name,
    (SELECT COALESCE(SUM(qty*cost),0) FROM po_items WHERE po_id=po.id) AS total,
    (SELECT COUNT(*) FROM po_items WHERE po_id=po.id) AS lines
    FROM purchase_orders po LEFT JOIN suppliers s ON s.id=po.supplier_id LEFT JOIN users u ON u.id=po.created_by
    WHERE ${where.join(' AND ')} ORDER BY po.id DESC LIMIT 300`, ...args);
});
GET('/api/po/:id', 'admin', ({ params }) => getPO(int(params.id)));
POST('/api/po', 'admin', ({ user, body }) => tx(() => {
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
PUT('/api/po/:id', 'admin', ({ user, params, body }) => tx(() => {
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
POST('/api/po/:id/status', 'admin', ({ user, params, body }) => tx(() => {
  const po = getPO(int(params.id));
  const to = body.status;
  if (!(PO_FLOW[po.status] || []).includes(to)) throw bad(`Status PO tidak dapat diubah dari "${po.status}" ke "${to}"`);
  if (po.status === 'partial' && to === 'cancelled') { /* sisa yang belum datang dibatalkan; stok yang sudah masuk tetap */ }
  q.run("UPDATE purchase_orders SET status=?, approved_by=?, updated_at=datetime('now','localtime') WHERE id=?", to, to === 'approved' ? user.id : (to === 'submitted' || to === 'draft' ? null : po.approved_by), po.id);
  audit(user, 'status_po', `${po.po_number} ${po.status}->${to}`);
  return getPO(po.id);
}));
// TERIMA BARANG: stok masuk ke GUDANG
POST('/api/po/:id/receive', 'admin', ({ user, params, body }) => tx(() => {
  const po = getPO(int(params.id));
  if (!['approved', 'partial'].includes(po.status)) throw bad('PO harus berstatus disetujui sebelum barang diterima');
  const recv = (body.items || []).map((x) => ({ item_id: int(x.item_id), qty: int(x.qty) })).filter((x) => x.qty > 0);
  if (!recv.length) throw bad('Isi jumlah barang yang diterima');
  for (const r of recv) {
    const it = po.items.find((i) => i.id === r.item_id);
    if (!it) throw bad('Baris PO tidak valid');
    if (r.qty > it.qty - it.received_qty) throw bad(`Jumlah diterima untuk "${it.name}" melebihi sisa pesanan (${it.qty - it.received_qty})`);
    moveStock({ productId: it.product_id, location: 'warehouse', delta: r.qty, type: 'po_in', ref: po.po_number, note: nul(body.note), userId: user.id });
    q.run('UPDATE po_items SET received_qty=received_qty+? WHERE id=?', r.qty, it.id);
    if (it.cost > 0) q.run('UPDATE products SET cost=? WHERE id=?', it.cost, it.product_id); // harga beli terakhir
  }
  const left = q.get('SELECT COUNT(*) AS n FROM po_items WHERE po_id=? AND received_qty<qty', po.id).n;
  q.run("UPDATE purchase_orders SET status=?, updated_at=datetime('now','localtime') WHERE id=?", left ? 'partial' : 'received', po.id);
  audit(user, 'terima_po', `${po.po_number}${left ? ' (sebagian)' : ' (lengkap)'}`);
  return getPO(po.id);
}));
DEL('/api/po/:id', 'admin', ({ user, params }) => {
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

GET('/api/dashboard', 'staf', ({ user }) => {
  const isAdmin = RANK[user.role] >= 2;
  const S = "status='paid'";
  const today = q.get(`SELECT COUNT(*) AS trx, COALESCE(SUM(total),0) AS revenue FROM sales WHERE ${S} AND date(created_at)=date('now','localtime')`);
  const todayItems = q.get(`SELECT COALESCE(SUM(si.qty),0) AS n FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.${S} AND date(s.created_at)=date('now','localtime')`).n;
  const month = q.get(`SELECT COUNT(*) AS trx, COALESCE(SUM(total),0) AS revenue FROM sales WHERE ${S} AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now','localtime')`);
  const days = 14; const series = [];
  const rows = q.all(`SELECT date(created_at) AS d, COUNT(*) AS trx, SUM(total) AS revenue FROM sales WHERE ${S} AND date(created_at)>=date('now','localtime','-${days - 1} days') GROUP BY d`);
  const byDay = Object.fromEntries(rows.map((r) => [r.d, r]));
  for (let i = days - 1; i >= 0; i--) { const dt = new Date(); dt.setDate(dt.getDate() - i); const k = ymd(dt); series.push({ date: k, trx: byDay[k]?.trx || 0, revenue: byDay[k]?.revenue || 0 }); }
  const top = q.all(`SELECT si.name, SUM(si.qty) AS qty, SUM(si.qty*si.price) AS revenue FROM sale_items si JOIN sales s ON s.id=si.sale_id
    WHERE s.${S} AND date(s.created_at)>=date('now','localtime','-29 days') GROUP BY si.product_id ORDER BY qty DESC LIMIT 5`);
  const low = q.all(`${PRODUCT_SELECT} WHERE p.active=1 AND COALESCE((SELECT qty FROM stock WHERE product_id=p.id AND location='store'),0) <= p.min_stock ORDER BY store_qty ASC LIMIT 10`)
    .map((r) => ({ id: r.id, name: r.name, sku: r.sku, store_qty: r.store_qty, wh_qty: r.wh_qty, min_stock: r.min_stock }));
  const byMethod = q.all(`SELECT payment_method AS method, COUNT(*) AS trx, SUM(total) AS revenue FROM sales WHERE ${S} AND date(created_at)=date('now','localtime') GROUP BY payment_method`);
  const orders = q.get(`SELECT SUM(status IN ('baru','diproses','dikirim')) AS aktif, SUM(status='baru') AS baru, SUM(status NOT IN ('batal','selesai') AND payment_status='belum') AS belum_bayar FROM orders`);
  const out = { today: { ...today, items: todayItems }, month, series, top, low, by_method: byMethod, orders: { aktif: orders.aktif || 0, baru: orders.baru || 0, belum_bayar: orders.belum_bayar || 0 },
    recent: q.all(`SELECT id,invoice_no,total,payment_method,channel,status,created_at FROM sales ORDER BY id DESC LIMIT 8`) };
  if (isAdmin) {
    out.po_open = q.get("SELECT COUNT(*) AS n FROM purchase_orders WHERE status IN ('submitted','approved','partial')").n;
    out.stock_value = q.get(`SELECT COALESCE(SUM(CASE WHEN st.location='store' THEN st.qty*p.cost END),0) AS store, COALESCE(SUM(CASE WHEN st.location='warehouse' THEN st.qty*p.cost END),0) AS warehouse FROM stock st JOIN products p ON p.id=st.product_id WHERE p.active=1`);
  }
  return out;
});

function salesReport(from, to) {
  const W = "s.status='paid' AND date(s.created_at)>=? AND date(s.created_at)<=?";
  const totals = q.get(`SELECT COUNT(*) AS trx, COALESCE(SUM(s.subtotal),0) AS gross, COALESCE(SUM(s.discount),0) AS discount, COALESCE(SUM(s.total),0) AS revenue FROM sales s WHERE ${W}`, from, to);
  const agg = q.get(`SELECT COALESCE(SUM(si.qty),0) AS items, COALESCE(SUM(si.qty*si.cost),0) AS cogs FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE ${W}`, from, to);
  const voided = q.get("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total FROM sales s WHERE s.status='void' AND date(s.created_at)>=? AND date(s.created_at)<=?", from, to);
  return {
    from, to, totals: { ...totals, ...agg, profit: totals.revenue - agg.cogs, avg: totals.trx ? Math.round(totals.revenue / totals.trx) : 0 }, voided,
    daily: q.all(`SELECT date(s.created_at) AS date, COUNT(*) AS trx, SUM(s.total) AS revenue, SUM(s.discount) AS discount FROM sales s WHERE ${W} GROUP BY date(s.created_at) ORDER BY date`, from, to),
    by_method: q.all(`SELECT s.payment_method AS method, COUNT(*) AS trx, SUM(s.total) AS revenue FROM sales s WHERE ${W} GROUP BY s.payment_method ORDER BY revenue DESC`, from, to),
    by_channel: q.all(`SELECT s.channel, COUNT(*) AS trx, SUM(s.total) AS revenue FROM sales s WHERE ${W} GROUP BY s.channel`, from, to),
    by_cashier: q.all(`SELECT COALESCE(u.name,'-') AS cashier, COUNT(*) AS trx, SUM(s.total) AS revenue FROM sales s LEFT JOIN users u ON u.id=s.user_id WHERE ${W} GROUP BY s.user_id ORDER BY revenue DESC`, from, to),
    by_product: q.all(`SELECT si.name, SUM(si.qty) AS qty, SUM(si.qty*si.price) AS revenue, SUM(si.qty*(si.price-si.cost)) AS profit FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE ${W} GROUP BY si.product_id ORDER BY revenue DESC LIMIT 100`, from, to),
  };
}
function rangeOf(query) {
  const now = new Date();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : ymd(now);
  return [from, to];
}
GET('/api/reports/sales', 'admin', ({ query }) => salesReport(...rangeOf(query)));
GET('/api/reports/stock', 'admin', () => {
  const rows = q.all(`${PRODUCT_SELECT} WHERE p.active=1 ORDER BY p.name`).map((p) => ({ ...p, store_value: p.store_qty * p.cost, wh_value: p.wh_qty * p.cost }));
  return { rows, totals: { store_value: rows.reduce((a, r) => a + r.store_value, 0), wh_value: rows.reduce((a, r) => a + r.wh_value, 0), store_qty: rows.reduce((a, r) => a + r.store_qty, 0), wh_qty: rows.reduce((a, r) => a + r.wh_qty, 0) } };
});
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
GET('/api/reports/export', 'admin', ({ res, query }) => {
  const [from, to] = rangeOf(query);
  let header, rows, name;
  if (query.type === 'stock') {
    header = ['SKU', 'Barcode', 'Nama', 'Kategori', 'Stok Toko', 'Stok Gudang', 'Min Stok', 'Harga Beli', 'Harga Jual', 'Nilai Stok (Beli)'];
    rows = q.all(`${PRODUCT_SELECT} WHERE p.active=1 ORDER BY p.name`).map((p) => [p.sku, p.barcode, p.name, p.category, p.store_qty, p.wh_qty, p.min_stock, p.cost, p.price, (p.store_qty + p.wh_qty) * p.cost]);
    name = 'stok-' + ymd(new Date());
  } else if (query.type === 'items') {
    header = ['Tanggal', 'Invoice', 'Produk', 'Qty', 'Harga', 'Subtotal', 'HPP', 'Laba'];
    rows = q.all(`SELECT s.created_at,s.invoice_no,si.name,si.qty,si.price,si.cost FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.status='paid' AND date(s.created_at)>=? AND date(s.created_at)<=? ORDER BY s.id`, from, to)
      .map((r) => [r.created_at, r.invoice_no, r.name, r.qty, r.price, r.qty * r.price, r.qty * r.cost, r.qty * (r.price - r.cost)]);
    name = `penjualan-per-item-${from}_${to}`;
  } else {
    header = ['Tanggal', 'Invoice', 'Kanal', 'Pelanggan', 'Kasir', 'Metode', 'Subtotal', 'Diskon', 'Total', 'Status'];
    rows = q.all(`SELECT s.*, u.name AS cashier FROM sales s LEFT JOIN users u ON u.id=s.user_id WHERE date(s.created_at)>=? AND date(s.created_at)<=? ORDER BY s.id`, from, to)
      .map((s) => [s.created_at, s.invoice_no, s.channel, s.customer_name, s.cashier, s.payment_method, s.subtotal, s.discount, s.total, s.status]);
    name = `penjualan-${from}_${to}`;
  }
  const csv = '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
  send(res, 200, Buffer.from(csv, 'utf8'), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"`, 'Access-Control-Allow-Origin': '*' });
});

// =====================================================================
//  START
// =====================================================================
function start() {
  const certDir = path.join(__dirname, 'certs');
  const useHttps = fs.existsSync(path.join(certDir, 'key.pem')) && fs.existsSync(path.join(certDir, 'cert.pem')) && process.env.HTTPS !== '0';
  const every = parseInt(process.env.EXPIRE_CHECK_SEC || '600', 10) * 1000;
  setInterval(() => { try { const n = expireOnlineOrders(); if (n) console.log(`[otomatis] ${n} pesanan online belum dibayar dibatalkan, stok dikembalikan`); } catch (e) { console.error(e); } }, every).unref();
  const server = useHttps
    ? https.createServer({ key: fs.readFileSync(path.join(certDir, 'key.pem')), cert: fs.readFileSync(path.join(certDir, 'cert.pem')) }, handler)
    : http.createServer(handler);
  server.listen(PORT, '0.0.0.0', () => {
    const proto = useHttps ? 'https' : 'http';
    const nets = Object.values(require('os').networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal);
    console.log(`\n  Toko Asesoris Rohani berjalan!\n`);
    console.log(`  Toko online : ${proto}://localhost:${PORT}/`);
    console.log(`  Admin/Kasir : ${proto}://localhost:${PORT}/admin/`);
    for (const n of nets) console.log(`  Dari HP (satu Wi-Fi): ${proto}://${n.address}:${PORT}/admin/`);
    if (!useHttps) console.log(`\n  Catatan: kamera/scan barcode di HP butuh HTTPS. Lihat README (bagian "Scan barcode di HP").`);
    console.log('');
  });
}
if (require.main === module) start();
module.exports = { handler, expireOnlineOrders };
