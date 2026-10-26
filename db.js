// Database SQLite (bawaan Node.js >= 22.13, tanpa dependensi tambahan)
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) {
  console.error(`\n  Aplikasi ini butuh Node.js 22.13 atau lebih baru (versi Anda: ${process.version}).\n  Unduh versi LTS terbaru di https://nodejs.org lalu jalankan ulang.\n`);
  process.exit(1);
}
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'toko.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('superadmin','admin','staf')),
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY, sku TEXT UNIQUE NOT NULL, barcode TEXT UNIQUE, name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id), description TEXT, image TEXT,
  price INTEGER NOT NULL DEFAULT 0, cost INTEGER NOT NULL DEFAULT 0, unit TEXT DEFAULT 'pcs',
  min_stock INTEGER NOT NULL DEFAULT 5, show_online INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS stock(
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location TEXT NOT NULL CHECK(location IN ('store','warehouse')),
  qty INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(product_id, location)
);
CREATE TABLE IF NOT EXISTS stock_movements(
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, location TEXT NOT NULL, type TEXT NOT NULL,
  qty INTEGER NOT NULL, balance INTEGER NOT NULL, ref TEXT, note TEXT, user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_mov_product ON stock_movements(product_id, id);
CREATE TABLE IF NOT EXISTS suppliers(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT, address TEXT, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS purchase_orders(
  id INTEGER PRIMARY KEY, po_number TEXT UNIQUE NOT NULL, supplier_id INTEGER REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'draft', notes TEXT, expected_date TEXT, revision INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER, approved_by INTEGER, created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS po_items(
  id INTEGER PRIMARY KEY, po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id), qty INTEGER NOT NULL, cost INTEGER NOT NULL,
  received_qty INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS po_revisions(
  id INTEGER PRIMARY KEY, po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL, snapshot TEXT NOT NULL, note TEXT, user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS transfers(
  id INTEGER PRIMARY KEY, number TEXT UNIQUE NOT NULL, note TEXT, user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS transfer_items(
  id INTEGER PRIMARY KEY, transfer_id INTEGER NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL, qty INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sales(
  id INTEGER PRIMARY KEY, invoice_no TEXT UNIQUE NOT NULL, channel TEXT NOT NULL DEFAULT 'pos',
  customer_name TEXT, customer_phone TEXT, subtotal INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL, paid INTEGER NOT NULL DEFAULT 0, change_amount INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'paid', note TEXT, void_reason TEXT,
  order_id INTEGER, user_id INTEGER, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(created_at);
CREATE TABLE IF NOT EXISTS sale_items(
  id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL, cost INTEGER NOT NULL DEFAULT 0,
  qty INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY, order_no TEXT UNIQUE NOT NULL, source TEXT NOT NULL DEFAULT 'online',
  customer_name TEXT NOT NULL, phone TEXT NOT NULL, address TEXT, notes TEXT,
  status TEXT NOT NULL DEFAULT 'baru', payment_method TEXT, payment_status TEXT NOT NULL DEFAULT 'belum',
  total INTEGER NOT NULL DEFAULT 0, sale_id INTEGER, user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS order_items(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL, qty INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payments(
  id INTEGER PRIMARY KEY, ref_type TEXT NOT NULL, ref_id INTEGER NOT NULL, method TEXT NOT NULL,
  amount INTEGER NOT NULL, note TEXT, user_id INTEGER, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS audit(
  id INTEGER PRIMARY KEY, user_id INTEGER, username TEXT, action TEXT NOT NULL, detail TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
`);

// ---------- helper ----------
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
}
const q = {
  get: (sql, ...p) => db.prepare(sql).get(...p),
  all: (sql, ...p) => db.prepare(sql).all(...p),
  run: (sql, ...p) => db.prepare(sql).run(...p),
};
// node:sqlite mengembalikan objek berprototipe null; ubah ke objek biasa agar mudah di-JSON
const plain = (r) => (r == null ? r : { ...r });
const plainAll = (rows) => rows.map((r) => ({ ...r }));

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(pw, salt, 64);
  const b = Buffer.from(hash, 'hex');
  return b.length === h.length && crypto.timingSafeEqual(h, b);
}

function setting(key, def = '') {
  const r = q.get('SELECT value FROM settings WHERE key=?', key);
  return r ? r.value : def;
}
function allSettings() {
  const o = {};
  for (const r of q.all('SELECT key,value FROM settings')) o[r.key] = r.value;
  return o;
}

// nomor dokumen: PREFIX-YYYYMMDD-0001
function nextNumber(prefix, table, col) {
  const d = new Date();
  const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const like = `${prefix}-${ymd}-%`;
  const r = q.get(`SELECT ${col} AS n FROM ${table} WHERE ${col} LIKE ? ORDER BY ${col} DESC LIMIT 1`, like);
  const last = r ? parseInt(r.n.split('-').pop(), 10) : 0;
  return `${prefix}-${ymd}-${String(last + 1).padStart(4, '0')}`;
}

// ---------- stok ----------
function getQty(productId, location) {
  const r = q.get('SELECT qty FROM stock WHERE product_id=? AND location=?', productId, location);
  return r ? r.qty : 0;
}
// ubah stok dengan delta (+/-) dan catat mutasi. Harus dipanggil di dalam tx().
function moveStock({ productId, location, delta, type, ref = null, note = null, userId = null, allowNegative = false }) {
  const cur = getQty(productId, location);
  const next = cur + delta;
  if (next < 0 && !allowNegative) {
    const p = q.get('SELECT name FROM products WHERE id=?', productId);
    const e = new Error(`Stok ${location === 'store' ? 'toko' : 'gudang'} "${p ? p.name : productId}" tidak cukup (tersedia ${cur}, diminta ${-delta})`);
    e.status = 400; throw e;
  }
  q.run(`INSERT INTO stock(product_id,location,qty) VALUES(?,?,?)
         ON CONFLICT(product_id,location) DO UPDATE SET qty=excluded.qty`, productId, location, next);
  q.run(`INSERT INTO stock_movements(product_id,location,type,qty,balance,ref,note,user_id) VALUES(?,?,?,?,?,?,?,?)`,
    productId, location, type, delta, next, ref, note, userId);
  return next;
}

function audit(user, action, detail) {
  q.run('INSERT INTO audit(user_id,username,action,detail) VALUES(?,?,?,?)',
    user ? user.id : null, user ? user.username : null, action, detail == null ? null : String(detail));
}

// ---------- seed ----------
function seed() {
  if (!q.get('SELECT id FROM users LIMIT 1')) {
    const mk = (u, n, p, r) => q.run('INSERT INTO users(username,name,password_hash,role) VALUES(?,?,?,?)', u, n, hashPassword(p), r);
    mk('superadmin', 'Super Admin', 'super123', 'superadmin');
    mk('admin', 'Admin Toko', 'admin123', 'admin');
    mk('staf', 'Staf Kasir', 'staf123', 'staf');
    console.log('[seed] Akun awal dibuat: superadmin/super123, admin/admin123, staf/staf123  (SEGERA GANTI PASSWORD!)');
  }
  const defaults = {
    store_name: 'Toko Asesoris Rohani', store_address: 'Jl. Contoh No. 1, Kota Anda', store_phone: '6281234567890',
    receipt_footer: 'Terima kasih atas kunjungan Anda. Barang yang sudah dibeli tidak dapat dikembalikan.',
    bank_info: 'BCA 1234567890 a.n. Toko Asesoris Rohani', qris_note: 'Scan QRIS di kasir / hubungi admin untuk kode QRIS.',
    allow_negative_stock: '0', paper_width: '58', online_hold_hours: '24',
  };
  for (const [k, v] of Object.entries(defaults)) q.run('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)', k, v);

  if (!q.get('SELECT id FROM categories LIMIT 1') && process.env.SEED_DEMO !== '0') {
    tx(() => {
      const cats = ['Kalung & Liontin', 'Gelang & Cincin', 'Rosario & Tasbih', 'Patung & Figura', 'Lilin & Dupa', 'Buku & Kitab', 'Souvenir'];
      const cid = {};
      for (const c of cats) cid[c] = Number(q.run('INSERT INTO categories(name) VALUES(?)', c).lastInsertRowid);
      q.run("INSERT INTO suppliers(name,phone,address) VALUES('CV Sumber Rohani (contoh)','628111111111','Jakarta')");
      const demo = [
        ['Kalung Liontin Salib Perak', 'Kalung & Liontin', 85000, 50000, 12, 30],
        ['Kalung Liontin Doa Kuningan', 'Kalung & Liontin', 45000, 25000, 20, 40],
        ['Gelang Manik Doa', 'Gelang & Cincin', 25000, 12000, 30, 60],
        ['Cincin Doa Stainless', 'Gelang & Cincin', 35000, 18000, 15, 25],
        ['Rosario/Tasbih Kayu 33 Butir', 'Rosario & Tasbih', 40000, 22000, 25, 50],
        ['Rosario/Tasbih Kristal', 'Rosario & Tasbih', 95000, 60000, 6, 20],
        ['Patung Doa Resin 15 cm', 'Patung & Figura', 150000, 95000, 4, 10],
        ['Lilin Aromaterapi Doa', 'Lilin & Dupa', 30000, 15000, 18, 36],
        ['Dupa Wangi Isi 20', 'Lilin & Dupa', 15000, 7000, 3, 50],
        ['Buku Doa Harian', 'Buku & Kitab', 55000, 35000, 10, 20],
        ['Gantungan Kunci Rohani', 'Souvenir', 12000, 5000, 40, 100],
      ];
      demo.forEach((d, i) => {
        const sku = 'RH-' + String(i + 1).padStart(4, '0');
        const barcode = '899' + String(1000000 + i * 37).padStart(7, '0') + String(i % 10);
        const id = Number(q.run(`INSERT INTO products(sku,barcode,name,category_id,price,cost,min_stock,description)
          VALUES(?,?,?,?,?,?,?,?)`, sku, barcode, d[0], cid[d[1]], d[2], d[3], 5, 'Produk contoh — silakan edit/hapus.').lastInsertRowid);
        moveStock({ productId: id, location: 'store', delta: d[4], type: 'initial', note: 'Stok awal (contoh)' });
        moveStock({ productId: id, location: 'warehouse', delta: d[5], type: 'initial', note: 'Stok awal (contoh)' });
      });
    });
    console.log('[seed] Data contoh dibuat (set SEED_DEMO=0 untuk melewati).');
  }
}

module.exports = { db, q, tx, plain, plainAll, hashPassword, verifyPassword, setting, allSettings, nextNumber, getQty, moveStock, audit, seed, DATA_DIR };
