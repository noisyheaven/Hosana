// Membuat sertifikat HTTPS self-signed untuk jaringan lokal (kamera HP/browser hanya mau aktif lewat HTTPS).
// Hasil: certs/key.pem & certs/cert.pem. Server otomatis memakai HTTPS bila kedua file ada.
const { spawnSync } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = path.join(__dirname, '..', 'certs'); fs.mkdirSync(dir, { recursive: true });
const ips = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((i) => 'IP:' + i)].join(',');
const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825', '-subj', '/CN=toko-rohani',
  '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'), '-addext', 'subjectAltName=' + san], { stdio: 'inherit' });
if (r.error || r.status !== 0) {
  console.error('\nOpenSSL tidak tersedia / gagal. Alternatif (lebih mudah): pasang "mkcert" (https://github.com/FiloSottile/mkcert), lalu:\n  mkcert -install\n  mkcert -key-file certs/key.pem -cert-file certs/cert.pem localhost 127.0.0.1 ' + (ips[0] || '192.168.1.10'));
  process.exit(1);
}
console.log(`\nSertifikat dibuat di certs/ untuk: ${san}\nJalankan ulang server (npm start) lalu buka https://${ips[0] || 'localhost'}:3000/admin/\nBrowser akan memperingatkan "tidak aman" (wajar untuk sertifikat buatan sendiri): pilih Lanjutkan / Advanced > Proceed.`);
