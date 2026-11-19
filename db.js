// Database SQLite (bawaan Node.js >= 22.13, tanpa dependensi tambahan)
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) {
  console.error(`\n  Aplikasi ini butuh Node.js 22.13 atau lebih baru (versi Anda: ${process.version}).\n  Unduh versi LTS terbaru di https://nodejs.org lalu jalankan ulang.\n`);
  process.exit(1);
}
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const PERM = require('./permissions');
// 3 lokasi stok
const LOC_LABEL = { display: 'Display Toko', gudang_toko: 'Gudang Toko', gudang_ruko: 'Gudang Ruko' };
const LOCATIONS = Object.keys(LOC_LABEL);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'toko.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS roles(
  key TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, permissions TEXT NOT NULL DEFAULT '[]',
  builtin INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime'))
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
  location TEXT NOT NULL CHECK(location IN ('display','gudang_toko','gudang_ruko')),
  qty INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(product_id, location)
);
CREATE TABLE IF NOT EXISTS stock_movements(
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, location TEXT NOT NULL, type TEXT NOT NULL,
  qty INTEGER NOT NULL, balance INTEGER NOT NULL, ref TEXT, note TEXT, user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_mov_product ON stock_movements(product_id, id);
CREATE TABLE IF NOT EXISTS stock_requests(
  id INTEGER PRIMARY KEY, number TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','preparing','shipped','received','rejected','cancelled')),
  urgent INTEGER NOT NULL DEFAULT 0, from_location TEXT NOT NULL DEFAULT 'gudang_ruko', to_location TEXT NOT NULL DEFAULT 'display', note TEXT, reject_reason TEXT, ship_note TEXT, receive_note TEXT,
  created_by INTEGER, prepared_by INTEGER, shipped_by INTEGER, received_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')), prepared_at TEXT, shipped_at TEXT, received_at TEXT,
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS stock_request_items(
  id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES stock_requests(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id), qty INTEGER NOT NULL,
  sent_qty INTEGER NOT NULL DEFAULT 0, received_qty INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_req_status ON stock_requests(status, id);
CREATE TABLE IF NOT EXISTS suppliers(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT, address TEXT, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS customers(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT, address TEXT, notes TEXT,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
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
  from_location TEXT NOT NULL DEFAULT 'gudang_ruko', to_location TEXT NOT NULL DEFAULT 'display',
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
  total INTEGER NOT NULL DEFAULT 0, sale_id INTEGER, user_id INTEGER, source_location TEXT NOT NULL DEFAULT 'display',
  created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sales_invoices(
  id INTEGER PRIMARY KEY, si_no TEXT UNIQUE NOT NULL, order_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'terbit',
  customer_name TEXT, customer_phone TEXT, address TEXT, notes TEXT,
  subtotal INTEGER NOT NULL DEFAULT 0, discount INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
  items_json TEXT NOT NULL DEFAULT '[]',
  issued_by INTEGER, issued_at TEXT DEFAULT (datetime('now','localtime')),
  void_reason TEXT, voided_by INTEGER, voided_at TEXT
);
CREATE TABLE IF NOT EXISTS order_items(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL, qty INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payments(
  id INTEGER PRIMARY KEY, ref_type TEXT NOT NULL, ref_id INTEGER NOT NULL, method TEXT NOT NULL,
  amount INTEGER NOT NULL, note TEXT, user_id INTEGER, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS cash_expenses(
  id INTEGER PRIMARY KEY, expense_no TEXT UNIQUE NOT NULL, spent_at TEXT NOT NULL DEFAULT (date('now','localtime')),
  category TEXT NOT NULL, description TEXT, amount INTEGER NOT NULL CHECK(amount > 0), user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sale_returns(
  id INTEGER PRIMARY KEY, return_no TEXT UNIQUE NOT NULL,
  sale_id INTEGER NOT NULL REFERENCES sales(id), cash_expense_id INTEGER,
  refund_amount INTEGER NOT NULL CHECK(refund_amount > 0),
  location TEXT NOT NULL CHECK(location IN ('display','gudang_toko','gudang_ruko')),
  reason TEXT NOT NULL, note TEXT, user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sale_return_items(
  id INTEGER PRIMARY KEY, return_id INTEGER NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  sale_item_id INTEGER NOT NULL REFERENCES sale_items(id), product_id INTEGER NOT NULL,
  name TEXT NOT NULL, qty INTEGER NOT NULL CHECK(qty > 0),
  restock_qty INTEGER NOT NULL DEFAULT 0 CHECK(restock_qty >= 0 AND restock_qty <= qty),
  unit_refund INTEGER NOT NULL CHECK(unit_refund >= 0)
);
CREATE INDEX IF NOT EXISTS idx_sale_returns_sale ON sale_returns(sale_id,id);

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
    const e = new Error(`Stok ${LOC_LABEL[location] || location} "${p ? p.name : productId}" tidak cukup (tersedia ${cur}, diminta ${-delta})`);
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

// ---------- migrasi: lepas CHECK(role IN (...)) pada tabel users agar superadmin bisa membuat role kustom ----------
(function migrateRoles() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (!row || !/CHECK\s*\(\s*role/i.test(row.sql)) return;
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec(`BEGIN;
      CREATE TABLE users_new(
        id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
        password_hash TEXT NOT NULL, role TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime')));
      INSERT INTO users_new(id,username,name,password_hash,role,active,created_at) SELECT id,username,name,password_hash,role,active,created_at FROM users;
      DROP TABLE users; ALTER TABLE users_new RENAME TO users; COMMIT;`);
    console.log('[migrasi] tabel pengguna disiapkan untuk role kustom');
  } catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
  finally { db.exec('PRAGMA foreign_keys = ON'); }
})();

// ---------- migrasi stok: 2 lokasi lama -> 3 lokasi (toko -> Display Toko, gudang -> Gudang Ruko) ----------
function addCol(table, col, def) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
(function migrateLocations() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='stock'").get();
  if (row && /'store'/.test(row.sql)) {
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec(`BEGIN;
        CREATE TABLE stock_new(product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          location TEXT NOT NULL CHECK(location IN ('display','gudang_toko','gudang_ruko')), qty INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(product_id, location));
        INSERT INTO stock_new(product_id,location,qty) SELECT product_id, CASE location WHEN 'store' THEN 'display' WHEN 'warehouse' THEN 'gudang_ruko' ELSE location END, qty FROM stock;
        DROP TABLE stock; ALTER TABLE stock_new RENAME TO stock;
        UPDATE stock_movements SET location = CASE location WHEN 'store' THEN 'display' WHEN 'warehouse' THEN 'gudang_ruko' ELSE location END;
        COMMIT;`);
      console.log('[migrasi] stok: toko -> Display Toko, gudang -> Gudang Ruko (Gudang Toko baru, awalnya kosong)');
    } catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; } finally { db.exec('PRAGMA foreign_keys = ON'); }
  }
  addCol('stock_requests', 'from_location', "TEXT NOT NULL DEFAULT 'gudang_ruko'");
  addCol('stock_requests', 'to_location', "TEXT NOT NULL DEFAULT 'display'");
  addCol('transfers', 'from_location', "TEXT NOT NULL DEFAULT 'gudang_ruko'");
  addCol('transfers', 'to_location', "TEXT NOT NULL DEFAULT 'display'");
  addCol('orders', 'source_location', "TEXT NOT NULL DEFAULT 'display'");
  addCol('orders', 'packed_at', 'TEXT');      // waktu tim SO menandai selesai packing
  addCol('orders', 'packed_by', 'INTEGER');   // pengguna yang menandai
})();

// ---------- migrasi: diskon (Rp + %) dan pajak/PPN pada penjualan kasir ----------
// `discount` tetap = TOTAL diskon dalam rupiah (dipakai laporan & retur). Kolom baru hanya menyimpan rincian input kasir + PPN.
(function migrateTax() {
  addCol('sales', 'discount_rp', 'INTEGER NOT NULL DEFAULT 0');       // diskon rupiah yang diinput kasir
  addCol('sales', 'discount_pct', 'REAL NOT NULL DEFAULT 0');         // diskon persen yang diinput kasir
  addCol('sales', 'tax_rate', 'REAL NOT NULL DEFAULT 0');             // tarif pajak (%) saat transaksi, 0 = tanpa pajak
  addCol('sales', 'tax_mode', "TEXT NOT NULL DEFAULT 'none'");        // none | exclusive (ditambahkan) | inclusive (sudah termasuk)
  addCol('sales', 'tax_amount', 'INTEGER NOT NULL DEFAULT 0');        // nilai pajak (Rp)
  // transaksi lama: seluruh diskonnya dianggap diskon rupiah (hanya sekali, selama kolom baru masih kosong)
  q.run('UPDATE sales SET discount_rp=discount WHERE discount>0 AND discount_rp=0 AND discount_pct=0');
})();

// ---------- migrasi: Sales Invoice (SI) terbit saat SO difinalkan; pembayaran berdiri sendiri (bisa kapan saja, bisa bertahap) ----------
(function migrateSalesInvoice() {
  addCol('orders', 'discount', 'INTEGER NOT NULL DEFAULT 0');     // diskon nota
  addCol('orders', 'paid_amount', 'INTEGER NOT NULL DEFAULT 0');  // total uang yang sudah diterima
  addCol('orders', 'si_id', 'INTEGER');                           // Sales Invoice aktif / terakhir
  addCol('orders', 'final_at', 'TEXT');
  addCol('orders', 'final_by', 'INTEGER');
  // SO lama yang sudah lunas: jumlah dibayar = total
  const a = q.run("UPDATE orders SET paid_amount=total WHERE payment_status='lunas' AND paid_amount=0").changes;
  // SO lama yang sudah punya invoice (dibuat saat pembayaran): dianggap sudah final, nomor invoice lamanya dipakai sebagai nomor SI
  const legacy = q.all(`SELECT o.id, o.status, o.customer_name, o.phone, o.address, o.notes, o.total, o.discount, s.invoice_no, s.created_at AS sale_at, s.user_id AS sale_user
    FROM orders o JOIN sales s ON s.id=o.sale_id WHERE o.si_id IS NULL`);
  for (const o of legacy) {
    const items = q.all('SELECT product_id,name,price,qty FROM order_items WHERE order_id=?', o.id);
    const subtotal = items.reduce((t, i) => t + i.price * i.qty, 0);
    const void_ = o.status === 'batal';
    const id = Number(q.run(`INSERT INTO sales_invoices(si_no,order_id,status,customer_name,customer_phone,address,notes,subtotal,discount,total,items_json,issued_by,issued_at,void_reason,voided_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, o.invoice_no, o.id, void_ ? 'void' : 'terbit', o.customer_name, o.phone, o.address, o.notes, subtotal, 0, o.total, JSON.stringify(items), o.sale_user, o.sale_at,
      void_ ? 'SO dibatalkan (data lama)' : null, void_ ? o.sale_at : null).lastInsertRowid);
    q.run('UPDATE orders SET si_id=?, final_at=?, final_by=? WHERE id=?', id, o.sale_at, o.sale_user, o.id);
  }
  if (a || legacy.length) console.log(`[migrasi] Sales Invoice: ${legacy.length} SO lama yang sudah dibayar dianggap final (nomor invoice lama dipakai sebagai nomor SI)`);
})();

// ---------- migrasi role: Admin dipecah jadi Sales Admin & Admin Gudang; Gudang (lama) menjadi Admin Gudang ----------
(function migrateRoleSplit() {
  const has = (k) => q.get('SELECT key FROM roles WHERE key=?', k);
  const gd = has('gudang');
  if (gd) {
    if (!has('admin_gudang')) {
      q.run("UPDATE roles SET key='admin_gudang', name=CASE WHEN name='Gudang' THEN 'Admin Gudang' ELSE name END, description=CASE WHEN description LIKE 'Stok gudang, terima barang PO%' THEN ? ELSE description END WHERE key='gudang'", PERM.BUILTIN.admin_gudang.description);
      q.run("UPDATE users SET role='admin_gudang' WHERE role='gudang'");
      console.log('[migrasi] role Gudang menjadi Admin Gudang');
    }
  }
  const ad = has('admin');
  if (ad) {
    const n = q.get("SELECT COUNT(*) AS n FROM users WHERE role='admin'").n;
    if (!n) { q.run("DELETE FROM roles WHERE key='admin'"); }
    else {
      // pengguna Admin lama tidak kehilangan akses: role-nya dijadikan role kustom "Admin (lama)" sampai dipindah ke Sales Admin / Admin Gudang
      q.run("UPDATE roles SET name='Admin (lama)', builtin=0, description='Role Admin versi lama (sebelum dipecah). Pindahkan penggunanya ke Sales Admin atau Admin Gudang, lalu hapus role ini.' WHERE key='admin'");
      console.log(`[migrasi] ${n} pengguna Admin dipindah ke role "Admin (lama)": pindahkan ke Sales Admin / Admin Gudang di Pengguna & Role`);
    }
  }
})();

// ---------- migrasi detail role: role bawaan yang belum pernah diubah superadmin dipindah ke hak terbaru ----------
(function migrateRoleDetail() {
  const same = (a, b) => a.length === b.length && a.every((k) => b.includes(k));
  for (const [key, olds] of Object.entries(PERM.PREVIOUS_DEFAULTS)) {
    const r = q.get('SELECT permissions FROM roles WHERE key=? AND builtin=1', key);
    if (!r) continue;
    const cur = PERM.parse(r.permissions);
    if (!olds.some((old) => same(cur, PERM.normalize(old)))) continue; // sudah dikustomisasi: biarkan
    const nu = PERM.BUILTIN[key];
    if (same(cur, PERM.normalize(nu.permissions))) continue;
    q.run('UPDATE roles SET permissions=?, description=? WHERE key=?', JSON.stringify(PERM.normalize(nu.permissions)), nu.description, key);
    console.log(`[migrasi] hak role ${nu.name} diperbarui sesuai detail role terbaru`);
  }
})();

// ---------- role bawaan: dibuat bila belum ada (perubahan hak oleh superadmin tidak ditimpa saat restart) ----------
function ensureBuiltinRoles() {
  for (const [key, r] of Object.entries(PERM.BUILTIN)) {
    q.run('INSERT OR IGNORE INTO roles(key,name,description,permissions,builtin) VALUES(?,?,?,?,1)', key, r.name, r.description, JSON.stringify(r.permissions));
  }
}
ensureBuiltinRoles();

// ---------- seed ----------
function seed() {
  if (!q.get('SELECT id FROM users LIMIT 1')) {
    const mk = (u, n, p, r) => q.run('INSERT INTO users(username,name,password_hash,role) VALUES(?,?,?,?)', u, n, hashPassword(p), r);
    mk('superadmin', 'Super Admin', 'super123', 'superadmin');
    mk('salesadmin', 'Sales Admin', 'sales123', 'sales_admin');
    mk('staf', 'Staf Kasir', 'staf123', 'staf');
    mk('admingudang', 'Admin Gudang', 'gudang123', 'admin_gudang');
    mk('kasir', 'Kasir', 'kasir123', 'kasir');
    mk('timso', 'Tim SO', 'timso123', 'tim_so');
    console.log('[seed] Akun awal dibuat: superadmin/super123, salesadmin/sales123, staf/staf123, admingudang/gudang123, kasir/kasir123, timso/timso123  (SEGERA GANTI PASSWORD!)');
  }
  const defaults = {
    store_name: 'Hosana', store_address: 'Jl. Contoh No. 1, Kota Anda', store_phone: '6281234567890',
    receipt_footer: 'Terima kasih atas kunjungan Anda. Barang yang sudah dibeli tidak dapat dikembalikan.',
    bank_info: 'BCA 1234567890 a.n. Hosana', qris_note: 'Scan QRIS di kasir / hubungi admin untuk kode QRIS.',
    allow_negative_stock: '0', paper_width: '58', online_hold_hours: '24',
    tax_enabled: '0', tax_rate: '11', tax_mode: 'exclusive', tax_name: 'PPN',
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
        moveStock({ productId: id, location: 'display', delta: d[4], type: 'initial', note: 'Stok awal (contoh)' });
        moveStock({ productId: id, location: 'gudang_toko', delta: Math.round(d[5] / 3), type: 'initial', note: 'Stok awal (contoh)' });
        moveStock({ productId: id, location: 'gudang_ruko', delta: d[5], type: 'initial', note: 'Stok awal (contoh)' });
      });
    });
    console.log('[seed] Data contoh dibuat (set SEED_DEMO=0 untuk melewati).');
  }
}

module.exports = { LOCATIONS, LOC_LABEL, db, q, tx, plain, plainAll, hashPassword, verifyPassword, setting, allSettings, nextNumber, getQty, moveStock, audit, seed, DATA_DIR };
