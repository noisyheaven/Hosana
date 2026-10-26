// Menyalin panel admin/kasir (../public/admin) ke folder www/ untuk dibungkus jadi aplikasi Android.
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..', '..', 'public', 'admin');
const dst = path.join(__dirname, '..', 'www');
if (!fs.existsSync(src)) { console.error('Folder sumber tidak ditemukan: ' + src); process.exit(1); }
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true, filter: (f) => path.basename(f) !== 'sw.js' }); // service worker tidak dipakai di APK
const base = (process.env.API_BASE || '').trim().replace(/\/+$/, '');
fs.writeFileSync(path.join(dst, 'config.js'), `// dibuat otomatis oleh prepare-web.js\nwindow.API_BASE = ${JSON.stringify(base)};\n`);
const vend = path.join(dst, 'vendor', 'html5-qrcode.min.js');
console.log(`[web] panel disalin ke www/${base ? ' (alamat server bawaan: ' + base + ')' : ' (alamat server diisi di layar login)'}`);
if (!fs.existsSync(vend)) console.log('[web] catatan: scanner cadangan lokal belum ada. Jalankan "npm run vendor" di folder utama lebih dulu (opsional).');
