// Reset password akun (mis. lupa password superadmin). Jalankan di komputer/server tempat data/ berada:
//   node scripts/reset-password.js <username> <password-baru>
//   node scripts/reset-password.js --list          (lihat daftar akun)
// Memakai DATA_DIR yang sama dengan server (default: folder data/). Semua sesi login akun itu diputus.
require('../env');
const path = require('path'), fs = require('fs'), crypto = require('crypto');
let DatabaseSync; try { ({ DatabaseSync } = require('node:sqlite')); } catch { console.error('Butuh Node.js 22.13+'); process.exit(1); }
const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const file = path.join(dir, 'toko.db');
if (!fs.existsSync(file)) { console.error('Database tidak ditemukan: ' + file + '\nJika server memakai DATA_DIR lain, set variabel itu juga di sini.'); process.exit(1); }
const db = new DatabaseSync(file);
const [a, b] = process.argv.slice(2);
if (a === '--list') { for (const u of db.prepare('SELECT username,name,role,active FROM users ORDER BY id').all()) console.log(`${u.username}\t${u.role}\t${u.active ? 'aktif' : 'NONAKTIF'}\t${u.name}`); process.exit(0); }
if (!a || !b) { console.error('Pemakaian: node scripts/reset-password.js <username> <password-baru>'); process.exit(1); }
if (b.length < 6) { console.error('Password minimal 6 karakter'); process.exit(1); }
const u = db.prepare('SELECT id FROM users WHERE username=?').get(a.toLowerCase());
if (!u) { console.error('Username tidak ditemukan. Lihat daftar: node scripts/reset-password.js --list'); process.exit(1); }
const salt = crypto.randomBytes(16).toString('hex');
const hash = salt + ':' + crypto.scryptSync(b, salt, 64).toString('hex');
db.prepare('UPDATE users SET password_hash=?, active=1 WHERE id=?').run(hash, u.id);
db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
console.log(`Password "${a}" diganti dan akun diaktifkan. Jika login sebelumnya terkunci ("terlalu banyak percobaan"), restart server.`);
