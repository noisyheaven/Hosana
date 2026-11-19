// Membuat sertifikat HTTPS self-signed untuk jaringan lokal (kamera HP/browser hanya mau aktif lewat HTTPS).
// Hasil: certs/key.pem & certs/cert.pem. Server otomatis memakai HTTPS bila kedua file ada.
// OpenSSL dicari otomatis: PATH, Git for Windows, WAMP, XAMPP, atau lewat OPENSSL_BIN=C:\path\openssl.exe
const { spawnSync } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = path.join(__dirname, '..', 'certs');
const ips = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
const extra = (process.env.EXTRA_IPS || '').split(',').map((x) => x.trim()).filter(Boolean); // mis. EXTRA_IPS=192.168.88.1
const all = [...new Set([...ips, ...extra])];
const san = ['DNS:localhost', 'IP:127.0.0.1', ...all.map((i) => 'IP:' + i)].join(',');

function globDirs(base, sub) { // base\* \sub, tanpa pustaka tambahan
  try { return fs.readdirSync(base).map((d) => path.join(base, d, ...sub)); } catch { return []; }
}
function candidates() {
  const list = [];
  if (process.env.OPENSSL_BIN) list.push(process.env.OPENSSL_BIN);
  list.push('openssl');
  if (process.platform === 'win32') {
    const drives = new Set([path.parse(__dirname).root, 'C:\\', 'D:\\', 'E:\\']);
    for (const d of drives) {
      for (const g of ['Program Files\\Git\\usr\\bin', 'Program Files (x86)\\Git\\usr\\bin', 'xampp\\apache\\bin']) list.push(path.join(d, g, 'openssl.exe'));
      list.push(...globDirs(path.join(d, 'wamp64', 'bin', 'apache'), ['bin', 'openssl.exe']), ...globDirs(path.join(d, 'wamp', 'bin', 'apache'), ['bin', 'openssl.exe']));
    }
  }
  return [...new Set(list)];
}
function findOpenssl() {
  for (const bin of candidates()) {
    if (bin !== 'openssl' && !fs.existsSync(bin)) continue;
    const env = { ...process.env };
    if (!env.OPENSSL_CONF) { // OpenSSL bawaan WAMP/XAMPP perlu tahu lokasi openssl.cnf
      for (const c of [path.join(path.dirname(bin), '..', 'conf', 'openssl.cnf'), path.join(path.dirname(bin), 'openssl.cnf'), path.join(path.dirname(bin), '..', 'openssl.cnf')]) if (fs.existsSync(c)) { env.OPENSSL_CONF = c; break; }
    }
    const v = spawnSync(bin, ['version'], { env, encoding: 'utf8' });
    if (!v.error && v.status === 0) return { bin, env, version: (v.stdout || '').trim() };
  }
  return null;
}

const found = findOpenssl();
if (!found) {
  console.error('\nOpenSSL tidak ditemukan. Pilihan:\n  1) Pasang Git for Windows (https://git-scm.com/download/win; sudah termasuk OpenSSL), lalu jalankan lagi: npm run cert\n  2) Atau tunjuk lokasinya: set OPENSSL_BIN=C:\\lokasi\\openssl.exe  lalu npm run cert\n  3) Atau pasang "mkcert" (https://github.com/FiloSottile/mkcert):\n       mkcert -install\n       mkcert -key-file certs/key.pem -cert-file certs/cert.pem ' + ['localhost', '127.0.0.1', ...all].join(' '));
  process.exit(1);
}
console.log(`Memakai ${found.bin} (${found.version})`);
fs.mkdirSync(dir, { recursive: true });
const r = spawnSync(found.bin, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825', '-subj', '/CN=hosana',
  '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'), '-addext', 'subjectAltName=' + san], { stdio: 'inherit', env: found.env });
if (r.error || r.status !== 0) {
  console.error('\nOpenSSL gagal membuat sertifikat (versi terlalu lama atau konfigurasi hilang). Coba OpenSSL dari Git for Windows (OPENSSL_BIN) atau mkcert.');
  process.exit(1);
}
console.log(`\nSertifikat dibuat di certs/ untuk: ${san}\nPERIKSA: alamat IP yang dipakai HP untuk membuka server harus ada dalam daftar di atas.\nBila belum ada, ulangi dengan: set EXTRA_IPS=192.168.88.1   lalu  npm run cert\nJalankan ulang server (start.bat) lalu buka https://${all[0] || 'localhost'}:3000/admin/\nBrowser akan memperingatkan "tidak aman" (wajar untuk sertifikat buatan sendiri): pilih Lanjutkan / Advanced > Proceed.`);
