// Menyalin pustaka scanner cadangan (html5-qrcode) ke panel admin agar scan kamera jalan tanpa internet.
const fs = require('fs'), path = require('path');
const from = path.join(__dirname, '..', 'node_modules', 'html5-qrcode', 'html5-qrcode.min.js');
const to = path.join(__dirname, '..', 'public', 'admin', 'vendor', 'html5-qrcode.min.js');
if (!fs.existsSync(from)) { console.error('Pustaka belum terpasang. Jalankan dulu: npm install'); process.exit(1); }
fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to);
console.log('Scanner lokal terpasang: public/admin/vendor/html5-qrcode.min.js');
